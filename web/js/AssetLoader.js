/**
 * AssetLoader.js
 * Handles loading 3D assets (GLB/GLTF/OBJ/STL) from ComfyUI's /view API,
 * from ArrayBuffers (drag-and-drop), and from external paths delivered by
 * the onExecuted callback.
 *
 * Extracted verbatim from web/3d_viewport.js lines 3920–4096.
 */

export class AssetLoader {
    /**
     * @param {object} THREE
     * @param {object} deps
     */
    constructor(THREE, deps) {
        this.THREE = THREE;
        Object.assign(this, deps);

        if (deps.commandClasses) {
            this.AssetCommand = deps.commandClasses.AssetCommand;
        }

        this._bindDragDrop();
    }

    // -----------------------------------------------------------------------
    // _ensureValidMaterials
    // -----------------------------------------------------------------------
    _ensureValidMaterials(raw) {
        const THREE = this.THREE;
        raw.traverse(c => {
            if (c.isMesh) {
                if (c.geometry && !c.geometry.attributes.normal) {
                    c.geometry.computeVertexNormals();
                }
                const hasColors = c.geometry && !!c.geometry.attributes.color;
                if (!c.material || (Array.isArray(c.material) && c.material.length === 0)) {
                    c.material = new THREE.MeshPhongMaterial({ color: 0xcccccc, side: THREE.DoubleSide, vertexColors: hasColors });
                } else {
                    const mats = Array.isArray(c.material) ? c.material : [c.material];
                    mats.forEach(m => {
                        m.side = THREE.DoubleSide;
                        if (hasColors) m.vertexColors = true;
                    });
                }
            }
        });
    }
    // -----------------------------------------------------------------------
    // loadAssetSilent
    // -----------------------------------------------------------------------
    loadAssetSilent(filename, type = "output") {
        return new Promise((resolve, reject) => {
            const THREE = this.THREE;
            const ext = filename.split(".").pop().toLowerCase();
            let loader;
            if (ext === "glb" || ext === "gltf") loader = new THREE.GLTFLoader();
            else if (ext === "obj") loader = new THREE.OBJLoader();
            else if (ext === "stl") loader = new THREE.STLLoader();
            else return reject(new Error("Unsupported format: " + ext));

            const url = `/view?filename=${encodeURIComponent(filename)}&type=${type}`;
            loader.load(url, (result) => {
                let raw = result.scene || result;
                if (ext === "stl" && result.isBufferGeometry) {
                    raw = new THREE.Mesh(result, new THREE.MeshStandardMaterial({ color: 0xcccccc }));
                }

                this._ensureValidMaterials(raw);

                const meshes = [];
                raw.traverse(c => { if (c.isMesh) meshes.push(c); });

                if (meshes.length === 1) {
                    let model = meshes[0];
                    if (model.parent) model.removeFromParent();
                    model.name = filename;
                    model.userData.filename = filename;
                    model.userData.type = type;
                    model.traverse(m => this.shadingMgr.updateMeshShading(m));
                    resolve(model);
                } else {
                    raw.name = filename;
                    raw.userData.filename = filename;
                    raw.userData.type = type;
                    raw.traverse(m => this.shadingMgr.updateMeshShading(m));
                    resolve(raw);
                }
            }, undefined, (err) => reject(new Error("Load failed: " + err)));
        });
    }

    // -----------------------------------------------------------------------
    // addAsset
    // -----------------------------------------------------------------------
    addAsset(obj) {
        const cmd = new this.AssetCommand(obj, true, this.assets, this.scene);
        this.history.push(cmd);
        cmd.add();
        obj.traverse(m => this.shadingMgr.updateMeshShading(m));
        console.log("Comfy3D: Asset added via Command:", obj.name);
        this.selMgr.selectObject(obj);
        this.selMgr.updateOutliner?.();
    }

    // -----------------------------------------------------------------------
    // loadExternalAsset
    // -----------------------------------------------------------------------
    loadExternalAsset(path, type = "temp") {
        const THREE = this.THREE;
        const ext = path.split(".").pop().toLowerCase();
        let filename = path;
        let subfolder = "";

        if (path.includes("/") || path.includes("\\")) {
            const normalizedPath = path.replace(/\\/g, "/");
            const parts = normalizedPath.split("/");
            filename = parts.pop();

            const roots = ["output", "input", "temp"];
            let foundRoot = null;
            let foundIdx = -1;

            for (const root of roots) {
                const idx = parts.lastIndexOf(root);
                if (idx > foundIdx) { foundIdx = idx; foundRoot = root; }
            }

            if (foundRoot) {
                type = foundRoot;
                subfolder = parts.slice(foundIdx + 1).join("/");
            } else {
                // If it starts with /home or similar, it's an absolute path we failed to relativize
                if (parts.length > 1 && (parts[0] === "" || parts[1] === "home" || parts[1] === "mnt")) {
                    subfolder = ""; // Can't serve absolute paths via /view easily
                } else {
                    subfolder = parts.join("/");
                }
            }
        }

        // ComfyUI /view API format: /view?filename=NAME&subfolder=SUB&type=TYPE
        let url = `/view?filename=${encodeURIComponent(filename)}&type=${type}`;
        if (subfolder && subfolder !== "/") {
            url += `&subfolder=${encodeURIComponent(subfolder)}`;
        }

        let loader;
        if (ext === "glb" || ext === "gltf") loader = new THREE.GLTFLoader();
        else if (ext === "obj") loader = new THREE.OBJLoader();
        else if (ext === "stl") loader = new THREE.STLLoader();
        else return;

        console.log(`Comfy3D: Attempting load from ${type}: ${url}`);

        const onLoaded = (result) => {
            console.log(`Comfy3D: Successfully loaded asset from ${type}: ${path}`);
            let model = result.scene || result;
            if (ext === "stl" && result.isBufferGeometry) {
                model = new THREE.Mesh(result, new THREE.MeshStandardMaterial({ color: 0xcccccc }));
            }
            this._ensureValidMaterials(model);

            const fullRelativePath = (subfolder && subfolder !== "/") ? (subfolder.endsWith("/") ? subfolder + filename : subfolder + "/" + filename) : filename;
            
            model.name = filename;
            model.userData.filename = fullRelativePath;
            model.userData.type = type;
            this.addAsset(model);
            this.frameScene(model);
        };

        const onError = (error) => {
            console.error(`Comfy3D: Failed to load from ${type}:`, error);
            if (type === "temp") {
                console.log("Comfy3D: Retrying from 'output' folder...");
                this.loadExternalAsset(path, "output");
            }
        };

        loader.load(url, onLoaded, undefined, onError);
    }

    // -----------------------------------------------------------------------
    // Drag-and-drop handler
    // -----------------------------------------------------------------------
    _bindDragDrop() {
        const THREE = this.THREE;
        const container = this.container;

        container.addEventListener("dragover", e => {
            e.preventDefault();
            container.style.border = "2px dashed #00ff88";
        });
        container.addEventListener("dragleave", () => container.style.border = "none");
        container.addEventListener("drop", async e => {
            e.preventDefault();
            container.style.border = "none";
            const files = Array.from(e.dataTransfer.files);
            files.forEach((file, idx) => {
                const ext = file.name.split(".").pop().toLowerCase();
                if (!["glb", "gltf", "obj", "stl"].includes(ext)) return;

                const reader = new FileReader();
                reader.onload = async event => {
                    const buffer = event.target.result;
                    const onLoaded = (model) => {
                        model.name = file.name;
                        model.userData.filename = file.name;
                        model.userData.type = "temp";
                        this.addAsset(model);
                        if (files.length === 1 || idx === 0) this.frameScene(model);
                    };

                    if (ext === "glb" || ext === "gltf") {
                        const loader = new THREE.GLTFLoader();
                        loader.parse(buffer, "", gltf => onLoaded(gltf.scene));
                    } else if (ext === "obj") {
                        const loader = new THREE.OBJLoader();
                        const text = new TextDecoder().decode(buffer);
                        onLoaded(loader.parse(text));
                    } else if (ext === "stl") {
                        const loader = new THREE.STLLoader();
                        const geometry = loader.parse(buffer);
                        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xcccccc }));
                        onLoaded(mesh);
                    }
                };
                reader.readAsArrayBuffer(file);
            });
        });
    }
}
