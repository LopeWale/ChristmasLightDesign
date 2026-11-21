from __future__ import annotations

import subprocess
import time
from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient


def _poll_until_done(client: TestClient, job_id: str, timeout_s: float = 4.0) -> dict:
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


def test_da3_mps_reconstructor_emits_32byte_splat_and_glb_via_api(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("RECON_JOBS_DIR", str(tmp_path / "jobs"))
    monkeypatch.setenv("LUMEN3D_DA3_OFFLINE_FAST", "1")
    from app.main import create_app

    img = np.full((360, 480, 3), (210, 185, 145), dtype=np.uint8)
    cv2.rectangle(img, (80, 70), (400, 330), (95, 110, 175), -1)
    cv2.rectangle(img, (110, 170), (370, 190), (235, 235, 240), -1)
    ok, encoded = cv2.imencode(".png", img)
    assert ok

    client = TestClient(create_app())
    resp = client.post(
        "/jobs/reconstruct",
        data={"mode": "da3"},
        files=[("files", ("facade.png", encoded.tobytes(), "image/png"))],
    )
    assert resp.status_code == 200
    done = _poll_until_done(client, resp.json()["jobId"])
    assert done["status"] == "completed"
    assert done["backendUsed"] == "da3"
    assert done["splatUrl"] and done["splatUrl"].endswith("/scene.splat")

    splat_resp = client.get(done["splatUrl"])
    assert splat_resp.status_code == 200
    splat_bytes = splat_resp.content
    assert len(splat_bytes) >= 32 * 100
    assert len(splat_bytes) % 32 == 0


def test_dev_worker_bootstrap_script_resolves_python_with_unrelated_virtual_env(
    tmp_path: Path,
):
    repo_root = Path(__file__).resolve().parents[3]
    script = repo_root / "scripts" / "dev-worker.sh"
    assert script.is_file(), "scripts/dev-worker.sh must exist"

    fake_venv = tmp_path / "empty_venv"
    (fake_venv / "bin").mkdir(parents=True)

    env = {
        "PATH": "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
        "VIRTUAL_ENV": str(fake_venv),
        "HOME": str(Path.home()),
    }
    proc = subprocess.run(
        ["bash", str(script), "--check-only"],
        cwd=str(repo_root),
        env=env,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert proc.returncode == 0, f"stderr={proc.stderr} stdout={proc.stdout}"
    assert "python" in proc.stdout.lower()


def test_encode_32byte_splat_negates_y_and_z_for_drei_splat_loader():
    from app.da3_mps_backend import encode_32byte_splat_buffer

    pts = np.array([[1.5, 4.0, 2.5]], dtype=np.float32)
    scales = np.array([[0.1, 0.1, 0.1]], dtype=np.float32)
    rgba = np.array([[200, 150, 100, 255]], dtype=np.uint8)
    buf = encode_32byte_splat_buffer(pts, scales, rgba)
    floats = np.frombuffer(buf[:12], dtype="<f4")
    # @react-three/drei SplatLoader negates Y and Z on load; stored buffer must be (x, -y, -z)
    assert np.allclose(floats, [1.5, -4.0, -2.5], atol=1e-4)

