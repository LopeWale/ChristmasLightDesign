from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field


class BoundingBox3D(BaseModel):
    min: tuple[float, float, float]
    max: tuple[float, float, float]


class SceneMetadata(BaseModel):
    vertexCount: int = Field(ge=0)
    faceCount: int = Field(gt=0)
    boundingBox: BoundingBox3D


class CameraPose(BaseModel):
    id: int = Field(ge=0)
    name: str
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    intrinsics: list[list[float]]
    extrinsics: list[list[float]]


class CamerasPayload(BaseModel):
    convention: str = "opencv_camera_to_world"
    cameras: list[CameraPose]


ReconstructionMode = Literal["auto", "vggt", "synthetic"]
JobStatus = Literal["queued", "processing", "completed", "failed"]


class ReconstructionJob(BaseModel):
    jobId: str
    status: JobStatus
    progress: int = Field(ge=0, le=100)
    mode: ReconstructionMode
    backendUsed: Optional[Literal["vggt", "synthetic"]] = None
    glbUrl: Optional[str] = None
    camerasUrl: Optional[str] = None
    referenceImageUrl: Optional[str] = None
    meshStats: Optional[SceneMetadata] = None
    error: Optional[str] = None
