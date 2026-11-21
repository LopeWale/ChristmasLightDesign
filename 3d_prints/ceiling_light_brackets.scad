// ============================================================================
// Parametric Ceiling Light & Ornament Zig-Zag Wall Brackets
// Designed for Bambu Lab P1S (Print flat on side: Z = bracket width, 0 supports)
// ============================================================================
//
// Coordinate System (matches generate_brackets.py):
//   X-axis (0..31.4 mm): Wall back face (X=0) -> 6mm plate -> 1.00" (25.4mm) pole
//   Y-axis (0..38.0 mm): Vertical wall height (pole at Y=10..20, nail holes at Y=23.2 & 30.5)
//   Z-axis (0..12.0 mm): Bracket width & print bed height (thread hole runs along Z)
//
// Set `part_mode` below to export individual pieces or the 20-piece P1S plate:
//   "middle"      -> Middle Bracket (1" pole + 4mm flared Z-hole + top quick-hook cradle)
//   "start"       -> Start Bracket  (1" pole + 4mm flared Z-hole + figure-8 horn cleat + V-cinch slot)
//   "end"         -> End Bracket    (same universal horn cleat + V-cinch slot as Start)
//   "p1s_kit_20"  -> 20-bracket starter grid (1 Start, 1 End, 18 Middle) for 256x256mm bed

part_mode = "middle"; // ["middle", "start", "end", "p1s_kit_20"]

// --- Core Parametric Dimensions (mm) ---
plate_thickness       = 6.0;
pole_length           = 25.4;   // Exactly 1.00 inch
plate_height          = 38.0;   // 1.50 inches
bracket_width         = 12.0;   // 0.47 inches (Z print height)

pole_y_min            = 10.0;
pole_y_max            = 20.0;   // 10 mm tall pole shaft
gusset_y_min          = 1.5;
gusset_x_end          = 18.0;

// Thread eyelet along Z-axis on 1-inch pole
eyelet_x              = 26.0;
eyelet_y              = 15.0;
eyelet_diameter       = 4.0;
eyelet_flare_diameter = 6.0;
eyelet_flare_depth    = 1.6;

// Wall plate nail holes along X-axis
main_nail_y           = 30.5;
main_nail_diameter    = 3.5;
countersink_diameter  = 7.0;
countersink_depth     = 1.8;

pin_nail_y            = 23.2;
pin_nail_diameter     = 2.2;

$fn = 64;

module base_l_body() {
    total_x = plate_thickness + pole_length;
    tip_r   = (pole_y_max - pole_y_min) / 2;
    tip_cx  = total_x - tip_r;
    tip_cy  = (pole_y_min + pole_y_max) / 2;

    linear_extrude(height = bracket_width) {
        union() {
            // Vertical wall plate (X: 0..6, Y: 0..38)
            square([plate_thickness, plate_height]);

            // 1-inch horizontal pole shaft + rounded tip
            translate([plate_thickness - 1, pole_y_min])
                square([tip_cx - (plate_thickness - 1), pole_y_max - pole_y_min]);
            translate([tip_cx, tip_cy])
                circle(r = tip_r);

            // Lower triangular support gusset
            polygon(points = [
                [plate_thickness - 0.5, gusset_y_min],
                [gusset_x_end, pole_y_min + 0.2],
                [plate_thickness - 0.5, pole_y_min + 0.2]
            ]);
        }
    }
}

module horn_cleat_addon() {
    // Figure-8 horn cleat running full Z=0..12 width so it sits flat on Z=0 build plate with 0 overhangs
    linear_extrude(height = bracket_width) {
        polygon(points = [
            [14.4, 19.5],
            [19.2, 19.5],
            [19.2, 22.0],
            [23.6, 23.2],
            [23.6, 25.0],
            [10.0, 25.0],
            [10.0, 23.2],
            [14.4, 22.0]
        ]);
    }
}

module teardrop_x_hole(y_pos, z_pos, dia, length_x) {
    r = dia / 2;
    translate([-0.1, y_pos, z_pos])
    rotate([0, 90, 0])
    linear_extrude(height = length_x) {
        union() {
            circle(r = r);
            // 45-degree self-supporting teardrop apex in +Z (which is -X in rotated 2D frame)
            polygon(points = [
                [0, r * 0.7071],
                [-r * 1.4142, 0],
                [0, -r * 0.7071]
            ]);
        }
    }
}

module common_cutouts() {
    // 1. Z-axis thread through-hole + double-sided 45-degree entry flares
    translate([eyelet_x, eyelet_y, -0.1])
        cylinder(h = bracket_width + 0.2, d = eyelet_diameter);
    translate([eyelet_x, eyelet_y, -0.05])
        cylinder(h = eyelet_flare_depth + 0.05, d1 = eyelet_flare_diameter, d2 = eyelet_diameter);
    translate([eyelet_x, eyelet_y, bracket_width - eyelet_flare_depth])
        cylinder(h = eyelet_flare_depth + 0.05, d1 = eyelet_diameter, d2 = eyelet_flare_diameter);

    // 2. X-axis Main Nail/Screw Teardrop hole + countersink (zero floating overhangs!)
    teardrop_x_hole(main_nail_y, bracket_width / 2, main_nail_diameter, plate_thickness + 0.2);
    translate([plate_thickness - countersink_depth, main_nail_y, bracket_width / 2])
        rotate([0, 90, 0])
            cylinder(h = countersink_depth + 0.1, d1 = main_nail_diameter, d2 = countersink_diameter);

    // 3. X-axis Secondary Anti-Rotation Brad/Pinhole Teardrop
    teardrop_x_hole(pin_nail_y, bracket_width / 2, pin_nail_diameter, plate_thickness + 0.2);
}

module bracket(kind = "middle") {
    difference() {
        union() {
            base_l_body();
            if (kind == "start" || kind == "end") {
                horn_cleat_addon();
            }
        }
        common_cutouts();

        // Middle bracket top quick-drop J-hook cradle groove behind eyelet
        if (kind == "middle") {
            translate([0, 0, -0.1])
            linear_extrude(height = bracket_width + 0.2) {
                hull() {
                    translate([19.2, 20.6]) circle(r = 1.85);
                    translate([16.5, 16.5]) circle(r = 1.85);
                }
            }
        }

        // Start / End bracket V-pinch cinch slot under front cleat horn
        if (kind == "start" || kind == "end") {
            translate([0, 0, -0.1])
            linear_extrude(height = bracket_width + 0.2) {
                polygon(points = [
                    [18.6, 21.0],
                    [23.2, 20.4],
                    [23.2, 21.8],
                    [18.6, 21.25]
                ]);
            }
        }
    }
}

if (part_mode == "p1s_kit_20") {
    for (r = [0 : 3]) {
        for (c = [0 : 4]) {
            idx = r * 5 + c;
            translate([c * 40, r * 46, 0]) {
                if (idx == 0) bracket("start");
                else if (idx == 1) bracket("end");
                else bracket("middle");
            }
        }
    }
} else {
    bracket(part_mode);
}
