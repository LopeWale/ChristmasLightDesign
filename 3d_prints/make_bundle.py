#!/usr/bin/env python3
"""Simple local download server with Content-Disposition attachment headers and a clean HTML download index."""
import http.server
import os
import socketserver
from pathlib import Path
import zipfile

ROOT_DIR = Path("/home/antigravity/LopeWale/ChristmasLightDesign/3d_prints")
ZIP_ALL = ROOT_DIR / "Bambu_Lab_P1S_Ceiling_Brackets_Complete_Bundle.zip"

def build_bundle_zip() -> None:
    files = [
        "Bambu_P1S_Plate_20x_Starter_Kit_1Start_18Middle_1End.3mf",
        "Bambu_P1S_Plate_20x_Middle_Expansion.3mf",
        "Start_Bracket_Single_P1S.3mf",
        "Middle_Bracket_Single_P1S.3mf",
        "End_Bracket_Single_P1S.3mf",
        "Start_Bracket_1in_Cleat.stl",
        "Middle_Bracket_1in_Eyelet_Cradle.stl",
        "End_Bracket_1in_Cleat.stl",
        "Bambu_Studio_P1S_Process_Profile.json",
        "Bambu_P1S_Slicer_Config.ini",
        "bracket_configuration_settings.json",
        "ceiling_light_brackets.scad",
        "generate_brackets.py",
    ]
    with zipfile.ZipFile(ZIP_ALL, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for fname in files:
            fpath = ROOT_DIR / fname
            if fpath.exists():
                zf.write(fpath, arcname=fname)

if __name__ == "__main__":
    build_bundle_zip()
    print("Created bundle zip:", ZIP_ALL, f"({ZIP_ALL.stat().st_size / (1024*1024):.1f} MB)")
