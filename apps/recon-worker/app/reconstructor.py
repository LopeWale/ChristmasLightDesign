from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Literal

from app.schemas import CamerasPayload, SceneMetadata


ProgressCallback = Callable[[int], None]


@dataclass
class ReconstructionArtifacts:
    backend_used: Literal["vggt", "synthetic"]
    glb_path: Path
    cameras_path: Path
    reference_image_path: Path
    mesh_stats: SceneMetadata
    cameras_payload: CamerasPayload


class Reconstructor(ABC):
    """Multi-view 3D exterior scene reconstructor contract."""

    backend_name: Literal["vggt", "synthetic"]

    @abstractmethod
    def reconstruct(
        self,
        image_paths: list[Path],
        output_dir: Path,
        progress_cb: ProgressCallback | None = None,
    ) -> ReconstructionArtifacts:
        raise NotImplementedError


def select_reconstructor(mode: str = "auto") -> Reconstructor:
    normalized = (mode or "auto").strip().lower()
    if normalized not in ("auto", "vggt", "synthetic"):
        raise ValueError(f"Unsupported reconstruction mode: {mode}")

    if normalized == "synthetic":
        from app.synthetic_backend import SyntheticReconstructor

        return SyntheticReconstructor()

    from app.vggt_backend import VGGTReconstructor, is_vggt_cuda_available

    if normalized == "vggt":
        return VGGTReconstructor()

    # auto mode: select VGGT when CUDA + VGGT + Open3D are present, else deterministic synthetic
    if is_vggt_cuda_available():
        return VGGTReconstructor()

    from app.synthetic_backend import SyntheticReconstructor

    return SyntheticReconstructor()
