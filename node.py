import base64
import io
import os
import uuid
import folder_paths
import torch
import numpy as np
from PIL import Image
from server import PromptServer
from aiohttp import web

class Comfy3DStudioNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
            },
            "optional": {
                "input_3d": ("*",),
            },
            "hidden": {
                "base64_image": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "process"
    CATEGORY = "3D-Studio"
    OUTPUT_NODE = True

    def process(self, **kwargs):
        base64_image = kwargs.get("base64_image", "")
        input_3d = kwargs.get("input_3d")
        
        try:
            # 1. Establish the 3D Input Bridge (Send path to UI)
            ui_results = {}
            if input_3d is not None:
                print(f"Comfy3D: Raw input_3d received: {type(input_3d)} | {input_3d}")
                # Unwrap list if it's a batch of one
                if isinstance(input_3d, list) and len(input_3d) > 0:
                    input_3d = input_3d[0]
                    print(f"Comfy3D: Unwrapped list to: {type(input_3d)} | {input_3d}")

                if isinstance(input_3d, str):
                    # Relativize absolute paths for ComfyUI API compatibility
                    folder_type = "output" # Default
                    if os.path.isabs(input_3d):
                        out_dir = folder_paths.get_output_directory()
                        tmp_dir = folder_paths.get_temp_directory()
                        in_dir = folder_paths.get_input_directory()
                        
                        if input_3d.startswith(out_dir):
                            input_3d = os.path.relpath(input_3d, out_dir)
                            folder_type = "output"
                        elif input_3d.startswith(tmp_dir):
                            input_3d = os.path.relpath(input_3d, tmp_dir)
                            folder_type = "temp"
                        elif input_3d.startswith(in_dir):
                            input_3d = os.path.relpath(input_3d, in_dir)
                            folder_type = "input"
                    else:
                        # If path is already relative, try to guess where it is
                        out_dir = folder_paths.get_output_directory()
                        in_dir = folder_paths.get_input_directory()
                        tmp_dir = folder_paths.get_temp_directory()
                        
                        if os.path.exists(os.path.join(in_dir, input_3d)):
                            folder_type = "input"
                        elif os.path.exists(os.path.join(tmp_dir, input_3d)):
                            folder_type = "temp"
                        else:
                            folder_type = "output"

                    ui_results["mesh_path"] = [{"filename": input_3d, "type": folder_type}]
                    print(f"Comfy3D: Incoming mesh: {input_3d} ({folder_type})")
                else:
                    # Handle MESH dict or Trimesh object
                    m = input_3d.get("mesh") if isinstance(input_3d, dict) else input_3d
                    if hasattr(m, "export"):
                        temp_dir = folder_paths.get_temp_directory()
                        filename = f"studio_input_{uuid.uuid4().hex}.glb"
                        m.export(os.path.join(temp_dir, filename))
                        ui_results["mesh_path"] = [{"filename": filename, "type": "temp"}]
                        print(f"Comfy3D: Exported incoming trimesh to: {filename}")

            # 2. Process the viewport snapshot
            if not base64_image:
                res = (torch.zeros((1, 512, 512, 3), dtype=torch.float32),)
                return {"ui": ui_results, "result": res} if ui_results else res

            # Handle data URL prefix if present
            if "," in base64_image:
                base64_image = base64_image.split(",")[1]

            image_data = base64.b64decode(base64_image)
            image = Image.open(io.BytesIO(image_data)).convert("RGB")
            
            # Convert PIL Image to PyTorch Tensor (batch_size, height, width, channels)
            image_np = np.array(image).astype(np.float32) / 255.0
            image_tensor = torch.from_numpy(image_np)[None,]
            
            res = (image_tensor,)
            return {"ui": ui_results, "result": res} if ui_results else res
        except Exception as e:
            print(f"Error in Comfy3D-Studio process: {e}")
            res = (torch.zeros((1, 512, 512, 3), dtype=torch.float32),)
            return {"ui": ui_results, "result": res} if ui_results else res

def trimesh_texture_split(mesh_path, quantization_steps=16.0):
    import trimesh
    import os
    import numpy as np
    from trimesh.visual import material, TextureVisuals

    print(f"[Comfy3D] Splitting Texture for: {mesh_path}")
    
    if not os.path.isabs(mesh_path):
        candidates = [
            folder_paths.get_output_directory(),
            folder_paths.get_input_directory(),
            folder_paths.get_temp_directory()
        ]
        for d in candidates:
            if d and os.path.exists(os.path.join(d, mesh_path)):
                mesh_path = os.path.join(d, mesh_path)
                break
    
    scene = trimesh.load(mesh_path, force='scene')
    geom_names = list(scene.geometry.keys())
    if not geom_names:
        return mesh_path
        
    geom_name = geom_names[0]
    mesh = scene.geometry[geom_name]
    
    mat = mesh.visual.material
    pil_img = None
    if hasattr(mat, "baseColorTexture"): 
        pil_img = mat.baseColorTexture
        if pil_img: print(f"[Comfy3D] Found baseColorTexture: {pil_img.size}")
    elif hasattr(mat, "image"): 
        pil_img = mat.image
        if pil_img: print(f"[Comfy3D] Found image texture: {pil_img.size}")

    if pil_img is None:
        print("[Comfy3D] No texture found, skipping split.")
        return mesh_path
        
    if not hasattr(mesh.visual, 'uv') or mesh.visual.uv is None or len(mesh.visual.uv) == 0:
        print("[Comfy3D] Mesh has no UVs, cannot split by texture. Skipping.")
        return mesh_path

    img_np = np.array(pil_img.convert('RGB')) / 255.0  
    # CRITICAL: Convert sRGB texture colors to Linear space for PBR baseColorFactor
    # This prevents the "washed out" / "lighter" look (color drift)
    img_np = np.power(img_np, 2.2)
    
    h, w = img_np.shape[:2]
    
    # NaN-safe UV sampling
    try:
        raw_uvs = mesh.visual.uv[mesh.faces]
        # Check for any NaN in source UVs
        if np.isnan(raw_uvs).any():
            print("[Comfy3D] Warning: Source UVs contain NaN. Filling with 0.")
            raw_uvs = np.nan_to_num(raw_uvs)
            
        face_uvs = raw_uvs.mean(axis=1)  
        u = face_uvs[:, 0] % 1.0
        v = face_uvs[:, 1] % 1.0
        
        pixel_x = np.clip((u * w).astype(int), 0, w - 1)
        pixel_y = np.clip(((1.0 - v) * h).astype(int), 0, h - 1)
    except Exception as e:
        print(f"[Comfy3D] UV sampling failed: {e}")
        return mesh_path
    
    face_colors = img_np[pixel_y, pixel_x] 
    
    # Increase precision for internal grouping to avoid hue snap
    # We round to grouping_steps, then use the MEAN color of the group for output
    crushed_colors = np.round(face_colors * quantization_steps) / quantization_steps
    unique_colors, face_color_indices = np.unique(crushed_colors, axis=0, return_inverse=True)
    
    scene_out = trimesh.Scene()
    part_idx = 0
    
    for i, _ in enumerate(unique_colors):
        mask = (face_color_indices == i)
        # Use the actual average color of the faces in this segment for best accuracy
        color = face_colors[mask].mean(axis=0)
        
        sub_mesh = mesh.submesh([mask], append=True)
        r, g, b = np.clip(color * 255, 0, 255).astype(np.uint8)
        
        # Assign color-based material
        p_mat = material.PBRMaterial(
            baseColorFactor=[r, g, b, 255], 
            metallicFactor=0.0, 
            roughnessFactor=1.0,
            doubleSided=True  # Ensure both sides are visible in viewport
        )
        sub_mesh.visual = TextureVisuals(material=p_mat)
        scene_out.add_geometry(sub_mesh, geom_name=f"part_{part_idx}")
        part_idx += 1

    out_filename = f"studio_split_{uuid.uuid4().hex}.glb"
    out_path = os.path.join(folder_paths.get_temp_directory(), out_filename)
    scene_out.export(out_path)
    return out_path

async def split_mesh_api(request):
    try:
        data = await request.json()
        filename = data.get("filename")
        folder_type = data.get("type", "output")
        q_steps = data.get("quantization_steps", 6.0)

        if not filename:
            return web.json_response({"error": "No filename provided"}, status=400)

        # Resolve path
        path = filename
        if not os.path.isabs(path):
            candidates = [
                os.path.join(folder_paths.get_output_directory(), filename),
                os.path.join(folder_paths.get_temp_directory(), filename),
                os.path.join(folder_paths.get_input_directory(), filename)
            ]
            for c in candidates:
                if c and os.path.exists(c):
                    path = c
                    break

        if not os.path.exists(path):
            return web.json_response({"error": f"File not found: {path}"}, status=404)

        result_path = trimesh_texture_split(path, q_steps)
        res_filename = os.path.basename(result_path)
        
        return web.json_response({
            "filename": res_filename,
            "type": "temp",
            "full_path": result_path
        })
    except Exception as e:
        print(f"[Comfy3D] Split API Error: {e}")
        return web.json_response({"error": str(e)}, status=500)

async def join_mesh_api(request):
    try:
        import trimesh
        import uuid
        data = await request.json()
        entries = data.get("entries", []) # List of {filename: str, meshes: [str]}
        filenames = data.get("filenames", []) # Fallback for old style
        
        if not entries and not filenames:
            return web.json_response({"error": "No filenames provided for joining"}, status=400)

        # Normalize old filenames list to entries
        if not entries:
            entries = [{"filename": f} for f in filenames]

        all_geometries = []
        for entry in entries:
            filename = entry.get("filename")
            target_meshes = entry.get("meshes") # Optional list of names
            
            # Resolve path
            path = filename
            if not os.path.isabs(path):
                candidates = [
                    os.path.join(folder_paths.get_output_directory(), filename),
                    os.path.join(folder_paths.get_temp_directory(), filename),
                    os.path.join(folder_paths.get_input_directory(), filename)
                ]
                for c in candidates:
                    if c and os.path.exists(c):
                        path = c
                        break
            
            if os.path.exists(path):
                # Load current mesh
                scene = trimesh.load(path, force='scene')
                # If the file only has one mesh, and we specify target_meshes, 
                # it's very likely the user wants this mesh (e.g. previously merged mesh).
                nodes_with_geom = list(scene.graph.nodes_geometry)
                force_all = len(nodes_with_geom) == 1
                
                for node_name in nodes_with_geom:
                    match = target_meshes is None or (isinstance(target_meshes, list) and node_name in target_meshes)
                    if match or force_all:
                        # Get world transform and geometry name for this node from the graph tuple
                        transform, geom_name = scene.graph[node_name]
                        if geom_name in scene.geometry:
                            print(f"[Comfy3D Join] Adding transformed geometry: {node_name} (match={match}, force={force_all})")
                            geom = scene.geometry[geom_name].copy()
                            geom.apply_transform(transform)
                            all_geometries.append(geom)
                        else:
                            print(f"[Comfy3D Join] Geometry not found for node: {node_name}")
                    else:
                        print(f"[Comfy3D Join] Skipping node: {node_name} (no match in {target_meshes})")

        if not all_geometries:
            return web.json_response({"error": "No valid geometry found in provided files"}, status=400)

        # True Merge: Concatenate all geometries into a single mesh
        # Clean up geometries before concatenating
        proc_geoms = []
        for geom in all_geometries:
            try:
                geom.remove_unreferenced_vertices()
                if hasattr(geom, 'vertices') and np.isnan(geom.vertices).any():
                    valid_verts = ~np.isnan(geom.vertices).any(axis=1)
                    geom.update_vertices(valid_verts)
                geom.process(validate=True)
            except:
                pass
            proc_geoms.append(geom)

        merged_mesh = trimesh.util.concatenate(proc_geoms)
        
        out_filename = f"studio_merged_{uuid.uuid4().hex}.glb"
        out_path = os.path.join(folder_paths.get_temp_directory(), out_filename)
        merged_mesh.export(out_path)
        
        return web.json_response({
            "filename": out_filename,
            "type": "temp",
            "full_path": out_path
        })
    except Exception as e:
        print(f"[Comfy3D] Join API Error: {e}")
        return web.json_response({"error": str(e)}, status=500)

def setup_api():
    try:
        from server import PromptServer
        from aiohttp import web
        
        if hasattr(PromptServer, "instance") and PromptServer.instance.app is not None:
            print("[Comfy3D] Registering split_mesh API route...")
            # Use 'add_route' for maximum compatibility if 'add_post' is missing
            router = PromptServer.instance.app.router
            if hasattr(router, "add_post"):
                router.add_post("/comfy3d/split_mesh", split_mesh_api)
                router.add_post("/comfy3d/join_mesh", join_mesh_api)
            else:
                router.add_route("POST", "/comfy3d/split_mesh", split_mesh_api)
                router.add_route("POST", "/comfy3d/join_mesh", join_mesh_api)
            print("[Comfy3D] API route registered successfully.")
    except Exception as e:
        print(f"[Comfy3D] Failed to register API route: {e}")

setup_api()

class Comfy3DTextureSplitterNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "input_3d": ("*",),
                "quantization_steps": ("FLOAT", {"default": 16.0, "min": 0.1, "max": 64.0, "step": 0.1}),
            }
        }

    RETURN_TYPES = ("*",) 
    RETURN_NAMES = ("GLB_PATH",)
    FUNCTION = "split"
    CATEGORY = "3D-Studio"
    OUTPUT_NODE = True

    def split(self, input_3d, quantization_steps):
        if isinstance(input_3d, list) and len(input_3d) > 0:
            input_3d = input_3d[0]
        
        mesh_path = input_3d
        if isinstance(input_3d, dict):
            mesh_path = input_3d.get("mesh") or input_3d.get("glb_path")
            
        out_path = trimesh_texture_split(mesh_path, quantization_steps)
        return (out_path,)

NODE_CLASS_MAPPINGS = {
    "Comfy3D-Studio": Comfy3DStudioNode,
    "Comfy3DTextureSplitter": Comfy3DTextureSplitterNode
}
