from __future__ import annotations

import asyncio
from concurrent.futures import Future, ThreadPoolExecutor
import json
import logging
import os
from pathlib import Path
import re
import threading
import time
from typing import Any
import uuid

import cv2
from fastapi import Body, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

# Prevent OpenCV pthreads/GCD thread-pool contention inside ThreadPoolExecutor workers on macOS
cv2.setNumThreads(1)

# Eagerly import core reconstructors on the main thread so concurrent worker threads never
# race on lazy C-extension imports (scipy.signal / numpy.fft / trimesh)
from app.architectural_backend import ArchitecturalReconstructor, PRESET_CONDO_3F_2B  # noqa: E402,F401
from app.da3_mps_backend import DA3MpsReconstructor  # noqa: E402,F401
from app.live_scan_manager import LiveScanSessionManager  # noqa: E402
from app.neural_metric_engine import NEURAL_RUNTIME  # noqa: E402
from app.reconstructor import select_reconstructor  # noqa: E402
from app.schemas import (  # noqa: E402
    ArchitecturalBuildingSpecModel,
    LiveScanSessionModel,
    ReconstructionJob,
)
from app.synthetic_backend import SyntheticReconstructor  # noqa: E402,F401
from app.video_keyframes import extract_sharp_keyframes  # noqa: E402


class CreateLiveScanSessionRequest(BaseModel):
    address: str | None = None
    targetHeightMeters: float | None = None
    partialOverrides: dict[str, Any] | None = None

logger = logging.getLogger("uvicorn.error")

VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm", ".avi"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
SAFE_JOB_ID_RE = re.compile(r"^[a-zA-Z0-9_-]+$")

ARTIFACT_MEDIA_TYPES = {
    ".glb": "model/gltf-binary",
    ".splat": "application/octet-stream",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}


def _default_jobs_root() -> Path:
    env_dir = os.environ.get("RECON_JOBS_DIR")
    if env_dir:
        return Path(env_dir).resolve()
    return (Path(__file__).resolve().parent.parent / "jobs_data").resolve()


def _persist_job_state(job_dir: Path, job: ReconstructionJob) -> None:
    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        tmp_path = job_dir / "job.json.tmp"
        final_path = job_dir / "job.json"
        tmp_path.write_text(job.model_dump_json(indent=2), encoding="utf-8")
        os.replace(tmp_path, final_path)
    except OSError:
        pass


def _load_persisted_job(jobs_root: Path, job_id: str) -> ReconstructionJob | None:
    if not SAFE_JOB_ID_RE.match(job_id):
        return None
    job_file = (jobs_root / job_id / "job.json").resolve()
    if not job_file.is_relative_to(jobs_root) or not job_file.is_file():
        return None
    try:
        return ReconstructionJob.model_validate_json(job_file.read_text(encoding="utf-8"))
    except Exception:
        return None


def create_app() -> FastAPI:
    app = FastAPI(
        title="Lumen3D Multi-View 3D Reconstruction Worker",
        version="0.2.1",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    jobs_lock = threading.Lock()
    jobs_store: dict[str, ReconstructionJob] = {}
    executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="recon-worker")
    scan_manager = LiveScanSessionManager(_default_jobs_root)

    def _save_job(job_dir: Path, job: ReconstructionJob) -> None:
        with jobs_lock:
            jobs_store[job.jobId] = job
        _persist_job_state(job_dir, job)

    def _update_job(job_id: str, job_dir: Path, **updates: object) -> None:
        updated: ReconstructionJob | None = None
        with jobs_lock:
            current = jobs_store.get(job_id)
            if current is not None:
                updated = current.model_copy(update=updates)
                jobs_store[job_id] = updated
        if updated is not None:
            _persist_job_state(job_dir, updated)

    def _submit_job(
        job_id: str,
        mode: str,
        input_files: list[Path],
        job_dir: Path,
        explicit_spec: dict[str, Any] | ArchitecturalBuildingSpecModel | None = None,
    ) -> None:
        fut = executor.submit(
            _execute_job,
            job_id,
            mode,
            input_files,
            job_dir,
            explicit_spec,
        )

        def _on_done(done_fut: Future[None]) -> None:
            exc = done_fut.exception()
            if exc is not None:
                _update_job(
                    job_id,
                    job_dir,
                    status="failed",
                    error=str(exc) or exc.__class__.__name__,
                )

        fut.add_done_callback(_on_done)

    def _execute_job(
        job_id: str,
        mode: str,
        input_files: list[Path],
        job_dir: Path,
        explicit_spec: dict[str, Any] | ArchitecturalBuildingSpecModel | None = None,
    ) -> None:
        t0 = time.perf_counter()
        try:
            _update_job(job_id, job_dir, status="processing", progress=10)
            artifacts_dir = job_dir / "artifacts"
            artifacts_dir.mkdir(parents=True, exist_ok=True)

            resolved_images: list[Path] = []
            for idx, path in enumerate(input_files):
                suffix = path.suffix.lower()
                if suffix in VIDEO_EXTENSIONS:
                    keyframes_dir = job_dir / f"keyframes_{idx:02d}"
                    extracted = extract_sharp_keyframes(
                        video_path=path,
                        output_dir=keyframes_dir,
                        target_fps=2.0,
                        max_frames=16,
                        progress_cb=lambda pct: _update_job(
                            job_id, job_dir, progress=min(30, max(10, int(pct)))
                        ),
                    )
                    resolved_images.extend(extracted)
                elif suffix in IMAGE_EXTENSIONS:
                    resolved_images.append(path)

            _update_job(job_id, job_dir, progress=30)
            reconstructor = select_reconstructor(mode=mode, explicit_spec=explicit_spec)
            result = reconstructor.reconstruct(
                image_paths=resolved_images,
                output_dir=artifacts_dir,
                progress_cb=lambda pct: _update_job(
                    job_id, job_dir, progress=min(99, max(30, int(pct)))
                ),
            )

            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            _update_job(
                job_id,
                job_dir,
                status="completed",
                progress=100,
                backendUsed=result.backend_used,
                glbUrl=f"/jobs/{job_id}/artifacts/{result.glb_path.name}",
                splatUrl=(
                    f"/jobs/{job_id}/artifacts/{result.splat_path.name}"
                    if result.splat_path is not None
                    else None
                ),
                camerasUrl=f"/jobs/{job_id}/artifacts/{result.cameras_path.name}",
                referenceImageUrl=f"/jobs/{job_id}/artifacts/{result.reference_image_path.name}",
                meshStats=result.mesh_stats,
                buildingSpec=result.building_spec,
                error=None,
            )
            logger.info(
                "[lumen3d:worker] job=%s completed backend=%s views=%d in %.1fms",
                job_id,
                result.backend_used,
                len(resolved_images),
                elapsed_ms,
            )
        except BaseException as exc:
            err_msg = str(exc) or exc.__class__.__name__
            _update_job(
                job_id,
                job_dir,
                status="failed",
                error=err_msg,
            )
            logger.error("[lumen3d:worker] job=%s failed: %s", job_id, err_msg)
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                raise

    @app.get("/health")
    def health() -> dict[str, Any]:
        default_mode = os.environ.get("RECON_BACKEND", "auto")
        return {
            "status": "ok",
            "defaultMode": default_mode,
            **NEURAL_RUNTIME.status(),
        }

    @app.post("/models/warmup")
    def warmup_neural_models(allow_download: bool = Query(default=False)) -> dict[str, Any]:
        NEURAL_RUNTIME.start_background_warmup(allow_download=allow_download)
        return {"status": "warming", **NEURAL_RUNTIME.status()}

    @app.post("/scan/sessions", response_model=LiveScanSessionModel)
    def create_scan_session(
        payload: CreateLiveScanSessionRequest | None = Body(default=None),
    ) -> LiveScanSessionModel:
        req = payload or CreateLiveScanSessionRequest()
        return scan_manager.create_session(
            address=req.address,
            target_height_m=req.targetHeightMeters,
            partial_overrides=req.partialOverrides,
        )

    @app.get("/scan/sessions/{session_id}", response_model=LiveScanSessionModel)
    def get_scan_session(session_id: str) -> LiveScanSessionModel:
        if not SAFE_JOB_ID_RE.match(session_id):
            raise HTTPException(status_code=400, detail="Invalid session identifier")
        session = scan_manager.get_session(session_id)
        if session is None:
            raise HTTPException(
                status_code=404, detail=f"Scan session '{session_id}' not found"
            )
        return session

    @app.post("/scan/sessions/{session_id}/frames", response_model=LiveScanSessionModel)
    async def ingest_scan_frame(
        session_id: str,
        file: UploadFile = File(...),
        sector: str = Form(default="auto"),
        yaw_deg: str = Form(default=""),
    ) -> LiveScanSessionModel:
        if not SAFE_JOB_ID_RE.match(session_id):
            raise HTTPException(status_code=400, detail="Invalid session identifier")
        raw_bytes = await file.read()
        if not raw_bytes:
            raise HTTPException(status_code=400, detail="Empty camera frame payload")

        parsed_yaw: float | None = None
        if yaw_deg and yaw_deg.strip():
            try:
                val = float(yaw_deg.strip())
                if val == val:  # guard NaN
                    parsed_yaw = val
            except ValueError:
                parsed_yaw = None

        try:
            return await asyncio.to_thread(
                scan_manager.ingest_frame,
                session_id,
                raw_bytes,
                sector,
                parsed_yaw,
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/jobs/demo", response_model=ReconstructionJob)
    def start_demo_job(preset: str = Query(default="house")) -> ReconstructionJob:
        norm_preset = (preset or "house").strip().lower()
        job_id = f"demo-{uuid.uuid4().hex[:10]}"
        jobs_root = _default_jobs_root()
        job_dir = jobs_root / job_id
        job_dir.mkdir(parents=True, exist_ok=True)

        if norm_preset == "condo":
            job = ReconstructionJob(
                jobId=job_id,
                status="queued",
                progress=0,
                mode="auto",
                buildingSpec=PRESET_CONDO_3F_2B,
            )
            _save_job(job_dir, job)
            _submit_job(
                job_id,
                "architectural",
                [],
                job_dir,
                PRESET_CONDO_3F_2B,
            )
            return job

        job = ReconstructionJob(
            jobId=job_id,
            status="queued",
            progress=0,
            mode="synthetic",
        )
        _save_job(job_dir, job)
        _submit_job(job_id, "synthetic", [], job_dir, None)
        return job

    @app.post("/jobs/reconstruct", response_model=ReconstructionJob)
    async def start_reconstruct_job(
        files: list[UploadFile] = File(default=[]),
        mode: str = Form(default=""),
        spec_json: str = Form(default=""),
    ) -> ReconstructionJob:
        effective_mode_raw = (
            mode or os.environ.get("RECON_BACKEND") or "auto"
        ).strip().lower()
        if effective_mode_raw not in (
            "auto",
            "da3",
            "vggt",
            "synthetic",
            "architectural",
        ):
            raise HTTPException(
                status_code=400, detail=f"Invalid mode: {effective_mode_raw}"
            )

        parsed_spec: dict[str, Any] | None = None
        if spec_json and spec_json.strip():
            try:
                raw_obj = json.loads(spec_json)
                if not isinstance(raw_obj, dict):
                    raise ValueError("spec_json must be a JSON object")
                parsed_spec = raw_obj
            except Exception as exc:
                raise HTTPException(
                    status_code=400, detail=f"Invalid spec_json: {exc}"
                ) from exc

        if effective_mode_raw != "synthetic" and len(files) == 0 and parsed_spec is None:
            raise HTTPException(
                status_code=400,
                detail="At least one image (JPEG/PNG/WEBP), walkaround video (.mp4/.mov), or spec_json is required.",
            )

        job_id = f"recon-{uuid.uuid4().hex[:10]}"
        jobs_root = _default_jobs_root()
        job_dir = jobs_root / job_id
        uploads_dir = job_dir / "uploads"
        uploads_dir.mkdir(parents=True, exist_ok=True)

        saved_inputs: list[Path] = []
        for idx, upload in enumerate(files):
            raw_name = Path(upload.filename or f"upload_{idx}.png").name
            ext = Path(raw_name).suffix.lower() or ".png"
            if ext not in IMAGE_EXTENSIONS and ext not in VIDEO_EXTENSIONS:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported file extension '{ext}'. Upload JPEG/PNG/WEBP or MP4/MOV.",
                )
            dest = uploads_dir / f"input_{idx:03d}{ext}"
            content = await upload.read()
            dest.write_bytes(content)
            saved_inputs.append(dest)

        reported_mode = (
            "auto"
            if effective_mode_raw == "architectural"
            else effective_mode_raw  # type: ignore[assignment]
        )
        job = ReconstructionJob(
            jobId=job_id,
            status="queued",
            progress=0,
            mode=reported_mode,  # type: ignore[arg-type]
        )
        _save_job(job_dir, job)
        _submit_job(
            job_id,
            effective_mode_raw,
            saved_inputs,
            job_dir,
            parsed_spec,
        )
        return job

    @app.get("/jobs/{job_id}", response_model=ReconstructionJob)
    def get_job_status(job_id: str) -> ReconstructionJob:
        with jobs_lock:
            job = jobs_store.get(job_id)
        if job is None:
            persisted = _load_persisted_job(_default_jobs_root(), job_id)
            if persisted is not None:
                with jobs_lock:
                    jobs_store[job_id] = persisted
                return persisted
            if job_id.startswith("scan-"):
                scan_session = scan_manager.get_session(job_id)
                if scan_session is not None and scan_session.latestJob is not None:
                    return scan_session.latestJob
            raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
        return job

    @app.get("/jobs/{job_id}/artifacts/{filename}")
    def get_job_artifact(job_id: str, filename: str) -> FileResponse:
        if not SAFE_JOB_ID_RE.match(job_id):
            raise HTTPException(status_code=400, detail="Invalid job identifier")
        safe_name = Path(filename).name
        if safe_name != filename or ".." in filename:
            raise HTTPException(status_code=400, detail="Invalid artifact filename")

        jobs_root = _default_jobs_root()
        artifact_path = (jobs_root / job_id / "artifacts" / safe_name).resolve()
        if not artifact_path.is_relative_to(jobs_root) or not artifact_path.is_file():
            raise HTTPException(status_code=404, detail="Artifact not found")

        media_type = ARTIFACT_MEDIA_TYPES.get(
            artifact_path.suffix.lower(), "application/octet-stream"
        )
        return FileResponse(artifact_path, media_type=media_type)

    return app


app = create_app()
