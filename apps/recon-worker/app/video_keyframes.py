from __future__ import annotations

from pathlib import Path
import cv2
import numpy as np


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
) -> list[Path]:
    """
    Extract keyframes from an exterior walkaround video at ~2 fps, filtering out
    motion-blurred frames via Laplacian variance and capping at `max_frames`.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError(f"Unable to open video file: {video_path}")

    src_fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    if src_fps <= 0.5 or np.isnan(src_fps):
        src_fps = 30.0

    frame_step = max(1, int(round(src_fps / max(target_fps, 0.25))))
    candidates: list[tuple[int, float, np.ndarray]] = []
    frame_idx = 0

    try:
        while True:
            ok, frame = cap.read()
            if not ok or frame is None:
                break
            if frame_idx % frame_step == 0:
                score = compute_laplacian_sharpness(frame)
                candidates.append((frame_idx, score, frame))
            frame_idx += 1
    finally:
        cap.release()

    if not candidates:
        raise ValueError(f"No readable video frames found in: {video_path}")

    sharp = [item for item in candidates if item[1] >= blur_threshold]
    if not sharp:
        # Fallback to top sharpest candidates if low-texture facade falls under threshold
        sharp = sorted(candidates, key=lambda item: item[1], reverse=True)[: min(4, len(candidates))]
        sharp.sort(key=lambda item: item[0])

    if len(sharp) > max_frames:
        indices = np.linspace(0, len(sharp) - 1, num=max_frames, dtype=int)
        sharp = [sharp[int(i)] for i in indices]

    saved_paths: list[Path] = []
    for out_idx, (orig_idx, _score, frame) in enumerate(sharp):
        out_path = output_dir / f"keyframe_{out_idx:03d}_f{orig_idx:05d}.png"
        cv2.imwrite(str(out_path), frame)
        saved_paths.append(out_path)

    return saved_paths
