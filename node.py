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
                        out_dir = os.path.abspath(folder_paths.get_output_directory()).rstrip(os.path.sep)
                        tmp_dir = os.path.abspath(folder_paths.get_temp_directory()).rstrip(os.path.sep)
                        in_dir = os.path.abspath(folder_paths.get_input_directory()).rstrip(os.path.sep)
                        abs_input = os.path.abspath(input_3d)

                        if abs_input.startswith(out_dir):
                            input_3d = os.path.relpath(abs_input, out_dir)
                            folder_type = "output"
                        elif abs_input.startswith(tmp_dir):
                            input_3d = os.path.relpath(abs_input, tmp_dir)
                            folder_type = "temp"
                        elif abs_input.startswith(in_dir):
                            input_3d = os.path.relpath(abs_input, in_dir)
                            folder_type = "input"
                        else:
                            # Not in a standard root, keep as-is but hope for the best
                            input_3d = abs_input
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
    
    # --- Convert to HSV for meaningfull semantic color splitting ---
    r, g, b = face_colors[:, 0], face_colors[:, 1], face_colors[:, 2]
    maxc = np.maximum(np.maximum(r, g), b)
    minc = np.minimum(np.minimum(r, g), b)
    val = maxc
    deltac = maxc - minc
    
    sat = np.zeros_like(maxc)
    hue = np.zeros_like(maxc)
    
    idx = (maxc != 0)
    sat[idx] = deltac[idx] / maxc[idx]
    
    idx_d = (deltac != 0)
    
    idx_r = idx_d & (maxc == r)
    hue[idx_r] = (g[idx_r] - b[idx_r]) / deltac[idx_r]
    
    idx_g = idx_d & (maxc == g) & ~idx_r
    hue[idx_g] = (b[idx_g] - r[idx_g]) / deltac[idx_g] + 2.0
    
    idx_b = idx_d & (maxc == b) & ~idx_r & ~idx_g
    hue[idx_b] = (r[idx_b] - g[idx_b]) / deltac[idx_b] + 4.0
    
    hue = (hue / 6.0) % 1.0 
    
    # Pure grays are hue-agnostic, force to 0 so they don't fragment
    hue[sat < 0.15] = 0.0
    
    # Increase precision for hue vs brightness to snap to correct semantics
    # To prevent over-segmentation (e.g. wall splitting into 10 shading stripes), 
    # we prioritize Hue and heavily suppress S/V variance.
    h_steps = max(6.0, quantization_steps * 1.5)
    sv_steps = max(2.0, quantization_steps / 2.5)
    
    hq = np.round(hue * h_steps) / h_steps
    hq[hq == 1.0] = 0.0 # Red hue wraps natively
    sq = np.round(sat * sv_steps) / sv_steps
    vq = np.round(val * sv_steps) / sv_steps
    
    crushed_colors = np.column_stack((hq, sq, vq))
    unique_colors, face_color_indices = np.unique(crushed_colors, axis=0, return_inverse=True)
    
    try:
        import collections
        adjacency = mesh.face_adjacency
        
        # Build quick adjacency dict
        adj_dict = {}
        for f1, f2 in adjacency:
            if f1 not in adj_dict:
                adj_dict[f1] = []
            if f2 not in adj_dict:
                adj_dict[f2] = []
            adj_dict[f1].append(int(f2))
            adj_dict[f2].append(int(f1))
            
        # Run 2 iterations of majority voting
        for _ in range(2):
            new_indices = face_color_indices.copy()
            for face_idx in range(len(face_color_indices)):
                neighbors = adj_dict.get(face_idx, [])
                if len(neighbors) < 2:
                    continue
                neighbor_labels = [face_color_indices[n] for n in neighbors]
                count = collections.Counter(neighbor_labels)
                most_common, freq = count.most_common(1)[0]
                
                # If 2 or more neighbors share a different label, adopt their label
                if most_common != face_color_indices[face_idx] and freq >= 2:
                    new_indices[face_idx] = most_common
            face_color_indices = new_indices
            
    except Exception as e:
        print(f"[Comfy3D] Failed to smooth texture labels: {e}")
        
    scene_out = trimesh.Scene()
    part_idx = 0
    
    for i, _ in enumerate(unique_colors):
        mask = (face_color_indices == i)
        
        sub_mesh = mesh.submesh([mask], append=True)
        
        try:
            sub_mesh.remove_unreferenced_vertices()
        except:
            pass
        
        # Keep the original material and UV mapping instead of replacing it with a flat color
        if hasattr(sub_mesh, 'visual') and hasattr(sub_mesh.visual, 'material'):
            sub_mesh.visual.material = mat
            
        scene_out.add_geometry(sub_mesh, geom_name=f"part_{part_idx}")
        part_idx += 1

    out_filename = f"studio_split_{uuid.uuid4().hex}.glb"
    out_path = os.path.join(folder_paths.get_temp_directory(), out_filename)
    scene_out.export(out_path)
    return out_path

def resolve_mesh_path(filename):
    import os
    import glob
    import folder_paths
    
    path = filename
    if os.path.exists(path):
        return path
        
    candidates = [
        os.path.join(folder_paths.get_output_directory(), filename),
        os.path.join(folder_paths.get_temp_directory(), filename),
        os.path.join(folder_paths.get_input_directory(), filename)
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
            
    if not os.path.exists(path):
        import glob
        print(f"[Comfy3D] Exact path not found for {filename}, performing deep search...")
        search_dirs = [folder_paths.get_output_directory(), folder_paths.get_temp_directory(), folder_paths.get_input_directory()]
        for d in search_dirs:
            if not d: continue
            # Search recursively for the filename
            search_pattern = os.path.join(d, "**", os.path.basename(filename))
            matches = glob.glob(search_pattern, recursive=True)
            if matches:
                path = matches[0]
                print(f"[Comfy3D] Deep search found: {path}")
                return path
            
    return path

async def split_selection_api(request):
    try:
        import trimesh
        import numpy as np
        data = await request.json()
        filename = data.get("filename")
        face_indices = data.get("face_indices") # List[int]
        vertex_indices = data.get("vertex_indices") # List[int]
        
        if not filename:
            return web.json_response({"error": "No filename provided"}, status=400)
            
        # Resolve path
        path = resolve_mesh_path(filename)
        
        if not os.path.exists(path):
            return web.json_response({"error": f"File not found: {path}"}, status=404)
            
        # Load mesh
        scene = trimesh.load(path, force='scene')
        geom_names = list(scene.geometry.keys())
        if not geom_names:
            return web.json_response({"error": "No geometry in file"}, status=400)
        
        # We only support splitting the first geometry in the file for now
        g_name = geom_names[0]
        mesh = scene.geometry[g_name]
        
        # 1. Determine mask
        mask = np.zeros(len(mesh.faces), dtype=bool)
        if face_indices:
            mask[face_indices] = True
        elif vertex_indices:
            # Faces that contain ANY of these vertices
            v_set = set(vertex_indices)
            for i, face in enumerate(mesh.faces):
                if any(v in v_set for v in face):
                    mask[i] = True
        
        if not mask.any():
            return web.json_response({"error": "No faces selected for split"}, status=400)
            
        # 2. Extract split mesh
        split_mesh = mesh.submesh([mask], append=True)
        
        # 3. Create original-minus-selection mesh
        original_reduced = mesh.submesh([~mask], append=True)
        
        # Force opaque materials so Three.js doesn't render them invisible
        for m_name, m in [("split", split_mesh), ("reduced", original_reduced)]:
            # Strip unreferenced vertices so the bounding box/pivot correctly shrinks to the new isolated piece!
            try:
                m.remove_unreferenced_vertices()
            except Exception as e:
                print(f"[Comfy3D] Failed to remove unreferenced vertices for {m_name}: {e}")

            if hasattr(m, 'visual'):
                if hasattr(m.visual, 'material') and hasattr(m.visual.material, 'baseColorFactor'):
                    orig_color = m.visual.material.baseColorFactor
                    print(f"[Comfy3D] {m_name} original color: {orig_color}")
                    if m.visual.material.baseColorFactor is None:
                        m.visual.material.baseColorFactor = [200, 200, 200, 255]
                        print(f"[Comfy3D] -> Fixed: None -> [200, 200, 200, 255]")
                    elif len(m.visual.material.baseColorFactor) == 4:
                        if m.visual.material.baseColorFactor[3] < 255:
                            m.visual.material.baseColorFactor[3] = 255
                            print(f"[Comfy3D] -> Fixed: {orig_color} -> {m.visual.material.baseColorFactor}")
                elif hasattr(m.visual, 'vertex_colors') and m.visual.vertex_colors is not None and len(m.visual.vertex_colors) > 0:
                    print(f"[Comfy3D] {m_name} fixing vertex colors alpha...")
                    m.visual.vertex_colors[:, 3] = 255

        # 4. Export both
        out1_filename = f"studio_reduced_{uuid.uuid4().hex}.glb"
        out2_filename = f"studio_selection_{uuid.uuid4().hex}.glb"
        out1_path = os.path.join(folder_paths.get_temp_directory(), out1_filename)
        out2_path = os.path.join(folder_paths.get_temp_directory(), out2_filename)
        
        original_reduced.export(out1_path)
        split_mesh.export(out2_path)
        
        return web.json_response({
            "reduced": {"filename": out1_filename, "type": "temp"},
            "selection": {"filename": out2_filename, "type": "temp"}
        })
    except Exception as e:
        print(f"[Comfy3D] Split Selection Error: {e}")
        return web.json_response({"error": str(e)}, status=500)

async def split_mesh_api(request):
    try:
        data = await request.json()
        filename = data.get("filename")
        folder_type = data.get("type", "output")
        q_steps = data.get("quantization_steps", 6.0)

        if not filename:
            return web.json_response({"error": "No filename provided"}, status=400)

        # Resolve path
        path = resolve_mesh_path(filename)

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
            path = resolve_mesh_path(filename)
            
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
        
        # Force opaque materials so Three.js doesn't render it invisible
        if hasattr(merged_mesh, 'visual'):
            if hasattr(merged_mesh.visual, 'material') and hasattr(merged_mesh.visual.material, 'baseColorFactor'):
                if merged_mesh.visual.material.baseColorFactor is None:
                    merged_mesh.visual.material.baseColorFactor = [200, 200, 200, 255]
                elif len(merged_mesh.visual.material.baseColorFactor) == 4:
                    merged_mesh.visual.material.baseColorFactor[3] = 255
            elif hasattr(merged_mesh.visual, 'vertex_colors') and merged_mesh.visual.vertex_colors is not None and len(merged_mesh.visual.vertex_colors) > 0:
                merged_mesh.visual.vertex_colors[:, 3] = 255

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
                router.add_post("/comfy3d/split_selection", split_selection_api)
                router.add_post("/comfy3d/join_mesh", join_mesh_api)
            else:
                router.add_route("POST", "/comfy3d/split_mesh", split_mesh_api)
                router.add_route("POST", "/comfy3d/split_selection", split_selection_api)
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
