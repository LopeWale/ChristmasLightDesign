from __future__ import annotations

from pathlib import Path
from typing import Any
import cv2
import numpy as np
from scipy.signal import find_peaks

from app.schemas import ArchitecturalBuildingSpecModel, BalconySpecModel


def _clamp_rgb(rgb: np.ndarray | tuple[float, float, float]) -> tuple[int, int, int]:
    arr = np.clip(np.asarray(rgb, dtype=np.float64), 35.0, 245.0).round().astype(int)
    return (int(arr[0]), int(arr[1]), int(arr[2]))


def _segment_building_bbox(bgr: np.ndarray) -> tuple[int, int, int, int, float]:
    """
    Estimate primary facade bounding box (x0, y0, x1, y1) and upper roof peak prominence
    by separating uniform sky rows from textured building foreground.
    """
    h, w, _ = bgr.shape
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    grad = np.hypot(gx, gy)

    # Sky mask heuristic: upper region with low gradient & color close to top border median
    top_strip = bgr[: max(8, h // 14), :, :].astype(np.float32)
    sky_bgr = np.median(top_strip.reshape(-1, 3), axis=0)
    color_dist = np.linalg.norm(bgr.astype(np.float32) - sky_bgr[None, None, :], axis=2)

    fg_mask = (color_dist > 22.0) | (grad > 28.0)
    # Ignore bottom 5% street/curb strip
    fg_mask[int(h * 0.96) :, :] = False

    ys, xs = np.where(fg_mask)
    if len(xs) < (h * w * 0.05):
        return int(w * 0.12), int(h * 0.16), int(w * 0.88), int(h * 0.92), 0.0

    x0 = int(np.percentile(xs, 3))
    x1 = int(np.percentile(xs, 97))
    y0 = int(np.percentile(ys, 2))
    y1 = int(np.percentile(ys, 97))

    if x1 - x0 < w * 0.2:
        x0, x1 = int(w * 0.12), int(w * 0.88)
    if y1 - y0 < h * 0.2:
        y0, y1 = int(h * 0.16), int(h * 0.92)

    # Measure top silhouette y_top(x) across left, center, and right thirds to detect gable peak
    col_tops: list[tuple[int, int]] = []
    for x in range(x0, x1, max(1, (x1 - x0) // 30)):
        col_ys = np.where(fg_mask[:, x])[0]
        if len(col_ys) > 0:
            col_tops.append((x, int(col_ys[0])))

    prominence = 0.0
    if len(col_tops) >= 9:
        n = len(col_tops)
        left_y = np.median([p[1] for p in col_tops[: n // 4]])
        mid_y = np.min([p[1] for p in col_tops[n // 3 : (2 * n) // 3]])
        right_y = np.median([p[1] for p in col_tops[(3 * n) // 4 :]])
        side_y = 0.5 * (left_y + right_y)
        prominence = max(0.0, float(side_y - mid_y) / max(1.0, float(y1 - y0)))

    return x0, y0, x1, y1, prominence


def analyze_facade_images(
    image_paths: list[Path],
    partial_overrides: dict[str, Any] | None = None,
) -> ArchitecturalBuildingSpecModel:
    """
    Analyze uploaded exterior photos / video keyframes using OpenCV to infer story count,
    roof silhouette, facade colors, window bays, and multi-floor balconies.
    """
    overrides = dict(partial_overrides or {})
    valid_bgrs: list[np.ndarray] = []

    for p in image_paths[:6]:
        img = cv2.imread(str(p), cv2.IMREAD_COLOR)
        if img is None or img.size == 0:
            continue
        h, w = img.shape[:2]
        scale = min(1.0, 640.0 / max(h, w))
        if scale < 1.0:
            img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        valid_bgrs.append(img)

    if not valid_bgrs:
        base = ArchitecturalBuildingSpecModel(
            sourceSummary="Default 3-story architectural template"
        )
        return base.model_copy(update=overrides) if overrides else base

    primary = valid_bgrs[0]
    gray_raw = cv2.cvtColor(primary, cv2.COLOR_BGR2GRAY)
    mean_luma = float(gray_raw.mean())

    # Lift extremely dark twilight/night frames for structural edge analysis
    working = primary.copy()
    if mean_luma < 32.0:
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        lifted = clahe.apply(gray_raw)
        working = cv2.cvtColor(lifted, cv2.COLOR_GRAY2BGR)

    x0, y0, x1, y1, peak_prominence = _segment_building_bbox(working)
    bldg_w = max(20, x1 - x0)
    bldg_h = max(20, y1 - y0)
    aspect_hw = float(bldg_h) / float(bldg_w)

    roi_bgr = primary[y0:y1, x0:x1]
    roi_work_gray = cv2.cvtColor(working[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)

    # Roof style detection from upper silhouette peak prominence
    if peak_prominence >= 0.11:
        roof_style = "pitched_gable"
        roof_pitch = round(min(38.0, 14.0 + peak_prominence * 95.0), 1)
    else:
        roof_style = "flat_parapet"
        roof_pitch = 2.0

    # Horizontal floor-band & balcony-ledge analysis via vertical derivative projection
    body_y0 = int(bldg_h * (0.28 if roof_style == "pitched_gable" else 0.06))
    body_gray = roi_work_gray[body_y0:, :]
    body_h = max(16, body_gray.shape[0])

    abs_gy = np.abs(cv2.Sobel(body_gray, cv2.CV_32F, 0, 1, ksize=3))
    row_energy = abs_gy.mean(axis=1)
    kernel_len = max(5, (body_h // 25) | 1)
    smoothed_row = np.convolve(row_energy, np.ones(kernel_len) / kernel_len, mode="same")

    min_floor_px = max(12, int(body_h * 0.18))
    energy_thresh = float(np.percentile(smoothed_row, 62))
    peaks, _ = find_peaks(smoothed_row, distance=min_floor_px, height=max(8.0, energy_thresh))

    # Combine aspect ratio and horizontal structural bands to estimate story count (1..8)
    if aspect_hw < 0.45 and roof_style == "pitched_gable":
        floors = 1
    elif aspect_hw < 0.68:
        floors = 2 if len(peaks) >= 3 else 1
    elif aspect_hw < 0.92:
        floors = 3 if (len(peaks) >= 4 and roof_style == "flat_parapet") else 2
    elif aspect_hw < 1.38:
        floors = max(3, min(4, len(peaks) if len(peaks) >= 3 else 3))
    else:
        floors = max(3, min(6, len(peaks) if len(peaks) >= 3 else 4))

    floors = int(np.clip(floors, 1, 8))

    # Vertical window bay estimation via horizontal Sobel-X projection
    abs_gx = np.abs(cv2.Sobel(body_gray, cv2.CV_32F, 1, 0, ksize=3))
    col_energy = abs_gx.mean(axis=0)
    col_peaks, _ = find_peaks(
        col_energy,
        distance=max(10, bldg_w // 8),
        height=max(6.0, float(np.percentile(col_energy, 65))),
    )
    window_bays = int(np.clip(max(2, len(col_peaks) // 2), 2, 6))

    # Extract facade wall, trim, and roof RGB colors from actual image pixels
    if mean_luma < 20.0:
        wall_rgb = (156, 112, 94)
        trim_rgb = (228, 232, 238)
        roof_rgb = (58, 62, 70)
    else:
        mid_patch = roi_bgr[int(bldg_h * 0.25) : int(bldg_h * 0.80), int(bldg_w * 0.15) : int(bldg_w * 0.85)]
        flat_px = mid_patch.reshape(-1, 3)
        luma_px = 0.114 * flat_px[:, 0] + 0.587 * flat_px[:, 1] + 0.299 * flat_px[:, 2]
        # Exclude dark window glass (< 55) and blown highlights (> 240) when sampling wall color
        mid_mask = (luma_px >= 55) & (luma_px <= 232)
        if np.any(mid_mask):
            med_bgr = np.median(flat_px[mid_mask], axis=0)
        else:
            med_bgr = np.median(flat_px, axis=0)
        wall_rgb = _clamp_rgb((med_bgr[2], med_bgr[1], med_bgr[0]))

        bright_mask = luma_px >= np.percentile(luma_px, 85)
        if np.any(bright_mask):
            trim_bgr = np.median(flat_px[bright_mask], axis=0)
            trim_rgb = _clamp_rgb((trim_bgr[2], trim_bgr[1], trim_bgr[0]))
        else:
            trim_rgb = (236, 238, 242)

        top_patch = roi_bgr[: max(6, int(bldg_h * 0.16)), :]
        top_bgr = np.median(top_patch.reshape(-1, 3), axis=0)
        roof_rgb = _clamp_rgb((top_bgr[2] * 0.75, top_bgr[1] * 0.75, top_bgr[0] * 0.75))

    # Detect prominent horizontal balcony slabs/railings on upper floors
    balconies: list[BalconySpecModel] = []
    if floors >= 2:
        for fl in range(2, min(floors, 5) + 1):
            # Band near floor deck level from top of building down
            rel_y = 1.0 - (float(fl - 1) / float(floors))
            band_center = int(rel_y * body_h)
            y_lo = max(0, band_center - max(6, body_h // 14))
            y_hi = min(body_h, band_center + max(6, body_h // 14))
            if y_hi > y_lo:
                band_slice = abs_gy[y_lo:y_hi, :]
                strong_cols = (band_slice.max(axis=0) > max(28.0, energy_thresh * 1.15)).astype(np.float32)
                span_ratio = float(strong_cols.mean())
                if span_ratio >= 0.24 or (floors >= 3 and roof_style == "flat_parapet" and fl in (2, 3)):
                    active_xs = np.where(strong_cols > 0.5)[0]
                    if len(active_xs) > 4:
                        cx_norm = ((float(np.median(active_xs)) / float(bldg_w)) - 0.5) * 0.65
                    else:
                        cx_norm = -0.16 if fl % 2 == 0 else 0.16
                    cx_norm = float(np.clip(round(cx_norm, 2), -0.32, 0.32))
                    balconies.append(
                        BalconySpecModel(
                            id=f"cv-balcony-f{fl}",
                            floor=fl,
                            wallFace="front",
                            centerOffsetNorm=cx_norm,
                            widthMeters=3.4,
                            depthMeters=1.4,
                            mountStyle="cantilevered",
                            railingType="metal_picket",
                        )
                    )

    # Set proportional metric footprint width/depth from building aspect & floor height
    est_height_m = floors * 3.05
    est_width_m = float(np.clip(est_height_m / max(0.38, aspect_hw), 8.5, 22.0))
    est_depth_m = float(np.clip(est_width_m * 0.78, 7.5, 16.0))
    hw = round(est_width_m * 0.5, 2)
    hd = round(est_depth_m * 0.5, 2)

    archetype = (
        "multi_story_condo"
        if floors >= 3 and roof_style == "flat_parapet"
        else "townhouse"
        if floors >= 3
        else "single_family_gable"
        if roof_style == "pitched_gable"
        else "modern_box"
    )

    spec_dict: dict[str, Any] = {
        "archetype": archetype,
        "floors": floors,
        "metersPerFloor": 3.05,
        "footprintPolygonMeters": [(-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd)],
        "roofStyle": roof_style,
        "roofPitchDegrees": roof_pitch,
        "wallColorRgb": wall_rgb,
        "trimColorRgb": trim_rgb,
        "roofColorRgb": roof_rgb,
        "windowBaysPerFloor": window_bays,
        "hasGarage": bool(floors <= 2 and est_width_m >= 12.5),
        "balconies": [b.model_dump() for b in balconies],
        "sourceSummary": f"OpenCV multi-view facade extraction ({floors}F, {len(balconies)} balconies)",
    }

    for k, v in overrides.items():
        if v is not None:
            spec_dict[k] = v

    # Ensure no balcony sits above final floor count after overrides
    final_floors = int(spec_dict["floors"])
    spec_dict["balconies"] = [
        b for b in spec_dict.get("balconies", []) if int(b["floor"]) <= final_floors
    ]

    return ArchitecturalBuildingSpecModel.model_validate(spec_dict)
