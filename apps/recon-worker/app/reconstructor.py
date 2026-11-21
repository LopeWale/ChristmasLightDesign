from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Literal

from app.schemas import ArchitecturalBuildingSpecModel, CamerasPayload, SceneMetadata


ProgressCallback = Callable[[int], None]


@dataclass
class ReconstructionArtifacts:
    backend_used: Literal["vggt", "synthetic", "architectural", "da3"]
    glb_path: Path
    cameras_path: Path
    reference_image_path: Path
    mesh_stats: SceneMetadata
    cameras_payload: CamerasPayload
    building_spec: ArchitecturalBuildingSpecModel | None = None
    splat_path: Path | None = None


class Reconstructor(ABC):
    """Multi-view 3D exterior scene reconstructor contract."""

    backend_name: Literal["vggt", "synthetic", "architectural", "da3"]

    @abstractmethod
    def reconstruct(
        self,
        image_paths: list[Path],
        output_dir: Path,
        progress_cb: ProgressCallback | None = None,
    ) -> ReconstructionArtifacts:
        raise NotImplementedError


def select_reconstructor(
    mode: str = "auto",
    explicit_spec: dict[str, Any] | ArchitecturalBuildingSpecModel | None = None,
) -> Reconstructor:
    normalized = (mode or "auto").strip().lower()
    if normalized not in ("auto", "da3", "vggt", "synthetic", "architectural"):
        raise ValueError(f"Unsupported reconstruction mode: {mode}")

    if normalized == "da3":
        from app.da3_mps_backend import DA3MpsReconstructor

        return DA3MpsReconstructor(explicit_spec=explicit_spec)

    if explicit_spec is not None or normalized == "architectural":
        from app.architectural_backend import ArchitecturalReconstructor

        return ArchitecturalReconstructor(explicit_spec=explicit_spec)

    if normalized == "synthetic":
        from app.synthetic_backend import SyntheticReconstructor

        return SyntheticReconstructor()

    from app.vggt_backend import VGGTReconstructor, is_vggt_cuda_available

    if normalized == "vggt":
        return VGGTReconstructor()

    if is_vggt_cuda_available():
        return VGGTReconstructor()

    from app.architectural_backend import ArchitecturalReconstructor

    return ArchitecturalReconstructor()
