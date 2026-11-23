from __future__ import annotations

import io
import subprocess
from pathlib import Path

import cv2
import numpy as np
import pytest
import trimesh
from fastapi.testclient import TestClient
from trimesh.visual import TextureVisuals


def _encode_textured_view(bg_bgr: tuple[int, int, int], accent_bgr: tuple[int, int, int]) -> bytes:
    img = np.full((540, 720, 3), (185, 175, 162), dtype=np.uint8)  # sky
    cv2.rectangle(img, (90, 95), (630, 440), bg_bgr, -1)
    for y in range(130, 420, 48):
        cv2.line(img, (95, y), (625, y), accent_bgr, 2)
    for x in (160, 340, 490):
        cv2.rectangle(img, (x, 165), (x + 70, 265), (42, 48, 56), -1)
    cv2.rectangle(img, (0, 440), (720, 540), (128, 132, 138), -1)  # driveway
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 94])
    assert ok
    return buf.tobytes()


def test_live_scan_session_lifecycle_blur_rejection_yaw_sectors_and_multiwall_fusion(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("RECON_JOBS_DIR", str(tmp_path / "jobs"))
    from app.main import create_app

    app = create_app()
    client = TestClient(app)

    # 1. Start live scan session with Google Solar targetHeightMeters = 9.6m
    r_create = client.post(
        "/scan/sessions",
        json={
            "address": "1007 N Shartel Ave, Oklahoma City, OK",
            "targetHeightMeters": 9.6,
        },
    )
    assert r_create.status_code == 200
    session = r_create.json()
    sid = session["sessionId"]
    assert sid.startswith("scan-")
    assert session["status"] == "waiting_for_frames"

    # 2. Submit motion-blurred uniform frame -> rejected without polluting coveredSectors
    blurry = np.full((360, 480, 3), 125, dtype=np.uint8)
    ok, blur_jpg = cv2.imencode(".jpg", blurry)
    assert ok
    r_blur = client.post(
        f"/scan/sessions/{sid}/frames",
        data={"sector": "auto", "yaw_deg": "180.0"},
        files=[("file", ("blur.jpg", blur_jpg.tobytes(), "image/jpeg"))],
    )
    assert r_blur.status_code == 200
    s_blur = r_blur.json()
    assert s_blur["coveredSectors"] == []
    assert "steady" in s_blur["guidanceMessage"].lower() or "blur" in s_blur["guidanceMessage"].lower()

    # 3. Submit crisp Anchor Front frame (yaw=180.0)
    front_bytes = _encode_textured_view((96, 94, 92), (46, 58, 84))
    r_front = client.post(
        f"/scan/sessions/{sid}/frames",
        data={"sector": "auto", "yaw_deg": "180.0"},
        files=[("file", ("front.jpg", front_bytes, "image/jpeg"))],
    )
    assert r_front.status_code == 200
    s_front = r_front.json()
    assert s_front["status"] == "ready"
    assert s_front["coveredSectors"] == ["front"]
    job1 = s_front["latestJob"]
    assert job1 is not None
    assert job1["glbUrl"].endswith("scene_r001.glb")
    assert job1["splatUrl"].endswith("scene_r001.splat")

    splat1 = client.get(job1["splatUrl"]).content
    assert len(splat1) >= 32 * 500
    assert len(splat1) % 32 == 0

    # 4. Walk +82 deg around to the right side (yaw=262.0 -> auto-detected as "right_side")
    right_bytes = _encode_textured_view((52, 68, 108), (210, 212, 216))
    r_right = client.post(
        f"/scan/sessions/{sid}/frames",
        data={"sector": "auto", "yaw_deg": "262.0"},
        files=[("file", ("right.jpg", right_bytes, "image/jpeg"))],
    )
    assert r_right.status_code == 200
    s_right = r_right.json()
    assert "front" in s_right["coveredSectors"]
    assert "right_side" in s_right["coveredSectors"]
    job2 = s_right["latestJob"]
    assert job2["glbUrl"].endswith("scene_r002.glb")
    assert job2["splatUrl"].endswith("scene_r002.splat")

    # Verify multi-angle splat cloud grew and right_facade_wall is UV-textured in scene_r002.glb
    splat2 = client.get(job2["splatUrl"]).content
    assert len(splat2) > len(splat1)

    glb2_bytes = client.get(job2["glbUrl"]).content
    scene2 = trimesh.load(io.BytesIO(glb2_bytes), file_type="glb")
    assert isinstance(scene2, trimesh.Scene)
    assert "front_facade_walls" in scene2.geometry
    assert "right_facade_wall" in scene2.geometry
    assert isinstance(scene2.geometry["right_facade_wall"].visual, TextureVisuals)
    # Metric height locked to Google Solar targetHeightMeters (~9.6m + coping)
    max_y = float(scene2.bounds[1, 1])
    assert 9.4 <= max_y <= 10.6

    # 5. Survives app reload from persisted session.json
    reloaded_client = TestClient(create_app())
    r_reload = reloaded_client.get(f"/scan/sessions/{sid}")
    assert r_reload.status_code == 200
    assert "right_side" in r_reload.json()["coveredSectors"]


def test_neural_metric_engine_fuses_moge2_pointmap_and_da3_multiview_extrinsics():
    from app.neural_metric_engine import fuse_multiview_pointmaps_to_splat_arrays

    h, w = 24, 32
    us, vs = np.meshgrid(np.linspace(-3.5, 3.5, w), np.linspace(4.5, -4.5, h))
    # View 0 (front): OpenCV camera coords (+X right, +Y down, +Z forward at z=12m)
    pts_cam0 = np.stack([us, -vs, np.full_like(us, 12.0)], axis=-1).astype(np.float32)
    mask0 = np.ones((h, w), dtype=bool)
    mask0[:3, :] = False  # top 3 rows = sky (must be masked out!)
    rgb0 = np.full((h, w, 3), (120, 95, 75), dtype=np.uint8)
    w2c_0 = np.eye(4, dtype=np.float32)[:3, :4]  # camera at (0, 0, 0) looking +Z

    # View 1 (right oblique): camera translated +4m right
    w2c_1 = np.eye(4, dtype=np.float32)[:3, :4]
    w2c_1[0, 3] = -4.0

    positions, scales, rgba = fuse_multiview_pointmaps_to_splat_arrays(
        pointmaps_cam=[pts_cam0, pts_cam0],
        valid_masks=[mask0, mask0],
        rgb_images=[rgb0, rgb0],
        extrinsics_w2c=[w2c_0, w2c_1],
        target_height_m=9.2,
    )

    assert len(positions) > 400
    assert positions.shape == scales.shape
    assert rgba.shape == (len(positions), 4)
    # Ground-aligned minY == 0.0 and top scaled to target_height_m (9.2m)
    assert abs(float(positions[:, 1].min())) < 1e-2
    assert abs(float(positions[:, 1].max()) - 9.2) < 0.25


def test_health_reports_neural_readiness_and_install_script_syntax():
    from app.main import create_app

    client = TestClient(create_app())
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["computeDevice"] in ("mps", "cuda", "cpu")
    assert "da3Available" in body
    assert "moge2Available" in body
    assert "weightsWarmState" in body

    repo_root = Path(__file__).resolve().parents[3]
    install_script = repo_root / "scripts" / "install-neural-models.sh"
    assert install_script.is_file()
    chk = subprocess.run(["bash", "-n", str(install_script)], capture_output=True, text=True)
    assert chk.returncode == 0, chk.stderr
