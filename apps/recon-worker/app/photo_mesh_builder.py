from __future__ import annotations

from pathlib import Path
import cv2
import numpy as np
from PIL import Image
import trimesh
from trimesh.visual import TextureVisuals
from trimesh.visual.material import PBRMaterial

from app.schemas import ArchitecturalBuildingSpecModel
from app.synthetic_backend import (
    FRONT_DOOR_HEIGHT_UNITS,
    GARAGE_DOOR_HEIGHT_UNITS,
    _make_box,
    _make_gable_prism_along_x,
)


def _make_textured_quad_box(
    min_xyz: tuple[float, float, float],
    max_xyz: tuple[float, float, float],
    pil_tex: Image.Image,
    mat_name: str,
    roughness: float = 0.82,
    metallic: float = 0.06,
) -> trimesh.Trimesh:
    """
    Build an axis-aligned 6-face 3D box (24 unmerged vertices) with exact unit outward
    vertex normals and UV-mapped `PBRMaterial` texture on all 6 faces.
    """
    x0, y0, z0 = min_xyz
    x1, y1, z1 = max_xyz

    # 6 quads, each ordered CCW when viewed from outside (+Z, -Z, +X, -X, +Y, -Y)
    verts = np.array(
        [
            # +Z front
            [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
            # -Z rear
            [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0],
            # +X right
            [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1],
            # -X left
            [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0],
            # +Y top
            [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0],
            # -Y bottom
            [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
        ],
        dtype=np.float64,
    )

    faces = np.array(
        [
            [q * 4 + 0, q * 4 + 1, q * 4 + 2]
            if half == 0
            else [q * 4 + 0, q * 4 + 2, q * 4 + 3]
            for q in range(6)
            for half in range(2)
        ],
        dtype=np.int64,
    )

    normals = np.repeat(
        np.array(
            [
                [0.0, 0.0, 1.0],
                [0.0, 0.0, -1.0],
                [1.0, 0.0, 0.0],
                [-1.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, -1.0, 0.0],
            ],
            dtype=np.float64,
        ),
        4,
        axis=0,
    )

    uv = np.tile(
        np.array(
            [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]], dtype=np.float32
        ),
        (6, 1),
    )

    mat = PBRMaterial(
        name=mat_name,
        baseColorTexture=pil_tex,
        metallicFactor=metallic,
        roughnessFactor=roughness,
    )
    return trimesh.Trimesh(
        vertices=verts,
        faces=faces,
        vertex_normals=normals,
        visual=TextureVisuals(uv=uv, material=mat),
        process=False,
    )


def _make_single_textured_wall_quad(
    corners_ccw: list[tuple[float, float, float]],
    normal_xyz: tuple[float, float, float],
    pil_tex: Image.Image,
    mat_name: str,
) -> trimesh.Trimesh:
    verts = np.asarray(corners_ccw, dtype=np.float64)
    faces = np.array([[0, 1, 2], [0, 2, 3]], dtype=np.int64)
    normals = np.tile(np.asarray(normal_xyz, dtype=np.float64), (4, 1))
    uv = np.array(
        [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]], dtype=np.float32
    )
    mat = PBRMaterial(
        name=mat_name,
        baseColorTexture=pil_tex,
        metallicFactor=0.07,
        roughnessFactor=0.77,
    )
    return trimesh.Trimesh(
        vertices=verts,
        faces=faces,
        vertex_normals=normals,
        visual=TextureVisuals(uv=uv, material=mat),
        process=False,
    )


def _make_side_and_rear_shell(
    min_xyz: tuple[float, float, float],
    max_xyz: tuple[float, float, float],
    pil_tex: Image.Image,
    mat_name: str,
) -> trimesh.Trimesh:
    """
    Build the Rear (-Z), Right (+X), Left (-X), and Bottom (-Y) walls of the main building
    mass WITHOUT an internal +Z face, so recessed 2.5D features on `front_facade_walls`
    never experience poke-through or Z-fighting.
    """
    x0, y0, z0 = min_xyz
    x1, y1, z1 = max_xyz

    verts = np.array(
        [
            # -Z rear
            [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0],
            # +X right
            [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1],
            # -X left
            [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0],
            # -Y bottom
            [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
        ],
        dtype=np.float64,
    )

    faces = np.array(
        [
            [q * 4 + 0, q * 4 + 1, q * 4 + 2]
            if half == 0
            else [q * 4 + 0, q * 4 + 2, q * 4 + 3]
            for q in range(4)
            for half in range(2)
        ],
        dtype=np.int64,
    )

    normals = np.repeat(
        np.array(
            [
                [0.0, 0.0, -1.0],
                [1.0, 0.0, 0.0],
                [-1.0, 0.0, 0.0],
                [0.0, -1.0, 0.0],
            ],
            dtype=np.float64,
        ),
        4,
        axis=0,
    )

    uv = np.tile(
        np.array(
            [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]], dtype=np.float32
        ),
        (4, 1),
    )

    mat = PBRMaterial(
        name=mat_name,
        baseColorTexture=pil_tex,
        metallicFactor=0.07,
        roughnessFactor=0.78,
    )
    return trimesh.Trimesh(
        vertices=verts,
        faces=faces,
        vertex_normals=normals,
        visual=TextureVisuals(uv=uv, material=mat),
        process=False,
    )


def _make_single_textured_wall_quad(
    corners_ccw: list[tuple[float, float, float]],
    normal_xyz: tuple[float, float, float],
    pil_tex: Image.Image,
    mat_name: str,
) -> trimesh.Trimesh:
    verts = np.asarray(corners_ccw, dtype=np.float64)
    faces = np.array([[0, 1, 2], [0, 2, 3]], dtype=np.int64)
    normals = np.tile(np.asarray(normal_xyz, dtype=np.float64), (4, 1))
    uv = np.array(
        [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]], dtype=np.float32
    )
    mat = PBRMaterial(
        name=mat_name,
        baseColorTexture=pil_tex,
        metallicFactor=0.07,
        roughnessFactor=0.77,
    )
    return trimesh.Trimesh(
        vertices=verts,
        faces=faces,
        vertex_normals=normals,
        visual=TextureVisuals(uv=uv, material=mat),
        process=False,
    )


def _select_sharpest_bgr_views(image_paths: list[Path]) -> list[np.ndarray]:
    views: list[tuple[float, np.ndarray]] = []
    for p in image_paths[:8]:
        bgr = cv2.imread(str(p), cv2.IMREAD_COLOR)
        if bgr is None or bgr.size == 0:
            continue
        h, w = bgr.shape[:2]
        scale = min(1.0, 1280.0 / max(h, w))
        if scale < 1.0:
            bgr = cv2.resize(
                bgr, (int(round(w * scale)), int(round(h * scale))), interpolation=cv2.INTER_AREA
            )
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        sharp = float(cv2.Laplacian(gray, cv2.CV_32F).var())
        views.append((sharp, bgr))

    views.sort(key=lambda item: item[0], reverse=True)
    return [v[1] for v in views]


def _segment_facade_and_masses(bgr: np.ndarray) -> dict[str, object]:
    """
    Segment sky, foreground ground/driveway foundation line, converging main tower
    trapezoid, optional rooftop setback, and optional attached side garage/wing.
    """
    h, w = bgr.shape[:2]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    grad = np.hypot(gx, gy)

    # 1. Connected-component sky mask seeded from top image border
    top_strip = bgr[: max(6, int(h * 0.07)), int(w * 0.05) : int(w * 0.95)].astype(np.float32)
    sky_med = np.median(top_strip.reshape(-1, 3), axis=0)
    sky_dist = np.linalg.norm(bgr.astype(np.float32) - sky_med[None, None, :], axis=2)
    sky_cand = ((sky_dist < 40.0) & (grad < 28.0)).astype(np.uint8)

    num_labels, labels = cv2.connectedComponents(sky_cand)
    top_labels = set(np.unique(labels[0, int(w * 0.04) : int(w * 0.96)])) - {0}
    sky_mask = np.isin(labels, list(top_labels))

    y_top = np.full(w, h, dtype=np.int32)
    x_margin_l = max(2, int(w * 0.03))
    x_margin_r = min(w - 2, int(w * 0.96))
    for x in range(x_margin_l, x_margin_r):
        non_sky = np.where(~sky_mask[:, x])[0]
        if len(non_sky) > 0:
            y_top[x] = int(non_sky[0])

    # 2. Detect foreground driveway / lawn foundation curb line near bottom of facade
    ground_patch = bgr[int(h * 0.86) : int(h * 0.98), int(w * 0.22) : int(w * 0.78)]
    ground_med = np.median(ground_patch.reshape(-1, 3).astype(np.float32), axis=0)
    ground_std = float(np.std(ground_patch.reshape(-1, 3).astype(np.float32)))

    y_foundation = int(h * 0.90)
    if ground_std < 38.0:
        # Uniform foreground driveway/lawn present: scan upward to find building base curb
        center_slice = bgr[:, int(w * 0.24) : int(w * 0.76)].astype(np.float32)
        row_ground_dist = np.linalg.norm(
            np.median(center_slice, axis=1) - ground_med[None, :], axis=1
        )
        for y_cand in range(int(h * 0.86), int(h * 0.52), -1):
            # Require sustained non-ground facade color above y_cand
            above_window = row_ground_dist[max(0, y_cand - 18) : y_cand]
            if len(above_window) >= 8 and float(np.median(above_window)) >= 26.0:
                y_foundation = y_cand
                break

    # 3. Identify primary multi-story tower horizontal span [x_top_l, x_top_r]
    mid_cols = y_top[int(w * 0.22) : int(w * 0.78)]
    valid_mid = mid_cols[mid_cols < int(h * 0.75)]
    y_roof_ref = int(np.percentile(valid_mid, 25)) if len(valid_mid) > 8 else int(h * 0.16)
    tower_h_est = max(40, y_foundation - y_roof_ref)

    tower_cols = np.where(
        (np.arange(w) >= x_margin_l)
        & (np.arange(w) < x_margin_r)
        & (y_top <= y_roof_ref + int(0.18 * tower_h_est))
    )[0]

    if len(tower_cols) >= max(16, int(w * 0.22)):
        x_top_l = int(np.percentile(tower_cols, 2))
        x_top_r = int(np.percentile(tower_cols, 98))
    else:
        x_top_l = int(w * 0.14)
        x_top_r = int(w * 0.86)

    # Separate optional rooftop setback (narrower tier rising above main parapet corners)
    corner_band_l = y_top[x_top_l : min(w, x_top_l + max(8, (x_top_r - x_top_l) // 7))]
    corner_band_r = y_top[max(0, x_top_r - max(8, (x_top_r - x_top_l) // 7)) : x_top_r + 1]
    y_parapet_l = int(np.median(corner_band_l)) if len(corner_band_l) > 0 else y_roof_ref
    y_parapet_r = int(np.median(corner_band_r)) if len(corner_band_r) > 0 else y_roof_ref
    y_parapet = int(0.5 * (y_parapet_l + y_parapet_r))

    interior_top = y_top[
        x_top_l + (x_top_r - x_top_l) // 6 : x_top_r - (x_top_r - x_top_l) // 6
    ]
    y_min_interior = int(np.percentile(interior_top, 10)) if len(interior_top) > 4 else y_parapet
    has_rooftop_setback = (y_parapet - y_min_interior) >= max(10, int(0.03 * tower_h_est))
    setback_crop: np.ndarray | None = None
    if has_rooftop_setback:
        sb_y0 = max(0, y_min_interior)
        sb_y1 = min(h, y_parapet + 4)
        sb_x0 = x_top_l + (x_top_r - x_top_l) // 6
        sb_x1 = x_top_r - (x_top_r - x_top_l) // 6
        if sb_y1 > sb_y0 + 6 and sb_x1 > sb_x0 + 16:
            setback_crop = bgr[sb_y0:sb_y1, sb_x0:sb_x1].copy()

    # 4. Detect optional attached lower side wing / garage (e.g. right-side 1-story garage bay)
    right_wing_crop: np.ndarray | None = None
    right_wing_height_ratio = 0.0
    if x_top_r < int(w * 0.92):
        rw_x0 = x_top_r + 4
        # Exclude rightmost 6% border to ignore mobile OS screenshot edge handles
        rw_x1 = min(int(w * 0.94), w - 4)
        if rw_x1 - rw_x0 >= max(14, int(w * 0.05)):
            wing_col_tops: list[int] = []
            for x_w in range(rw_x0, rw_x1):
                # Search inside the lower 72% of tower height so upper edge UI overlays are ignored
                y_search_start = y_parapet + int(0.26 * (y_foundation - y_parapet))
                col_fg = np.where(
                    (sky_dist[y_search_start:y_foundation, x_w] > 26.0)
                    | (np.abs(gy[y_search_start:y_foundation, x_w]) > 22.0)
                )[0]
                if len(col_fg) > 6:
                    wing_col_tops.append(y_search_start + int(col_fg[0]))
            if len(wing_col_tops) >= max(8, (rw_x1 - rw_x0) // 2):
                rw_top_y = int(np.median(wing_col_tops))
                ratio = float(y_foundation - rw_top_y) / float(
                    max(1, y_foundation - y_parapet)
                )
                if 0.28 <= ratio <= 0.70:
                    right_wing_height_ratio = ratio
                    right_wing_crop = bgr[
                        rw_top_y:y_foundation, rw_x0 : min(w - 2, int(w * 0.98))
                    ].copy()

    # 5. Estimate perspective convergence lines x_left(y) and x_right(y) from parapet to foundation
    abs_gx = np.abs(gx)
    corridor = max(12, int(w * 0.07))

    def trace_side_x(x_seed: int, y_a: int, y_b: int, prefer_outer: str) -> float:
        lo = max(2, x_seed - corridor)
        hi = min(w - 2, x_seed + corridor)
        if hi <= lo + 2 or y_b <= y_a + 4:
            return float(x_seed)
        prof = abs_gx[y_a:y_b, lo:hi].mean(axis=0)
        peak_thresh = float(prof.max()) * 0.55
        strong = np.where(prof >= max(10.0, peak_thresh))[0]
        if len(strong) == 0:
            return float(x_seed)
        chosen = int(strong[0]) if prefer_outer == "left" else int(strong[-1])
        return float(lo + chosen)

    span_h = max(40, y_foundation - y_parapet)
    y_band_top = (y_parapet + int(0.06 * span_h), y_parapet + int(0.32 * span_h))
    # Stop right-edge lower tracking above any attached right wing so the wing doesn't pull the line inward
    right_max_frac = (1.0 - right_wing_height_ratio - 0.04) if right_wing_height_ratio > 0 else 0.88
    y_band_mid_r = (
        y_parapet + int(0.32 * span_h),
        y_parapet + int(max(0.45, right_max_frac) * span_h),
    )
    y_band_bot_l = (y_parapet + int(0.58 * span_h), y_foundation - int(0.04 * span_h))

    xl_1 = trace_side_x(x_top_l, *y_band_top, "left")
    xl_2 = trace_side_x(int(xl_1) - corridor // 3, *y_band_bot_l, "left")
    ya_l = 0.5 * sum(y_band_top)
    yb_l = 0.5 * sum(y_band_bot_l)
    slope_l = np.clip((xl_2 - xl_1) / max(20.0, yb_l - ya_l), -0.22, 0.12)
    x_tl = float(np.clip(xl_1 + slope_l * (y_parapet - ya_l), 0, w - 1))
    x_bl = float(np.clip(xl_1 + slope_l * (y_foundation - ya_l), 0, w - 1))

    xr_1 = trace_side_x(x_top_r, *y_band_top, "right")
    xr_2 = trace_side_x(int(xr_1) + corridor // 4, *y_band_mid_r, "right")
    ya_r = 0.5 * sum(y_band_top)
    yb_r = 0.5 * sum(y_band_mid_r)
    slope_r = np.clip((xr_2 - xr_1) / max(20.0, yb_r - ya_r), -0.12, 0.22)
    x_tr = float(np.clip(xr_1 + slope_r * (y_parapet - ya_r), x_tl + 40, w - 1))
    x_br = float(np.clip(xr_1 + slope_r * (y_foundation - ya_r), x_bl + 40, w - 1))

    src_quad = np.array(
        [
            [x_tl, float(y_parapet)],
            [x_tr, float(y_parapet)],
            [x_br, float(y_foundation)],
            [x_bl, float(y_foundation)],
        ],
        dtype=np.float32,
    )
    tex_size = 1024
    dst_quad = np.array(
        [
            [0.0, 0.0],
            [float(tex_size - 1), 0.0],
            [float(tex_size - 1), float(tex_size - 1)],
            [0.0, float(tex_size - 1)],
        ],
        dtype=np.float32,
    )
    homography = cv2.getPerspectiveTransform(src_quad, dst_quad)
    rectified_bgr = cv2.warpPerspective(
        bgr,
        homography,
        (tex_size, tex_size),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE,
    )

    avg_px_w = max(40.0, 0.5 * ((x_tr - x_tl) + (x_br - x_bl)))
    px_h = float(max(40, y_foundation - y_parapet))
    true_aspect_hw = px_h / avg_px_w

    ground_strip = bgr[min(h - 16, y_foundation + 6) : max(min(h - 8, y_foundation + 22), int(h * 0.97)), int(w * 0.12) : int(w * 0.88)]
    if ground_strip.size == 0:
        ground_strip = np.full((64, 64, 3), ground_med.astype(np.uint8), dtype=np.uint8)

    return {
        "rectified_bgr": rectified_bgr,
        "true_aspect_hw": float(np.clip(true_aspect_hw, 0.35, 2.2)),
        "setback_crop": setback_crop,
        "right_wing_crop": right_wing_crop,
        "right_wing_height_ratio": right_wing_height_ratio,
        "ground_strip": ground_strip,
    }


def _synthesize_side_cladding_texture(
    rectified_bgr: np.ndarray, secondary_bgr: np.ndarray | None = None
) -> Image.Image:
    """
    Build a seamless 512x512 side/rear architectural cladding texture that preserves the exact
    per-story material bands of the front facade (e.g. warm horizontal cedar on floor 1,
    charcoal architectural metal panels on floors 2-3) without duplicating front doors/windows.
    """
    if secondary_bgr is not None and secondary_bgr.size > 0:
        resized = cv2.resize(secondary_bgr, (512, 512), interpolation=cv2.INTER_AREA)
        return Image.fromarray(cv2.cvtColor(resized, cv2.COLOR_BGR2RGB))

    small = cv2.resize(rectified_bgr, (512, 512), interpolation=cv2.INTER_AREA)
    # Extract clean per-row architectural cladding color from outer wall margins (ignoring windows/alcoves)
    margin_cols = np.concatenate([small[:, 14:58, :], small[:, 454:498, :]], axis=1)  # (512, 88, 3)
    margin_luma = margin_cols.mean(axis=2)  # (512, 88)
    row_p65 = np.percentile(margin_luma, 65, axis=1, keepdims=True)
    # Keep pixels near the upper-middle cladding tone per row (rejects dark doorway alcoves & reflective glass)
    row_bgr = np.zeros((512, 3), dtype=np.float32)
    for r in range(512):
        mask = np.abs(margin_luma[r] - row_p65[r, 0]) <= 22.0
        if np.any(mask):
            row_bgr[r] = np.median(margin_cols[r, mask], axis=0)
        else:
            row_bgr[r] = np.median(margin_cols[r], axis=0)

    # Smooth slightly vertically while preserving sharp horizontal siding/panel seam lines
    tiled = np.repeat(row_bgr[:, None, :], 512, axis=1)
    # Add subtle architectural vertical panel seams on upper metal panels
    for x_joint in (128, 256, 384):
        tiled[:, x_joint : x_joint + 2, :] *= 0.88
    tiled_u8 = np.clip(tiled, 0, 255).astype(np.uint8)

    return Image.fromarray(cv2.cvtColor(tiled_u8, cv2.COLOR_BGR2RGB))


def _build_ground_pad_texture(ground_strip_bgr: np.ndarray) -> Image.Image:
    """Create a 512x512 ground texture from the photo's actual driveway/walkway/lawn foreground."""
    base = cv2.resize(ground_strip_bgr, (512, 512), interpolation=cv2.INTER_LINEAR)
    # Blend mirror halves to eliminate tiling seams across the ground plane
    blended = cv2.addWeighted(base, 0.65, base[:, ::-1, :], 0.35, 0.0)
    return Image.fromarray(cv2.cvtColor(blended, cv2.COLOR_BGR2RGB))


def _compute_facade_relief_and_door_u(
    rectified_bgr: np.ndarray, grid_nx: int = 64, grid_ny: int = 64
) -> tuple[np.ndarray, float]:
    """
    Compute a metric Z-offset field `relief[gy, gx]` in meters (`[-0.48m .. +0.05m]`)
    over the rectified front facade (`gy=0` bottom foundation .. `gy=grid_ny-1` top parapet)
    and return `(relief_grid, door_center_u_norm_in_minus_05_to_plus_05)`:
      - Deep ground-reaching dark entry alcove: `-0.46m` recessed 3D walk-in doorway
      - Framed interior glass windows: `-0.07m` recessed panes
      - Cladding seams & mid-facade material transition trim: `+0.03m` crisp architectural relief
    """
    small_bgr = cv2.resize(
        rectified_bgr, (grid_nx, grid_ny), interpolation=cv2.INTER_AREA
    )
    # Flip vertically so row 0 = bottom (y=0m) and row grid_ny-1 = top (y=bldg_h)
    flipped_bgr = small_bgr[::-1, :, :]
    gray = cv2.cvtColor(flipped_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)

    relief = np.zeros((grid_ny, grid_nx), dtype=np.float64)

    # 1. Detect recessed ground-floor doorway / entry alcove (darkest vertical ground slot)
    ground_rows = max(6, int(grid_ny * 0.38))
    ground_gray = gray[:ground_rows, :]
    col_luma = ground_gray.mean(axis=0)
    # Exclude 1-cell outer border
    inner_luma = col_luma[2 : grid_nx - 2]
    min_col_idx = int(np.argmin(inner_luma)) + 2
    med_ground_luma = float(np.median(inner_luma))

    door_u_norm = (float(min_col_idx) / float(max(1, grid_nx - 1))) - 0.5
    if float(col_luma[min_col_idx]) < min(48.0, med_ground_luma - 22.0):
        # Genuine dark recessed entry alcove detected (e.g. left alcove on 1007 N Shartel Ave!)
        alcove_mask = np.zeros_like(gray, dtype=np.float32)
        dark_thresh = float(col_luma[min_col_idx]) + 20.0
        x_lo = max(1, min_col_idx - int(grid_nx * 0.08))
        x_hi = min(grid_nx - 1, min_col_idx + int(grid_nx * 0.08) + 1)
        alcove_sub = (gray[:ground_rows, x_lo:x_hi] <= dark_thresh).astype(np.float32)
        alcove_mask[:ground_rows, x_lo:x_hi] = alcove_sub
        alcove_smooth = cv2.GaussianBlur(alcove_mask, (3, 3), 0)
        relief -= 0.46 * alcove_smooth
    else:
        door_u_norm = float(np.clip(door_u_norm, -0.35, 0.35))

    # 2. Detect smooth reflective/glass interior window panes (low interior texture gradient, bounded away from borders)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    grad = np.hypot(gx, gy)
    hsv = cv2.cvtColor(flipped_bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    sat = hsv[:, :, 1]

    # Sky-reflective or dark glass windows differ noticeably in luma from median wall cladding
    wall_med_gray = float(np.median(gray))
    b_ch = flipped_bgr[:, :, 0].astype(np.float32)
    r_ch = flipped_bgr[:, :, 2].astype(np.float32)
    cool_or_dark_glass = (
        (np.abs(gray - wall_med_gray) >= 18.0)
        & (((b_ch >= r_ch + 2.0) & (sat < 60.0) & (grad < 16.0)) | ((gray < 48.0) & (grad < 14.0)))
    )
    win_mask = cool_or_dark_glass.astype(np.float32)
    # Zero out outer 2-cell perimeter so main wall panels near borders aren't recessed
    win_mask[:2, :] = 0.0
    win_mask[-2:, :] = 0.0
    win_mask[:, :2] = 0.0
    win_mask[:, -2:] = 0.0
    win_smooth = cv2.GaussianBlur(win_mask, (3, 3), 0)
    relief -= 0.06 * win_smooth

    # 3. Subtle architectural seam relief (kept tight so flat metal panels stay crisp and wave-free)
    norm_grad = grad / max(1.0, float(np.percentile(grad, 95)))
    relief += 0.012 * np.clip(norm_grad, 0.0, 1.0)

    # Clamp perimeter edges to 0.0 so the front relief mesh joins flush and watertight with the 3D side/roof walls!
    relief[0, :] = 0.0
    relief[-1, :] = 0.0
    relief[:, 0] = 0.0
    relief[:, -1] = 0.0

    return relief, float(np.clip(door_u_norm, -0.42, 0.42))


def _build_relief_facade_mesh(
    x0: float,
    x1: float,
    y0: float,
    y1: float,
    z_front: float,
    relief: np.ndarray,
    rectified_bgr: np.ndarray,
) -> trimesh.Trimesh:
    """
    Triangulate a `(grid_ny x grid_nx)` 2.5D architectural facade mesh on `[x0..x1] x [y0..y1]`
    with exact outward-pointing unit vertex normals and 1:1 perspective-rectified UV coordinates.
    """
    ny, nx = relief.shape
    us = np.linspace(0.0, 1.0, nx, dtype=np.float64)
    vs = np.linspace(0.0, 1.0, ny, dtype=np.float64)
    uu, vv = np.meshgrid(us, vs)  # (ny, nx), row 0 = bottom (v=0), row ny-1 = top (v=1)

    xs = x0 + (x1 - x0) * uu
    ys = y0 + (y1 - y0) * vv
    zs = z_front + relief

    verts = np.column_stack([xs.reshape(-1), ys.reshape(-1), zs.reshape(-1)])
    uv = np.column_stack([uu.reshape(-1), vv.reshape(-1)]).astype(np.float32)

    # Vectorized grid triangulation: CCW when viewed from +Z -> outward normal strictly +Z
    gy_idx, gx_idx = np.meshgrid(
        np.arange(ny - 1, dtype=np.int64),
        np.arange(nx - 1, dtype=np.int64),
        indexing="ij",
    )
    i00 = (gy_idx * nx + gx_idx).reshape(-1)
    i10 = i00 + 1
    i01 = i00 + nx
    i11 = i01 + 1

    f_lower = np.column_stack([i00, i10, i11])
    f_upper = np.column_stack([i00, i11, i01])
    faces = np.vstack([f_lower, f_upper])

    # Compute exact area-weighted outward vertex normals
    v0 = verts[faces[:, 0]]
    v1 = verts[faces[:, 1]]
    v2 = verts[faces[:, 2]]
    fn = np.cross(v1 - v0, v2 - v0)

    v_normals = np.zeros_like(verts)
    np.add.at(v_normals, faces[:, 0], fn)
    np.add.at(v_normals, faces[:, 1], fn)
    np.add.at(v_normals, faces[:, 2], fn)

    norms = np.linalg.norm(v_normals, axis=1, keepdims=True)
    bad = norms.squeeze(-1) < 1e-9
    if np.any(bad):
        v_normals[bad] = np.array([0.0, 0.0, 1.0], dtype=np.float64)
        norms = np.linalg.norm(v_normals, axis=1, keepdims=True)
    v_normals /= norms

    pil_front = Image.fromarray(cv2.cvtColor(rectified_bgr, cv2.COLOR_BGR2RGB))
    mat = PBRMaterial(
        name="front_photo_facade_pbr",
        baseColorTexture=pil_front,
        metallicFactor=0.08,
        roughnessFactor=0.76,
    )
    return trimesh.Trimesh(
        vertices=verts,
        faces=faces,
        vertex_normals=v_normals,
        visual=TextureVisuals(uv=uv, material=mat),
        process=False,
    )


def build_photo_textured_architectural_scene(
    image_paths: list[Path],
    spec: ArchitecturalBuildingSpecModel,
    sector_views: dict[str, Path] | None = None,
    target_height_m: float | None = None,
) -> tuple[trimesh.Scene, ArchitecturalBuildingSpecModel]:
    """
    Reconstruct a high-fidelity, UV-photo-textured, 2.5D depth-relieved, 360-degree metric `.glb`
    building scene directly from the user's exterior photo(s) + multi-angle scan sectors + spec.
    """
    from app.architectural_backend import (
        BALCONY_GUARDRAIL_HEIGHT_M,
        _make_oriented_prism,
        build_architectural_scene,
    )

    front_candidates = (
        [sector_views["front"]]
        if sector_views and "front" in sector_views
        else image_paths
    )
    views = _select_sharpest_bgr_views(front_candidates)
    if not views:
        views = _select_sharpest_bgr_views(image_paths)
    if not views:
        return build_architectural_scene(spec), spec

    seg = _segment_facade_and_masses(views[0])
    rectified_bgr: np.ndarray = seg["rectified_bgr"]  # type: ignore[assignment]
    true_aspect_hw: float = float(seg["true_aspect_hw"])  # type: ignore[arg-type]
    setback_crop: np.ndarray | None = seg["setback_crop"]  # type: ignore[assignment]
    right_wing_crop: np.ndarray | None = seg["right_wing_crop"]  # type: ignore[assignment]
    right_wing_ratio: float = float(seg["right_wing_height_ratio"])  # type: ignore[arg-type]
    ground_strip: np.ndarray = seg["ground_strip"]  # type: ignore[assignment]

    eff_mpf = float(spec.metersPerFloor)
    if target_height_m is not None and 3.0 <= target_height_m <= 36.0:
        eff_mpf = float(np.clip(target_height_m / max(1, spec.floors), 2.45, 4.8))

    bldg_h = float(spec.floors) * eff_mpf
    photo_width_m = float(np.clip(bldg_h / max(0.38, true_aspect_hw), 5.6, 18.0))

    # Resolve optional dedicated side/rear sector images from live walkaround scan
    left_seg: dict[str, object] | None = None
    right_seg: dict[str, object] | None = None
    rear_seg: dict[str, object] | None = None
    if sector_views:
        left_p = sector_views.get("left_side") or sector_views.get("front_left")
        right_p = sector_views.get("right_side") or sector_views.get("front_right")
        rear_p = sector_views.get("rear")
        if left_p is not None:
            l_views = _select_sharpest_bgr_views([left_p])
            if l_views:
                left_seg = _segment_facade_and_masses(l_views[0])
        if right_p is not None:
            r_views = _select_sharpest_bgr_views([right_p])
            if r_views:
                right_seg = _segment_facade_and_masses(r_views[0])
        if rear_p is not None:
            b_views = _select_sharpest_bgr_views([rear_p])
            if b_views:
                rear_seg = _segment_facade_and_masses(b_views[0])

    # Measure spec footprint width; if Maps supplied a multi-unit rowhouse block (> 1.35x single-unit photo width),
    # constrain width to the actual single-unit facade shown in the user's photo!
    pts = np.asarray(spec.footprintPolygonMeters, dtype=np.float64)
    spec_w = float(pts[:, 0].max() - pts[:, 0].min()) if len(pts) >= 3 else photo_width_m
    spec_d = float(pts[:, 1].max() - pts[:, 1].min()) if len(pts) >= 3 else photo_width_m * 0.85

    if spec_w > photo_width_m * 1.32 or spec_w < photo_width_m * 0.65:
        eff_w = photo_width_m
    else:
        eff_w = 0.65 * photo_width_m + 0.35 * spec_w

    # If a side walkaround view was captured, measure actual metric building depth from side elevation aspect ratio!
    side_seg_for_depth = right_seg or left_seg
    if side_seg_for_depth is not None:
        side_aspect = float(side_seg_for_depth["true_aspect_hw"])  # type: ignore[arg-type]
        measured_d = float(np.clip(bldg_h / max(0.38, side_aspect), 5.6, 16.0))
        eff_d = measured_d
    else:
        eff_d = float(np.clip(spec_d if 5.5 <= spec_d <= 15.0 else eff_w * 0.88, 5.8, 14.0))

    hx = round(eff_w * 0.5, 3)
    hz = round(eff_d * 0.5, 3)

    updated_spec = spec.model_copy(
        update={
            "metersPerFloor": round(eff_mpf, 3),
            "footprintPolygonMeters": [(-hx, -hz), (hx, -hz), (hx, hz), (-hx, hz)],
            "hasGarage": bool(spec.hasGarage or right_wing_crop is not None),
        }
    )

    scene = trimesh.Scene()

    # 1. Foreground Driveway / Ground Pad (minY = 0.0 exact, textured from actual foreground!)
    wing_extra_x = (eff_w * 0.42) if right_wing_crop is not None else 0.0
    pad_x_l = max(8.0, hx + 3.5)
    pad_x_r = max(8.0, hx + wing_extra_x + 3.5)
    pad_z_back = min(-7.0, -hz - 3.0)
    pad_z_front = max(9.5, hz + 5.2)
    ground_tex = _build_ground_pad_texture(ground_strip)
    ground_mesh = _make_textured_quad_box(
        (-pad_x_l, 0.0, pad_z_back),
        (pad_x_r, 0.02, pad_z_front),
        ground_tex,
        "ground_driveway_pbr",
        roughness=0.92,
        metallic=0.02,
    )
    scene.add_geometry(ground_mesh, node_name="ground_turf", geom_name="ground_turf")

    # 2. 360-Degree Side & Rear Cladding Envelope (upgraded per-wall with live walkaround photos when available!)
    default_side_tex = _synthesize_side_cladding_texture(rectified_bgr, None)
    left_tex = (
        Image.fromarray(cv2.cvtColor(left_seg["rectified_bgr"], cv2.COLOR_BGR2RGB))  # type: ignore[arg-type]
        if left_seg is not None
        else default_side_tex
    )
    right_tex = (
        Image.fromarray(cv2.cvtColor(right_seg["rectified_bgr"], cv2.COLOR_BGR2RGB))  # type: ignore[arg-type]
        if right_seg is not None
        else default_side_tex
    )
    rear_tex = (
        Image.fromarray(cv2.cvtColor(rear_seg["rectified_bgr"], cv2.COLOR_BGR2RGB))  # type: ignore[arg-type]
        if rear_seg is not None
        else default_side_tex
    )

    scene.add_geometry(
        _make_single_textured_wall_quad(
            [(-hx, 0.02, -hz), (-hx, 0.02, hz), (-hx, bldg_h, hz), (-hx, bldg_h, -hz)],
            (-1.0, 0.0, 0.0),
            left_tex,
            "left_facade_pbr",
        ),
        node_name="left_facade_wall",
        geom_name="left_facade_wall",
    )
    scene.add_geometry(
        _make_single_textured_wall_quad(
            [(hx, 0.02, hz), (hx, 0.02, -hz), (hx, bldg_h, -hz), (hx, bldg_h, hz)],
            (1.0, 0.0, 0.0),
            right_tex,
            "right_facade_pbr",
        ),
        node_name="right_facade_wall",
        geom_name="right_facade_wall",
    )
    scene.add_geometry(
        _make_single_textured_wall_quad(
            [(hx, 0.02, -hz), (-hx, 0.02, -hz), (-hx, bldg_h, -hz), (hx, bldg_h, -hz)],
            (0.0, 0.0, -1.0),
            rear_tex,
            "rear_facade_pbr",
        ),
        node_name="rear_facade_wall",
        geom_name="rear_facade_wall",
    )

    # 3. High-Res Perspective-Rectified + 2.5D Depth-Relieved Front Facade Mesh
    relief_grid, door_u_norm = _compute_facade_relief_and_door_u(rectified_bgr, 64, 64)
    front_facade = _build_relief_facade_mesh(
        -hx, hx, 0.02, bldg_h, hz, relief_grid, rectified_bgr
    )
    scene.add_geometry(
        front_facade, node_name="front_facade_walls", geom_name="front_facade_walls"
    )

    # 4. Calibration Reference Front Door Node (exact 6.67 ft = 2.033016m height tucked cleanly behind doorway recess)
    door_cx = float(np.clip(door_u_norm * eff_w, -hx + 0.55, hx - 0.55))
    door_rgba = (28, 26, 26, 255)
    front_door = _make_box(
        (door_cx - 0.44, 0.02, hz - 0.56),
        (door_cx + 0.44, 0.02 + FRONT_DOOR_HEIGHT_UNITS, hz - 0.49),
        door_rgba,
    )
    scene.add_geometry(front_door, node_name="front_door", geom_name="front_door")

    # 5. Roof Structure, Parapet Coping (`eaves_gutters`) & Optional Rooftop Setback
    roof_rgba = (*updated_spec.roofColorRgb, 255)
    trim_rgba = (*updated_spec.trimColorRgb, 255)
    dark_coping_rgba = (44, 47, 52, 255)

    if updated_spec.roofStyle in ("pitched_gable", "hip"):
        rise = min(
            3.6,
            0.5 * eff_d * np.tan(np.deg2rad(max(14.0, updated_spec.roofPitchDegrees))),
        )
        roof_mesh = _make_gable_prism_along_x(
            -hx - 0.28,
            hx + 0.28,
            hz + 0.28,
            0.0,
            -hz - 0.28,
            bldg_h - 0.02,
            bldg_h + float(rise),
            roof_rgba,
        )
        scene.add_geometry(
            roof_mesh, node_name="pitched_gable_roof", geom_name="pitched_gable_roof"
        )
        eaves_mesh = trimesh.util.concatenate(
            [
                _make_box(
                    (-hx - 0.30, bldg_h - 0.10, hz + 0.20),
                    (hx + 0.30, bldg_h, hz + 0.32),
                    trim_rgba,
                ),
                _make_box(
                    (-hx - 0.30, bldg_h - 0.10, -hz - 0.32),
                    (hx + 0.30, bldg_h, -hz - 0.20),
                    trim_rgba,
                ),
            ]
        )
        scene.add_geometry(
            eaves_mesh, node_name="eaves_gutters", geom_name="eaves_gutters"
        )
    else:
        # Sleek modern flat roof membrane + crisp architectural metal parapet cap (`eaves_gutters`)
        roof_deck = _make_box(
            (-hx + 0.18, bldg_h - 0.05, -hz + 0.18),
            (hx - 0.18, bldg_h + 0.02, hz - 0.18),
            roof_rgba,
        )
        scene.add_geometry(
            roof_deck, node_name="pitched_gable_roof", geom_name="pitched_gable_roof"
        )

        coping_parts = [
            # Front roofline coping (raycastable for Roof & Railings C9/icicle strands!)
            _make_box(
                (-hx - 0.05, bldg_h, hz - 0.22),
                (hx + 0.05, bldg_h + 0.16, hz + 0.06),
                dark_coping_rgba,
            ),
            # Rear coping
            _make_box(
                (-hx - 0.05, bldg_h, -hz - 0.06),
                (hx + 0.05, bldg_h + 0.16, -hz + 0.22),
                dark_coping_rgba,
            ),
            # Left coping
            _make_box(
                (-hx - 0.06, bldg_h, -hz),
                (-hx + 0.22, bldg_h + 0.16, hz),
                dark_coping_rgba,
            ),
            # Right coping
            _make_box(
                (hx - 0.22, bldg_h, -hz),
                (hx + 0.06, bldg_h + 0.16, hz),
                dark_coping_rgba,
            ),
        ]
        scene.add_geometry(
            trimesh.util.concatenate(coping_parts),
            node_name="eaves_gutters",
            geom_name="eaves_gutters",
        )

        # Optional rooftop cedar penthouse / terrace parapet setback (visible above main parapet)
        if setback_crop is not None and setback_crop.size > 0:
            sb_pil = Image.fromarray(
                cv2.cvtColor(
                    cv2.resize(setback_crop, (512, 128), interpolation=cv2.INTER_LINEAR),
                    cv2.COLOR_BGR2RGB,
                )
            )
            sb_mesh = _make_textured_quad_box(
                (-hx * 0.68, bldg_h + 0.02, -hz * 0.45),
                (hx * 0.68, bldg_h + 0.72, hz - 0.85),
                sb_pil,
                "rooftop_setback_pbr",
                roughness=0.80,
                metallic=0.05,
            )
            scene.add_geometry(
                sb_mesh,
                node_name="rooftop_setback_walls",
                geom_name="rooftop_setback_walls",
            )

    # 6. Optional Attached Side Garage Wing (when visible in photo, e.g. right charcoal garage bay)
    if right_wing_crop is not None and right_wing_crop.size > 0:
        wing_w = max(2.8, eff_w * 0.40)
        wing_h = max(2.9, bldg_h * right_wing_ratio)
        wing_z_front = hz - 0.95
        wing_pil = Image.fromarray(
            cv2.cvtColor(
                cv2.resize(right_wing_crop, (512, 512), interpolation=cv2.INTER_LINEAR),
                cv2.COLOR_BGR2RGB,
            )
        )
        wing_mesh = _make_textured_quad_box(
            (hx - 0.05, 0.02, -hz * 0.85),
            (hx + wing_w, wing_h, wing_z_front),
            wing_pil,
            "attached_garage_wing_pbr",
            roughness=0.78,
            metallic=0.08,
        )
        scene.add_geometry(wing_mesh, node_name="garage_wing", geom_name="garage_wing")

        wing_coping = _make_box(
            (hx - 0.02, wing_h, wing_z_front - 0.20),
            (hx + wing_w + 0.04, wing_h + 0.12, wing_z_front + 0.05),
            dark_coping_rgba,
        )
        scene.add_geometry(
            wing_coping, node_name="garage_eaves_gutter", geom_name="garage_eaves_gutter"
        )

        g_door = _make_box(
            (hx + 0.35, 0.02, wing_z_front - 0.04),
            (hx + wing_w - 0.25, 0.02 + GARAGE_DOOR_HEIGHT_UNITS, wing_z_front + 0.01),
            (46, 48, 52, 255),
        )
        scene.add_geometry(g_door, node_name="garage_door", geom_name="garage_door")

    # 7. Optional 3D Balconies (from CV or user's Floors & Balconies adjuster)
    face_frames = {
        "front": (np.array([0.0, hz]), np.array([1.0, 0.0]), np.array([0.0, 1.0]), eff_w),
        "rear": (np.array([0.0, -hz]), np.array([-1.0, 0.0]), np.array([0.0, -1.0]), eff_w),
        "left": (np.array([-hx, 0.0]), np.array([0.0, 1.0]), np.array([-1.0, 0.0]), eff_d),
        "right": (np.array([hx, 0.0]), np.array([0.0, -1.0]), np.array([1.0, 0.0]), eff_d),
    }
    for idx, bal in enumerate(updated_spec.balconies):
        if bal.floor > updated_spec.floors:
            continue
        b_mid, b_t, b_n, b_len = face_frames.get(bal.wallFace, face_frames["front"])
        u_center = float(np.clip(bal.centerOffsetNorm, -0.40, 0.40)) * b_len
        half_w = min(0.44 * b_len, 0.5 * bal.widthMeters)
        u0, u1 = u_center - half_w, u_center + half_w
        out_depth = (
            bal.depthMeters
            if bal.mountStyle == "cantilevered"
            else max(0.65, bal.depthMeters * 0.6)
        )
        y_deck = (bal.floor - 1) * updated_spec.metersPerFloor
        y_ceil = bal.floor * updated_spec.metersPerFloor

        slab = _make_oriented_prism(
            b_mid, b_t, b_n, u0, u1, y_deck - 0.08, y_deck + 0.10, -0.04, out_depth, trim_rgba
        )
        scene.add_geometry(
            slab, node_name=f"balcony_slab_{idx}", geom_name=f"balcony_slab_{idx}"
        )

        soffits = trimesh.util.concatenate(
            [
                _make_oriented_prism(
                    b_mid,
                    b_t,
                    b_n,
                    u0,
                    u1,
                    y_ceil - 0.12,
                    y_ceil - 0.02,
                    -0.04,
                    out_depth,
                    (226, 230, 236, 255),
                ),
                _make_oriented_prism(
                    b_mid,
                    b_t,
                    b_n,
                    u0 + 0.04,
                    u1 - 0.04,
                    y_deck - 0.12,
                    y_deck - 0.08,
                    0.02,
                    out_depth - 0.04,
                    (218, 222, 228, 255),
                ),
            ]
        )
        scene.add_geometry(
            soffits, node_name=f"balcony_soffit_{idx}", geom_name=f"balcony_soffit_{idx}"
        )

        y_rail_bot = y_deck + 0.10
        y_rail_top = y_rail_bot + BALCONY_GUARDRAIL_HEIGHT_M
        rail_parts: list[trimesh.Trimesh] = []
        iron_rgba = (42, 46, 54, 255)
        if bal.railingType == "solid_parapet":
            parapet_rgba = (*updated_spec.wallColorRgb, 255)
            rail_parts.extend(
                [
                    _make_oriented_prism(
                        b_mid, b_t, b_n, u0, u1, y_rail_bot, y_rail_top - 0.06, out_depth - 0.11, out_depth, parapet_rgba
                    ),
                    _make_oriented_prism(
                        b_mid, b_t, b_n, u0, u0 + 0.11, y_rail_bot, y_rail_top - 0.06, 0.02, out_depth, parapet_rgba
                    ),
                    _make_oriented_prism(
                        b_mid, b_t, b_n, u1 - 0.11, u1, y_rail_bot, y_rail_top - 0.06, 0.02, out_depth, parapet_rgba
                    ),
                    _make_oriented_prism(
                        b_mid, b_t, b_n, u0 - 0.02, u1 + 0.02, y_rail_top - 0.06, y_rail_top, out_depth - 0.13, out_depth + 0.02, trim_rgba
                    ),
                ]
            )
        elif bal.railingType == "glass_panel":
            frame_rgba = (196, 204, 214, 255)
            panel_rgba = (118, 168, 202, 255)
            rail_parts.extend(
                [
                    _make_oriented_prism(
                        b_mid, b_t, b_n, u0, u1, y_rail_top - 0.05, y_rail_top, out_depth - 0.06, out_depth, frame_rgba
                    ),
                    _make_oriented_prism(
                        b_mid, b_t, b_n, u0 + 0.05, u1 - 0.05, y_rail_bot + 0.06, y_rail_top - 0.05, out_depth - 0.04, out_depth - 0.015, panel_rgba
                    ),
                ]
            )
        else:
            rail_parts.extend(
                [
                    _make_oriented_prism(
                        b_mid, b_t, b_n, u0, u1, y_rail_top - 0.05, y_rail_top, out_depth - 0.05, out_depth, iron_rgba
                    ),
                    _make_oriented_prism(
                        b_mid, b_t, b_n, u0, u1, y_rail_bot + 0.05, y_rail_bot + 0.09, out_depth - 0.05, out_depth, iron_rgba
                    ),
                ]
            )
            num_pickets = max(5, int((u1 - u0) / 0.18))
            for u_p in np.linspace(u0 + 0.04, u1 - 0.04, num_pickets):
                rail_parts.append(
                    _make_oriented_prism(
                        b_mid,
                        b_t,
                        b_n,
                        float(u_p) - 0.015,
                        float(u_p) + 0.015,
                        y_rail_bot + 0.06,
                        y_rail_top - 0.04,
                        out_depth - 0.04,
                        out_depth - 0.01,
                        iron_rgba,
                    )
                )
        scene.add_geometry(
            trimesh.util.concatenate(rail_parts),
            node_name=f"balcony_railing_{idx}",
            geom_name=f"balcony_railing_{idx}",
        )

    return scene, updated_spec
