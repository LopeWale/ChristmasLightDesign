#!/usr/bin/env python3
"""
Parametric CAD & Bambu Lab P1S 3D Print Generator
for Ceiling Light & Ornament Zig-Zag Wall Brackets (Start, Middle, End).

Coordinate System (Print-on-Side Orientation for Maximum Strength & Zero Supports):
- X axis (0 to 31.4 mm): Wall-to-Pole direction
    * X = 0.0 mm: Flat back of wall plate (rests against wall)
    * X = 0.0 to 6.0 mm: Vertical wall plate thickness (6.0 mm)
    * X = 6.0 to 31.4 mm: 1.00-inch (25.4 mm) horizontal standoff pole
- Y axis (0 to 38.0 mm): Vertical wall height direction
    * Y = 0.0 mm: Bottom tip of lower gusset on wall plate
    * Y = 10.0 to 20.0 mm: 1-inch standoff pole vertical shaft (10.0 mm tall)
    * Y = 23.0 mm: Optional 2.2 mm anti-rotation brad/pinhole center
    * Y = 30.5 mm: Main 3.5 mm nail/screw hole center with 7.0 mm countersink
    * Y = 38.0 mm: Top edge of wall plate
- Z axis (0 to 12.0 mm): Bracket width & Print Bed vertical Z height
    * Z = 0.0 mm: Flat side resting directly on the Bambu Lab P1S build plate
    * Z = 12.0 mm: Top side during printing
    * Thread through-hole runs vertically along Z (at X = 26.0 mm, Y = 15.0 mm)
      with 4.0 mm inner diameter and flared 5.6 mm entry mouths at Z = 0 and Z = 12.

Why print on the side (Z = width)?
1. Continuous filament perimeter loops run unbroken around the L-shape from the
   nail hole down into the 1-inch pole tip, giving >30 lb tensile pull strength.
2. All 3 holes (thread hole along Z, nail holes along X) and the top cradle hook
   or horn cleat print cleanly with 0 supports required.
"""

from __future__ import annotations

import json
import math
import os
import struct
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Tuple
import numpy as np


@dataclass
class BracketParams:
    # Core dimensions (mm)
    plate_thickness: float = 6.0          # X: 0 to 6 mm
    pole_length: float = 25.4             # X: 6 to 31.4 mm (exactly 1.00 inch)
    plate_height: float = 38.0            # Y: 0 to 38 mm (1.50 inches)
    bracket_width: float = 12.0           # Z: 0 to 12 mm (0.47 inches, print height)

    # Pole vertical bounds (Y)
    pole_y_min: float = 10.0
    pole_y_max: float = 20.0              # 10 mm tall pole shaft
    gusset_y_min: float = 1.5             # Smooth support gusset down to Y=1.5 mm
    gusset_x_end: float = 18.0            # Gusset reaches out to X=18 mm under pole

    # Thread eyelet on 1-inch pole (runs along Z axis)
    eyelet_x: float = 26.0                # 20 mm out from wall plate face, 5.4 mm from tip
    eyelet_y: float = 15.0                # Centered vertically on pole
    eyelet_diameter: float = 4.0          # 4.0 mm through-hole
    eyelet_flare_diameter: float = 6.0    # Flared chamfer mouth diameter at Z=0 & Z=12
    eyelet_flare_depth: float = 1.6       # Depth of smooth entry flare on each side

    # Nail holes on wall plate (run along X axis from X=0 to X=6)
    main_nail_y: float = 30.5             # Above the pole on Y-axis
    main_nail_diameter: float = 3.5       # Fits standard finish nails & #6 screws
    countersink_diameter: float = 7.0     # Flat/conical head recess on X=6 front face
    countersink_depth: float = 1.8

    pin_nail_y: float = 23.2              # Secondary anti-rotation pinhole
    pin_nail_diameter: float = 2.2        # Small brad / picture nail

    # Middle bracket top quick-drop hook/cradle groove (behind eyelet on top of pole)
    cradle_x_center: float = 17.5
    cradle_y_floor: float = 16.5          # Drops 3.5 mm down from Y=20 top of pole
    cradle_radius: float = 2.1            # 4.2 mm wide cradle with retaining lip

    # Start / End bracket integrated Figure-8 Horn Cleat & V-cinch slot (on top of pole)
    cleat_center_x: float = 16.8
    cleat_neck_half_x: float = 2.4        # 4.8 mm sturdy neck
    cleat_horn_tip_half_x: float = 6.8    # 13.6 mm total horn span (X=10.0 to 23.6)
    cleat_y_top: float = 25.0             # Rises 5 mm above Y=20 pole top
    cleat_neck_y_top: float = 22.6        # 2.6 mm high waist under horns


def _dist_to_segment_2d(px: np.ndarray, py: np.ndarray, x1: float, y1: float, x2: float, y2: float) -> np.ndarray:
    dx = x2 - x1
    dy = y2 - y1
    l2 = dx * dx + dy * dy
    if l2 == 0:
        return np.hypot(px - x1, py - y1)
    t = np.clip(((px - x1) * dx + (py - y1) * dy) / l2, 0.0, 1.0)
    proj_x = x1 + t * dx
    proj_y = y1 + t * dy
    return np.hypot(px - proj_x, py - proj_y)


def evaluate_bracket_sdf(
    X: np.ndarray,
    Y: np.ndarray,
    Z: np.ndarray,
    kind: str,
    p: BracketParams,
) -> np.ndarray:
    """
    Vectorized Signed Distance Field (SDF) for Start, Middle, and End brackets.
    Negative values = inside solid plastic; Positive values = outside air.
    """
    total_x = p.plate_thickness + p.pole_length  # 31.4 mm
    tip_r = 0.5 * (p.pole_y_max - p.pole_y_min)  # 5.0 mm rounded pole tip
    tip_cx = total_x - tip_r                     # 26.4 mm
    tip_cy = 0.5 * (p.pole_y_min + p.pole_y_max) # 15.0 mm

    # 1. Wall plate 2D SDF in XY (X in [0, 6], Y in [0, 38], rounded top/bottom front corners)
    plate_r = 2.0
    dx_plate = np.maximum(np.maximum(0.0 - X, X - p.plate_thickness), 0.0)
    dy_plate = np.maximum(np.maximum(0.0 + plate_r - Y, Y - (p.plate_height - plate_r)), 0.0)
    # Keep back wall corner X=0 crisp, round slightly at Y extremes
    sdf_plate_2d = np.hypot(dx_plate, np.maximum(0.0 - Y, Y - p.plate_height))
    # Top-front fillet at (X=6, Y=38) and bottom-front fillet at (X=6, Y=0)
    in_plate_x = (X >= 0.0) & (X <= p.plate_thickness)
    in_plate_y = (Y >= 0.0) & (Y <= p.plate_height)
    inside_plate_dist = np.maximum(
        np.maximum(-X, X - p.plate_thickness),
        np.maximum(-Y, Y - p.plate_height),
    )
    sdf_plate_2d = np.where(in_plate_x & in_plate_y, inside_plate_dist, sdf_plate_2d)

    # Round front-top (X=6, Y=38) and front-bottom (X=6, Y=0) corners with radius 2.2mm
    r_corner = 2.2
    mask_ft = (X > p.plate_thickness - r_corner) & (Y > p.plate_height - r_corner)
    dist_ft = np.hypot(X - (p.plate_thickness - r_corner), Y - (p.plate_height - r_corner)) - r_corner
    sdf_plate_2d = np.where(mask_ft, np.maximum(sdf_plate_2d, dist_ft), sdf_plate_2d)

    mask_fb = (X > p.plate_thickness - r_corner) & (Y < r_corner)
    dist_fb = np.hypot(X - (p.plate_thickness - r_corner), Y - r_corner) - r_corner
    sdf_plate_2d = np.where(mask_fb, np.maximum(sdf_plate_2d, dist_fb), sdf_plate_2d)

    # 2. 1-inch Horizontal Pole in XY (X from 4 to 26.4 + semi-circle tip radius 5.0 at (26.4, 15.0))
    dx_shaft = np.maximum(np.maximum(3.0 - X, X - tip_cx), 0.0)
    dy_shaft = np.maximum(np.maximum(p.pole_y_min - Y, Y - p.pole_y_max), 0.0)
    inside_shaft = np.maximum(np.maximum(3.0 - X, X - tip_cx), np.maximum(p.pole_y_min - Y, Y - p.pole_y_max))
    sdf_shaft = np.where((X >= 3.0) & (X <= tip_cx) & (Y >= p.pole_y_min) & (Y <= p.pole_y_max), inside_shaft, np.hypot(dx_shaft, dy_shaft))
    sdf_tip = np.hypot(X - tip_cx, Y - tip_cy) - tip_r
    sdf_pole_2d = np.minimum(sdf_shaft, sdf_tip)

    # 3. Structural Lower Gusset under pole: triangle from (X=6, Y=2.0) to (X=17.5, Y=10.0)
    # Using smooth concave fillet / angled web
    gusset_top = p.pole_y_min + 1.0
    gusset_line_y = p.gusset_y_min + (p.pole_y_min - p.gusset_y_min) * ((X - p.plate_thickness) / (p.gusset_x_end - p.plate_thickness))
    # Inside gusset when X in [4, 17.5], Y <= gusset_top, Y >= gusset_line_y
    d_x_gusset = np.maximum(4.0 - X, X - p.gusset_x_end)
    d_y_top_gusset = Y - gusset_top
    # Normal to line from (6, 1.5) to (18, 10): vector (12, 8.5), outward normal (8.5, -12) / hypot
    nx = (p.pole_y_min - p.gusset_y_min)
    ny = -(p.gusset_x_end - p.plate_thickness)
    n_len = math.hypot(nx, ny)
    d_hyp = ((X - p.plate_thickness) * nx + (Y - p.gusset_y_min) * ny) / n_len
    sdf_gusset_2d = np.maximum(np.maximum(d_x_gusset, d_y_top_gusset), d_hyp)

    # Upper corner root fillet at (X=6, Y=20)
    r_upper_fillet = 2.0
    fc_x = p.plate_thickness + r_upper_fillet
    fc_y = p.pole_y_max + r_upper_fillet
    in_uf_box = (X >= p.plate_thickness - 0.5) & (X <= fc_x) & (Y >= p.pole_y_max - 0.5) & (Y <= fc_y)
    d_uf = r_upper_fillet - np.hypot(X - fc_x, Y - fc_y)
    sdf_uf_2d = np.where(in_uf_box, d_uf, 10.0)

    # Combine base L-bracket 2D profile
    sdf_2d = np.minimum(np.minimum(sdf_plate_2d, sdf_pole_2d), np.minimum(sdf_gusset_2d, sdf_uf_2d))

    # 4. If Start or End bracket, add the integrated Horn Cleat on top of the pole (Y from 19.5 to 25.0)
    if kind in ("start", "end"):
        # Trapezoidal horn cleat in XY:
        # Neck: Y from 19.0 to 22.6, X half-width = 2.4 mm around cleat_center_x (16.8)
        # Horns: Y from 22.2 to 25.0, X half-width flares from 2.4 mm at Y=22.0 to 6.8 mm at Y=24.0, with rounded tips
        cx = p.cleat_center_x
        ax = np.abs(X - cx)

        # Neck box
        d_neck = np.maximum(ax - p.cleat_neck_half_x, np.maximum(19.0 - Y, Y - 23.2))

        # Flared horn bar: lower surface rises gently from (ax=2.0, Y=22.0) to (ax=6.5, Y=23.3)
        horn_bottom_y = 22.0 + 1.2 * np.clip((ax - 2.0) / 4.8, 0.0, 1.0)
        d_horn = np.maximum(
            ax - p.cleat_horn_tip_half_x,
            np.maximum(horn_bottom_y - Y, Y - p.cleat_y_top),
        )
        # Round the top-outer horn corners slightly
        sdf_cleat_2d = np.minimum(d_neck, d_horn)
        sdf_2d = np.minimum(sdf_2d, sdf_cleat_2d)

    # 5. Extrude 2D profile along Z in [0, 12.0] with subtle 0.45 mm top-only edge chamfer
    # Keep bottom Z=0 completely flat (no bottom bevel) for 100% first-layer bed adhesion!
    d_z = np.maximum(0.0 - Z, Z - p.bracket_width)
    sdf_3d = np.maximum(sdf_2d, d_z)
    top_edge_bevel = (sdf_2d + (Z - p.bracket_width) + 0.45) * 0.7071
    sdf_3d = np.maximum(sdf_3d, top_edge_bevel)

    # 6. If Start or End bracket, carve a V-Pinch Cinch Slot on the cleat neck
    # Notice: the horn cleat now runs the full Z=[0, 12.0] width of the pole so it rests
    # directly on the Z=0 build plate with ZERO mid-air overhangs!
    # We also add smooth 45-degree side V-grooves on the cleat waist (Y in [20.0, 22.8])
    # so the figure-8 wrapped thread stays centered and cannot slip off the sides.
    if kind in ("start", "end"):
        # Side V-notches on cleat neck (self-supporting 45-degree chamfered waist at Z=0 and Z=12)
        in_waist_y = (Y >= 20.0) & (Y <= 22.8) & (X >= 13.5) & (X <= 20.0)
        waist_depth = 1.4 * (1.0 - np.abs(Y - 21.4) / 1.4)  # 0 at Y=20.0 and Y=22.8, 1.4mm deep at Y=21.4
        d_waist_z = np.maximum(waist_depth - Z, Z - (p.bracket_width - waist_depth))
        sdf_3d = np.where(in_waist_y, np.maximum(sdf_3d, d_waist_z), sdf_3d)

        # V-pinch cinch slot at the base of the front horn (X from 18.6 to 23.0, Y = 21.1)
        slot_y_center = 21.1
        t_slot = np.clip((X - 18.6) / 3.8, 0.0, 1.0)
        slot_half_h = 0.12 + 0.55 * t_slot
        in_slot_x = (X >= 18.6) & (X <= 23.0)
        d_cinch_slot = np.maximum(np.abs(Y - slot_y_center) - slot_half_h, 18.6 - X)
        sdf_3d = np.where(in_slot_x, np.maximum(sdf_3d, -d_cinch_slot), sdf_3d)

    # 7. If Middle bracket, carve the optional Top Hook / Cradle Groove behind the eyelet
    if kind == "middle":
        d_seg = _dist_to_segment_2d(X, Y, 19.2, 20.6, 16.5, 16.5) - 1.85
        sdf_3d = np.maximum(sdf_3d, -d_seg)

    # 8. Thread Through-Hole along Z-axis on the 1-inch pole (at X = 26.0, Y = 15.0)
    # With 45-degree flared entry chamfers at Z=0 and Z=12 so zig-zag thread never chafes!
    r_eye_Point = np.hypot(X - p.eyelet_x, Y - p.eyelet_y)
    r_base = 0.5 * p.eyelet_diameter  # 2.0 mm radius (4.0 mm diameter)
    r_flare_extra = 0.5 * (p.eyelet_flare_diameter - p.eyelet_diameter)  # +1.0 mm radius at faces
    flare_bottom = np.clip((p.eyelet_flare_depth - Z) / p.eyelet_flare_depth, 0.0, 1.0) * r_flare_extra
    flare_top = np.clip((Z - (p.bracket_width - p.eyelet_flare_depth)) / p.eyelet_flare_depth, 0.0, 1.0) * r_flare_extra
    r_effective = r_base + np.maximum(flare_bottom, flare_top)
    sdf_eyelet = r_eye_Point - r_effective
    sdf_3d = np.maximum(sdf_3d, -sdf_eyelet)

    # 9. Wall Plate Nail Holes along X-axis (centered at Z = 6.0 mm)
    # Using a 3D-printing Teardrop profile (45-degree roof in +Z) so the top of the horizontal
    # hole & countersink is 100% self-supporting with zero floating overhang warnings!
    z_mid = 0.5 * p.bracket_width

    def _teardrop_dist(dy: np.ndarray, dz: np.ndarray, radius: np.ndarray) -> np.ndarray:
        r_circ = np.hypot(dy, dz) - radius
        # Upper 45-degree teardrop roof: when dz > 0, extend roof up to dz = sqrt(2)*radius - |dy|
        r_roof = np.maximum((np.abs(dy) + dz) * 0.70710678 - radius, -dz)
        return np.minimum(r_circ, r_roof)

    # Main nail/screw hole at Y = 30.5 mm (3.5 mm through-hole + 7.0 mm countersink on X=6 face)
    cs_t = np.clip((X - (p.plate_thickness - p.countersink_depth)) / p.countersink_depth, 0.0, 1.0)
    r_main_eff = 0.5 * p.main_nail_diameter + cs_t * 0.5 * (p.countersink_diameter - p.main_nail_diameter)
    d_main_td = _teardrop_dist(Y - p.main_nail_y, Z - z_mid, r_main_eff)
    sdf_main_nail = np.maximum(d_main_td, np.maximum(-1.0 - X, X - (p.plate_thickness + 1.0)))
    sdf_3d = np.maximum(sdf_3d, -sdf_main_nail)

    # Secondary anti-rotation pinhole at Y = 23.2 mm (2.2 mm diameter with tiny entry chamfer)
    pin_cs_t = np.clip((X - (p.plate_thickness - 0.8)) / 0.8, 0.0, 1.0)
    r_pin_eff = 0.5 * p.pin_nail_diameter + pin_cs_t * 0.65
    d_pin_td = _teardrop_dist(Y - p.pin_nail_y, Z - z_mid, r_pin_eff)
    sdf_pin_nail = np.maximum(d_pin_td, np.maximum(-1.0 - X, X - (p.plate_thickness + 1.0)))
    sdf_3d = np.maximum(sdf_3d, -sdf_pin_nail)

    return sdf_3d


# Standard Marching Tetrahedra Lookup Table (6 tetrahedra per voxel cube)
_TETRA_CORNERS = [
    (0, 5, 1, 6),
    (0, 1, 2, 6),
    (0, 2, 3, 6),
    (0, 3, 7, 6),
    (0, 7, 4, 6),
    (0, 4, 5, 6),
]

# Corner offsets (dx, dy, dz) for vertices 0..7 of a unit cube
_CUBE_OFFSETS = np.array([
    [0, 0, 0], # 0
    [1, 0, 0], # 1
    [1, 1, 0], # 2
    [0, 1, 0], # 3
    [0, 0, 1], # 4
    [1, 0, 1], # 5
    [1, 1, 1], # 6
    [0, 1, 1], # 7
], dtype=np.int32)

# Consistent Marching Tetrahedra triangle table for all 14 inside/outside bitmasks
_TETRA_TRIANGLES: Dict[int, List[Tuple[Tuple[int, int], Tuple[int, int], Tuple[int, int]]]] = {
    0b0001: [((0, 1), (0, 3), (0, 2))],
    0b0010: [((1, 0), (1, 2), (1, 3))],
    0b0011: [((0, 3), (0, 2), (1, 3)), ((1, 3), (0, 2), (1, 2))],
    0b0100: [((2, 0), (2, 3), (2, 1))],
    0b0101: [((0, 1), (2, 3), (2, 1)), ((0, 1), (0, 3), (2, 3))],
    0b0110: [((1, 0), (2, 0), (2, 3)), ((1, 0), (2, 3), (1, 3))],
    0b0111: [((3, 0), (3, 2), (3, 1))],
    0b1000: [((3, 0), (3, 1), (3, 2))],
    0b1001: [((0, 1), (3, 1), (3, 2)), ((0, 1), (3, 2), (0, 2))],
    0b1010: [((1, 0), (1, 2), (3, 2)), ((1, 0), (3, 2), (3, 0))],
    0b1011: [((2, 0), (2, 1), (2, 3))],
    0b1100: [((2, 0), (3, 0), (3, 1)), ((2, 0), (3, 1), (2, 1))],
    0b1101: [((1, 0), (1, 3), (1, 2))],
    0b1110: [((0, 1), (0, 2), (0, 3))],
}


def extract_isosurface_mesh(
    kind: str,
    p: BracketParams,
    step: float = 0.50,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Vectorized Marching Tetrahedra isosurface extractor.
    Produces a guaranteed 100% 2-manifold watertight triangle mesh (0 non-manifold edges)
    with Z=0 lying strictly flat on the Bambu Lab P1S build plate.
    """
    # Offset grid coordinates by an irrational fraction of `step` so no grid vertex ever
    # lands directly on integer/half-integer CAD boundary planes (Z=0, Z=12, X=0, X=6, Y=10, Y=20)
    off_x = 0.137 * step
    off_y = 0.173 * step
    off_z = 0.157 * step
    xs = np.arange(-1.0 + off_x, p.plate_thickness + p.pole_length + 1.2, step, dtype=np.float32)
    ys = np.arange(-1.0 + off_y, p.plate_height + 1.2, step, dtype=np.float32)
    zs = np.arange(-1.0 + off_z, p.bracket_width + 1.2, step, dtype=np.float32)

    X, Y, Z = np.meshgrid(xs, ys, zs, indexing="ij")
    sdf = evaluate_bracket_sdf(X, Y, Z, kind, p).astype(np.float32)
    sdf = np.where(np.abs(sdf) < 1e-5, -1e-5, sdf)

    c_vals = [
        sdf[
            _CUBE_OFFSETS[i, 0] : sdf.shape[0] - 1 + _CUBE_OFFSETS[i, 0],
            _CUBE_OFFSETS[i, 1] : sdf.shape[1] - 1 + _CUBE_OFFSETS[i, 1],
            _CUBE_OFFSETS[i, 2] : sdf.shape[2] - 1 + _CUBE_OFFSETS[i, 2],
        ]
        for i in range(8)
    ]

    min_v = np.minimum.reduce(c_vals)
    max_v = np.maximum.reduce(c_vals)
    active_ix, active_iy, active_iz = np.where((min_v < 0.0) & (max_v > 0.0))

    N = len(active_ix)
    c_sdf = np.stack([c_vals[i][active_ix, active_iy, active_iz] for i in range(8)], axis=1)

    c_pos = np.zeros((N, 8, 3), dtype=np.float32)
    for i in range(8):
        c_pos[:, i, 0] = xs[active_ix + _CUBE_OFFSETS[i, 0]]
        c_pos[:, i, 1] = ys[active_iy + _CUBE_OFFSETS[i, 1]]
        c_pos[:, i, 2] = zs[active_iz + _CUBE_OFFSETS[i, 2]]

    all_tris: List[np.ndarray] = []

    for tet in _TETRA_CORNERS:
        t_sdf = c_sdf[:, tet]        # (N, 4)
        t_pos = c_pos[:, tet, :]     # (N, 4, 3)

        mask = (
            ((t_sdf[:, 0] < 0).astype(np.int32) << 0)
            | ((t_sdf[:, 1] < 0).astype(np.int32) << 1)
            | ((t_sdf[:, 2] < 0).astype(np.int32) << 2)
            | ((t_sdf[:, 3] < 0).astype(np.int32) << 3)
        )

        for code, tri_list in _TETRA_TRIANGLES.items():
            sel = np.where(mask == code)[0]
            if len(sel) == 0:
                continue
            s_sdf = t_sdf[sel]
            s_pos = t_pos[sel]

            for e1, e2, e3 in tri_list:
                pts = []
                for u, v in (e1, e2, e3):
                    if tet[u] < tet[v]:
                        u_c, v_c = u, v
                    else:
                        u_c, v_c = v, u
                    du = s_sdf[:, u_c]
                    dv = s_sdf[:, v_c]
                    denom = du - dv
                    t = (du / denom)[:, None]
                    p_uv = s_pos[:, u_c, :] + t * (s_pos[:, v_c, :] - s_pos[:, u_c, :])
                    pts.append(p_uv)
                tri_batch = np.stack(pts, axis=1)
                all_tris.append(tri_batch)

    raw_tris = np.concatenate(all_tris, axis=0)  # (T, 3, 3)

    flat_pts = raw_tris.reshape(-1, 3)
    quant = np.round(flat_pts * 10000.0).astype(np.int64)
    _, unique_idx, inv_idx = np.unique(quant, axis=0, return_index=True, return_inverse=True)
    vertices = flat_pts[unique_idx].astype(np.float32)
    faces = inv_idx.reshape(-1, 3).astype(np.int32)

    # Snap flat Z=0 bed plane, Z=12 top plane, and X=0 wall back plane cleanly
    vertices[:, 2] = np.where(np.abs(vertices[:, 2]) < 1e-3, 0.0, vertices[:, 2])
    vertices[:, 2] = np.where(np.abs(vertices[:, 2] - p.bracket_width) < 1e-3, p.bracket_width, vertices[:, 2])
    vertices[:, 0] = np.where(np.abs(vertices[:, 0]) < 1e-3, 0.0, vertices[:, 0])

    # Ensure outward winding (signed volume > 0)
    signed_vol = np.sum(np.einsum("ij,ij->i", vertices[faces[:, 0]], np.cross(vertices[faces[:, 1]], vertices[faces[:, 2]]))) / 6.0
    if signed_vol < 0:
        faces = faces[:, [0, 2, 1]]

    return vertices, faces


def write_binary_stl(path: Path, vertices: np.ndarray, faces: np.ndarray, header_text: str = "Bambu Lab P1S Bracket") -> None:
    """Writes a standard binary STL file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    v0 = vertices[faces[:, 0]]
    v1 = vertices[faces[:, 1]]
    v2 = vertices[faces[:, 2]]
    normals = np.cross(v1 - v0, v2 - v0)
    norms = np.linalg.norm(normals, axis=1, keepdims=True)
    normals = np.where(norms > 1e-12, normals / norms, 0.0).astype(np.float32)

    header = header_text.encode("ascii", errors="ignore")[:80].ljust(80, b"\0")
    num_tris = len(faces)

    dtype = np.dtype([
        ("normal", "<f4", (3,)),
        ("v0", "<f4", (3,)),
        ("v1", "<f4", (3,)),
        ("v2", "<f4", (3,)),
        ("attr", "<u2"),
    ])
    records = np.zeros(num_tris, dtype=dtype)
    records["normal"] = normals
    records["v0"] = v0
    records["v1"] = v1
    records["v2"] = v2
    records["attr"] = 0

    with open(path, "wb") as f:
        f.write(header)
        f.write(struct.pack("<I", num_tris))
        f.write(records.tobytes())


def combine_meshes(instances: List[Tuple[np.ndarray, np.ndarray, float, float, float]]) -> Tuple[np.ndarray, np.ndarray]:
    """Combines multiple (vertices, faces, dx, dy, dz) instances into a single mesh."""
    all_v = []
    all_f = []
    offset = 0
    for v, f, dx, dy, dz in instances:
        shifted_v = v + np.array([[dx, dy, dz]], dtype=np.float32)
        all_v.append(shifted_v)
        all_f.append(f + offset)
        offset += len(v)
    return np.concatenate(all_v, axis=0), np.concatenate(all_f, axis=0)


def write_bambu_3mf(
    path: Path,
    objects: List[Tuple[str, np.ndarray, np.ndarray, float, float, float]],
    plate_name: str = "Bambu Lab P1S Ceiling Light Brackets",
) -> None:
    """
    Writes a valid 3MF archive compatible with Bambu Studio / OrcaSlicer / PrusaSlicer
    configured for the Bambu Lab P1S (256x256x256 mm build plate, zero supports).
    Each entry in `objects` gets its own unique <object id="idx"> and <item objectid="idx">
    with baked-in world coordinates so Bambu Studio never stacks multiple items on top of each other.
    """
    path.parent.mkdir(parents=True, exist_ok=True)

    resources_xml_parts = []
    build_xml_parts = []
    model_settings_items = []

    for idx, (obj_name, vertices, faces, tx, ty, tz) in enumerate(objects, start=1):
        # Bake (tx, ty, tz) directly into the object's vertices and use identity transform
        # so every slicer (Bambu Studio, OrcaSlicer, Bambu Handy) places each bracket at its
        # exact build-plate grid coordinate with zero ambiguity or multi-instance stacking!
        v_lines = [
            f'          <vertex x="{v[0] + tx:.4f}" y="{v[1] + ty:.4f}" z="{v[2] + tz:.4f}"/>'
            for v in vertices
        ]
        t_lines = [f'          <triangle v1="{f[0]}" v2="{f[1]}" v3="{f[2]}"/>' for f in faces]
        resources_xml_parts.append(
            f'    <object id="{idx}" name="{obj_name}" type="model">\n'
            f'      <mesh>\n'
            f'        <vertices>\n' + "\n".join(v_lines) + "\n        </vertices>\n"
            f'        <triangles>\n' + "\n".join(t_lines) + "\n        </triangles>\n"
            f'      </mesh>\n'
            f'    </object>'
        )
        build_xml_parts.append(
            f'    <item objectid="{idx}" transform="1 0 0 0 1 0 0 0 1 0 0 0" printable="1"/>'
        )
        model_settings_items.append(
            f'  <object id="{idx}">\n'
            f'    <metadata key="name" value="{obj_name}"/>\n'
            f'    <metadata key="extruder" value="1"/>\n'
            f'  </object>'
        )

    model_xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<model unit="millimeter" xml:lang="en-US" '
        'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" '
        'xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">\n'
        '  <metadata name="Application">BambuStudio</metadata>\n'
        f'  <metadata name="Title">{plate_name}</metadata>\n'
        '  <resources>\n'
        + "\n".join(resources_xml_parts)
        + "\n  </resources>\n"
        '  <build>\n'
        + "\n".join(build_xml_parts)
        + "\n  </build>\n"
        '</model>\n'
    )

    content_types_xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
        '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
        '  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n'
        '</Types>\n'
    )

    rels_xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
        '  <Relationship Target="/3D/3dmodel.model" Id="rel-1" '
        'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n'
        '</Relationships>\n'
    )

    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types_xml)
        zf.writestr("_rels/.rels", rels_xml)
        zf.writestr("3D/3dmodel.model", model_xml)


def write_standalone_configs(out_dir: Path, p: BracketParams) -> None:
    """Writes standalone Bambu Studio / OrcaSlicer process preset JSON, INI config, and parametric CAD config."""
    # 1. Bambu Studio / OrcaSlicer Importable Process Preset (.json)
    bambu_process_preset = {
        "type": "process",
        "name": "Bambu P1S - Ceiling Light Bracket (4 Walls, 25% Gyroid, 0 Supports)",
        "from": "User",
        "inherits": "0.20mm Standard @BBL X1C",
        "version": "1.9.0.0",
        "print_settings_id": "Bambu P1S - Ceiling Light Bracket (4 Walls, 25% Gyroid, 0 Supports)",
        "compatible_printers": [
            "Bambu Lab P1S 0.4 nozzle",
            "Bambu Lab P1P 0.4 nozzle",
            "Bambu Lab X1 Carbon 0.4 nozzle",
            "Bambu Lab A1 0.4 nozzle"
        ],
        "layer_height": "0.2",
        "initial_layer_print_height": "0.2",
        "wall_loops": "4",
        "top_shell_layers": "5",
        "bottom_shell_layers": "5",
        "sparse_infill_density": "25%",
        "sparse_infill_pattern": "gyroid",
        "enable_support": "0",
        "support_type": "normal(auto)",
        "brim_type": "no_brim",
        "brim_width": "0",
        "elefant_foot_compensation": "0.15",
        "wall_generator": "arachne",
        "detect_thin_wall": "1",
        "seam_position": "aligned",
        "outer_wall_speed": "120",
        "inner_wall_speed": "200",
        "sparse_infill_speed": "230"
    }
    with open(out_dir / "Bambu_Studio_P1S_Process_Profile.json", "w") as f:
        json.dump(bambu_process_preset, f, indent=2)

    # 2. Parametric Geometry & Slicer Configuration File
    cad_and_print_config = {
        "project": "Ceiling Light & Ornament Zig-Zag Wall Brackets",
        "target_printer": "Bambu Lab P1S (256x256x256 mm Textured PEI Plate)",
        "print_orientation": {
            "bed_axis": "Z (Bracket 12.0 mm width lies flat on Z=0 build plate)",
            "wall_to_pole_axis": "X (0 to 6.0 mm wall plate + 25.4 mm / 1.00 inch pole = 31.4 mm total)",
            "vertical_wall_height_axis": "Y (0 to 38.0 mm / 1.50 inch vertical wall plate)",
            "supports_required": False
        },
        "dimensions_mm": {
            "plate_thickness_x": p.plate_thickness,
            "pole_length_x": p.pole_length,
            "pole_length_inches": round(p.pole_length / 25.4, 3),
            "plate_height_y": p.plate_height,
            "bracket_width_z": p.bracket_width,
            "pole_shaft_height_y": p.pole_y_max - p.pole_y_min,
            "thread_eyelet_center_xy": [p.eyelet_x, p.eyelet_y],
            "thread_eyelet_inner_diameter": p.eyelet_diameter,
            "thread_eyelet_flared_mouth_diameter": p.eyelet_flare_diameter,
            "main_nail_hole_y": p.main_nail_y,
            "main_nail_hole_diameter": p.main_nail_diameter,
            "main_nail_countersink_diameter": p.countersink_diameter,
            "secondary_anti_rotation_pinhole_y": p.pin_nail_y,
            "secondary_anti_rotation_pinhole_diameter": p.pin_nail_diameter,
            "middle_top_hook_cradle_center_x": p.cradle_x_center,
            "start_end_horn_cleat_span_mm": p.cleat_horn_tip_half_x * 2.0,
            "start_end_v_cinch_slot_taper_mm": [1.2, 0.25]
        },
        "bambu_p1s_slicer_settings": bambu_process_preset
    }
    with open(out_dir / "bracket_configuration_settings.json", "w") as f:
        json.dump(cad_and_print_config, f, indent=2)

    # 3. Slicer Configuration INI (compatible with File -> Import -> Import Config in Bambu/Orca/PrusaSlicer)
    ini_lines = [
        "# Bambu Studio / OrcaSlicer Configuration File",
        "# Printer: Bambu Lab P1S (0.4mm Nozzle, Textured PEI Plate)",
        "# Part: Ceiling Light & Ornament Zig-Zag Wall Brackets (Start, Middle, End)",
        "printer_model = Bambu Lab P1S",
        "curr_bed_type = Textured PEI Plate",
        "nozzle_diameter = 0.4",
        "layer_height = 0.2",
        "initial_layer_print_height = 0.2",
        "wall_loops = 4",
        "top_shell_layers = 5",
        "bottom_shell_layers = 5",
        "sparse_infill_density = 25%",
        "sparse_infill_pattern = gyroid",
        "enable_support = 0",
        "brim_type = no_brim",
        "brim_width = 0",
        "elefant_foot_compensation = 0.15",
        "wall_generator = arachne",
        "detect_thin_wall = 1",
        "seam_position = aligned",
        "outer_wall_speed = 120",
        "inner_wall_speed = 200",
        "sparse_infill_speed = 230",
        ""
    ]
    with open(out_dir / "Bambu_P1S_Slicer_Config.ini", "w") as f:
        f.write("\n".join(ini_lines))


def main() -> None:
    out_dir = Path("/home/antigravity/LopeWale/ChristmasLightDesign/3d_prints")
    out_dir.mkdir(parents=True, exist_ok=True)

    params = BracketParams()

    print("Generating high-resolution meshes (step=0.50mm)...")
    v_start, f_start = extract_isosurface_mesh("start", params, step=0.50)
    v_middle, f_middle = extract_isosurface_mesh("middle", params, step=0.50)
    # Start and End use the exact same universal Horn Cleat + V-Cinch + 1" Pole geometry
    v_end, f_end = v_start.copy(), f_start.copy()

    print(f"  Start/End Bracket: {len(v_start):,} vertices, {len(f_start):,} triangles")
    print(f"  Middle Bracket   : {len(v_middle):,} vertices, {len(f_middle):,} triangles")

    # 1. Save Individual STLs
    write_binary_stl(out_dir / "Start_Bracket_1in_Cleat.stl", v_start, f_start, "Start Bracket 1in Pole + Horn Cleat")
    write_binary_stl(out_dir / "Middle_Bracket_1in_Eyelet_Cradle.stl", v_middle, f_middle, "Middle Bracket 1in Pole + Eyelet & Cradle")
    write_binary_stl(out_dir / "End_Bracket_1in_Cleat.stl", v_end, f_end, "End Bracket 1in Pole + Horn Cleat")

    # 2. Save Individual 3MFs (centered on Bambu Lab P1S 256x256 mm build plate at X=112, Y=109)
    write_bambu_3mf(
        out_dir / "Start_Bracket_Single_P1S.3mf",
        [("Start_Bracket", v_start, f_start, 112.0, 109.0, 0.0)],
        "Start Bracket - Bambu Lab P1S",
    )
    write_bambu_3mf(
        out_dir / "Middle_Bracket_Single_P1S.3mf",
        [("Middle_Bracket", v_middle, f_middle, 112.0, 109.0, 0.0)],
        "Middle Bracket - Bambu Lab P1S",
    )
    write_bambu_3mf(
        out_dir / "End_Bracket_Single_P1S.3mf",
        [("End_Bracket", v_end, f_end, 112.0, 109.0, 0.0)],
        "End Bracket - Bambu Lab P1S",
    )

    # 3. Create Pre-Arranged Bambu Lab P1S Batch Build Plates (256x256 mm bed)
    starter_kit_objs = []
    starter_kit_stl_instances = []
    cols, rows = 5, 4
    pitch_x, pitch_y = 40.0, 46.0
    origin_x = 0.5 * (256.0 - (cols - 1) * pitch_x - 31.4)
    origin_y = 0.5 * (256.0 - (rows - 1) * pitch_y - 38.0)

    idx = 0
    for r in range(rows):
        for c in range(cols):
            tx = origin_x + c * pitch_x
            ty = origin_y + r * pitch_y
            if idx == 0:
                starter_kit_objs.append(("Start_Bracket", v_start, f_start, tx, ty, 0.0))
                starter_kit_stl_instances.append((v_start, f_start, tx, ty, 0.0))
            elif idx == 1:
                starter_kit_objs.append(("End_Bracket", v_end, f_end, tx, ty, 0.0))
                starter_kit_stl_instances.append((v_end, f_end, tx, ty, 0.0))
            else:
                starter_kit_objs.append((f"Middle_Bracket_{idx-1:02d}", v_middle, f_middle, tx, ty, 0.0))
                starter_kit_stl_instances.append((v_middle, f_middle, tx, ty, 0.0))
            idx += 1

    write_bambu_3mf(
        out_dir / "Bambu_P1S_Plate_20x_Starter_Kit_1Start_18Middle_1End.3mf",
        starter_kit_objs,
        "Bambu Lab P1S - 20x Ceiling Bracket Starter Kit (1 Start, 18 Middle, 1 End)",
    )
    v_kit, f_kit = combine_meshes(starter_kit_stl_instances)
    write_binary_stl(
        out_dir / "Bambu_P1S_Plate_20x_Starter_Kit_1Start_18Middle_1End.stl",
        v_kit,
        f_kit,
        "Bambu P1S 20x Starter Kit Plate",
    )

    # Plate B: 20x Middle Bracket Expansion Plate
    middle_batch_objs = []
    for r in range(rows):
        for c in range(cols):
            tx = origin_x + c * pitch_x
            ty = origin_y + r * pitch_y
            n = r * cols + c + 1
            middle_batch_objs.append((f"Middle_Bracket_{n:02d}", v_middle, f_middle, tx, ty, 0.0))

    write_bambu_3mf(
        out_dir / "Bambu_P1S_Plate_20x_Middle_Expansion.3mf",
        middle_batch_objs,
        "Bambu Lab P1S - 20x Middle Bracket Expansion Plate",
    )

    # 4. Write standalone Bambu Studio / OrcaSlicer process profiles & configuration files
    write_standalone_configs(out_dir, params)
    print("Done! All 3MF/STL exports and configuration files written to:", out_dir)


if __name__ == "__main__":
    main()
