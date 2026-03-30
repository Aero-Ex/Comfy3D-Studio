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
     * @param {object[]} deps.assets         - Shared live asset array.
     * @param {THREE.Scene} deps.scene
     * @param {SelectionManager} deps.selectionManager
     * @param {ShadingManager} deps.shadingManager
     * @param {CommandHistory} deps.history
     * @param {object} deps.commandClasses   - { AssetCommand }
     * @param {HTMLElement} deps.container   - Root container for drag-drop.
     * @param {Function} deps.toggleLoading
     * @param {Function} deps.frameScene
     * @param {Function} deps.triggerUpdate
     */
    constructor(THREE, { assets, scene, selectionManager, shadingManager, history, commandClasses, container, toggleLoading, frameScene, triggerUpdate }) {
        this.THREE = THREE;
        this.assets = assets;
        this.scene = scene;
        this.selMgr = selectionManager;
        this.shadingMgr = shadingManager;
        this.history = history;
        this.AssetCommand = commandClasses.AssetCommand;
        this.container = container;
        this.toggleLoading = toggleLoading;
        this.frameScene = frameScene;
        this.triggerUpdate = triggerUpdate;

        this._bindDragDrop();
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

                const meshes = [];
                raw.traverse(c => { if (c.isMesh) meshes.push(c); });

                if (meshes.length === 1) {
                    let model = meshes[0];
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
            let rootIdx = -1;
            let foundRoot = "";

            for (const root of roots) {
                const idx = parts.lastIndexOf(root);
                if (idx > rootIdx) { rootIdx = idx; foundRoot = root; }
            }

            if (rootIdx !== -1) {
                subfolder = parts.slice(rootIdx + 1).join("/");
                type = foundRoot;
            } else {
                subfolder = "";
            }
        }

        let url = `/api/view?filename=${encodeURIComponent(filename)}`;
        if (subfolder) url += `&subfolder=${encodeURIComponent(subfolder)}`;
        url += `&type=${type}`;

        let loader;
        if (ext === "glb" || ext === "gltf") loader = new THREE.GLTFLoader();
        else if (ext === "obj") loader = new THREE.OBJLoader();
        else if (ext === "stl") loader = new THREE.STLLoader();
        else return;

        console.log(`Comfy3D: Attempting load from ${type}:`, url);

        const onLoaded = (result) => {
            console.log(`Comfy3D: Successfully loaded asset from ${type}:`, path);
            let model = result.scene || result;
            if (ext === "stl" && result.isBufferGeometry) {
                model = new THREE.Mesh(result, new THREE.MeshStandardMaterial({ color: 0xcccccc }));
            }
            model.name = filename;
            model.userData.filename = filename;
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
