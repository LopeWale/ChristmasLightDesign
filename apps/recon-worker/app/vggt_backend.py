from __future__ import annotations

import importlib.util
from pathlib import Path
import shutil
import numpy as np
from PIL import Image
import trimesh

from app.reconstructor import ProgressCallback, ReconstructionArtifacts, Reconstructor
from app.schemas import BoundingBox3D, CameraPose, CamerasPayload, SceneMetadata


def filter_sky_and_low_confidence_depth(
    depth: np.ndarray,
    confidence: np.ndarray,
    min_confidence: float = 1.2,
    max_depth: float = 40.0,
) -> np.ndarray:
    """
    Zero out low-confidence and distant sky pixels in VGGT dense depth predictions
    before Open3D ScalableTSDFVolume integration.
    """
    cleaned = np.array(depth, dtype=np.float32, copy=True)
    invalid_mask = (
        ~np.isfinite(cleaned)
        | (cleaned <= 0.05)
        | (cleaned > max_depth)
        | (~np.isfinite(confidence))
        | (confidence < min_confidence)
    )
    cleaned[invalid_mask] = 0.0
    return cleaned


def is_vggt_cuda_available() -> bool:
    """Return True only when CUDA + torch + vggt + open3d are all available."""
    for pkg in ("torch", "vggt", "open3d"):
        if importlib.util.find_spec(pkg) is None:
            return False
    try:
        import torch

        return bool(torch.cuda.is_available())
    except Exception:
        return False


class VGGTReconstructor(Reconstructor):
    """
    Multi-view exterior reconstruction using `facebookresearch/vggt` +
    `open3d.pipelines.integration.ScalableTSDFVolume` -> decimated `.glb` with normals.
    """

    backend_name = "vggt"

    def __init__(
        self,
        model_id: str = "facebook/VGGT-1B",
        max_triangles: int = 250_000,
        voxel_length: float = 0.03,
        sdf_trunc: float = 0.12,
    ) -> None:
        self.model_id = model_id
        self.max_triangles = max_triangles
        self.voxel_length = voxel_length
        self.sdf_trunc = sdf_trunc

    def reconstruct(
        self,
        image_paths: list[Path],
        output_dir: Path,
        progress_cb: ProgressCallback | None = None,
    ) -> ReconstructionArtifacts:
        if not image_paths:
            raise ValueError("VGGT reconstruction requires at least 1 input image.")

        try:
            import open3d as o3d
            import torch
            from vggt.models.vggt import VGGT
            from vggt.utils.load_fn import load_and_preprocess_images
            from vggt.utils.pose_enc import pose_encoding_to_extri_intri
        except ImportError as exc:
            raise RuntimeError(
                "VGGT backend requires `torch`, `vggt` (facebookresearch/vggt), and `open3d`. "
                "Use RECON_BACKEND=auto or RECON_BACKEND=synthetic on CPU-only environments."
            ) from exc

        output_dir.mkdir(parents=True, exist_ok=True)
        if progress_cb:
            progress_cb(15)

        device = "cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")
        model = VGGT.from_pretrained(self.model_id).to(device)
        model.eval()

        str_paths = [str(p) for p in image_paths]
        images = load_and_preprocess_images(str_paths).to(device)

        if progress_cb:
            progress_cb(35)

        with torch.no_grad():
            if device == "cuda":
                amp_dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
                with torch.cuda.amp.autocast(dtype=amp_dtype):
                    predictions = model(images)
            else:
                predictions = model(images)

        extrinsics_w2c, intrinsics_k = pose_encoding_to_extri_intri(
            predictions["pose_enc"], images.shape[-2:]
        )
        depth_maps = predictions["depth"].squeeze(0).squeeze(-1).detach().cpu().numpy()
        depth_conf = predictions["depth_conf"].squeeze(0).detach().cpu().numpy()
        extrinsics_np = extrinsics_w2c.squeeze(0).detach().cpu().numpy()
        intrinsics_np = intrinsics_k.squeeze(0).detach().cpu().numpy()
        rgb_np = (
            (images.squeeze(0).permute(0, 2, 3, 1).detach().cpu().numpy() * 255.0)
            .clip(0, 255)
            .astype(np.uint8)
        )

        if progress_cb:
            progress_cb(60)

        volume = o3d.pipelines.integration.ScalableTSDFVolume(
            voxel_length=self.voxel_length,
            sdf_trunc=self.sdf_trunc,
            color_type=o3d.pipelines.integration.TSDFVolumeColorType.RGB8,
        )

        cameras: list[CameraPose] = []
        num_views, h, w, _ = rgb_np.shape

        for idx in range(num_views):
            cleaned_depth = filter_sky_and_low_confidence_depth(
                depth=depth_maps[idx],
                confidence=depth_conf[idx],
            )
            color_o3d = o3d.geometry.Image(np.ascontiguousarray(rgb_np[idx]))
            depth_o3d = o3d.geometry.Image(np.ascontiguousarray(cleaned_depth))
            rgbd = o3d.geometry.RGBDImage.create_from_color_and_depth(
                color_o3d,
                depth_o3d,
                depth_scale=1.0,
                depth_trunc=40.0,
                convert_rgb_to_intensity=False,
            )

            k_mat = intrinsics_np[idx]
            intrinsic_o3d = o3d.camera.PinholeCameraIntrinsic(
                w,
                h,
                float(k_mat[0, 0]),
                float(k_mat[1, 1]),
                float(k_mat[0, 2]),
                float(k_mat[1, 2]),
            )

            w2c_4x4 = np.eye(4, dtype=np.float64)
            w2c_4x4[:3, :4] = extrinsics_np[idx][:3, :4]
            volume.integrate(rgbd, intrinsic_o3d, w2c_4x4)

            c2w_4x4 = np.linalg.inv(w2c_4x4)
            cameras.append(
                CameraPose(
                    id=idx,
                    name="front" if idx == 0 else f"view_{idx}",
                    width=int(w),
                    height=int(h),
                    intrinsics=k_mat.astype(float).tolist(),
                    extrinsics=c2w_4x4.astype(float).tolist(),
                )
            )

        if progress_cb:
            progress_cb(80)

        o3d_mesh = volume.extract_triangle_mesh()
        o3d_mesh.remove_degenerate_triangles()
        o3d_mesh.remove_duplicated_triangles()
        o3d_mesh.remove_duplicated_vertices()
        o3d_mesh.remove_non_manifold_edges()

        if len(o3d_mesh.triangles) > self.max_triangles:
            o3d_mesh = o3d_mesh.simplify_quadric_decimation(
                target_number_of_triangles=self.max_triangles
            )

        o3d_mesh.compute_vertex_normals()

        verts = np.asarray(o3d_mesh.vertices, dtype=np.float64)
        faces = np.asarray(o3d_mesh.triangles, dtype=np.int64)
        normals = np.asarray(o3d_mesh.vertex_normals, dtype=np.float64)
        if o3d_mesh.has_vertex_colors():
            vcolors = (np.asarray(o3d_mesh.vertex_colors) * 255.0).clip(0, 255).astype(np.uint8)
            alpha = np.full((len(verts), 1), 255, dtype=np.uint8)
            rgba = np.hstack([vcolors, alpha])
        else:
            rgba = np.full((len(verts), 4), 200, dtype=np.uint8)
            rgba[:, 3] = 255

        tmesh = trimesh.Trimesh(
            vertices=verts,
            faces=faces,
            vertex_normals=normals,
            vertex_colors=rgba,
            process=False,
        )
        scene = trimesh.Scene()
        scene.add_geometry(tmesh, node_name="reconstructed_facade", geom_name="reconstructed_facade")

        glb_path = output_dir / "scene.glb"
        glb_bytes = trimesh.exchange.gltf.export_glb(scene, include_normals=True)
        glb_path.write_bytes(glb_bytes)

        cameras_payload = CamerasPayload(cameras=cameras)
        cameras_path = output_dir / "cameras.json"
        cameras_path.write_text(cameras_payload.model_dump_json(indent=2), encoding="utf-8")

        ref_path = output_dir / "reference_front.png"
        with Image.open(image_paths[0]) as src_img:
            src_img.convert("RGB").save(ref_path, format="PNG")

        bounds = tmesh.bounds
        stats = SceneMetadata(
            vertexCount=int(len(verts)),
            faceCount=int(len(faces)),
            boundingBox=BoundingBox3D(
                min=(float(bounds[0, 0]), float(bounds[0, 1]), float(bounds[0, 2])),
                max=(float(bounds[1, 0]), float(bounds[1, 1]), float(bounds[1, 2])),
            ),
        )
        if progress_cb:
            progress_cb(100)

        return ReconstructionArtifacts(
            backend_used="vggt",
            glb_path=glb_path,
            cameras_path=cameras_path,
            reference_image_path=ref_path,
            mesh_stats=stats,
            cameras_payload=cameras_payload,
        )
