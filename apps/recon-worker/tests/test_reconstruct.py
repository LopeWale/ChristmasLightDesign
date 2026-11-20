from __future__ import annotations

import io
import time
from pathlib import Path

import cv2
import numpy as np
import pytest
import trimesh
from fastapi.testclient import TestClient
from PIL import Image


def _poll_until_done(client: TestClient, job_id: str, timeout_s: float = 3.0) -> dict:
    deadline = time.perf_counter() + timeout_s
    last_payload = {}
    while time.perf_counter() < deadline:
        resp = client.get(f"/jobs/{job_id}")
        assert resp.status_code == 200
        last_payload = resp.json()
        if last_payload["status"] in ("completed", "failed"):
            return last_payload
        time.sleep(0.03)
    pytest.fail(f"Job {job_id} did not complete within {timeout_s}s: {last_payload}")


def test_demo_synthetic_job_completes_under_3s_with_valid_glb_normals_and_cameras(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("RECON_JOBS_DIR", str(tmp_path / "jobs"))
    from app.main import create_app

    app = create_app()
    client = TestClient(app)

    t0 = time.perf_counter()
    post_resp = client.post("/jobs/demo")
    assert post_resp.status_code == 200
    init_job = post_resp.json()
    job_id = init_job["jobId"]

    final_job = _poll_until_done(client, job_id, timeout_s=3.0)
    elapsed = time.perf_counter() - t0
    assert elapsed < 3.0, f"Synthetic job took {elapsed:.2f}s (> 3.0s limit)"
    assert final_job["status"] == "completed"
    assert final_job["progress"] == 100
    assert final_job["backendUsed"] == "synthetic"
    assert final_job["meshStats"]["faceCount"] > 100
    assert final_job["meshStats"]["faceCount"] <= 250_000
    assert final_job["meshStats"]["vertexCount"] > 100

    # Fetch and validate scene.glb via trimesh
    glb_resp = client.get(final_job["glbUrl"])
    assert glb_resp.status_code == 200
    loaded = trimesh.load(io.BytesIO(glb_resp.content), file_type="glb")

    geometries = list(loaded.geometry.values()) if isinstance(loaded, trimesh.Scene) else [loaded]
    assert len(geometries) >= 6

    total_faces = 0
    for geom in geometries:
        assert isinstance(geom, trimesh.Trimesh)
        assert len(geom.faces) > 0
        assert len(geom.vertices) > 0
        assert not np.isnan(geom.vertices).any(), "Found NaN vertices in scene.glb"
        assert not np.isinf(geom.vertices).any(), "Found Inf vertices in scene.glb"
        normals = geom.vertex_normals
        assert normals.shape == geom.vertices.shape
        assert not np.isnan(normals).any(), "Found NaN vertex normals in scene.glb"
        norms = np.linalg.norm(normals, axis=1)
        assert np.all(norms > 0.9), "Vertex normals must be non-zero unit vectors"
        total_faces += len(geom.faces)

    assert total_faces == final_job["meshStats"]["faceCount"]

    # Ground plane minY should sit cleanly at 0.0 for accurate elevation math
    min_y = final_job["meshStats"]["boundingBox"]["min"][1]
    assert abs(min_y) < 1e-3

    # Fetch and validate cameras.json
    cam_resp = client.get(final_job["camerasUrl"])
    assert cam_resp.status_code == 200
    cameras_data = cam_resp.json()
    assert len(cameras_data["cameras"]) >= 3
    cam0 = cameras_data["cameras"][0]
    assert cam0["name"] == "front"
    assert len(cam0["intrinsics"]) == 3
    assert len(cam0["extrinsics"]) == 4

    # Fetch and validate reference_front.png
    img_resp = client.get(final_job["referenceImageUrl"])
    assert img_resp.status_code == 200
    img = Image.open(io.BytesIO(img_resp.content))
    assert img.size == (cam0["width"], cam0["height"])


def test_multipart_image_reconstruct_auto_mode(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("RECON_JOBS_DIR", str(tmp_path / "jobs"))
    monkeypatch.setenv("RECON_BACKEND", "auto")
    from app.main import create_app

    app = create_app()
    client = TestClient(app)

    # Create two sample facade PNG images
    files = []
    for idx in range(2):
        arr = np.full((240, 320, 3), fill_value=80 + idx * 40, dtype=np.uint8)
        cv2.rectangle(arr, (80, 60), (240, 200), (180, 90, 70), -1)
        buf = io.BytesIO()
        Image.fromarray(arr).save(buf, format="PNG")
        buf.seek(0)
        files.append(("files", (f"view_{idx}.png", buf.getvalue(), "image/png")))

    resp = client.post("/jobs/reconstruct", data={"mode": "auto"}, files=files)
    assert resp.status_code == 200
    job = _poll_until_done(client, resp.json()["jobId"], timeout_s=3.0)
    assert job["status"] == "completed"
    assert job["glbUrl"].endswith("scene.glb")


def test_video_keyframe_extractor_filters_blur_and_caps_count(tmp_path: Path):
    from app.video_keyframes import extract_sharp_keyframes

    video_path = tmp_path / "walkaround.mp4"
    fps = 10.0
    width, height = 320, 240
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(video_path), fourcc, fps, (width, height))
    assert writer.isOpened()

    rng = np.random.default_rng(42)
    # Write 30 frames (3 seconds at 10 fps -> ~6 candidate frames at 2 fps)
    # Alternate sharp checkerboard frames with heavily blurred frames
    for i in range(30):
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        for y in range(0, height, 20):
            for x in range(0, width, 20):
                if ((x // 20) + (y // 20) + i) % 2 == 0:
                    frame[y : y + 20, x : x + 20] = (230, 200, 160)
                else:
                    frame[y : y + 20, x : x + 20] = (30, 45, 70)
        # Make every odd half-second super blurry
        if (i // 5) % 2 == 1:
            frame = cv2.GaussianBlur(frame, (31, 31), 12.0)
        else:
            noise = rng.integers(0, 15, size=frame.shape, dtype=np.uint8)
            frame = cv2.add(frame, noise)
        writer.write(frame)
    writer.release()

    out_dir = tmp_path / "keyframes"
    extracted = extract_sharp_keyframes(
        video_path=video_path,
        output_dir=out_dir,
        target_fps=2.0,
        max_frames=20,
        blur_threshold=80.0,
    )
    assert len(extracted) >= 2
    assert len(extracted) <= 20
    for frame_path in extracted:
        assert frame_path.exists()
        gray = cv2.imread(str(frame_path), cv2.IMREAD_GRAYSCALE)
        lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        assert lap_var >= 80.0


def test_vggt_depth_sky_and_confidence_filter():
    from app.vggt_backend import filter_sky_and_low_confidence_depth

    depth = np.ones((100, 100), dtype=np.float32) * 8.0
    conf = np.ones((100, 100), dtype=np.float32) * 2.5
    # Low confidence region
    conf[60:80, 20:40] = 0.4
    # Far sky depth in upper image
    depth[0:20, :] = 65.0

    filtered = filter_sky_and_low_confidence_depth(
        depth=depth,
        confidence=conf,
        min_confidence=1.2,
        max_depth=40.0,
    )
    assert np.all(filtered[0:20, :] == 0.0)
    assert np.all(filtered[60:80, 20:40] == 0.0)
    assert np.all(filtered[30:50, 50:70] == 8.0)


def test_multipart_video_reconstruct_and_vggt_missing_dep_reporting(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("RECON_JOBS_DIR", str(tmp_path / "jobs"))
    from app.main import create_app

    app = create_app()
    client = TestClient(app)

    video_path = tmp_path / "clip.mp4"
    writer = cv2.VideoWriter(str(video_path), cv2.VideoWriter_fourcc(*"mp4v"), 10.0, (240, 180))
    for i in range(12):
        img = np.zeros((180, 240, 3), dtype=np.uint8)
        cv2.rectangle(img, (30 + i * 2, 30), (190, 150), (200, 140, 90), 2)
        cv2.line(img, (30, 30), (110, 10), (240, 240, 240), 2)
        writer.write(img)
    writer.release()

    resp = client.post(
        "/jobs/reconstruct",
        data={"mode": "auto"},
        files=[("files", ("clip.mp4", video_path.read_bytes(), "video/mp4"))],
    )
    assert resp.status_code == 200
    done = _poll_until_done(client, resp.json()["jobId"], timeout_s=3.0)
    assert done["status"] == "completed"
    assert done["meshStats"]["faceCount"] > 100


def test_vggt_sanitize_vertex_normals_replaces_zero_and_nan_vectors():
    from app.vggt_backend import sanitize_vertex_normals

    raw = np.array(
        [
            [0.0, 0.0, 2.0],
            [0.0, 0.0, 0.0],
            [np.nan, 1.0, 0.0],
        ],
        dtype=np.float64,
    )
    cleaned = sanitize_vertex_normals(raw)
    assert cleaned.shape == (3, 3)
    assert not np.isnan(cleaned).any()
    norms = np.linalg.norm(cleaned, axis=1)
    assert np.allclose(norms, 1.0, atol=1e-6)


