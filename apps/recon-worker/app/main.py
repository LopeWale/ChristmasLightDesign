from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import re
import threading
from typing import Any
import uuid

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.reconstructor import select_reconstructor
from app.schemas import ArchitecturalBuildingSpecModel, ReconstructionJob
from app.video_keyframes import extract_sharp_keyframes

VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm", ".avi"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
SAFE_JOB_ID_RE = re.compile(r"^[a-zA-Z0-9_-]+$")

ARTIFACT_MEDIA_TYPES = {
    ".glb": "model/gltf-binary",
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


def create_app() -> FastAPI:
    app = FastAPI(
        title="Lumen3D Multi-View 3D Reconstruction Worker",
        version="0.2.0",
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
    executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="recon-worker")

    def _update_job(job_id: str, **updates: object) -> None:
        with jobs_lock:
            current = jobs_store.get(job_id)
            if current is None:
                return
            jobs_store[job_id] = current.model_copy(update=updates)

    def _execute_job(
        job_id: str,
        mode: str,
        input_files: list[Path],
        job_dir: Path,
        explicit_spec: dict[str, Any] | ArchitecturalBuildingSpecModel | None = None,
    ) -> None:
        try:
            _update_job(job_id, status="processing", progress=10)
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
                        max_frames=20,
                    )
                    resolved_images.extend(extracted)
                elif suffix in IMAGE_EXTENSIONS:
                    resolved_images.append(path)

            reconstructor = select_reconstructor(mode=mode, explicit_spec=explicit_spec)
            result = reconstructor.reconstruct(
                image_paths=resolved_images,
                output_dir=artifacts_dir,
                progress_cb=lambda pct: _update_job(job_id, progress=min(99, max(10, int(pct)))),
            )

            _update_job(
                job_id,
                status="completed",
                progress=100,
                backendUsed=result.backend_used,
                glbUrl=f"/jobs/{job_id}/artifacts/{result.glb_path.name}",
                camerasUrl=f"/jobs/{job_id}/artifacts/{result.cameras_path.name}",
                referenceImageUrl=f"/jobs/{job_id}/artifacts/{result.reference_image_path.name}",
                meshStats=result.mesh_stats,
                buildingSpec=result.building_spec,
                error=None,
            )
        except Exception as exc:
            _update_job(
                job_id,
                status="failed",
                error=str(exc),
            )

    @app.get("/health")
    def health() -> dict[str, str]:
        default_mode = os.environ.get("RECON_BACKEND", "auto")
        return {"status": "ok", "defaultMode": default_mode}

    @app.post("/jobs/demo", response_model=ReconstructionJob)
    def start_demo_job(preset: str = Query(default="house")) -> ReconstructionJob:
        norm_preset = (preset or "house").strip().lower()
        job_id = f"demo-{uuid.uuid4().hex[:10]}"
        jobs_root = _default_jobs_root()
        job_dir = jobs_root / job_id
        job_dir.mkdir(parents=True, exist_ok=True)

        if norm_preset == "condo":
            from app.architectural_backend import PRESET_CONDO_3F_2B

            job = ReconstructionJob(
                jobId=job_id,
                status="queued",
                progress=0,
                mode="auto",
                buildingSpec=PRESET_CONDO_3F_2B,
            )
            with jobs_lock:
                jobs_store[job_id] = job
            executor.submit(
                _execute_job,
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
        with jobs_lock:
            jobs_store[job_id] = job

        executor.submit(_execute_job, job_id, "synthetic", [], job_dir, None)
        return job

    @app.post("/jobs/reconstruct", response_model=ReconstructionJob)
    async def start_reconstruct_job(
        files: list[UploadFile] = File(default=[]),
        mode: str = Form(default=""),
        spec_json: str = Form(default=""),
    ) -> ReconstructionJob:
        effective_mode_raw = (mode or os.environ.get("RECON_BACKEND") or "auto").strip().lower()
        if effective_mode_raw not in ("auto", "vggt", "synthetic", "architectural"):
            raise HTTPException(status_code=400, detail=f"Invalid mode: {effective_mode_raw}")

        parsed_spec: dict[str, Any] | None = None
        if spec_json and spec_json.strip():
            try:
                raw_obj = json.loads(spec_json)
                if not isinstance(raw_obj, dict):
                    raise ValueError("spec_json must be a JSON object")
                parsed_spec = raw_obj
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"Invalid spec_json: {exc}") from exc

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
        with jobs_lock:
            jobs_store[job_id] = job

        executor.submit(
            _execute_job,
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
