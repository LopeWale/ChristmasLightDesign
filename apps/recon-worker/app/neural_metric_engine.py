from __future__ import annotations

import importlib.util
import logging
import os
from pathlib import Path
import platform
import threading
from typing import Any

import cv2
import numpy as np

from app.schemas import NeuralBackendKind

logger = logging.getLogger("uvicorn.error")


def get_compute_device() -> str:
    if platform.system() == "Darwin" and platform.machine() == "arm64":
        return "mps"
    if importlib.util.find_spec("torch") is not None:
        try:
            import torch  # type: ignore

            if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                return "mps"
            if torch.cuda.is_available():
                return "cuda"
        except Exception:
            pass
    return "cpu"


def has_da3_installed() -> bool:
    return (
        importlib.util.find_spec("torch") is not None
        and importlib.util.find_spec("depth_anything_3") is not None
    )


def has_moge2_installed() -> bool:
    return (
        importlib.util.find_spec("torch") is not None
        and importlib.util.find_spec("moge") is not None
    )


def fuse_multiview_pointmaps_to_splat_arrays(
    pointmaps_cam: list[np.ndarray],
    valid_masks: list[np.ndarray],
    rgb_images: list[np.ndarray],
    extrinsics_w2c: list[np.ndarray] | None = None,
    target_height_m: float | None = None,
    max_splats: int = 28_000,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Fuse 1..N per-view metric pointmaps in OpenCV camera space (+X right, +Y down, +Z forward)
    into a unified Three.js right-handed world frame (+X right, +Y up, +Z front) with `minY = 0.0`,
    optional Google Solar `target_height_m` scale lock, and 3D Gaussian scale/RGBA attributes.
    """
    if not pointmaps_cam:
        raise ValueError("At least one pointmap is required for multi-view splat fusion.")

    # OpenCV (+X right, +Y down, +Z into scene) -> Three.js (+X right, +Y up, +Z toward front viewer)
    cv_to_three = np.diag([1.0, -1.0, -1.0]).astype(np.float64)

    world_chunks: list[np.ndarray] = []
    rgb_chunks: list[np.ndarray] = []

    n_views = len(pointmaps_cam)
    per_view_budget = max(800, max_splats // max(1, n_views))

    for idx, pts_cam in enumerate(pointmaps_cam):
        h, w, _ = pts_cam.shape
        mask = (
            valid_masks[idx].astype(bool)
            if idx < len(valid_masks)
            else np.ones((h, w), dtype=bool)
        )
        finite = np.all(np.isfinite(pts_cam), axis=-1) & (pts_cam[:, :, 2] > 0.15)
        keep = mask & finite
        if not np.any(keep):
            continue

        pts_flat = pts_cam[keep].astype(np.float64)
        rgb_img = rgb_images[idx]
        if rgb_img.shape[:2] != (h, w):
            rgb_img = cv2.resize(rgb_img, (w, h), interpolation=cv2.INTER_AREA)
        rgb_flat = rgb_img[keep].astype(np.uint8)

        if len(pts_flat) > per_view_budget:
            sel = np.linspace(0, len(pts_flat) - 1, num=per_view_budget, dtype=int)
            pts_flat = pts_flat[sel]
            rgb_flat = rgb_flat[sel]

        if extrinsics_w2c is not None and idx < len(extrinsics_w2c):
            w2c_4x4 = np.eye(4, dtype=np.float64)
            w2c_4x4[:3, :4] = np.asarray(extrinsics_w2c[idx], dtype=np.float64)[:3, :4]
            try:
                c2w_4x4 = np.linalg.inv(w2c_4x4)
            except np.linalg.LinAlgError:
                c2w_4x4 = np.eye(4, dtype=np.float64)
            r_c2w = c2w_4x4[:3, :3]
            t_c2w = c2w_4x4[:3, 3]
            pts_world_cv = (pts_flat @ r_c2w.T) + t_c2w[None, :]
        else:
            pts_world_cv = pts_flat

        pts_three = pts_world_cv @ cv_to_three.T
        world_chunks.append(pts_three)
        rgb_chunks.append(rgb_flat)

    if not world_chunks:
        raise ValueError("No valid finite foreground points remained after sky masking.")

    all_pos = np.vstack(world_chunks).astype(np.float32)
    all_rgb = np.vstack(rgb_chunks).astype(np.uint8)

    # Recenter X/Z around centroid and ground-align minY = 0.0
    p_min = np.percentile(all_pos, 2, axis=0)
    p_max = np.percentile(all_pos, 98, axis=0)
    cx = 0.5 * float(p_min[0] + p_max[0])
    cz = 0.5 * float(p_min[2] + p_max[2])
    all_pos[:, 0] -= cx
    all_pos[:, 2] -= cz

    min_y = float(np.percentile(all_pos[:, 1], 1))
    all_pos[:, 1] = np.maximum(0.0, all_pos[:, 1] - min_y)

    raw_h = float(np.percentile(all_pos[:, 1], 99))
    if target_height_m is not None and target_height_m > 1.5 and raw_h > 0.25:
        scale_factor = float(target_height_m) / raw_h
        all_pos *= scale_factor

    span = float(np.linalg.norm(all_pos.max(axis=0) - all_pos.min(axis=0)))
    splat_radius = float(np.clip(span / max(80.0, np.sqrt(len(all_pos)) * 1.8), 0.04, 0.16))
    scales = np.full_like(all_pos, splat_radius, dtype=np.float32)
    alpha = np.full((len(all_rgb), 1), 235, dtype=np.uint8)
    rgba = np.hstack([all_rgb, alpha])

    return all_pos, scales, rgba


class NeuralGeometryRuntime:
    """
    Thread-safe manager for 2025/2026 neural metric geometry models on Apple Silicon MPS / CUDA:
      - `depth-anything/DA3-SMALL` (Apache-2.0, multi-view depth + camera poses)
      - `Ruicheng/moge-2-vits-normal` (MIT, metric 3D pointmaps + sky mask + surface normals)
    Pre-warms asynchronously so live scan requests never stall or time out.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state: str = "idle"
        self._da3_model: Any = None
        self._moge2_model: Any = None
        self._device: str = get_compute_device()

    def status(self) -> dict[str, Any]:
        da3_pkg = has_da3_installed()
        moge_pkg = has_moge2_installed()
        warm_state = self._state
        if warm_state == "idle" and not (da3_pkg or moge_pkg):
            warm_state = "fallback_only"
        return {
            "computeDevice": self._device,
            "da3Available": da3_pkg,
            "moge2Available": moge_pkg,
            "da3Loaded": self._da3_model is not None,
            "moge2Loaded": self._moge2_model is not None,
            "weightsWarmState": warm_state,
        }

    def active_backend_kind(self) -> NeuralBackendKind:
        if self._da3_model is not None and self._moge2_model is not None:
            return "da3_moge2_mps"
        if self._moge2_model is not None:
            return "moge2_mps"
        if self._da3_model is not None:
            return "da3_mps"
        return "hybrid_multiview_relief"

    def start_background_warmup(self, allow_download: bool = False) -> None:
        if not (has_da3_installed() or has_moge2_installed()):
            self._state = "fallback_only"
            return
        with self._lock:
            if self._state in ("warming", "ready"):
                return
            self._state = "warming"

        def _warm() -> None:
            try:
                import torch  # type: ignore

                dev = torch.device(self._device)
                local_only = not (
                    allow_download or os.environ.get("LUMEN3D_ALLOW_HF_DOWNLOAD") == "1"
                )

                if has_moge2_installed() and self._moge2_model is None:
                    try:
                        from moge.model.v2 import MoGeModel  # type: ignore

                        if not local_only:
                            m = MoGeModel.from_pretrained("Ruicheng/moge-2-vits-normal")
                        else:
                            from huggingface_hub import hf_hub_download  # type: ignore

                            ckpt = hf_hub_download(
                                repo_id="Ruicheng/moge-2-vits-normal",
                                filename="model.pt",
                                local_files_only=True,
                            )
                            m = MoGeModel.from_pretrained(ckpt)
                        m = m.to(dev)
                        m.eval()
                        self._moge2_model = m
                        logger.info("[lumen3d:neural] Loaded MoGe-2 (vits-normal) on %s", self._device)
                    except Exception as exc:
                        logger.info("[lumen3d:neural] MoGe-2 warmup skipped: %s", exc)

                if has_da3_installed() and self._da3_model is None:
                    try:
                        from depth_anything_3.api import DepthAnything3  # type: ignore

                        d_model = DepthAnything3.from_pretrained(
                            "depth-anything/DA3-SMALL",
                            local_files_only=local_only,
                        ).to(device=dev)
                        d_model.eval()
                        self._da3_model = d_model
                        logger.info("[lumen3d:neural] Loaded DA3-SMALL on %s", self._device)
                    except Exception as exc:
                        logger.info("[lumen3d:neural] DA3-SMALL warmup skipped: %s", exc)

                self._state = (
                    "ready"
                    if (self._moge2_model is not None or self._da3_model is not None)
                    else "fallback_only"
                )
            except Exception:
                self._state = "fallback_only"

        threading.Thread(target=_warm, name="neural-warmup", daemon=True).start()

    def try_infer_multiview_splats(
        self,
        image_paths: list[Path],
        target_height_m: float | None = None,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
        """
        Run loaded MoGe-2 and/or DA3-SMALL models on `image_paths` to produce fused metric
        world-space 3D Gaussian arrays `(positions, scales, rgba)`, or return `None` if models
        are not yet loaded so caller uses fast multi-view geometric fusion without blocking.
        """
        if self._moge2_model is None and self._da3_model is None:
            return None

        try:
            import torch  # type: ignore

            dev = torch.device(self._device)
            extrinsics_w2c: list[np.ndarray] | None = None
            pointmaps_cam: list[np.ndarray] = []
            valid_masks: list[np.ndarray] = []
            rgb_images: list[np.ndarray] = []

            if self._da3_model is not None and len(image_paths) >= 1:
                with torch.no_grad():
                    pred = self._da3_model.inference([str(p) for p in image_paths])
                extrinsics_w2c = [
                    np.asarray(pred.extrinsics[i], dtype=np.float32)
                    for i in range(len(pred.extrinsics))
                ]
                if self._moge2_model is None:
                    # Unproject DA3 multi-view depth + intrinsics directly
                    for i in range(len(pred.depth)):
                        rgb = np.asarray(pred.processed_images[i], dtype=np.uint8)
                        depth = np.asarray(pred.depth[i], dtype=np.float32)
                        conf = np.asarray(pred.conf[i], dtype=np.float32)
                        k_mat = np.asarray(pred.intrinsics[i], dtype=np.float32)
                        h, w = depth.shape
                        uu, vv = np.meshgrid(
                            np.arange(w, dtype=np.float32),
                            np.arange(h, dtype=np.float32),
                        )
                        fx = max(1.0, float(k_mat[0, 0]))
                        fy = max(1.0, float(k_mat[1, 1]))
                        cx = float(k_mat[0, 2])
                        cy = float(k_mat[1, 2])
                        z = depth
                        x = (uu - cx) * z / fx
                        y = (vv - cy) * z / fy
                        pts = np.stack([x, y, z], axis=-1)
                        conf_thresh = float(np.percentile(conf, 20))
                        mask = (conf >= conf_thresh) & (z > 0.1) & (z < float(np.percentile(z, 92)))
                        pointmaps_cam.append(pts)
                        valid_masks.append(mask)
                        rgb_images.append(rgb)

            if self._moge2_model is not None:
                for p in image_paths:
                    bgr = cv2.imread(str(p), cv2.IMREAD_COLOR)
                    if bgr is None:
                        continue
                    h, w = bgr.shape[:2]
                    scale = min(1.0, 512.0 / max(h, w))
                    if scale < 1.0:
                        bgr = cv2.resize(bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
                    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                    tensor = (
                        torch.tensor(rgb / 255.0, dtype=torch.float32, device=dev)
                        .permute(2, 0, 1)
                    )
                    with torch.no_grad():
                        out = self._moge2_model.infer(tensor, resolution_level=5)
                    pts = out["points"].detach().cpu().numpy().astype(np.float32)
                    mask = out["mask"].detach().cpu().numpy().astype(bool)
                    pointmaps_cam.append(pts)
                    valid_masks.append(mask)
                    rgb_images.append(rgb)

            if not pointmaps_cam:
                return None

            return fuse_multiview_pointmaps_to_splat_arrays(
                pointmaps_cam=pointmaps_cam,
                valid_masks=valid_masks,
                rgb_images=rgb_images,
                extrinsics_w2c=extrinsics_w2c,
                target_height_m=target_height_m,
            )
        except Exception as exc:
            logger.warning("[lumen3d:neural] Inference fallback triggered: %s", exc)
            return None


NEURAL_RUNTIME = NeuralGeometryRuntime()
