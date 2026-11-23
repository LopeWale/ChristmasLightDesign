from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import threading
from typing import Any
import uuid

import cv2
import numpy as np
import trimesh

from app.architectural_backend import build_framed_cameras
from app.cv_facade_analyzer import analyze_facade_images
from app.da3_mps_backend import _estimate_relative_depth_map, encode_32byte_splat_buffer
from app.neural_metric_engine import NEURAL_RUNTIME
from app.photo_mesh_builder import (
    _segment_facade_and_masses,
    build_photo_textured_architectural_scene,
)
from app.schemas import (
    BoundingBox3D,
    LiveScanFrameMetaModel,
    LiveScanSessionModel,
    ReconstructionJob,
    ScanAngleSector,
    SceneMetadata,
)
from app.synthetic_backend import render_reference_elevation_png
from app.video_keyframes import _resize_max_dim, compute_laplacian_sharpness

VALID_SECTORS: tuple[ScanAngleSector, ...] = (
    "front",
    "front_left",
    "left_side",
    "front_right",
    "right_side",
    "rear",
)

RECOMMENDED_WALK_ORDER: tuple[ScanAngleSector, ...] = (
    "front",
    "front_right",
    "right_side",
    "front_left",
    "left_side",
)

SECTOR_LABELS: dict[ScanAngleSector, str] = {
    "front": "Front Elevation",
    "front_left": "45° Front-Left Corner",
    "left_side": "Left Wall",
    "front_right": "45° Front-Right Corner",
    "right_side": "Right Wall / Garage",
    "rear": "Rear Elevation",
}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def classify_yaw_delta_to_sector(delta_deg: float) -> ScanAngleSector:
    wrapped = ((delta_deg + 180.0) % 360.0) - 180.0
    if abs(wrapped) < 22.0:
        return "front"
    if -58.0 <= wrapped <= -22.0:
        return "front_left"
    if -135.0 <= wrapped < -58.0:
        return "left_side"
    if 22.0 <= wrapped <= 58.0:
        return "front_right"
    if 58.0 < wrapped <= 135.0:
        return "right_side"
    return "rear"


def _next_guidance_message(covered: list[ScanAngleSector]) -> str:
    covered_set = set(covered)
    for target in RECOMMENDED_WALK_ORDER:
        if target not in covered_set:
            return f"Captured {len(covered)}/5 angles — walk toward {SECTOR_LABELS[target]} next."
    return "All key exterior angles captured! Tap Finish to start placing holiday lights."


def _project_sector_splats(
    bgr: np.ndarray,
    sector: ScanAngleSector,
    bounds: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Project a crisp, sky-cropped 3D Gaussian depth-relief sheet for `sector` onto the
    corresponding 3D building wall (`front` +Z, `right_side` +X, `left_side` -X, `rear` -Z).
    """
    seg = _segment_facade_and_masses(bgr)
    rectified_bgr = seg["rectified_bgr"]  # type: ignore[assignment]
    gw, gh = 88, 76
    small = cv2.resize(rectified_bgr, (gw, gh), interpolation=cv2.INTER_AREA)
    depth = _estimate_relative_depth_map(small)
    rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB).reshape(-1, 3)
    rgba = np.hstack([rgb, np.full((len(rgb), 1), 135, dtype=np.uint8)])

    min_x, _, min_z = float(bounds[0, 0]), float(bounds[0, 1]), float(bounds[0, 2])
    max_x, max_y, max_z = float(bounds[1, 0]), float(bounds[1, 1]), float(bounds[1, 2])

    vs = np.linspace(max_y * 0.98, 0.08, gh, dtype=np.float32)
    relief = (depth - 0.5) * 0.16

    if sector in ("right_side", "front_right"):
        zs = np.linspace(max_z * 0.96, min_z * 0.96, gw, dtype=np.float32)
        grid_z, grid_y = np.meshgrid(zs, vs)
        grid_x = np.full_like(grid_z, max_x - 0.015) + relief
    elif sector in ("left_side", "front_left"):
        zs = np.linspace(min_z * 0.96, max_z * 0.96, gw, dtype=np.float32)
        grid_z, grid_y = np.meshgrid(zs, vs)
        grid_x = np.full_like(grid_z, min_x + 0.015) - relief
    elif sector == "rear":
        xs = np.linspace(max_x * 0.96, min_x * 0.96, gw, dtype=np.float32)
        grid_x, grid_y = np.meshgrid(xs, vs)
        grid_z = np.full_like(grid_x, min_z + 0.015) - relief
    else:
        xs = np.linspace(min_x * 0.96, max_x * 0.96, gw, dtype=np.float32)
        grid_x, grid_y = np.meshgrid(xs, vs)
        grid_z = np.full_like(grid_x, max_z - 0.015) + relief

    pts = np.column_stack([grid_x.reshape(-1), grid_y.reshape(-1), grid_z.reshape(-1)]).astype(
        np.float32
    )
    scales = np.full((len(pts), 3), 0.032, dtype=np.float32)
    return pts, scales, rgba


class LiveScanSessionManager:
    """
    Stateful, disk-backed manager for real-time guided walkaround camera scan sessions.
    """

    def __init__(self, jobs_root_fn: Any) -> None:
        self._jobs_root_fn = jobs_root_fn
        self._lock = threading.Lock()
        self._sessions: dict[str, LiveScanSessionModel] = {}
        self._internal_meta: dict[str, dict[str, Any]] = {}

    def _session_dir(self, session_id: str) -> Path:
        root: Path = self._jobs_root_fn()
        return (root / session_id).resolve()

    def _persist(self, session: LiveScanSessionModel, meta: dict[str, Any]) -> None:
        s_dir = self._session_dir(session.sessionId)
        s_dir.mkdir(parents=True, exist_ok=True)
        tmp_s = s_dir / "session.json.tmp"
        tmp_m = s_dir / "session_meta.json.tmp"
        tmp_s.write_text(session.model_dump_json(indent=2), encoding="utf-8")
        tmp_m.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        os.replace(tmp_s, s_dir / "session.json")
        os.replace(tmp_m, s_dir / "session_meta.json")

    def _load_if_needed(self, session_id: str) -> tuple[LiveScanSessionModel, dict[str, Any]] | None:
        with self._lock:
            if session_id in self._sessions:
                return self._sessions[session_id], self._internal_meta[session_id]

        root: Path = self._jobs_root_fn()
        s_dir = (root / session_id).resolve()
        s_file = s_dir / "session.json"
        m_file = s_dir / "session_meta.json"
        if not s_dir.is_relative_to(root) or not s_file.is_file():
            return None

        try:
            session = LiveScanSessionModel.model_validate_json(
                s_file.read_text(encoding="utf-8")
            )
            meta = (
                json.loads(m_file.read_text(encoding="utf-8"))
                if m_file.is_file()
                else {"anchor_yaw": None, "revision": 0, "sector_files": {}, "sector_scores": {}}
            )
            with self._lock:
                self._sessions[session_id] = session
                self._internal_meta[session_id] = meta
            return session, meta
        except Exception:
            return None

    def create_session(
        self,
        address: str | None = None,
        target_height_m: float | None = None,
        partial_overrides: dict[str, Any] | None = None,
    ) -> LiveScanSessionModel:
        session_id = f"scan-{uuid.uuid4().hex[:10]}"
        now = _utc_now_iso()
        session = LiveScanSessionModel(
            sessionId=session_id,
            status="waiting_for_frames",
            address=address or None,
            targetHeightMeters=target_height_m,
            coveredSectors=[],
            frames=[],
            latestJob=None,
            neuralBackendUsed=NEURAL_RUNTIME.active_backend_kind(),
            guidanceMessage="Point camera at the Front Elevation and hold steady.",
            updatedAtIso=now,
        )
        meta: dict[str, Any] = {
            "anchor_yaw": None,
            "revision": 0,
            "sector_files": {},
            "sector_scores": {},
            "partial_overrides": partial_overrides or {},
        }
        with self._lock:
            self._sessions[session_id] = session
            self._internal_meta[session_id] = meta
        self._persist(session, meta)
        # Opportunistically warm cached neural models in background
        NEURAL_RUNTIME.start_background_warmup(allow_download=False)
        return session

    def get_session(self, session_id: str) -> LiveScanSessionModel | None:
        loaded = self._load_if_needed(session_id)
        return loaded[0] if loaded is not None else None

    def ingest_frame(
        self,
        session_id: str,
        raw_bytes: bytes,
        sector_hint: str = "auto",
        yaw_deg: float | None = None,
        min_sharpness: float = 24.0,
    ) -> LiveScanSessionModel:
        loaded = self._load_if_needed(session_id)
        if loaded is None:
            raise KeyError(f"Scan session '{session_id}' not found")
        session, meta = loaded

        arr = np.frombuffer(raw_bytes, dtype=np.uint8)
        bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if bgr is None or bgr.size == 0:
            raise ValueError("Uploaded camera frame is not a readable JPEG/PNG/WEBP image.")

        resized = _resize_max_dim(bgr, 960)
        sharpness = compute_laplacian_sharpness(resized)

        if sharpness < min_sharpness:
            warn_session = session.model_copy(
                update={
                    "guidanceMessage": f"Hold camera steady — frame motion-blurred (focus {sharpness:.0f} < {min_sharpness:.0f}).",
                    "updatedAtIso": _utc_now_iso(),
                }
            )
            with self._lock:
                self._sessions[session_id] = warn_session
            self._persist(warn_session, meta)
            return warn_session

        # Resolve viewing sector
        norm_hint = (sector_hint or "auto").strip().lower()
        if norm_hint in VALID_SECTORS:
            resolved_sector: ScanAngleSector = norm_hint  # type: ignore[assignment]
            if resolved_sector == "front" and yaw_deg is not None and meta.get("anchor_yaw") is None:
                meta["anchor_yaw"] = float(yaw_deg)
        elif not meta["sector_files"]:
            resolved_sector = "front"
            if yaw_deg is not None:
                meta["anchor_yaw"] = float(yaw_deg)
        elif yaw_deg is not None and meta.get("anchor_yaw") is not None:
            resolved_sector = classify_yaw_delta_to_sector(
                float(yaw_deg) - float(meta["anchor_yaw"])
            )
        else:
            # Cycle to next uncovered walkaround sector when device lacks a compass gyroscope
            existing = set(meta["sector_files"].keys())
            resolved_sector = "front"
            for candidate_sec in RECOMMENDED_WALK_ORDER:
                if candidate_sec not in existing:
                    resolved_sector = candidate_sec
                    break

        s_dir = self._session_dir(session_id)
        frames_dir = s_dir / "frames"
        artifacts_dir = s_dir / "artifacts"
        frames_dir.mkdir(parents=True, exist_ok=True)
        artifacts_dir.mkdir(parents=True, exist_ok=True)

        frame_id = f"f-{len(session.frames) + 1:03d}"
        prev_score = float(meta["sector_scores"].get(resolved_sector, -1.0))
        sector_img_path = frames_dir / f"sector_{resolved_sector}.jpg"
        if sharpness >= prev_score or not sector_img_path.is_file():
            cv2.imwrite(
                str(sector_img_path), resized, [cv2.IMWRITE_JPEG_QUALITY, 94]
            )
            meta["sector_files"][resolved_sector] = str(sector_img_path)
            meta["sector_scores"][resolved_sector] = float(sharpness)

        meta["revision"] = int(meta.get("revision", 0)) + 1
        rev = int(meta["revision"])

        sector_paths: dict[str, Path] = {
            k: Path(v) for k, v in meta["sector_files"].items() if Path(v).is_file()
        }
        ordered_paths = [
            sector_paths[sec] for sec in VALID_SECTORS if sec in sector_paths
        ]

        # Analyze primary + multi-view images and fuse 3D PBR mesh + 3D Gaussian splats
        spec = analyze_facade_images(
            ordered_paths, partial_overrides=meta.get("partial_overrides") or None
        )
        scene, updated_spec = build_photo_textured_architectural_scene(
            image_paths=ordered_paths,
            spec=spec,
            sector_views=sector_paths,
            target_height_m=session.targetHeightMeters,
        )

        glb_name = f"scene_r{rev:03d}.glb"
        splat_name = f"scene_r{rev:03d}.splat"
        glb_path = artifacts_dir / glb_name
        glb_path.write_bytes(trimesh.exchange.gltf.export_glb(scene, include_normals=True))

        cameras_payload = build_framed_cameras(scene)
        cameras_path = artifacts_dir / "cameras.json"
        cameras_path.write_text(cameras_payload.model_dump_json(indent=2), encoding="utf-8")

        ref_path = artifacts_dir / "reference_front.png"
        render_reference_elevation_png(scene, cameras_payload.cameras[0], ref_path)

        # Build fused multi-view 3D Gaussian Splat buffer (MoGe-2 / DA3 neural runtime when warm,
        # otherwise multi-wall surface + per-sector depth-relief Gaussian accumulation!)
        neural_arrays = NEURAL_RUNTIME.try_infer_multiview_splats(
            ordered_paths, target_height_m=session.targetHeightMeters
        )
        backend_kind = NEURAL_RUNTIME.active_backend_kind()

        if neural_arrays is not None:
            pos_arr, scale_arr, rgba_arr = neural_arrays
        else:
            color_meshes = []
            for g in scene.geometry.values():
                if not isinstance(g, trimesh.Trimesh):
                    continue
                gc = g.copy()
                if not hasattr(gc.visual, "vertex_colors"):
                    gc.visual = gc.visual.to_color()
                color_meshes.append(gc)
            merged = trimesh.util.concatenate(color_meshes)
            surf_pts, face_idx = trimesh.sample.sample_surface(merged, 1800, seed=42)
            surf_rgba = merged.visual.face_colors[face_idx][:, :4].copy()
            surf_rgba[:, 3] = 110
            surf_scales = np.full((len(surf_pts), 3), 0.035, dtype=np.float32)

            pts_list = [surf_pts.astype(np.float32)]
            scales_list = [surf_scales]
            rgba_list = [surf_rgba]

            bldg_bounds = np.array(
                [
                    [
                        min(p[0] for p in updated_spec.footprintPolygonMeters),
                        0.0,
                        min(p[1] for p in updated_spec.footprintPolygonMeters),
                    ],
                    [
                        max(p[0] for p in updated_spec.footprintPolygonMeters),
                        updated_spec.floors * updated_spec.metersPerFloor,
                        max(p[1] for p in updated_spec.footprintPolygonMeters),
                    ],
                ],
                dtype=np.float64,
            )

            for sec_key, sec_path in sector_paths.items():
                sec_bgr = cv2.imread(str(sec_path), cv2.IMREAD_COLOR)
                if sec_bgr is not None and sec_bgr.size > 0:
                    s_pts, s_sc, s_rgba = _project_sector_splats(
                        sec_bgr,
                        sec_key,  # type: ignore[arg-type]
                        bldg_bounds,
                    )
                    pts_list.append(s_pts)
                    scales_list.append(s_sc)
                    rgba_list.append(s_rgba)

            pos_arr = np.vstack(pts_list)
            scale_arr = np.vstack(scales_list)
            rgba_arr = np.vstack(rgba_list)

        splat_path = artifacts_dir / splat_name
        splat_path.write_bytes(encode_32byte_splat_buffer(pos_arr, scale_arr, rgba_arr))

        total_verts = sum(
            len(g.vertices) for g in scene.geometry.values() if isinstance(g, trimesh.Trimesh)
        )
        total_faces = sum(
            len(g.faces) for g in scene.geometry.values() if isinstance(g, trimesh.Trimesh)
        )
        bounds = scene.bounds
        stats = SceneMetadata(
            vertexCount=int(total_verts),
            faceCount=int(total_faces),
            boundingBox=BoundingBox3D(
                min=(float(bounds[0, 0]), float(bounds[0, 1]), float(bounds[0, 2])),
                max=(float(bounds[1, 0]), float(bounds[1, 1]), float(bounds[1, 2])),
            ),
        )

        covered = [sec for sec in VALID_SECTORS if sec in sector_paths]
        updated_spec = updated_spec.model_copy(
            update={
                "sourceSummary": f"Live Multi-View Scan ({len(covered)} angle{'s' if len(covered) != 1 else ''}, {backend_kind})"
            }
        )

        latest_job = ReconstructionJob(
            jobId=session_id,
            status="completed",
            progress=min(100, 20 + len(covered) * 16),
            mode="da3",
            backendUsed="da3",
            glbUrl=f"/jobs/{session_id}/artifacts/{glb_name}",
            splatUrl=f"/jobs/{session_id}/artifacts/{splat_name}",
            camerasUrl=f"/jobs/{session_id}/artifacts/cameras.json",
            referenceImageUrl=f"/jobs/{session_id}/artifacts/reference_front.png",
            meshStats=stats,
            buildingSpec=updated_spec,
            error=None,
        )

        now = _utc_now_iso()
        frame_meta = LiveScanFrameMetaModel(
            frameId=frame_id,
            sector=resolved_sector,
            sharpnessScore=round(float(sharpness), 1),
            yawDegrees=float(yaw_deg) if yaw_deg is not None else None,
            capturedAtIso=now,
        )

        new_session = session.model_copy(
            update={
                "status": "ready",
                "coveredSectors": covered,
                "frames": [*session.frames, frame_meta],
                "latestJob": latest_job,
                "neuralBackendUsed": backend_kind,
                "guidanceMessage": _next_guidance_message(covered),
                "updatedAtIso": now,
                "error": None,
            }
        )

        with self._lock:
            self._sessions[session_id] = new_session
            self._internal_meta[session_id] = meta
        self._persist(new_session, meta)
        return new_session
