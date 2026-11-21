from __future__ import annotations

import io
from pathlib import Path

import cv2
import numpy as np
import trimesh
from trimesh.visual import TextureVisuals


def _make_perspective_modern_townhome_photo(path: Path) -> Path:
    """
    Synthesize a realistic upward-looking driveway photograph of a modern 3-story townhome:
    - Overcast sky
    - Rooftop cedar setback
    - Converging perspective trapezoid for 3-story tower (upper charcoal panels, lower warm cedar)
    - Recessed dark left entry doorway alcove + asymmetric windows
    - Attached right-side 1-story charcoal garage wing
    - Foreground gray concrete driveway
    """
    h, w = 960, 600
    img = np.full((h, w, 3), (176, 168, 158), dtype=np.uint8)  # overcast sky BGR

    # Rooftop cedar setback above parapet
    cv2.rectangle(img, (150, 96), (440, 126), (48, 66, 102), -1)

    # Upper 2 stories (charcoal architectural metal panels, perspective trapezoid)
    upper_poly = np.array([[98, 124], [496, 132], [522, 455], [72, 450]], dtype=np.int32)
    cv2.fillConvexPoly(img, upper_poly, (102, 99, 97))

    # L-shaped upper-left window + center-right horizontal window
    cv2.rectangle(img, (122, 225), (208, 265), (124, 118, 106), -1)
    cv2.rectangle(img, (162, 225), (208, 342), (124, 118, 106), -1)
    cv2.rectangle(img, (295, 298), (382, 345), (128, 124, 114), -1)

    # Ground story (warm cedar horizontal siding, perspective trapezoid down to foundation y=690)
    lower_poly = np.array([[72, 450], [522, 455], [542, 690], [52, 690]], dtype=np.int32)
    cv2.fillConvexPoly(img, lower_poly, (46, 58, 84))
    for y_plank in range(462, 688, 14):
        cv2.line(img, (60, y_plank), (534, y_plank), (36, 46, 68), 1)

    # Recessed dark left entry alcove reaching foundation + ground clerestory & double windows
    alcove_poly = np.array([[76, 472], [122, 472], [112, 690], [62, 690]], dtype=np.int32)
    cv2.fillConvexPoly(img, alcove_poly, (16, 16, 20))
    cv2.rectangle(img, (145, 472), (302, 522), (114, 108, 98), -1)
    cv2.rectangle(img, (314, 475), (426, 592), (118, 116, 108), -1)

    # Attached right-side 1-story charcoal garage wing (x=526..599, y=412..655)
    cv2.rectangle(img, (524, 412), (599, 655), (96, 94, 92), -1)
    cv2.rectangle(img, (536, 515), (599, 648), (44, 46, 50), -1)

    # Foreground concrete driveway (y=690..960)
    cv2.rectangle(img, (0, 690), (w, h), (126, 132, 138), -1)

    cv2.imwrite(str(path), img)
    return path


def test_uploaded_facade_photo_emits_uv_textured_glb_with_3d_relief_and_exact_proportions(
    tmp_path: Path,
):
    from app.architectural_backend import ArchitecturalReconstructor

    photo_path = _make_perspective_modern_townhome_photo(tmp_path / "shartel_condo.jpg")

    # Simulate Gemini + connected-rowhouse Maps polygon (19m wide!) passed alongside the photo:
    # Reconstructor MUST still use the actual photo texture & constrain width to the single-unit photo!
    bloated_rowhouse_spec = {
        "archetype": "multi_story_condo",
        "floors": 3,
        "metersPerFloor": 3.05,
        "footprintPolygonMeters": [
            (-9.5, -4.5),
            (9.5, -4.5),
            (9.5, 4.5),
            (-9.5, 4.5),
        ],
        "roofStyle": "flat_parapet",
        "roofPitchDegrees": 2.0,
        "wallColorRgb": (130, 130, 130),
        "trimColorRgb": (220, 220, 220),
        "roofColorRgb": (60, 60, 65),
        "windowBaysPerFloor": 3,
        "hasGarage": False,
        "balconies": [],
        "sourceSummary": "Gemini + Maps rowhouse",
    }

    out_dir = tmp_path / "artifacts"
    artifacts = ArchitecturalReconstructor(
        explicit_spec=bloated_rowhouse_spec
    ).reconstruct([photo_path], out_dir)

    assert artifacts.glb_path.is_file()
    assert artifacts.reference_image_path.is_file()

    scene = trimesh.load(io.BytesIO(artifacts.glb_path.read_bytes()), file_type="glb")
    assert isinstance(scene, trimesh.Scene)

    # 1. Must contain UV-mapped PBR photo texture on front_facade_walls (NOT untextured gray box)
    assert "front_facade_walls" in scene.geometry
    front_mesh = scene.geometry["front_facade_walls"]
    assert isinstance(front_mesh.visual, TextureVisuals)
    assert front_mesh.visual.uv is not None and len(front_mesh.visual.uv) == len(
        front_mesh.vertices
    )
    tex_img = getattr(front_mesh.visual.material, "baseColorTexture", None)
    assert tex_img is not None
    assert tex_img.size[0] >= 256 and tex_img.size[1] >= 256

    # 2. Main tower width must match the tall narrow townhome photo (< 10.5m), NOT the 19m rowhouse block
    front_span_x = float(front_mesh.bounds[1, 0] - front_mesh.bounds[0, 0])
    assert 5.0 <= front_span_x <= 10.5, f"Expected townhome width 5..10.5m, got {front_span_x:.2f}m"

    # 3. Front facade must have real 3D Z-depth relief (recessed left entry alcove + windows > 0.20m)
    front_span_z = float(front_mesh.bounds[1, 2] - front_mesh.bounds[0, 2])
    assert front_span_z >= 0.20, f"Expected >=0.20m 3D facade relief, got {front_span_z:.3f}m"

    # 4. No fake cartoon lollipop shrubs when reconstructing from a real photo
    assert "boxwood_shrub_left" not in scene.geometry
    assert "boxwood_shrub_right" not in scene.geometry

    # 5. Attached right-side garage wing + calibration front_door + valid unit normals + minY=0
    assert "garage_wing" in scene.geometry
    assert "front_door" in scene.geometry
    assert abs(float(scene.bounds[0, 1])) < 1e-3

    for geom in scene.geometry.values():
        assert isinstance(geom, trimesh.Trimesh)
        assert not np.isnan(geom.vertices).any()
        norms = np.linalg.norm(geom.vertex_normals, axis=1)
        assert np.all(norms > 0.95)
