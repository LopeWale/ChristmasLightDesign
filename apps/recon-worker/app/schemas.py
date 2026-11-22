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


class BalconySpecModel(BaseModel):
    id: str
    floor: int = Field(ge=1, le=8)
    wallFace: Literal["front", "left", "right", "rear"] = "front"
    centerOffsetNorm: float = Field(default=0.0, ge=-0.45, le=0.45)
    widthMeters: float = Field(default=3.2, ge=0.8, le=20.0)
    depthMeters: float = Field(default=1.4, ge=0.4, le=6.0)
    mountStyle: Literal["cantilevered", "recessed"] = "cantilevered"
    railingType: Literal["metal_picket", "glass_panel", "solid_parapet"] = "metal_picket"


class ArchitecturalBuildingSpecModel(BaseModel):
    archetype: Literal[
        "multi_story_condo",
        "townhouse",
        "single_family_gable",
        "modern_box",
    ] = "multi_story_condo"
    floors: int = Field(default=3, ge=1, le=8)
    metersPerFloor: float = Field(default=3.05, ge=2.4, le=5.0)
    footprintPolygonMeters: list[tuple[float, float]] = Field(
        default_factory=lambda: [(-6.0, -4.8), (6.0, -4.8), (6.0, 4.8), (-6.0, 4.8)]
    )
    roofStyle: Literal["flat_parapet", "pitched_gable", "hip"] = "flat_parapet"
    roofPitchDegrees: float = Field(default=2.0, ge=0.0, le=55.0)
    wallColorRgb: tuple[int, int, int] = (172, 108, 88)
    trimColorRgb: tuple[int, int, int] = (236, 238, 242)
    roofColorRgb: tuple[int, int, int] = (56, 60, 68)
    windowBaysPerFloor: int = Field(default=4, ge=1, le=12)
    hasGarage: bool = False
    balconies: list[BalconySpecModel] = Field(default_factory=list)
    sourceSummary: str = "Parametric 3D architectural model"


ReconstructionMode = Literal["auto", "da3", "vggt", "synthetic", "architectural"]
JobStatus = Literal["queued", "processing", "completed", "failed"]


class ReconstructionJob(BaseModel):
    jobId: str
    status: JobStatus
    progress: int = Field(ge=0, le=100)
    mode: Literal["auto", "da3", "vggt", "synthetic"]
    backendUsed: Optional[Literal["vggt", "synthetic", "architectural", "da3"]] = None
    glbUrl: Optional[str] = None
    splatUrl: Optional[str] = None
    camerasUrl: Optional[str] = None
    referenceImageUrl: Optional[str] = None
    meshStats: Optional[SceneMetadata] = None
    buildingSpec: Optional[ArchitecturalBuildingSpecModel] = None
    error: Optional[str] = None


ScanAngleSector = Literal[
    "front",
    "front_left",
    "left_side",
    "front_right",
    "right_side",
    "rear",
]

NeuralBackendKind = Literal[
    "da3_moge2_mps",
    "moge2_mps",
    "da3_mps",
    "hybrid_multiview_relief",
]


class LiveScanFrameMetaModel(BaseModel):
    frameId: str
    sector: ScanAngleSector
    sharpnessScore: float = Field(ge=0.0)
    yawDegrees: Optional[float] = None
    capturedAtIso: str


class LiveScanSessionModel(BaseModel):
    sessionId: str
    status: Literal["waiting_for_frames", "reconstructing", "ready", "failed"] = (
        "waiting_for_frames"
    )
    address: Optional[str] = None
    targetHeightMeters: Optional[float] = None
    coveredSectors: list[ScanAngleSector] = Field(default_factory=list)
    frames: list[LiveScanFrameMetaModel] = Field(default_factory=list)
    latestJob: Optional[ReconstructionJob] = None
    neuralBackendUsed: NeuralBackendKind = "hybrid_multiview_relief"
    guidanceMessage: str = (
        "Point camera at the front of your building to capture the anchor frame."
    )
    updatedAtIso: str
    error: Optional[str] = None
