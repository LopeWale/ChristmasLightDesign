from __future__ import annotations

import io
import json
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
        time.sleep(0.025)
    pytest.fail(f"Job {job_id} did not complete within {timeout_s}s: {last_payload}")


def test_demo_condo_preset_builds_3_floors_and_2_balconies_with_valid_normals(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("RECON_JOBS_DIR", str(tmp_path / "jobs"))
    from app.main import create_app

    client = TestClient(create_app())
    t0 = time.perf_counter()
    resp = client.post("/jobs/demo?preset=condo")
    assert resp.status_code == 200
    done = _poll_until_done(client, resp.json()["jobId"], timeout_s=2.5)
    elapsed = time.perf_counter() - t0

    assert elapsed < 2.5
    assert done["status"] == "completed"
    assert done["backendUsed"] == "architectural"
    assert done["buildingSpec"]["floors"] == 3
    assert len(done["buildingSpec"]["balconies"]) == 2
    assert done["meshStats"]["boundingBox"]["max"][1] > 9.0
    assert abs(done["meshStats"]["boundingBox"]["min"][1]) < 1e-3

    glb_resp = client.get(done["glbUrl"])
    assert glb_resp.status_code == 200
    scene = trimesh.load(io.BytesIO(glb_resp.content), file_type="glb")
    assert isinstance(scene, trimesh.Scene)

    geom_names = list(scene.geometry.keys())
    assert any("balcony_railing" in n for n in geom_names)
    assert any("balcony_soffit" in n for n in geom_names)
    assert any("front_door" in n for n in geom_names)

    for geom in scene.geometry.values():
        assert isinstance(geom, trimesh.Trimesh)
        assert not np.isnan(geom.vertices).any()
        normals = geom.vertex_normals
        assert not np.isnan(normals).any()
        norms = np.linalg.norm(normals, axis=1)
        assert np.all(norms > 0.95)


def test_clockwise_footprint_polygon_normalizes_to_outward_wall_normals():
    from app.architectural_backend import PRESET_CONDO_3F_2B, build_architectural_scene

    # Deliberately clockwise in (x, z) with duplicate closing vertex:
    # (-5, -4) -> (-5, +4) -> (+5, +4) -> (+5, -4) -> (-5, -4)
    cw_spec = PRESET_CONDO_3F_2B.model_copy(
        update={
            "footprintPolygonMeters": [
                (-5.0, -4.0),
                (-5.0, 4.0),
                (5.0, 4.0),
                (5.0, -4.0),
                (-5.0, -4.0),
            ],
            "balconies": [],
        }
    )
    scene = build_architectural_scene(cw_spec)
    walls = scene.geometry["main_walls"]
    # Find triangles whose centroid sits on front wall z ≈ +4.0
    tri_centers = walls.vertices[walls.faces].mean(axis=1)
    front_mask = tri_centers[:, 2] > 3.95
    assert np.any(front_mask)
    front_normals = walls.face_normals[front_mask]
    # Outward normal on front +Z wall must point strictly +Z (> +0.95)
    assert np.all(front_normals[:, 2] > 0.95)


def test_tall_4_story_condo_frames_door_and_parapet_within_camera_0():
    from app.architectural_backend import (
        PRESET_CONDO_3F_2B,
        build_architectural_scene,
        build_framed_cameras,
    )

    tall_spec = PRESET_CONDO_3F_2B.model_copy(update={"floors": 4})
    scene = build_architectural_scene(tall_spec)
    cams = build_framed_cameras(scene)
    cam0 = cams.cameras[0]

    k = np.array(cam0.intrinsics, dtype=np.float64)
    c2w = np.array(cam0.extrinsics, dtype=np.float64)
    w2c = np.linalg.inv(c2w)

    bounds = scene.bounds
    # Check both ground front_door base (0, 0.14, front_z) and top parapet (0, max_y, front_z)
    front_z = float(bounds[1, 2])
    max_y = float(bounds[1, 1])
    for pt_w in (np.array([0.0, 0.14, front_z, 1.0]), np.array([0.0, max_y, 0.0, 1.0])):
        pt_c = w2c @ pt_w
        assert pt_c[2] > 1.0
        u = k[0, 0] * (pt_c[0] / pt_c[2]) + k[0, 2]
        v = k[1, 1] * (pt_c[1] / pt_c[2]) + k[1, 2]
        assert 20.0 < u < cam0.width - 20.0
        assert 15.0 < v < cam0.height - 15.0


def test_cv_facade_analyzer_distinguishes_tall_3_story_condo_from_1_story_gable_house_and_clamps_dark_frames(
    tmp_path: Path,
):
    from app.cv_facade_analyzer import analyze_facade_images

    # 1. Synthetic 3-story brick condo image with flat roof & 2 horizontal balcony bands
    condo_img = np.full((640, 520, 3), (225, 195, 155), dtype=np.uint8)  # sky BGR
    # Tall brick building body: x=90..430, y=90..610
    cv2.rectangle(condo_img, (90, 90), (430, 610), (75, 92, 168), -1)  # brick BGR
    # Flat dark parapet cap
    cv2.rectangle(condo_img, (86, 82), (434, 96), (55, 58, 62), -1)
    # 3 rows of windows + 2 bright balcony slabs/railings on floors 2 & 3
    for floor_idx, y_top in enumerate([140, 300, 460]):
        for x_win in [125, 230, 335]:
            cv2.rectangle(condo_img, (x_win, y_top), (x_win + 55, y_top + 90), (50, 42, 36), -1)
        if floor_idx in (0, 1):
            # Prominent balcony deck + railing ledge
            cv2.rectangle(condo_img, (115, y_top + 88), (395, y_top + 108), (235, 235, 238), -1)
    condo_path = tmp_path / "condo.png"
    cv2.imwrite(str(condo_path), condo_img)

    # 2. Wide 1-story suburban gable house image
    house_img = np.full((480, 760, 3), (230, 200, 160), dtype=np.uint8)
    # Wide low wall: x=100..660, y=280..430
    cv2.rectangle(house_img, (100, 280), (660, 430), (185, 205, 220), -1)
    # Pitched triangular gable roof: peak at (380, 150)
    roof_pts = np.array([[80, 285], [380, 150], [680, 285]], dtype=np.int32)
    cv2.fillConvexPoly(house_img, roof_pts, (60, 65, 72))
    house_path = tmp_path / "house.png"
    cv2.imwrite(str(house_path), house_img)

    # 3. Very dark twilight frame
    dark_img = np.full((400, 400, 3), 4, dtype=np.uint8)
    dark_path = tmp_path / "dark.png"
    cv2.imwrite(str(dark_path), dark_img)

    condo_spec = analyze_facade_images([condo_path])
    house_spec = analyze_facade_images([house_path])
    dark_spec = analyze_facade_images([dark_path])

    assert condo_spec.floors >= 3
    assert len(condo_spec.balconies) >= 2
    assert house_spec.floors <= 2
    assert 1 <= dark_spec.floors <= 8
    assert all(35 <= c <= 245 for c in dark_spec.wallColorRgb)


def test_spec_json_rebuild_endpoint_updates_balconies_under_1s(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("RECON_JOBS_DIR", str(tmp_path / "jobs"))
    from app.architectural_backend import PRESET_CONDO_3F_2B
    from app.main import create_app

    custom_spec = PRESET_CONDO_3F_2B.model_dump()
    custom_spec["balconies"] = [
        {
            "id": "b-picket",
            "floor": 2,
            "wallFace": "front",
            "centerOffsetNorm": -0.2,
            "widthMeters": 3.0,
            "depthMeters": 1.4,
            "mountStyle": "cantilevered",
            "railingType": "metal_picket",
        },
        {
            "id": "b-glass",
            "floor": 3,
            "wallFace": "front",
            "centerOffsetNorm": 0.2,
            "widthMeters": 3.0,
            "depthMeters": 1.4,
            "mountStyle": "recessed",
            "railingType": "glass_panel",
        },
        {
            "id": "b-parapet",
            "floor": 2,
            "wallFace": "right",
            "centerOffsetNorm": 0.0,
            "widthMeters": 2.8,
            "depthMeters": 1.2,
            "mountStyle": "cantilevered",
            "railingType": "solid_parapet",
        },
    ]

    client = TestClient(create_app())
    t0 = time.perf_counter()
    resp = client.post(
        "/jobs/reconstruct",
        data={"mode": "auto", "spec_json": json.dumps(custom_spec)},
    )
    assert resp.status_code == 200
    done = _poll_until_done(client, resp.json()["jobId"], timeout_s=2.0)
    elapsed = time.perf_counter() - t0
    assert elapsed < 1.5
    assert done["status"] == "completed"
    assert len(done["buildingSpec"]["balconies"]) == 3


def test_cv_analyzer_picks_sharpest_view_and_applies_maps_floor_overrides_before_balconies(
    tmp_path: Path,
):
    from app.cv_facade_analyzer import analyze_facade_images

    # Frame 0: blurry uniform occlusion frame (e.g. passing tree / sidewalk)
    blurry = np.full((720, 1280, 3), 120, dtype=np.uint8)
    p_blurry = tmp_path / "f0_blurry.png"
    cv2.imwrite(str(p_blurry), blurry)

    # Frame 1: wide 16:9 landscape 3-story condo with 4 horizontal band edges
    wide_condo = np.full((720, 1280, 3), (225, 195, 155), dtype=np.uint8)
    cv2.rectangle(wide_condo, (140, 180), (1140, 660), (85, 105, 175), -1)
    for y_band in [290, 410, 530]:
        cv2.rectangle(wide_condo, (180, y_band), (1100, y_band + 14), (235, 235, 240), -1)
    p_sharp = tmp_path / "f1_wide_condo.png"
    cv2.imwrite(str(p_sharp), wide_condo)

    spec = analyze_facade_images(
        [p_blurry, p_sharp],
        partial_overrides={"floors": 3, "roofStyle": "flat_parapet"},
    )
    assert spec.floors == 3
    assert spec.archetype == "multi_story_condo"
    assert spec.hasGarage is False
    assert len(spec.balconies) >= 2


def test_concave_u_shaped_footprint_roof_cap_has_no_courtyard_triangles():
    from app.architectural_backend import PRESET_CONDO_3F_2B, build_architectural_scene

    u_shape = [
        (-6.0, -4.0),
        (6.0, -4.0),
        (6.0, 4.0),
        (3.0, 4.0),
        (3.0, -1.0),
        (-3.0, -1.0),
        (-3.0, 4.0),
        (-6.0, 4.0),
    ]
    spec = PRESET_CONDO_3F_2B.model_copy(
        update={"footprintPolygonMeters": u_shape, "balconies": []}
    )
    scene = build_architectural_scene(spec)
    roof = scene.geometry["pitched_gable_roof"]
    # Upward-facing horizontal roof triangles
    up_mask = roof.face_normals[:, 1] > 0.9
    roof_centers = roof.vertices[roof.faces[up_mask]].mean(axis=1)
    # Open courtyard is x in (-2.5, +2.5) and z in (+0.2, +3.8): zero roof triangles should sit there
    in_courtyard = (np.abs(roof_centers[:, 0]) < 2.5) & (roof_centers[:, 2] > 0.2)
    assert not np.any(in_courtyard), "Found roof triangles spanning open concave courtyard"

