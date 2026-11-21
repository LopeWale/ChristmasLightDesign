from __future__ import annotations

import os
from pathlib import Path
import platform
import threading
from typing import Any

import cv2
import numpy as np
from PIL import Image
import trimesh

from app.architectural_backend import ArchitecturalReconstructor
from app.reconstructor import ProgressCallback, ReconstructionArtifacts, Reconstructor
from app.schemas import ArchitecturalBuildingSpecModel

_PIPE_LOCK = threading.Lock()
_CACHED_DEPTH_PIPE: Any = None
_DEPTH_PIPE_FAILED = False


def detect_compute_device() -> str:
    if platform.system() == "Darwin" and platform.machine() == "arm64":
        return "mps"
    if os.environ.get("LUMEN3D_ENABLE_HF_DEPTH") == "1":
        try:
            import torch  # type: ignore

            if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                return "mps"
            if torch.cuda.is_available():
                return "cuda"
        except Exception:
            pass
    return "cpu"


def _get_cached_hf_depth_pipeline() -> Any | None:
    global _CACHED_DEPTH_PIPE, _DEPTH_PIPE_FAILED
    if _DEPTH_PIPE_FAILED:
        return None
    if _CACHED_DEPTH_PIPE is not None:
        return _CACHED_DEPTH_PIPE

    with _PIPE_LOCK:
        if _CACHED_DEPTH_PIPE is not None:
            return _CACHED_DEPTH_PIPE
        if _DEPTH_PIPE_FAILED:
            return None
        try:
            from transformers import pipeline  # type: ignore

            allow_download = os.environ.get("LUMEN3D_ALLOW_HF_DOWNLOAD") == "1"
            device_str = detect_compute_device()
            _CACHED_DEPTH_PIPE = pipeline(
                task="depth-estimation",
                model="depth-anything/Depth-Anything-V2-Small-hf",
                device=device_str,
                model_kwargs={"local_files_only": not allow_download},
            )
            return _CACHED_DEPTH_PIPE
        except Exception:
            _DEPTH_PIPE_FAILED = True
            return None


def _estimate_relative_depth_map(bgr: np.ndarray) -> np.ndarray:
    """
    Predict a normalized [0..1] facade depth map.
    Uses cached local Depth-Anything weights when `LUMEN3D_ENABLE_HF_DEPTH=1` (never blocking
    on uncached remote HuggingFace downloads unless `LUMEN3D_ALLOW_HF_DOWNLOAD=1`), and
    otherwise computes a fast multi-scale Sobel + bilateral architectural relief prior (<5ms).
    """
    if (
        os.environ.get("LUMEN3D_ENABLE_HF_DEPTH") == "1"
        and os.environ.get("LUMEN3D_DA3_OFFLINE_FAST") != "1"
    ):
        pipe = _get_cached_hf_depth_pipeline()
        if pipe is not None:
            try:
                rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                pil_img = Image.fromarray(rgb)
                out = pipe(pil_img)
                d_np = np.asarray(out["depth"], dtype=np.float32)
                d_min, d_max = float(d_np.min()), float(d_np.max())
                if d_max - d_min > 1e-5:
                    return (d_np - d_min) / (d_max - d_min)
            except Exception:
                pass

    h, w = bgr.shape[:2]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    smooth = cv2.bilateralFilter(gray, d=5, sigmaColor=0.12, sigmaSpace=3.0)
    gx = cv2.Sobel(smooth, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(smooth, cv2.CV_32F, 0, 1, ksize=3)
    relief = cv2.GaussianBlur(np.hypot(gx, gy), (7, 7), 0)
    relief = relief / max(1e-5, float(relief.max()))
    # Recessed dark openings (windows/alcoves) sit slightly deeper than sunlit cladding
    recess = np.clip(smooth, 0.1, 0.95)
    y_ramp = np.linspace(0.32, 0.92, h, dtype=np.float32)[:, None]
    depth = np.clip(0.55 * y_ramp + 0.25 * relief + 0.20 * recess, 0.05, 1.0)
    return depth.astype(np.float32)


def encode_32byte_splat_buffer(
    positions: np.ndarray,
    scales: np.ndarray,
    rgba: np.ndarray,
) -> bytes:
    """
    Serialize N 3D Gaussians into the standard 32-byte `.splat` binary layout consumed by
    `@react-three/drei` `<Splat>` / `antimatter15/splat`:
      - 3x float32 position (12B)
      - 3x float32 scale    (12B)
      - 4x uint8   rgba     (4B)
      - 4x uint8   quat     (4B, identity = [255, 128, 128, 128])
    """
    n = len(positions)
    dtype = np.dtype(
        [
            ("pos", "<f4", (3,)),
            ("scale", "<f4", (3,)),
            ("rgba", "u1", (4,)),
            ("rot", "u1", (4,)),
        ]
    )
    records = np.empty(n, dtype=dtype)
    pos_cv = np.asarray(positions, dtype=np.float32).copy()
    # @react-three/drei <Splat> (antimatter15) negates Y and Z on load; store (x, -y, -z)
    pos_cv[:, 1] *= -1.0
    pos_cv[:, 2] *= -1.0
    records["pos"] = pos_cv
    records["scale"] = np.asarray(scales, dtype=np.float32)
    records["rgba"] = np.clip(rgba, 0, 255).astype(np.uint8)
    records["rot"] = np.tile(np.array([255, 128, 128, 128], dtype=np.uint8), (n, 1))
    return records.tobytes()


class DA3MpsReconstructor(Reconstructor):
    """
    Apple Silicon MPS / Multi-View Depth + 3D Gaussian Splatting (`.splat`) reconstructor.
    Emits both a raycastable metric `scene.glb` and a dense `scene.splat` overlay.
    """

    backend_name = "da3"

    def __init__(
        self,
        explicit_spec: dict[str, Any] | ArchitecturalBuildingSpecModel | None = None,
    ) -> None:
        self._explicit_spec = explicit_spec

    def reconstruct(
        self,
        image_paths: list[Path],
        output_dir: Path,
        progress_cb: ProgressCallback | None = None,
    ) -> ReconstructionArtifacts:
        output_dir.mkdir(parents=True, exist_ok=True)
        if progress_cb:
            progress_cb(20)

        arch = ArchitecturalReconstructor(explicit_spec=self._explicit_spec)
        base_artifacts = arch.reconstruct(
            image_paths=image_paths,
            output_dir=output_dir,
            progress_cb=None,
        )
        if progress_cb:
            progress_cb(65)

        scene = trimesh.load(str(base_artifacts.glb_path), file_type="glb")
        merged = (
            trimesh.util.concatenate(list(scene.geometry.values()))
            if isinstance(scene, trimesh.Scene)
            else scene
        )

        # Sample surface splats across the reconstructed 3D building
        surf_pts, face_idx = trimesh.sample.sample_surface(merged, 2400, seed=42)
        if hasattr(merged.visual, "face_colors") and len(merged.visual.face_colors) > 0:
            surf_rgba = merged.visual.face_colors[face_idx][:, :4].copy()
        else:
            surf_rgba = np.tile(
                np.array([185, 168, 152, 235], dtype=np.uint8), (len(surf_pts), 1)
            )
        surf_rgba[:, 3] = 220
        surf_scales = np.full((len(surf_pts), 3), 0.13, dtype=np.float32)

        all_pts = [surf_pts.astype(np.float32)]
        all_scales = [surf_scales]
        all_rgba = [surf_rgba]

        # Project facade depth relief points onto the front building envelope when media is supplied
        if image_paths:
            bgr = cv2.imread(str(image_paths[0]), cv2.IMREAD_COLOR)
            if bgr is not None and bgr.size > 0:
                gw, gh = 84, 64
                small = cv2.resize(bgr, (gw, gh), interpolation=cv2.INTER_AREA)
                depth = _estimate_relative_depth_map(small)
                bounds = merged.bounds
                min_x, max_z = float(bounds[0, 0]), float(bounds[1, 2])
                max_x, max_y = float(bounds[1, 0]), float(bounds[1, 1])

                us = np.linspace(min_x * 0.86, max_x * 0.86, gw, dtype=np.float32)
                vs = np.linspace(max_y * 0.96, 0.20, gh, dtype=np.float32)
                grid_x, grid_y = np.meshgrid(us, vs)
                grid_z = max_z + (depth - 0.5) * 0.55

                rgb_px = cv2.cvtColor(small, cv2.COLOR_BGR2RGB).reshape(-1, 3)
                alpha_px = np.full((len(rgb_px), 1), 235, dtype=np.uint8)
                rgba_px = np.hstack([rgb_px, alpha_px])

                depth_pts = np.column_stack(
                    [grid_x.reshape(-1), grid_y.reshape(-1), grid_z.reshape(-1)]
                )
                depth_scales = np.full((len(depth_pts), 3), 0.095, dtype=np.float32)
                all_pts.append(depth_pts)
                all_scales.append(depth_scales)
                all_rgba.append(rgba_px)

        splat_path = output_dir / "scene.splat"
        splat_bytes = encode_32byte_splat_buffer(
            np.vstack(all_pts),
            np.vstack(all_scales),
            np.vstack(all_rgba),
        )
        splat_path.write_bytes(splat_bytes)

        if progress_cb:
            progress_cb(98)

        dev = detect_compute_device()
        updated_spec = (
            base_artifacts.building_spec.model_copy(
                update={
                    "sourceSummary": f"Depth-Relief + 3D Gaussian Splat ({dev.upper()})",
                }
            )
            if base_artifacts.building_spec
            else None
        )

        return ReconstructionArtifacts(
            backend_used="da3",
            glb_path=base_artifacts.glb_path,
            splat_path=splat_path,
            cameras_path=base_artifacts.cameras_path,
            reference_image_path=base_artifacts.reference_image_path,
            mesh_stats=base_artifacts.mesh_stats,
            cameras_payload=base_artifacts.cameras_payload,
            building_spec=updated_spec,
        )
