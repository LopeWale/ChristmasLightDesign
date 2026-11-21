from __future__ import annotations

import json
from pathlib import Path
from typing import Any
import numpy as np
import trimesh

from app.cv_facade_analyzer import analyze_facade_images
from app.reconstructor import ProgressCallback, ReconstructionArtifacts, Reconstructor
from app.schemas import (
    ArchitecturalBuildingSpecModel,
    BalconySpecModel,
    BoundingBox3D,
    CameraPose,
    CamerasPayload,
    SceneMetadata,
)
from app.synthetic_backend import (
    FRONT_DOOR_HEIGHT_UNITS,
    GARAGE_DOOR_HEIGHT_UNITS,
    _finalize_part_mesh,
    _look_at_opencv_c2w,
    _make_box,
    _make_gable_prism_along_x,
    _make_shrub,
    render_reference_elevation_png,
)

# Standard 42-inch IBC multi-family residential balcony guardrail height = 1.0668m
BALCONY_GUARDRAIL_HEIGHT_M = 1.07


PRESET_CONDO_3F_2B = ArchitecturalBuildingSpecModel(
    archetype="multi_story_condo",
    floors=3,
    metersPerFloor=3.10,
    footprintPolygonMeters=[
        (-6.2, -4.8),
        (6.2, -4.8),
        (6.2, 4.8),
        (-6.2, 4.8),
    ],
    roofStyle="flat_parapet",
    roofPitchDegrees=2.0,
    wallColorRgb=(172, 106, 86),
    trimColorRgb=(236, 239, 244),
    roofColorRgb=(54, 59, 68),
    windowBaysPerFloor=4,
    hasGarage=False,
    balconies=[
        BalconySpecModel(
            id="balcony-2f-left",
            floor=2,
            wallFace="front",
            centerOffsetNorm=-0.22,
            widthMeters=3.6,
            depthMeters=1.45,
            mountStyle="cantilevered",
            railingType="metal_picket",
        ),
        BalconySpecModel(
            id="balcony-3f-right",
            floor=3,
            wallFace="front",
            centerOffsetNorm=0.22,
            widthMeters=3.6,
            depthMeters=1.45,
            mountStyle="cantilevered",
            railingType="glass_panel",
        ),
    ],
    sourceSummary="3-Story Condo Preset (2 Balconies: 2F Picket & 3F Glass)",
)


def normalize_footprint_ccw(ring: list[tuple[float, float]]) -> np.ndarray:
    """
    Strip duplicate closing vertex, recenter at (0, 0), and orient vertex order so
    extruding edge p[i] -> p[i+1] upward (+Y) yields strictly OUTWARD wall normals
    `(-dz, 0, dx)` in Three.js right-handed coordinates (+X right, +Y up, +Z front).
    """
    pts = np.asarray(ring, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] != 2 or len(pts) < 3:
        pts = np.array([[-6.0, -4.8], [6.0, -4.8], [6.0, 4.8], [-6.0, 4.8]], dtype=np.float64)

    if len(pts) >= 4 and np.linalg.norm(pts[0] - pts[-1]) < 1e-3:
        pts = pts[:-1]

    # Remove near-duplicate consecutive vertices
    deduped = [pts[0]]
    for i in range(1, len(pts)):
        if np.linalg.norm(pts[i] - deduped[-1]) >= 0.05:
            deduped.append(pts[i])
    if len(deduped) < 3:
        pts = np.array([[-6.0, -4.8], [6.0, -4.8], [6.0, 4.8], [-6.0, 4.8]], dtype=np.float64)
    else:
        pts = np.asarray(deduped, dtype=np.float64)

    centroid = 0.5 * (pts.min(axis=0) + pts.max(axis=0))
    pts = pts - centroid

    # Signed shoelace sum S = sum(x_i * z_{i+1} - x_{i+1} * z_i).
    # For front edge (-w, +d) -> (+w, +d) to have outward normal (-dz, 0, dx) = (0, 0, +1), S must be < 0.
    x = pts[:, 0]
    z = pts[:, 1]
    shoelace = float(np.sum(x * np.roll(z, -1) - np.roll(x, -1) * z))
    if shoelace > 0.0:
        pts = pts[::-1].copy()

    return pts


# Precomputed unit box [0..1]^3 with 24 unmerged vertices and exact outward normals
_UNIT_BOX_CORNERS = np.array(
    [
        # +Z front
        [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
        # -Z back
        [1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0],
        # +X right
        [1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1],
        # -X left
        [0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0],
        # +Y top
        [0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0],
        # -Y bottom
        [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1],
    ],
    dtype=np.float64,
)

_UNIT_BOX_FACES = np.array(
    [
        [q * 4 + 0, q * 4 + 1, q * 4 + 2]
        if half == 0
        else [q * 4 + 0, q * 4 + 2, q * 4 + 3]
        for q in range(6)
        for half in range(2)
    ],
    dtype=np.int64,
)

_UNIT_BOX_LOCAL_NORMALS = np.repeat(
    np.array(
        [
            [0.0, 0.0, 1.0],
            [0.0, 0.0, -1.0],
            [1.0, 0.0, 0.0],
            [-1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, -1.0, 0.0],
        ],
        dtype=np.float64,
    ),
    4,
    axis=0,
)


def _make_oriented_prism(
    origin_xz: np.ndarray,
    t_vec: np.ndarray,
    n_vec: np.ndarray,
    u0: float,
    u1: float,
    y0: float,
    y1: float,
    w0: float,
    w1: float,
    rgba: tuple[int, int, int, int],
) -> trimesh.Trimesh:
    """
    Fast vectorized 3D box aligned to local wall frame (t_vec along wall, +Y up, n_vec outward)
    with guaranteed unit outward vertex normals on all 6 faces.
    """
    det = float(t_vec[0] * n_vec[1] - t_vec[1] * n_vec[0])
    t_oriented = t_vec if det >= 0 else -t_vec

    u = u0 + (u1 - u0) * _UNIT_BOX_CORNERS[:, 0]
    y = y0 + (y1 - y0) * _UNIT_BOX_CORNERS[:, 1]
    w = w0 + (w1 - w0) * _UNIT_BOX_CORNERS[:, 2]

    vx = origin_xz[0] + u * t_oriented[0] + w * n_vec[0]
    vz = origin_xz[1] + u * t_oriented[1] + w * n_vec[1]
    verts = np.column_stack([vx, y, vz])

    nu = _UNIT_BOX_LOCAL_NORMALS[:, 0]
    ny = _UNIT_BOX_LOCAL_NORMALS[:, 1]
    nw = _UNIT_BOX_LOCAL_NORMALS[:, 2]
    nx = nu * t_oriented[0] + nw * n_vec[0]
    nz = nu * t_oriented[1] + nw * n_vec[1]
    normals = np.column_stack([nx, ny, nz])

    colors = np.tile(np.array(rgba, dtype=np.uint8), (24, 1))
    return trimesh.Trimesh(
        vertices=verts,
        faces=_UNIT_BOX_FACES.copy(),
        vertex_normals=normals,
        vertex_colors=colors,
        process=False,
    )


def _extrude_polygon_walls_and_cap(
    poly_xz: np.ndarray,
    y0: float,
    y1: float,
    rgba: tuple[int, int, int, int],
) -> tuple[trimesh.Trimesh, trimesh.Trimesh]:
    """
    Extrude a 2D polygon into outward-facing vertical walls + top horizontal cap.
    """
    n = len(poly_xz)
    verts_list: list[list[float]] = []
    faces_list: list[list[int]] = []

    for i in range(n):
        p0 = poly_xz[i]
        p1 = poly_xz[(i + 1) % n]
        base_idx = len(verts_list)
        verts_list.extend(
            [
                [float(p0[0]), y0, float(p0[1])],
                [float(p1[0]), y0, float(p1[1])],
                [float(p1[0]), y1, float(p1[1])],
                [float(p0[0]), y1, float(p0[1])],
            ]
        )
        faces_list.append([base_idx + 0, base_idx + 1, base_idx + 2])
        faces_list.append([base_idx + 0, base_idx + 2, base_idx + 3])

    wall_verts = np.asarray(verts_list, dtype=np.float64)
    wall_faces = np.asarray(faces_list, dtype=np.int64)

    # Compute exact per-quad outward face normals without trimesh.fix_normals flipping open shells
    wall_normals = np.zeros_like(wall_verts)
    for q in range(n):
        idx0 = q * 4
        e1 = wall_verts[idx0 + 1] - wall_verts[idx0]
        e2 = wall_verts[idx0 + 3] - wall_verts[idx0]
        fn = np.cross(e1, e2)
        fn_len = float(np.linalg.norm(fn))
        fn = fn / fn_len if fn_len > 1e-8 else np.array([0.0, 0.0, 1.0])
        wall_normals[idx0 : idx0 + 4] = fn

    wall_colors = np.tile(np.array(rgba, dtype=np.uint8), (len(wall_verts), 1))
    walls_mesh = trimesh.Trimesh(
        vertices=wall_verts,
        faces=wall_faces,
        vertex_normals=wall_normals,
        vertex_colors=wall_colors,
        process=False,
    )

    # Top horizontal roof deck cap (fan from centroid for clean convex/star footprints)
    cx = float(poly_xz[:, 0].mean())
    cz = float(poly_xz[:, 1].mean())
    cap_verts = [[cx, y1, cz]] + [[float(p[0]), y1, float(p[1])] for p in poly_xz]
    cap_faces: list[list[int]] = []
    for i in range(n):
        # Cross((p[i]-c), (p[i+1]-c)) for shoelace < 0 has +Y normal when ordered [0, i+1, ((i+1)%n)+1]
        i0 = i + 1
        i1 = ((i + 1) % n) + 1
        v_a = np.array(cap_verts[i0]) - np.array(cap_verts[0])
        v_b = np.array(cap_verts[i1]) - np.array(cap_verts[0])
        if np.cross(v_a, v_b)[1] >= 0:
            cap_faces.append([0, i0, i1])
        else:
            cap_faces.append([0, i1, i0])

    cap_v_np = np.asarray(cap_verts, dtype=np.float64)
    cap_n_np = np.tile(np.array([[0.0, 1.0, 0.0]], dtype=np.float64), (len(cap_v_np), 1))
    cap_c_np = np.tile(np.array(rgba, dtype=np.uint8), (len(cap_v_np), 1))
    cap_mesh = trimesh.Trimesh(
        vertices=cap_v_np,
        faces=np.asarray(cap_faces, dtype=np.int64),
        vertex_normals=cap_n_np,
        vertex_colors=cap_c_np,
        process=False,
    )
    return walls_mesh, cap_mesh


def _select_wall_edge_for_face(
    poly_xz: np.ndarray,
    wall_face: str,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, float]:
    """
    Find the polygon wall edge best aligned with `wall_face` ('front'|'rear'|'left'|'right'),
    returning `(edge_midpoint_xz, unit_tangent_xz, unit_outward_normal_xz, edge_length)`.
    """
    target_dirs = {
        "front": np.array([0.0, 1.0]),
        "rear": np.array([0.0, -1.0]),
        "left": np.array([-1.0, 0.0]),
        "right": np.array([1.0, 0.0]),
    }
    target = target_dirs.get(wall_face, target_dirs["front"])

    best_score = -1e9
    best_mid = np.array([0.0, 4.8])
    best_t = np.array([1.0, 0.0])
    best_n = np.array([0.0, 1.0])
    best_len = 10.0

    n_pts = len(poly_xz)
    for i in range(n_pts):
        p0 = poly_xz[i]
        p1 = poly_xz[(i + 1) % n_pts]
        d = p1 - p0
        seg_len = float(np.linalg.norm(d))
        if seg_len < 0.5:
            continue
        t_unit = d / seg_len
        n_unit = np.array([-t_unit[1], t_unit[0]], dtype=np.float64)
        alignment = float(np.dot(n_unit, target))
        # Weight alignment strongly and prefer main wide facade segments
        score = alignment * 10.0 + min(seg_len, 20.0) * 0.08
        if score > best_score:
            best_score = score
            best_mid = 0.5 * (p0 + p1)
            best_t = t_unit
            best_n = n_unit
            best_len = seg_len

    # Keep t_oriented right-handed with n_unit (det = tx*nz - tz*nx > 0)
    if float(best_t[0] * best_n[1] - best_t[1] * best_n[0]) < 0:
        best_t = -best_t

    return best_mid, best_t, best_n, best_len


def build_architectural_scene(spec: ArchitecturalBuildingSpecModel) -> trimesh.Scene:
    """
    Build a watertight, normal-validated, 360-degree multi-story residential/condo `.glb` scene
    with balconies, 42-inch guardrails, soffits, multi-wall windows, and ground context.
    """
    scene = trimesh.Scene()
    poly = normalize_footprint_ccw(spec.footprintPolygonMeters)

    min_x, min_z = poly.min(axis=0)
    max_x, max_z = poly.max(axis=0)
    bldg_h = float(spec.floors) * float(spec.metersPerFloor)

    wall_rgba = (*spec.wallColorRgb, 255)
    trim_rgba = (*spec.trimColorRgb, 255)
    roof_rgba = (*spec.roofColorRgb, 255)

    # 1. Ground turf pad (minY = 0.0 exact)
    pad_x = max(9.5, float(max_x) + 4.2)
    pad_z_back = min(-7.5, float(min_z) - 3.5)
    pad_z_front = max(10.0, float(max_z) + 5.2)
    ground = _make_box((-pad_x, 0.0, pad_z_back), (pad_x, 0.02, pad_z_front), (44, 82, 48, 255))
    scene.add_geometry(ground, node_name="ground_turf", geom_name="ground_turf")

    # 2. Front walkway leading from street wall to sidewalk
    front_mid, front_t, front_n, front_len = _select_wall_edge_for_face(poly, "front")
    walkway = trimesh.util.concatenate(
        [
            _make_oriented_prism(
                front_mid, front_t, front_n, -1.1, 1.1, 0.02, 0.06, 0.0, 4.6, (152, 156, 164, 255)
            ),
            _make_oriented_prism(
                front_mid, front_t, front_n, -1.8, 1.8, 0.02, 0.14, -0.05, 0.95, (182, 178, 170, 255)
            ),
        ]
    )
    scene.add_geometry(walkway, node_name="front_walkway", geom_name="front_walkway")

    # 3. Extruded 360-degree main building walls
    walls_mesh, top_cap = _extrude_polygon_walls_and_cap(poly, 0.02, bldg_h, wall_rgba)
    belt_meshes = [walls_mesh]
    # Subtle architectural stone belt-courses between stories
    for fl in range(1, spec.floors):
        y_belt = fl * spec.metersPerFloor
        belt_poly = poly * 1.008
        belt_w, _ = _extrude_polygon_walls_and_cap(belt_poly, y_belt - 0.06, y_belt + 0.06, trim_rgba)
        belt_meshes.append(belt_w)

    scene.add_geometry(
        trimesh.util.concatenate(belt_meshes),
        node_name="main_walls",
        geom_name="main_walls",
    )

    # 4. Roof & Eaves/Parapet Coping
    if spec.roofStyle in ("pitched_gable", "hip"):
        span_z = max(2.0, float(max_z - min_z))
        rise = min(3.8, 0.5 * span_z * np.tan(np.deg2rad(max(12.0, spec.roofPitchDegrees))))
        roof_mesh = _make_gable_prism_along_x(
            float(min_x) - 0.30,
            float(max_x) + 0.30,
            float(max_z) + 0.32,
            0.5 * float(min_z + max_z),
            float(min_z) - 0.32,
            bldg_h - 0.04,
            bldg_h + float(rise),
            roof_rgba,
        )
        scene.add_geometry(roof_mesh, node_name="pitched_gable_roof", geom_name="pitched_gable_roof")

        eaves_mesh = trimesh.util.concatenate(
            [
                _make_box(
                    (float(min_x) - 0.32, bldg_h - 0.14, float(max_z) + 0.24),
                    (float(max_x) + 0.32, bldg_h - 0.02, float(max_z) + 0.36),
                    trim_rgba,
                ),
                _make_box(
                    (float(min_x) - 0.32, bldg_h - 0.14, float(min_z) - 0.36),
                    (float(max_x) + 0.32, bldg_h - 0.02, float(min_z) - 0.24),
                    trim_rgba,
                ),
            ]
        )
        scene.add_geometry(eaves_mesh, node_name="eaves_gutters", geom_name="eaves_gutters")
    else:
        # Flat condo roof membrane + 360-degree raised parapet wall & coping trim
        parapet_outer, parapet_top = _extrude_polygon_walls_and_cap(
            poly * 1.015, bldg_h, bldg_h + 0.42, roof_rgba
        )
        coping_walls, coping_cap = _extrude_polygon_walls_and_cap(
            poly * 1.028, bldg_h + 0.42, bldg_h + 0.52, trim_rgba
        )
        scene.add_geometry(
            trimesh.util.concatenate([top_cap, parapet_outer, parapet_top]),
            node_name="pitched_gable_roof",
            geom_name="pitched_gable_roof",
        )
        scene.add_geometry(
            trimesh.util.concatenate([coping_walls, coping_cap]),
            node_name="eaves_gutters",
            geom_name="eaves_gutters",
        )

    # 5. Primary ground-floor front entry door (exact 6.67 ft = 2.033016m height for metric calibration)
    door_y0 = 0.14
    door_y1 = door_y0 + FRONT_DOOR_HEIGHT_UNITS
    front_door = _make_oriented_prism(
        front_mid,
        front_t,
        front_n,
        -0.475,
        0.475,
        door_y0,
        door_y1,
        -0.02,
        0.07,
        (136, 36, 40, 255),
    )
    scene.add_geometry(front_door, node_name="front_door", geom_name="front_door")

    if spec.hasGarage and front_len >= 9.0:
        garage_u0 = 0.22 * front_len
        garage_door = _make_oriented_prism(
            front_mid,
            front_t,
            front_n,
            garage_u0,
            min(0.46 * front_len, garage_u0 + 2.6),
            0.02,
            0.02 + GARAGE_DOOR_HEIGHT_UNITS,
            -0.02,
            0.06,
            (226, 222, 212, 255),
        )
        scene.add_geometry(garage_door, node_name="garage_door", geom_name="garage_door")

    # 6. Multi-story windows across all 4 sides (360-degree visual completeness)
    window_parts: list[trimesh.Trimesh] = []
    glass_rgba = (52, 76, 106, 255)
    for face_name in ("front", "rear", "left", "right"):
        w_mid, w_t, w_n, w_len = _select_wall_edge_for_face(poly, face_name)
        bays = spec.windowBaysPerFloor if face_name in ("front", "rear") else max(2, spec.windowBaysPerFloor // 2)
        usable = max(2.0, w_len * 0.78)
        u_positions = np.linspace(-0.5 * usable, 0.5 * usable, bays) if bays > 1 else [0.0]

        for fl in range(1, spec.floors + 1):
            y_base = (fl - 1) * spec.metersPerFloor
            for u_c in u_positions:
                # Avoid overlapping ground-floor front entry door
                if face_name == "front" and fl == 1 and abs(float(u_c)) < 1.15:
                    continue
                # Avoid overlapping balconies on same floor/face/offset
                has_balcony_here = any(
                    b.wallFace == face_name
                    and b.floor == fl
                    and abs(b.centerOffsetNorm * w_len - float(u_c)) < (0.55 * b.widthMeters + 0.5)
                    for b in spec.balconies
                )
                if has_balcony_here:
                    continue
                window_parts.append(
                    _make_oriented_prism(
                        w_mid,
                        w_t,
                        w_n,
                        float(u_c) - 0.52,
                        float(u_c) + 0.52,
                        y_base + 0.95,
                        y_base + 2.25,
                        -0.01,
                        0.05,
                        glass_rgba,
                    )
                )

    # 7. Multi-floor Balconies (deck slab, ceiling/underside soffits, sliding glass door, 42" 3D railings)
    for idx, bal in enumerate(spec.balconies):
        if bal.floor > spec.floors:
            continue
        b_mid, b_t, b_n, b_len = _select_wall_edge_for_face(poly, bal.wallFace)
        u_center = float(np.clip(bal.centerOffsetNorm, -0.42, 0.42)) * b_len
        half_w = min(0.44 * b_len, 0.5 * bal.widthMeters)
        u0, u1 = u_center - half_w, u_center + half_w

        out_depth = bal.depthMeters if bal.mountStyle == "cantilevered" else max(0.65, bal.depthMeters * 0.6)
        y_deck = (bal.floor - 1) * spec.metersPerFloor
        y_ceil = bal.floor * spec.metersPerFloor

        # Structural deck slab
        slab = _make_oriented_prism(
            b_mid,
            b_t,
            b_n,
            u0,
            u1,
            y_deck - 0.08,
            y_deck + 0.10,
            -0.05,
            out_depth,
            trim_rgba,
        )
        scene.add_geometry(slab, node_name=f"balcony_slab_{idx}", geom_name=f"balcony_slab_{idx}")

        # Balcony soffits (both overhead ceiling canopy + underside of deck slab -> SurfaceMaterial 'balcony_soffit')
        soffits = trimesh.util.concatenate(
            [
                _make_oriented_prism(
                    b_mid,
                    b_t,
                    b_n,
                    u0,
                    u1,
                    y_ceil - 0.12,
                    y_ceil - 0.02,
                    -0.04,
                    out_depth,
                    (226, 230, 236, 255),
                ),
                _make_oriented_prism(
                    b_mid,
                    b_t,
                    b_n,
                    u0 + 0.04,
                    u1 - 0.04,
                    y_deck - 0.12,
                    y_deck - 0.08,
                    0.02,
                    out_depth - 0.04,
                    (218, 222, 228, 255),
                ),
            ]
        )
        scene.add_geometry(
            soffits,
            node_name=f"balcony_soffit_{idx}",
            geom_name=f"balcony_soffit_{idx}",
        )

        # Sliding glass balcony door on the facade wall
        door_half = min(half_w * 0.72, 1.05)
        window_parts.append(
            _make_oriented_prism(
                b_mid,
                b_t,
                b_n,
                u_center - door_half,
                u_center + door_half,
                y_deck + 0.10,
                y_deck + 2.18,
                -0.01,
                0.06,
                (44, 68, 96, 255),
            )
        )

        # 42-inch (1.07m) 3D Perimeter Balcony Railing ('balcony_railing')
        y_rail_bot = y_deck + 0.10
        y_rail_top = y_rail_bot + BALCONY_GUARDRAIL_HEIGHT_M
        rail_parts: list[trimesh.Trimesh] = []

        if bal.railingType == "solid_parapet":
            parapet_rgba = (*spec.wallColorRgb, 255)
            # Front & left/right solid half-walls + trim coping cap
            rail_parts.extend(
                [
                    _make_oriented_prism(b_mid, b_t, b_n, u0, u1, y_rail_bot, y_rail_top - 0.06, out_depth - 0.11, out_depth, parapet_rgba),
                    _make_oriented_prism(b_mid, b_t, b_n, u0, u0 + 0.11, y_rail_bot, y_rail_top - 0.06, 0.02, out_depth, parapet_rgba),
                    _make_oriented_prism(b_mid, b_t, b_n, u1 - 0.11, u1, y_rail_bot, y_rail_top - 0.06, 0.02, out_depth, parapet_rgba),
                    _make_oriented_prism(b_mid, b_t, b_n, u0 - 0.02, u1 + 0.02, y_rail_top - 0.06, y_rail_top, out_depth - 0.13, out_depth + 0.02, trim_rgba),
                ]
            )
        elif bal.railingType == "glass_panel":
            frame_rgba = (196, 204, 214, 255)
            panel_rgba = (118, 168, 202, 255)
            rail_parts.extend(
                [
                    # Top & bottom rails (front + sides)
                    _make_oriented_prism(b_mid, b_t, b_n, u0, u1, y_rail_top - 0.05, y_rail_top, out_depth - 0.06, out_depth, frame_rgba),
                    _make_oriented_prism(b_mid, b_t, b_n, u0, u0 + 0.06, y_rail_top - 0.05, y_rail_top, 0.02, out_depth, frame_rgba),
                    _make_oriented_prism(b_mid, b_t, b_n, u1 - 0.06, u1, y_rail_top - 0.05, y_rail_top, 0.02, out_depth, frame_rgba),
                    # Tempered glass panels
                    _make_oriented_prism(b_mid, b_t, b_n, u0 + 0.05, u1 - 0.05, y_rail_bot + 0.06, y_rail_top - 0.05, out_depth - 0.04, out_depth - 0.015, panel_rgba),
                    _make_oriented_prism(b_mid, b_t, b_n, u0 + 0.015, u0 + 0.04, y_rail_bot + 0.06, y_rail_top - 0.05, 0.06, out_depth - 0.05, panel_rgba),
                    _make_oriented_prism(b_mid, b_t, b_n, u1 - 0.04, u1 - 0.015, y_rail_bot + 0.06, y_rail_top - 0.05, 0.06, out_depth - 0.05, panel_rgba),
                ]
            )
        else:
            # Default 'metal_picket' architectural bronze/iron railing
            iron_rgba = (42, 46, 54, 255)
            rail_parts.extend(
                [
                    # Top rails
                    _make_oriented_prism(b_mid, b_t, b_n, u0, u1, y_rail_top - 0.05, y_rail_top, out_depth - 0.05, out_depth, iron_rgba),
                    _make_oriented_prism(b_mid, b_t, b_n, u0, u0 + 0.05, y_rail_top - 0.05, y_rail_top, 0.02, out_depth, iron_rgba),
                    _make_oriented_prism(b_mid, b_t, b_n, u1 - 0.05, u1, y_rail_top - 0.05, y_rail_top, 0.02, out_depth, iron_rgba),
                    # Bottom rails
                    _make_oriented_prism(b_mid, b_t, b_n, u0, u1, y_rail_bot + 0.05, y_rail_bot + 0.09, out_depth - 0.05, out_depth, iron_rgba),
                    _make_oriented_prism(b_mid, b_t, b_n, u0, u0 + 0.05, y_rail_bot + 0.05, y_rail_bot + 0.09, 0.02, out_depth, iron_rgba),
                    _make_oriented_prism(b_mid, b_t, b_n, u1 - 0.05, u1, y_rail_bot + 0.05, y_rail_bot + 0.09, 0.02, out_depth, iron_rgba),
                ]
            )
            # Vertical pickets along front span
            num_pickets = max(5, int((u1 - u0) / 0.18))
            for u_p in np.linspace(u0 + 0.04, u1 - 0.04, num_pickets):
                rail_parts.append(
                    _make_oriented_prism(
                        b_mid,
                        b_t,
                        b_n,
                        float(u_p) - 0.015,
                        float(u_p) + 0.015,
                        y_rail_bot + 0.06,
                        y_rail_top - 0.04,
                        out_depth - 0.04,
                        out_depth - 0.01,
                        iron_rgba,
                    )
                )
            # Side return pickets
            side_pickets = max(3, int(out_depth / 0.22))
            for w_p in np.linspace(0.08, out_depth - 0.06, side_pickets):
                rail_parts.append(
                    _make_oriented_prism(b_mid, b_t, b_n, u0 + 0.01, u0 + 0.04, y_rail_bot + 0.06, y_rail_top - 0.04, float(w_p) - 0.015, float(w_p) + 0.015, iron_rgba)
                )
                rail_parts.append(
                    _make_oriented_prism(b_mid, b_t, b_n, u1 - 0.04, u1 - 0.01, y_rail_bot + 0.06, y_rail_top - 0.04, float(w_p) - 0.015, float(w_p) + 0.015, iron_rgba)
                )

        scene.add_geometry(
            trimesh.util.concatenate(rail_parts),
            node_name=f"balcony_railing_{idx}",
            geom_name=f"balcony_railing_{idx}",
        )

    if window_parts:
        scene.add_geometry(
            trimesh.util.concatenate(window_parts),
            node_name="front_windows",
            geom_name="front_windows",
        )

    # 8. Ground-floor flanking ornamental boxwood shrubs
    shrub_offset = min(0.36 * front_len, 3.6)
    p_shrub_l = front_mid - shrub_offset * front_t + 0.85 * front_n
    p_shrub_r = front_mid + shrub_offset * front_t + 0.85 * front_n
    scene.add_geometry(
        _make_shrub((float(p_shrub_l[0]), 0.52, float(p_shrub_l[1])), (0.68, 0.50, 0.52), (38, 108, 52, 255)),
        node_name="boxwood_shrub_left",
        geom_name="boxwood_shrub_left",
    )
    scene.add_geometry(
        _make_shrub((float(p_shrub_r[0]), 0.52, float(p_shrub_r[1])), (0.68, 0.50, 0.52), (38, 108, 52, 255)),
        node_name="boxwood_shrub_right",
        geom_name="boxwood_shrub_right",
    )

    return scene


def build_framed_cameras(scene: trimesh.Scene) -> CamerasPayload:
    """
    Compute 4 pinhole cameras (`front`, `front_left`, `right_side`, `rear_oblique`)
    dynamically scaled to frame buildings of any height (1..8 floors) without clipping.
    """
    width, height = 1280, 720
    fx, fy, cx, cy = 960.0, 960.0, 640.0, 360.0
    k = [
        [fx, 0.0, cx],
        [0.0, fy, cy],
        [0.0, 0.0, 1.0],
    ]

    # Measure core building bounds (excluding wide turf pad)
    bldg_bounds_min = np.array([1e9, 0.0, 1e9], dtype=np.float64)
    bldg_bounds_max = np.array([-1e9, 4.0, -1e9], dtype=np.float64)
    for name, geom in scene.geometry.items():
        if "ground_turf" in name or "walkway" in name or not isinstance(geom, trimesh.Trimesh):
            continue
        gb = geom.bounds
        bldg_bounds_min = np.minimum(bldg_bounds_min, gb[0])
        bldg_bounds_max = np.maximum(bldg_bounds_max, gb[1])

    if not np.all(np.isfinite(bldg_bounds_min)):
        bldg_bounds_min = scene.bounds[0]
        bldg_bounds_max = scene.bounds[1]

    span_x = max(6.0, float(bldg_bounds_max[0] - bldg_bounds_min[0]))
    span_y = max(4.0, float(bldg_bounds_max[1] - 0.0))
    front_z = float(bldg_bounds_max[2])
    center_x = 0.5 * float(bldg_bounds_min[0] + bldg_bounds_max[0])
    center_z = 0.5 * float(bldg_bounds_min[2] + bldg_bounds_max[2])
    mid_y = 0.48 * span_y

    tan_half_v = (0.5 * height) / fy  # 360 / 960 = 0.375
    tan_half_h = (0.5 * width) / fx   # 640 / 960 = 0.667
    needed_dist_v = (0.5 * span_y * 1.38) / tan_half_v
    needed_dist_h = (0.5 * span_x * 1.32) / tan_half_h
    dist_from_front = max(11.5, needed_dist_v, needed_dist_h)

    cam_front_z = front_z + dist_from_front

    cameras = [
        CameraPose(
            id=0,
            name="front",
            width=width,
            height=height,
            intrinsics=k,
            extrinsics=_look_at_opencv_c2w([center_x, mid_y, cam_front_z], [center_x, mid_y, center_z]),
        ),
        CameraPose(
            id=1,
            name="front_left",
            width=width,
            height=height,
            intrinsics=k,
            extrinsics=_look_at_opencv_c2w(
                [center_x - 0.72 * dist_from_front, mid_y * 1.15, center_z + 0.85 * dist_from_front],
                [center_x, mid_y * 0.95, center_z],
            ),
        ),
        CameraPose(
            id=2,
            name="right_side",
            width=width,
            height=height,
            intrinsics=k,
            extrinsics=_look_at_opencv_c2w(
                [center_x + 0.95 * dist_from_front, mid_y * 1.1, center_z + 0.45 * dist_from_front],
                [center_x, mid_y * 0.95, center_z],
            ),
        ),
        CameraPose(
            id=3,
            name="rear_oblique",
            width=width,
            height=height,
            intrinsics=k,
            extrinsics=_look_at_opencv_c2w(
                [center_x - 0.65 * dist_from_front, mid_y * 1.2, center_z - 0.95 * dist_from_front],
                [center_x, mid_y * 0.95, center_z],
            ),
        ),
    ]
    return CamerasPayload(convention="opencv_camera_to_world", cameras=cameras)


class ArchitecturalReconstructor(Reconstructor):
    """
    Photo/CV + Maps-guided 360-degree multi-story & balcony architectural reconstructor.
    """

    backend_name = "architectural"

    def __init__(self, explicit_spec: dict[str, Any] | ArchitecturalBuildingSpecModel | None = None) -> None:
        self.explicit_spec = explicit_spec

    def reconstruct(
        self,
        image_paths: list[Path],
        output_dir: Path,
        progress_cb: ProgressCallback | None = None,
    ) -> ReconstructionArtifacts:
        output_dir.mkdir(parents=True, exist_ok=True)
        if progress_cb:
            progress_cb(20)

        if isinstance(self.explicit_spec, ArchitecturalBuildingSpecModel):
            spec = self.explicit_spec
        elif isinstance(self.explicit_spec, dict):
            # If full spec has floors + balconies + wallColorRgb and no images, validate directly;
            # if images were also uploaded, merge explicit overrides (e.g. Maps footprint) over CV!
            if image_paths and "archetype" not in self.explicit_spec:
                spec = analyze_facade_images(image_paths, partial_overrides=self.explicit_spec)
            else:
                spec = ArchitecturalBuildingSpecModel.model_validate(self.explicit_spec)
        else:
            spec = analyze_facade_images(image_paths)

        if progress_cb:
            progress_cb(50)

        scene = build_architectural_scene(spec)
        glb_path = output_dir / "scene.glb"
        glb_bytes = trimesh.exchange.gltf.export_glb(scene, include_normals=True)
        glb_path.write_bytes(glb_bytes)

        cameras_payload = build_framed_cameras(scene)
        cameras_path = output_dir / "cameras.json"
        cameras_path.write_text(cameras_payload.model_dump_json(indent=2), encoding="utf-8")

        spec_path = output_dir / "building_spec.json"
        spec_path.write_text(spec.model_dump_json(indent=2), encoding="utf-8")

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
            backend_used="architectural",
            glb_path=glb_path,
            cameras_path=cameras_path,
            reference_image_path=ref_path,
            mesh_stats=stats,
            cameras_payload=cameras_payload,
            building_spec=spec,
        )
