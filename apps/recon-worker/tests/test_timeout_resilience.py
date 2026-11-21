from __future__ import annotations

import sys
import time
import types
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient


def _poll_until_done(client: TestClient, job_id: str, timeout_s: float = 3.0) -> dict:
    deadline = time.perf_counter() + timeout_s
    last_payload = {}
    while time.perf_counter() < deadline:
        resp = client.get(f"/jobs/{job_id}")
        assert resp.status_code == 200
        last_payload = resp.json()
        if last_payload["status"] in ("completed", "failed"):
            return last_payload
        time.sleep(0.025)
    pytest.fail(f"Job {job_id} did not complete within {timeout_s}s: {last_payload}")


def test_high_res_video_keyframe_extraction_downscales_and_completes_under_2s(
    tmp_path: Path,
):
    from app.video_keyframes import extract_sharp_keyframes

    video_path = tmp_path / "walkaround_1080p60.mp4"
    width, height = 1920, 1080
    writer = cv2.VideoWriter(
        str(video_path), cv2.VideoWriter_fourcc(*"mp4v"), 60.0, (width, height)
    )
    assert writer.isOpened()

    base = np.full((height, width, 3), (210, 185, 155), dtype=np.uint8)
    cv2.rectangle(base, (320, 140), (1600, 960), (92, 95, 102), -1)
    cv2.rectangle(base, (320, 580), (1600, 960), (62, 88, 132), -1)
    for x in (480, 920, 1320):
        cv2.rectangle(base, (x, 240), (x + 140, 440), (45, 55, 68), -1)

    for i in range(180):  # 3 seconds @ 60fps = 180 full-HD frames
        shifted = np.roll(base, shift=(i % 9) * 2, axis=1)
        writer.write(shifted)
    writer.release()

    t0 = time.perf_counter()
    extracted = extract_sharp_keyframes(
        video_path=video_path,
        output_dir=tmp_path / "kf",
        target_fps=2.0,
        max_frames=12,
    )
    elapsed = time.perf_counter() - t0

    assert elapsed < 2.0, f"1080p60 keyframe extraction took {elapsed:.2f}s"
    assert 1 <= len(extracted) <= 12
    sample = cv2.imread(str(extracted[0]))
    assert sample is not None
    # Keyframes must be bounded to <= 960px max dimension and JPEG-encoded to avoid multi-GB 4K PNG stalls
    assert max(sample.shape[:2]) <= 960
    assert extracted[0].suffix.lower() in (".jpg", ".jpeg")


def test_da3_never_attempts_unbounded_hf_download_by_default_when_transformers_present(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    from app.da3_mps_backend import _estimate_relative_depth_map

    monkeypatch.delenv("LUMEN3D_DA3_OFFLINE_FAST", raising=False)
    monkeypatch.delenv("LUMEN3D_ENABLE_HF_DEPTH", raising=False)

    pipeline_calls: list[tuple] = []
    fake_transformers = types.ModuleType("transformers")

    def _forbidden_pipeline(*args, **kwargs):
        pipeline_calls.append((args, kwargs))
        raise RuntimeError("Should not invoke uncached HF pipeline by default")

    fake_transformers.pipeline = _forbidden_pipeline  # type: ignore[attr-defined]
    fake_torch = types.ModuleType("torch")
    fake_torch.Tensor = type("Tensor", (), {})  # type: ignore[attr-defined]
    fake_torch.cuda = types.SimpleNamespace(is_available=lambda: False)  # type: ignore[attr-defined]
    fake_torch.backends = types.SimpleNamespace(  # type: ignore[attr-defined]
        mps=types.SimpleNamespace(is_available=lambda: True)
    )

    with patch.dict(
        sys.modules, {"transformers": fake_transformers, "torch": fake_torch}
    ):
        bgr = np.full((64, 96, 3), 140, dtype=np.uint8)
        cv2.rectangle(bgr, (16, 12), (80, 56), (70, 90, 130), -1)
        depth = _estimate_relative_depth_map(bgr)
        assert depth.shape == (64, 96)
        assert float(depth.min()) >= 0.0
        assert float(depth.max()) <= 1.0
        assert (
            len(pipeline_calls) == 0
        ), "DA3 must not invoke HuggingFace pipeline unless LUMEN3D_ENABLE_HF_DEPTH=1"


def test_job_marks_failed_on_base_exception_and_persists_across_worker_reload(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    jobs_dir = tmp_path / "jobs"
    monkeypatch.setenv("RECON_JOBS_DIR", str(jobs_dir))
    from app.main import create_app

    # 1. Verify completed job persists to disk and survives a fresh app instance (e.g. uvicorn --reload)
    app1 = create_app()
    client1 = TestClient(app1)
    r_demo = client1.post("/jobs/demo?preset=condo")
    assert r_demo.status_code == 200
    demo_id = r_demo.json()["jobId"]
    done = _poll_until_done(client1, demo_id, timeout_s=2.5)
    assert done["status"] == "completed"

    app2 = create_app()
    client2 = TestClient(app2)
    reloaded_resp = client2.get(f"/jobs/{demo_id}")
    assert reloaded_resp.status_code == 200
    assert reloaded_resp.json()["status"] == "completed"

    # 2. Verify BaseException inside worker thread marks job "failed" instead of hanging in "processing" forever
    class SyntheticWorkerCrash(BaseException):
        pass

    with patch(
        "app.main.select_reconstructor",
        side_effect=SyntheticWorkerCrash("simulated native worker abort"),
    ):
        r_crash = client2.post("/jobs/demo?preset=house")
        assert r_crash.status_code == 200
        crashed_done = _poll_until_done(client2, r_crash.json()["jobId"], timeout_s=2.0)
        assert crashed_done["status"] == "failed"
        assert "simulated native worker abort" in (crashed_done["error"] or "")


def test_flush_modern_two_tone_townhouse_does_not_hallucinate_4_floors_or_balconies(
    tmp_path: Path,
):
    from app.cv_facade_analyzer import analyze_facade_images

    # Portrait photo of a sleek 3-story modern townhome (charcoal upper metal panels with thin seams,
    # ground-floor warm cedar horizontal siding, recessed left entry, zero cantilevered balcony slabs)
    img = np.full((960, 580, 3), (178, 174, 170), dtype=np.uint8)  # overcast sky BGR
    # Upper charcoal metal facade (floors 2 & 3): x=70..500, y=110..560
    cv2.rectangle(img, (70, 110), (500, 560), (96, 94, 92), -1)
    # Thin 1px architectural panel seams (NOT protruding balconies!)
    for y_seam in (210, 320, 430):
        cv2.line(img, (70, y_seam), (500, y_seam), (68, 66, 65), 1)
    # Upper asymmetric windows
    cv2.rectangle(img, (125, 235), (215, 365), (128, 124, 112), -1)
    cv2.rectangle(img, (285, 310), (375, 365), (128, 124, 112), -1)
    # Ground floor warm cedar wood cladding: x=70..500, y=560..860 (BGR warm brown)
    cv2.rectangle(img, (70, 560), (500, 860), (42, 68, 112), -1)
    # Ground windows + dark recessed left doorway
    cv2.rectangle(img, (82, 585), (128, 858), (18, 18, 22), -1)
    cv2.rectangle(img, (145, 585), (415, 725), (118, 122, 116), -1)
    # Concrete driveway at bottom
    cv2.rectangle(img, (0, 860), (580, 960), (162, 166, 168), -1)

    photo_path = tmp_path / "modern_townhouse.jpg"
    cv2.imwrite(str(photo_path), img)

    spec = analyze_facade_images([photo_path])
    assert spec.floors == 3
    assert spec.roofStyle == "flat_parapet"
    assert len(spec.balconies) == 0
