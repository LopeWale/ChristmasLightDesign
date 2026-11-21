from __future__ import annotations

from pathlib import Path
import cv2
import numpy as np
import trimesh

from app.reconstructor import ProgressCallback, ReconstructionArtifacts, Reconstructor
from app.schemas import BoundingBox3D, CameraPose, CamerasPayload, SceneMetadata

# Metric scale convention: 1.0 scene unit = 1.0 meter (3.28084 feet).
# Standard 80-inch (6.67 ft) residential front door = 2.033016 meters.
# Standard 84-inch (7.00 ft) residential garage door = 2.133600 meters.
FRONT_DOOR_HEIGHT_UNITS = 6.67 / 3.28084  # 2.033016
GARAGE_DOOR_HEIGHT_UNITS = 7.00 / 3.28084  # 2.133600


def _finalize_part_mesh(
    mesh: trimesh.Trimesh,
    rgba: tuple[int, int, int, int],
    sharp_edges: bool = True,
) -> trimesh.Trimesh:
    """Ensure clean, finite, unit-length vertex normals and vertex colors."""
    cleaned = mesh.copy()
    cleaned.remove_unreferenced_vertices()
    nondeg = cleaned.nondegenerate_faces()
    if len(nondeg) > 0:
        cleaned.update_faces(nondeg)
    cleaned.fix_normals()
    if sharp_edges:
        cleaned.unmerge_vertices()
    normals = np.array(cleaned.vertex_normals, dtype=np.float64, copy=True)
    norms = np.linalg.norm(normals, axis=1, keepdims=True)
    bad = (norms.squeeze(-1) < 1e-6) | ~np.isfinite(norms.squeeze(-1))
    if np.any(bad):
        normals[bad] = np.array([0.0, 1.0, 0.0], dtype=np.float64)
        norms = np.linalg.norm(normals, axis=1, keepdims=True)
    normals = normals / norms

    colors = np.tile(np.array(rgba, dtype=np.uint8), (len(cleaned.vertices), 1))
    return trimesh.Trimesh(
        vertices=np.asarray(cleaned.vertices, dtype=np.float64),
        faces=np.asarray(cleaned.faces, dtype=np.int64),
        vertex_normals=normals,
        vertex_colors=colors,
        process=False,
    )


def _make_box(
    bounds_min: tuple[float, float, float],
    bounds_max: tuple[float, float, float],
    rgba: tuple[int, int, int, int],
) -> trimesh.Trimesh:
    bmin = np.array(bounds_min, dtype=np.float64)
    bmax = np.array(bounds_max, dtype=np.float64)
    extents = bmax - bmin
    center = 0.5 * (bmin + bmax)
    tf = np.eye(4, dtype=np.float64)
    tf[:3, 3] = center
    box = trimesh.creation.box(extents=extents, transform=tf)
    return _finalize_part_mesh(box, rgba, sharp_edges=True)


def _make_gable_prism_along_x(
    x_min: float,
    x_max: float,
    z_front: float,
    z_ridge: float,
    z_back: float,
    y_eave: float,
    y_ridge: float,
    rgba: tuple[int, int, int, int],
) -> trimesh.Trimesh:
    """Triangular gable prism whose ridge runs along the X axis."""
    verts = np.array(
        [
            [x_min, y_eave, z_front],   # 0: left-front
            [x_min, y_ridge, z_ridge],  # 1: left-ridge
            [x_min, y_eave, z_back],    # 2: left-back
            [x_max, y_eave, z_front],   # 3: right-front
            [x_max, y_ridge, z_ridge],  # 4: right-ridge
            [x_max, y_eave, z_back],    # 5: right-back
        ],
        dtype=np.float64,
    )
    faces = np.array(
        [
            # Front roof slope (+Z/+Y)
            [0, 3, 4],
            [0, 4, 1],
            # Back roof slope (-Z/+Y)
            [4, 5, 2],
            [4, 2, 1],
            # Bottom soffit (-Y)
            [2, 5, 3],
            [2, 3, 0],
            # Left gable end (-X)
            [2, 0, 1],
            # Right gable end (+X)
            [3, 5, 4],
        ],
        dtype=np.int64,
    )
    raw = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
    return _finalize_part_mesh(raw, rgba, sharp_edges=True)


def _make_gable_prism_along_z(
    x_left: float,
    x_ridge: float,
    x_right: float,
    z_back: float,
    z_front: float,
    y_eave: float,
    y_ridge: float,
    rgba: tuple[int, int, int, int],
) -> trimesh.Trimesh:
    """Front-facing cross-gable prism whose ridge runs along the Z axis."""
    verts = np.array(
        [
            [x_left, y_eave, z_front],   # 0: front-left
            [x_ridge, y_ridge, z_front], # 1: front-peak
            [x_right, y_eave, z_front],  # 2: front-right
            [x_left, y_eave, z_back],    # 3: back-left
            [x_ridge, y_ridge, z_back],  # 4: back-peak
            [x_right, y_eave, z_back],   # 5: back-right
        ],
        dtype=np.float64,
    )
    faces = np.array(
        [
            # Front gable triangle (+Z)
            [0, 2, 1],
            # Back gable triangle (-Z)
            [5, 3, 4],
            # Left roof slope (-X/+Y)
            [3, 0, 1],
            [3, 1, 4],
            # Right roof slope (+X/+Y)
            [2, 5, 4],
            [2, 4, 1],
            # Bottom soffit (-Y)
            [3, 5, 2],
            [3, 2, 0],
        ],
        dtype=np.int64,
    )
    raw = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
    return _finalize_part_mesh(raw, rgba, sharp_edges=True)


def _make_vertical_column(
    center_x: float,
    center_z: float,
    y_bottom: float,
    y_top: float,
    radius: float,
    rgba: tuple[int, int, int, int],
) -> trimesh.Trimesh:
    height = y_top - y_bottom
    cyl = trimesh.creation.cylinder(radius=radius, height=height, sections=24)
    # Rotate cylinder from Z-axis to Y-axis
    rot = trimesh.transformations.rotation_matrix(np.pi / 2.0, [1.0, 0.0, 0.0])
    cyl.apply_transform(rot)
    cyl.apply_translation([center_x, 0.5 * (y_bottom + y_top), center_z])
    return _finalize_part_mesh(cyl, rgba, sharp_edges=False)


def _make_shrub(
    center: tuple[float, float, float],
    radii: tuple[float, float, float],
    rgba: tuple[int, int, int, int],
) -> trimesh.Trimesh:
    sphere = trimesh.creation.icosphere(subdivisions=2, radius=1.0)
    verts = sphere.vertices.copy()
    verts[:, 0] *= radii[0]
    verts[:, 1] *= radii[1]
    verts[:, 2] *= radii[2]
    verts[:, 0] += center[0]
    verts[:, 1] = np.maximum(0.02, verts[:, 1] + center[1])
    verts[:, 2] += center[2]
    shrub = trimesh.Trimesh(vertices=verts, faces=sphere.faces, process=False)
    return _finalize_part_mesh(shrub, rgba, sharp_edges=False)


def build_synthetic_house_scene() -> trimesh.Scene:
    """
    Construct a multi-part metric-consistent residential facade scene:
    - Ground plane at y = 0.0 (1 unit = 1.0m = 3.28084ft)
    - Main brick walls + garage wing
    - Pitched gable roofs + front cross-gable pediment
    - Eaves / gutters / fascia trim + rake boards
    - Front door (exact 6.67 ft height) + garage door (exact 7.00 ft height)
    - 2 cylindrical front porch columns
    - 2 front boxwood shrubs + stone front walkway
    """
    scene = trimesh.Scene()

    # 1. Ground turf (minY = 0.0 exact)
    ground = _make_box((-9.0, 0.0, -5.5), (9.0, 0.02, 8.5), (44, 84, 48, 255))
    scene.add_geometry(ground, node_name="ground_turf", geom_name="ground_turf")

    # 2. Front walkway + driveway apron
    walkway = trimesh.util.concatenate(
        [
            _make_box((-0.85, 0.02, 3.85), (0.85, 0.05, 8.2), (154, 158, 165, 255)),
            _make_box((4.85, 0.02, 2.65), (7.85, 0.04, 8.2), (132, 136, 142, 255)),
            _make_box((-2.25, 0.02, 3.00), (2.25, 0.14, 3.85), (178, 172, 162, 255)),
        ]
    )
    scene.add_geometry(walkway, node_name="front_walkway", geom_name="front_walkway")

    # 3. Main house brick walls + garage stucco wing + front gable pediment wall
    walls = trimesh.util.concatenate(
        [
            _make_box((-4.5, 0.02, -3.4), (4.5, 3.60, 3.00), (168, 92, 74, 255)),
            _make_box((4.5, 0.02, -3.1), (8.2, 3.00, 2.60), (190, 178, 162, 255)),
            _make_gable_prism_along_z(-2.25, 0.0, 2.25, 2.85, 3.02, 3.20, 4.82, (214, 206, 194, 255)),
        ]
    )
    scene.add_geometry(walls, node_name="main_walls", geom_name="main_walls")

    # 4. Pitched gable roofs (main ridge, front porch cross-gable, garage roof)
    roofs = trimesh.util.concatenate(
        [
            _make_gable_prism_along_x(-4.80, 4.80, 3.35, -0.20, -3.75, 3.55, 5.75, (56, 62, 72, 255)),
            _make_gable_prism_along_z(-2.42, 0.0, 2.42, 0.60, 3.92, 3.22, 4.98, (64, 70, 82, 255)),
            _make_gable_prism_along_x(4.45, 8.45, 2.90, -0.25, -3.40, 2.95, 4.55, (58, 64, 74, 255)),
        ]
    )
    scene.add_geometry(roofs, node_name="pitched_gable_roof", geom_name="pitched_gable_roof")

    # 5. Eaves, gutters & porch header beam
    eaves = trimesh.util.concatenate(
        [
            _make_box((-4.82, 3.46, 3.28), (-2.35, 3.58, 3.42), (238, 240, 245, 255)),
            _make_box((2.35, 3.46, 3.28), (4.82, 3.58, 3.42), (238, 240, 245, 255)),
            _make_box((-2.28, 3.05, 3.66), (2.28, 3.22, 3.90), (240, 242, 246, 255)),
            _make_box((4.48, 2.86, 2.84), (8.46, 2.98, 2.96), (238, 240, 245, 255)),
        ]
    )
    scene.add_geometry(eaves, node_name="eaves_gutters", geom_name="eaves_gutters")

    # 6. Front door (exact 6.67 ft = 2.033016 m height, centered at x=0 on front facade)
    door_y0 = 0.14
    door_y1 = door_y0 + FRONT_DOOR_HEIGHT_UNITS
    front_door = _make_box((-0.475, door_y0, 3.00), (0.475, door_y1, 3.06), (142, 32, 38, 255))
    scene.add_geometry(front_door, node_name="front_door", geom_name="front_door")

    # 7. Garage door (exact 7.00 ft = 2.1336 m height)
    garage_y0 = 0.02
    garage_y1 = garage_y0 + GARAGE_DOOR_HEIGHT_UNITS
    garage_door = _make_box((5.00, garage_y0, 2.60), (7.70, garage_y1, 2.66), (228, 224, 214, 255))
    scene.add_geometry(garage_door, node_name="garage_door", geom_name="garage_door")

    # 8. Windows for realistic architectural elevation
    windows = trimesh.util.concatenate(
        [
            _make_box((-3.70, 1.10, 3.00), (-2.50, 2.35, 3.05), (54, 78, 108, 255)),
            _make_box((2.50, 1.10, 3.00), (3.70, 2.35, 3.05), (54, 78, 108, 255)),
        ]
    )
    scene.add_geometry(windows, node_name="front_windows", geom_name="front_windows")

    # 9. Two cylindrical front porch columns
    col_left = _make_vertical_column(-1.85, 3.68, 0.14, 3.05, 0.14, (244, 245, 248, 255))
    col_right = _make_vertical_column(1.85, 3.68, 0.14, 3.05, 0.14, (244, 245, 248, 255))
    scene.add_geometry(col_left, node_name="porch_column_left", geom_name="porch_column_left")
    scene.add_geometry(col_right, node_name="porch_column_right", geom_name="porch_column_right")

    # 10. Two front boxwood shrubs
    shrub_left = _make_shrub((-3.10, 0.54, 3.85), (0.72, 0.52, 0.55), (38, 110, 52, 255))
    shrub_right = _make_shrub((3.10, 0.54, 3.85), (0.72, 0.52, 0.55), (38, 110, 52, 255))
    scene.add_geometry(shrub_left, node_name="boxwood_shrub_left", geom_name="boxwood_shrub_left")
    scene.add_geometry(shrub_right, node_name="boxwood_shrub_right", geom_name="boxwood_shrub_right")

    return scene


def _look_at_opencv_c2w(eye: list[float], target: list[float], up: list[float] | None = None) -> list[list[float]]:
    """
    Build a 4x4 OpenCV camera-to-world matrix (+X right, +Y down, +Z forward along sightline).
    """
    eye_v = np.array(eye, dtype=np.float64)
    target_v = np.array(target, dtype=np.float64)
    up_v = np.array(up or [0.0, 1.0, 0.0], dtype=np.float64)

    z_forward = target_v - eye_v
    z_forward /= np.linalg.norm(z_forward)

    x_right = np.cross(z_forward, up_v)
    x_right /= np.linalg.norm(x_right)

    y_down = np.cross(z_forward, x_right)
    y_down /= np.linalg.norm(y_down)

    c2w = np.eye(4, dtype=np.float64)
    c2w[:3, 0] = x_right
    c2w[:3, 1] = y_down
    c2w[:3, 2] = z_forward
    c2w[:3, 3] = eye_v
    return c2w.tolist()


def build_synthetic_cameras() -> CamerasPayload:
    width, height = 1280, 720
    k = [
        [960.0, 0.0, 640.0],
        [0.0, 960.0, 360.0],
        [0.0, 0.0, 1.0],
    ]
    cameras = [
        CameraPose(
            id=0,
            name="front",
            width=width,
            height=height,
            intrinsics=k,
            extrinsics=_look_at_opencv_c2w([1.6, 2.1, 14.5], [1.6, 2.1, 0.0]),
        ),
        CameraPose(
            id=1,
            name="front_left",
            width=width,
            height=height,
            intrinsics=k,
            extrinsics=_look_at_opencv_c2w([-7.5, 2.8, 12.8], [1.2, 2.0, 1.0]),
        ),
        CameraPose(
            id=2,
            name="front_right",
            width=width,
            height=height,
            intrinsics=k,
            extrinsics=_look_at_opencv_c2w([10.5, 2.8, 12.8], [2.0, 2.0, 1.0]),
        ),
    ]
    return CamerasPayload(convention="opencv_camera_to_world", cameras=cameras)


def render_reference_elevation_png(
    scene: trimesh.Scene,
    camera: CameraPose,
    out_path: Path,
) -> None:
    """
    Fast 2x-supersampled pinhole rasterizer matching `camera` intrinsics & extrinsics
    to produce a crisp shaded `reference_front.png` aligned to `scene.glb`.
    """
    ss = 2
    w, h = camera.width * ss, camera.height * ss

    # Sky gradient background (BGR for OpenCV)
    y_grad = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None]
    sky_top = np.array([235, 185, 135], dtype=np.float32)     # crisp daytime blue
    sky_horizon = np.array([245, 228, 210], dtype=np.float32) # soft horizon haze
    canvas = (sky_top * (1.0 - y_grad) + sky_horizon * y_grad).astype(np.uint8)
    canvas = np.repeat(canvas[:, None, :], w, axis=1)

    k = np.array(camera.intrinsics, dtype=np.float64)
    fx, fy, cx, cy = k[0, 0] * ss, k[1, 1] * ss, k[0, 2] * ss, k[1, 2] * ss

    c2w = np.array(camera.extrinsics, dtype=np.float64)
    w2c = np.linalg.inv(c2w)
    r_wc = w2c[:3, :3]
    t_wc = w2c[:3, 3]

    sun_dir = np.array([0.42, 0.78, 0.46], dtype=np.float64)
    sun_dir /= np.linalg.norm(sun_dir)

    all_tris_px: list[np.ndarray] = []
    all_depths: list[float] = []
    all_bgr: list[tuple[int, int, int]] = []

    for geom in scene.geometry.values():
        if not isinstance(geom, trimesh.Trimesh):
            continue
        verts_w = np.asarray(geom.vertices, dtype=np.float64)
        faces = np.asarray(geom.faces, dtype=np.int64)
        face_normals = np.asarray(geom.face_normals, dtype=np.float64)
        color_vis = (
            geom.visual
            if hasattr(geom.visual, "vertex_colors")
            else geom.visual.to_color()
        )
        vcolors = np.asarray(color_vis.vertex_colors, dtype=np.float64)[:, :3]

        verts_c = (verts_w @ r_wc.T) + t_wc
        tri_c = verts_c[faces]  # (F, 3, 3)

        # Keep triangles strictly in front of camera near plane
        valid = np.all(tri_c[:, :, 2] > 0.25, axis=1)
        if not np.any(valid):
            continue

        tri_c = tri_c[valid]
        f_normals = face_normals[valid]
        f_rgb = vcolors[faces[valid]].mean(axis=1)

        # Backface culling relative to camera ray
        tri_centers_w = verts_w[faces[valid]].mean(axis=1)
        cam_pos_w = c2w[:3, 3]
        to_cam = cam_pos_w - tri_centers_w
        front_facing = np.einsum("ij,ij->i", f_normals, to_cam) > -0.05
        tri_c = tri_c[front_facing]
        f_normals = f_normals[front_facing]
        f_rgb = f_rgb[front_facing]

        if len(tri_c) == 0:
            continue

        u = (fx * (tri_c[:, :, 0] / tri_c[:, :, 2])) + cx
        v = (fy * (tri_c[:, :, 1] / tri_c[:, :, 2])) + cy
        pts_2d = np.stack([u, v], axis=-1).round().astype(np.int32)
        depths = tri_c[:, :, 2].mean(axis=1)

        ndotl = np.clip(f_normals @ sun_dir, 0.0, 1.0)
        hemi = 0.5 + 0.5 * np.clip(f_normals[:, 1], -1.0, 1.0)
        shade = 0.42 + 0.46 * ndotl + 0.14 * hemi
        shaded_rgb = np.clip(f_rgb * shade[:, None], 0, 255).astype(np.uint8)

        for idx in range(len(pts_2d)):
            all_tris_px.append(pts_2d[idx])
            all_depths.append(float(depths[idx]))
            r_c, g_c, b_c = int(shaded_rgb[idx, 0]), int(shaded_rgb[idx, 1]), int(shaded_rgb[idx, 2])
            all_bgr.append((b_c, g_c, r_c))

    # Painter's sort back-to-front (largest Z_cam first)
    order = np.argsort(all_depths)[::-1]
    for idx in order:
        cv2.fillConvexPoly(canvas, all_tris_px[int(idx)], all_bgr[int(idx)], lineType=cv2.LINE_AA)

    downsampled = cv2.resize(
        canvas,
        (camera.width, camera.height),
        interpolation=cv2.INTER_AREA,
    )
    cv2.imwrite(str(out_path), downsampled)


class SyntheticReconstructor(Reconstructor):
    """Deterministic multi-part house reconstructor for CPU/CI and instant Demo mode."""

    backend_name = "synthetic"

    def reconstruct(
        self,
        image_paths: list[Path],
        output_dir: Path,
        progress_cb: ProgressCallback | None = None,
    ) -> ReconstructionArtifacts:
        output_dir.mkdir(parents=True, exist_ok=True)
        if progress_cb:
            progress_cb(20)

        scene = build_synthetic_house_scene()
        if progress_cb:
            progress_cb(55)

        glb_path = output_dir / "scene.glb"
        glb_bytes = trimesh.exchange.gltf.export_glb(scene, include_normals=True)
        glb_path.write_bytes(glb_bytes)

        cameras_payload = build_synthetic_cameras()
        cameras_path = output_dir / "cameras.json"
        cameras_path.write_text(cameras_payload.model_dump_json(indent=2), encoding="utf-8")

        if progress_cb:
            progress_cb(80)

        ref_path = output_dir / "reference_front.png"
        render_reference_elevation_png(scene, cameras_payload.cameras[0], ref_path)

        total_vertices = sum(
            len(g.vertices) for g in scene.geometry.values() if isinstance(g, trimesh.Trimesh)
        )
        total_faces = sum(
            len(g.faces) for g in scene.geometry.values() if isinstance(g, trimesh.Trimesh)
        )
        bounds = scene.bounds
        stats = SceneMetadata(
            vertexCount=int(total_vertices),
            faceCount=int(total_faces),
            boundingBox=BoundingBox3D(
                min=(float(bounds[0, 0]), float(bounds[0, 1]), float(bounds[0, 2])),
                max=(float(bounds[1, 0]), float(bounds[1, 1]), float(bounds[1, 2])),
            ),
        )

        if progress_cb:
            progress_cb(100)

        return ReconstructionArtifacts(
            backend_used="synthetic",
            glb_path=glb_path,
            cameras_path=cameras_path,
            reference_image_path=ref_path,
            mesh_stats=stats,
            cameras_payload=cameras_payload,
        )
