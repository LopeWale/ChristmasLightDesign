from __future__ import annotations

from pathlib import Path
from typing import Callable
import cv2
import numpy as np


def _resize_max_dim(frame: np.ndarray, max_dim: int) -> np.ndarray:
    h, w = frame.shape[:2]
    longest = max(h, w)
    if longest <= max_dim:
        return frame
    scale = float(max_dim) / float(longest)
    new_w = max(16, int(round(w * scale)))
    new_h = max(16, int(round(h * scale)))
    return cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)


def compute_laplacian_sharpness(bgr_or_gray: np.ndarray) -> float:
    """Compute variance of the Laplacian operator as a focus/blur metric."""
    if bgr_or_gray.ndim == 3:
        gray = cv2.cvtColor(bgr_or_gray, cv2.COLOR_BGR2GRAY)
    else:
        gray = bgr_or_gray
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def extract_sharp_keyframes(
    video_path: Path,
    output_dir: Path,
    target_fps: float = 2.0,
    max_frames: int = 20,
    blur_threshold: float = 60.0,
    max_dimension: int = 960,
    progress_cb: Callable[[int], None] | None = None,
) -> list[Path]:
    """
    Extract keyframes from an exterior walkaround video without decoding every 4K frame:
    - Bounds candidate sampling to at most `max(24, max_frames * 3)` frames across the clip
    - Skips non-sampled frames via `cap.grab()` / `CAP_PROP_POS_FRAMES` instead of full BGR decode
    - Downscales sampled frames to `<= max_dimension` immediately (preventing multi-GB 4K RAM spikes)
    - Saves crisp JPEG keyframes (`<= 960px`) in milliseconds instead of multi-second 4K PNGs
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError(f"Unable to open video file: {video_path}")

    raw_fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    # Guard against QuickTime VFR timebases (e.g. 600, 1000, 90000) or 0/NaN
    if np.isnan(raw_fps) or raw_fps < 1.0 or raw_fps > 240.0:
        src_fps = 30.0
    else:
        src_fps = raw_fps

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    max_candidates = max(24, max_frames * 3)

    fps_step = max(1, int(round(src_fps / max(target_fps, 0.25))))
    if total_frames > max_candidates:
        count_step = max(1, total_frames // max_candidates)
        frame_step = max(fps_step, count_step)
    else:
        frame_step = fps_step

    candidates: list[tuple[int, float, np.ndarray]] = []

    try:
        if total_frames > 0 and frame_step >= 12:
            # Fast random-access seek across long 4K60 walkaround videos
            target_indices = list(range(0, total_frames, frame_step))[:max_candidates]
            for idx_pos, target_frame in enumerate(target_indices):
                cap.set(cv2.CAP_PROP_POS_FRAMES, float(target_frame))
                ok, frame = cap.read()
                if not ok or frame is None:
                    break
                resized = _resize_max_dim(frame, max_dimension)
                score = compute_laplacian_sharpness(resized)
                candidates.append((target_frame, score, resized))
                if progress_cb and len(target_indices) > 1:
                    pct = 10 + int(15 * (idx_pos + 1) / len(target_indices))
                    progress_cb(pct)

        if not candidates:
            # Sequential fallback using lightweight `cap.grab()` on skipped frames
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0.0)
            frame_idx = 0
            while len(candidates) < max_candidates:
                if frame_idx % frame_step == 0:
                    ok, frame = cap.read()
                    if not ok or frame is None:
                        break
                    resized = _resize_max_dim(frame, max_dimension)
                    score = compute_laplacian_sharpness(resized)
                    candidates.append((frame_idx, score, resized))
                else:
                    if not cap.grab():
                        break
                frame_idx += 1
    finally:
        cap.release()

    if not candidates:
        raise ValueError(f"No readable video frames found in: {video_path}")

    sharp = [item for item in candidates if item[1] >= blur_threshold]
    if not sharp:
        # Fallback to top sharpest candidates if overcast/low-texture facade falls under threshold
        sharp = sorted(candidates, key=lambda item: item[1], reverse=True)[
            : min(4, len(candidates))
        ]
        sharp.sort(key=lambda item: item[0])

    if len(sharp) > max_frames:
        indices = np.linspace(0, len(sharp) - 1, num=max_frames, dtype=int)
        sharp = [sharp[int(i)] for i in indices]

    saved_paths: list[Path] = []
    for out_idx, (orig_idx, _score, frame) in enumerate(sharp):
        out_path = output_dir / f"keyframe_{out_idx:03d}_f{orig_idx:05d}.jpg"
        cv2.imwrite(str(out_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 94])
        saved_paths.append(out_path)

    return saved_paths
