/**
 * SegmentationPanel.js
 * Floating segmentation/split panel: BY MATERIAL split, JOIN SELECTED merge,
 * quantization slider, and EXIT button.
 *
 * Extracted verbatim from web/3d_viewport.js lines 725–912.
 */

export class SegmentationPanel {
    /**
     * @param {object} deps
     * @param {HTMLElement} deps.canvasArea
     * @param {object} deps.viewport
     * @param {object[]} deps.assets
     * @param {THREE.Scene} deps.scene
     * @param {SelectionManager} deps.selectionManager
     * @param {CommandHistory} deps.history
     * @param {object} deps.commandClasses          - { SeparateMeshCommand }
     * @param {AssetLoader} deps.assetLoader        - provides loadAssetSilent(), addAsset()
     * @param {ShadingManager} deps.shadingManager
     * @param {Function} deps.toggleLoading
     * @param {Function} deps.frameScene
     * @param {Function} deps.toggleIsolate
     * @param {Function} deps.getIsolatedObjects
     * @param {Function} deps.triggerUpdate
     * @param {Function} deps.updateOutliner
     */
    constructor(deps) {
        this.canvasArea = deps.canvasArea;
        this.viewport = deps.viewport;
        this.assets = deps.assets;
        this.scene = deps.scene;
        this.selMgr = deps.selectionManager;
        this.history = deps.history;
        this.SeparateMeshCommand = deps.commandClasses.SeparateMeshCommand;
        this.assetLoader = deps.assetLoader;
        this.shadingMgr = deps.shadingManager;
        this.toggleLoading = deps.toggleLoading;
        this.frameScene = deps.frameScene;
        this.toggleIsolate = deps.toggleIsolate;
        this.getIsolatedObjects = deps.getIsolatedObjects;
        this.triggerUpdate = deps.triggerUpdate;
        this.updateOutliner = deps.updateOutliner;

        this._buildDOM();
    }

    _buildDOM() {
        this.panel = document.createElement("div");
        Object.assign(this.panel.style, {
            position: "absolute", bottom: "72px", left: "50%",
            transform: "translateX(-50%) translateY(20px)", display: "none", gap: "24px",
            padding: "12px 24px", backgroundColor: "rgba(18, 18, 18, 0.7)",
            backdropFilter: "blur(18px)", borderRadius: "14px",
            border: "1px solid rgba(255,255,255,0.08)", zIndex: "110",
            alignItems: "center", color: "white", fontSize: "11px",
            boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
            transition: "all 0.3s cubic-bezier(0.23, 1, 0.32, 1)",
            opacity: "0", pointerEvents: "none"
        });
        this.panel.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:6px;">
                <div style="opacity:0.4; font-size:8px; font-weight:700; letter-spacing:0.1em; color:white; margin-bottom:2px;">MATERIAL SPLIT</div>
                <div style="display:flex; align-items:center; gap:12px;">
                     <input type="range" class="comfy3d-brush-slider" id="seg-quant-slider" min="1.0" max="64.0" step="1.0" value="16.0" style="width:100px;">
                     <button class="comfy3d-segmentation-btn-primary" id="seg-mat-btn" style="padding:4px 12px; border-radius:6px; border:none; background:#ff9500; color:white; font-size:10px; cursor:pointer; font-weight:700; letter-spacing:0.05em;">BY MATERIAL</button>
                </div>
            </div>
            <div style="width:1px; height:24px; background:rgba(255,255,255,0.1);"></div>
            <div style="display:flex; flex-direction:column; gap:6px; align-items:center;">
                <div style="opacity:0.4; font-size:8px; font-weight:700; letter-spacing:0.1em; color:white; margin-bottom:2px;">MERGE</div>
                <button class="comfy3d-segmentation-btn-secondary" id="seg-join-btn" style="padding:4px 12px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:none; color:white; font-size:10px; cursor:pointer; font-weight:700; letter-spacing:0.05em;">JOIN SELECTED</button>
            </div>
            <div style="width:1px; height:24px; background:rgba(255,255,255,0.1);"></div>
            <button class="comfy3d-segmentation-btn-secondary" id="seg-cancel-btn" style="padding:4px 8px; border-radius:6px; border:none; background:none; color:rgba(255,255,255,0.4); font-size:10px; cursor:pointer; font-weight:700;">EXIT</button>
        `;
        this.canvasArea.appendChild(this.panel);

        const quantSlider = this.panel.querySelector("#seg-quant-slider");
        quantSlider.addEventListener("input", e => {
            this.viewport.segmentationMode.quantization = parseFloat(e.target.value);
        });

        this.panel.querySelector("#seg-cancel-btn").addEventListener("click", () => this.toggle(false));
        this.panel.querySelector("#seg-mat-btn").addEventListener("click", () => {
            if (this.selMgr.selectedObjects.length === 0) return alert("Select a mesh first.");
            this.separateMesh({ quantization: this.viewport.segmentationMode.quantization });
        });
        this.panel.querySelector("#seg-join-btn").addEventListener("click", () => this.joinSelectedMeshes());
    }

    // -----------------------------------------------------------------------
    // toggle
    // -----------------------------------------------------------------------
    toggle(active) {
        const vp = this.viewport;
        vp.segmentationMode.active = (active !== undefined ? active : !vp.segmentationMode.active);
        if (vp.segmentationMode.active) {
            vp.brushActive = false;
            vp.pointSelection.active = false;

            if (!this.getIsolatedObjects() && this.selMgr.selectedObjects.length > 0) {
                this.toggleIsolate();
                this.frameScene(this.selMgr.selectedObjects);
            }

            Object.assign(this.panel.style, {
                display: "flex", opacity: "1", transform: "translateX(-50%) translateY(0)", pointerEvents: "auto"
            });
        } else {
            Object.assign(this.panel.style, {
                opacity: "0", transform: "translateX(-50%) translateY(20px)", pointerEvents: "none"
            });
            setTimeout(() => { if (!this.viewport.segmentationMode.active) this.panel.style.display = "none"; }, 300);
        }
        if (this._updateToolbar) this._updateToolbar();
    }

    // -----------------------------------------------------------------------
    // joinSelectedMeshes
    // -----------------------------------------------------------------------
    async joinSelectedMeshes() {
        const selectedObjects = this.selMgr.selectedObjects;
        const entriesMap = new Map();
        const meshes = selectedObjects.filter(o => o.isMesh);

        selectedObjects.forEach(obj => {
            let current = obj;
            let filename = null;
            while (current) {
                if (current.userData && current.userData.filename) {
                    filename = current.userData.filename; break;
                }
                current = current.parent;
            }
            if (filename) {
                if (!entriesMap.has(filename)) entriesMap.set(filename, new Set());
                if (obj.isMesh) entriesMap.get(filename).add(obj.name);
            }
        });

        if (meshes.length < 2 && entriesMap.size < 2) {
            alert("Select at least 2 distinct meshes or objects to join.");
            return;
        }

        const entries = Array.from(entriesMap.entries()).map(([filename, meshSet]) => ({
            filename, meshes: meshSet.size > 0 ? Array.from(meshSet) : null
        }));
        if (entries.length === 0) {
            alert("Selected objects must have associated files to join.");
            return;
        }

        const objectsToRemove = [];
        selectedObjects.forEach(obj => {
            if (obj.isMesh) objectsToRemove.push(obj);
            else if (this.assets.includes(obj)) objectsToRemove.push(obj);
        });

        try {
            this.toggleLoading(true);
            const resp = await fetch("/comfy3d/join_mesh", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ entries })
            });
            const result = await resp.json();
            if (result.error) throw new Error(result.error);

            const model = await this.assetLoader.loadAssetSilent(result.filename, result.type);

            let finalObject = model;
            if (model.isGroup && model.children.length === 1 && model.children[0].isMesh) {
                finalObject = model.children[0];
                finalObject.userData.filename = model.userData.filename;
                finalObject.userData.type = model.userData.type;
            }

            const activeObj = selectedObjects[selectedObjects.length - 1] || selectedObjects[0];
            if (activeObj) {
                finalObject.name = activeObj.name + "_Merged";
                const parent = activeObj.parent || this.scene;
                parent.add(finalObject);
            } else {
                finalObject.name = "Merged_Mesh";
                this.scene.add(finalObject);
            }

            const cmd = new this.SeparateMeshCommand(objectsToRemove, [finalObject], this.assets, this.scene);
            cmd.redo();
            this.history.push(cmd);

            this.selMgr.selectedObjects = [finalObject];
            this.updateOutliner();
            this.frameScene(finalObject);
            console.log("Comfy3D: Merged into " + result.filename);
        } catch (e) {
            console.error("Comfy3D: Join Failed:", e);
            alert("Join error: " + e.message);
        } finally {
            this.toggleLoading(false);
        }
    }

    // -----------------------------------------------------------------------
    // separateMesh
    // -----------------------------------------------------------------------
    async separateMesh(options = { quantization: 6.0 }) {
        const selectedObjects = this.selMgr.selectedObjects;
        const targets = selectedObjects.filter(o => o.isMesh || (o.children && o.children.some(c => c.isMesh)));
        if (targets.length === 0) {
            console.warn("Comfy3D: No meshes selected for separation.");
            return;
        }

        const btn = this._toolbar?.toolbarBtns?.["split"];
        if (btn) {
            btn.style.backgroundColor = "rgba(0, 255, 128, 0.3)";
            btn.style.boxShadow = "0 0 15px rgba(0, 255, 128, 0.2)";
        }

        try {
            this.toggleLoading(true);
            const originalRoots = [];
            const newModels = [];

            for (const target of targets) {
                let root = target;
                while (root.parent && !this.assets.includes(root)) root = root.parent;
                if (!originalRoots.includes(root)) originalRoots.push(root);

                const filename = root.userData.filename;
                const folderType = root.userData.type || "output";
                if (!filename) continue;

                console.log(`Comfy3D: Splitting ${filename} via backend...`);
                const response = await fetch("/comfy3d/split_mesh", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ filename, type: folderType, quantization_steps: options.quantization })
                });
                const result = await response.json();
                if (result.error) throw new Error(result.error);

                const model = await this.assetLoader.loadAssetSilent(result.filename, result.type);
                model.name = filename.split("/").pop().replace(".glb", "_Split");
                model.userData.filename = result.filename;
                model.userData.type = result.type;
                model.traverse(c => {
                    if (c.isMesh) {
                        this.shadingMgr.updateMeshShading(c);
                        c.userData.filename = result.filename;
                        c.userData.type = result.type;
                    }
                });
                newModels.push(model);
            }

            if (newModels.length > 0) {
                const cmd = new this.SeparateMeshCommand(originalRoots, newModels, this.assets, this.scene);
                cmd.redo();
                this.history.push(cmd);
                this.selMgr.selectedObjects = [...newModels];
                this.updateOutliner();
                this.frameScene(newModels[0]);
            }
        } catch (e) {
            console.error("Comfy3D: Separation failed:", e);
            alert("Separation Failed: " + e.message);
        } finally {
            this.toggleLoading(false);
            if (btn) { btn.style.backgroundColor = "transparent"; btn.style.boxShadow = "none"; }
        }
    }

    /** inject toolbar ref so separateMesh can highlight the split button */
    setToolbar(toolbar) {
        this._toolbar = toolbar;
    }

    /** inject updateToolbar callback for toggle() */
    setUpdateToolbarCallback(fn) {
        this._updateToolbar = fn;
    }
}
