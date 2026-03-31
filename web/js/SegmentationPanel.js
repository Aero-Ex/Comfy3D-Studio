/**
 * SegmentationPanel.js
 * Floating segmentation/split panel: BY MATERIAL split, JOIN SELECTED merge,
 * quantization slider, and EXIT button.
 */

export class SegmentationPanel {
    /**
     * @param {object} THREE
     * @param {object} deps
     */
    constructor(THREE, deps) {
        this.THREE = THREE;
        Object.assign(this, deps);
        this.canvasArea = deps.container;
        this.scene = deps.scene;
        this.history = deps.history;
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
            transform: "translateX(-50%) translateY(20px)", display: "none", gap: "28px",
            padding: "16px 28px", backgroundColor: "rgba(18, 18, 18, 0.8)",
            backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
            borderRadius: "16px", border: "1px solid rgba(255,255,255,0.06)",
            zIndex: "110", alignItems: "center", color: "white",
            fontFamily: "system-ui, -apple-system, sans-serif",
            boxShadow: "0 12px 48px rgba(0,0,0,0.65)",
            transition: "all 0.4s cubic-bezier(0.23, 1, 0.32, 1)",
            opacity: "0", pointerEvents: "none"
        });
        this.panel.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:8px;">
                <div style="opacity:0.35; font-size:9px; font-weight:700; letter-spacing:0.12em; color:white; margin-bottom:2px; text-transform:uppercase;">MATERIAL SPLIT</div>
                <div style="display:flex; align-items:center; gap:14px;">
                     <input type="range" class="comfy3d-brush-slider" id="seg-quant-slider" min="1.0" max="64.0" step="1.0" value="16.0" style="width:110px;">
                     <button class="comfy3d-segmentation-btn-primary" id="seg-mat-btn" style="padding:6px 14px; border-radius:8px; border:none; background:#ff9500; color:white; font-size:11px; cursor:pointer; font-weight:700; letter-spacing:0.04em; transition:transform 0.1s;">BY MATERIAL</button>
                </div>
            </div>
            <div style="width:1px; height:28px; background:rgba(255,255,255,0.06);"></div>
            <div style="display:flex; flex-direction:column; gap:8px; align-items:center;">
                <div style="opacity:0.35; font-size:9px; font-weight:700; letter-spacing:0.12em; color:white; margin-bottom:2px; text-transform:uppercase;">MERGE</div>
                <button class="comfy3d-segmentation-btn-secondary" id="seg-join-btn" style="padding:6px 14px; border-radius:8px; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.03); color:white; font-size:11px; cursor:pointer; font-weight:700; letter-spacing:0.04em; transition:all 0.2s;">JOIN SELECTED</button>
            </div>
            <div style="width:1px; height:28px; background:rgba(255,255,255,0.06);"></div>
            <button class="comfy3d-segmentation-btn-secondary" id="seg-cancel-btn" style="padding:6px 10px; border-radius:8px; border:none; background:none; color:rgba(255,255,255,0.3); font-size:11px; cursor:pointer; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; transition:color 0.2s;">EXIT</button>
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
        const meshes = selectedObjects.filter(o => o.isMesh && o.visible !== false);

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

            const cmd = new this.commandClasses.SeparateMeshCommand(objectsToRemove, [finalObject], this.assets, this.scene);
            cmd.redo();
            this.history.push(cmd);

            this.selMgr.selectedObjects = [finalObject];
            this.updateOutliner?.();
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
        const targets = selectedObjects.filter(o => ((o.isMesh || (o.children && o.children.some(c => c.isMesh))) && o.visible !== false));
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
                
                model.position.copy(root.position);
                model.quaternion.copy(root.quaternion);
                model.scale.copy(root.scale);
                model.updateMatrixWorld(true);
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
                const cmd = new this.commandClasses.SeparateMeshCommand(originalRoots, newModels, this.assets, this.scene);
                cmd.redo();
                this.history.push(cmd);
                this.selMgr.selectedObjects = [...newModels];
                this.updateOutliner?.();
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

    // -----------------------------------------------------------------------
    // splitBySelection
    // -----------------------------------------------------------------------
    async splitBySelection() {
        const activeMesh = this.selMgr.getActiveMesh();
        if (!activeMesh) return alert("Select a mesh first.");

        const sub = this.viewport.selectedSubElements.get(activeMesh.uuid);
        if (!sub || (sub.vertices.size === 0 && sub.faces.size === 0)) {
            return alert("Select some vertices or faces to split first (use keys 1 or 3).");
        }

        let root = activeMesh;
        while (root.parent && !this.assets.includes(root)) root = root.parent;
        const filename = root.userData.filename;
        const folderType = root.userData.type || "output";
        if (!filename) return alert("Selected mesh has no associated file.");

        try {
            this.toggleLoading(true);
            console.log(`Comfy3D: Splitting selection from ${filename}...`);

            const payload = {
                filename,
                type: folderType,
                face_indices: sub.faces.size > 0 ? Array.from(sub.faces) : null,
                vertex_indices: sub.vertices.size > 0 ? Array.from(sub.vertices) : null
            };

            const response = await fetch("/comfy3d/split_selection", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (result.error) throw new Error(result.error);

            // Load both results
            const reducedModel = await this.assetLoader.loadAssetSilent(result.reduced.filename, result.reduced.type);
            const selectionModel = await this.assetLoader.loadAssetSilent(result.selection.filename, result.selection.type);

            reducedModel.name = activeMesh.name + "_Base";
            selectionModel.name = activeMesh.name + "_Part";

            reducedModel.position.copy(root.position);
            reducedModel.quaternion.copy(root.quaternion);
            reducedModel.scale.copy(root.scale);
            reducedModel.updateMatrixWorld(true);

            selectionModel.position.copy(root.position);
            selectionModel.quaternion.copy(root.quaternion);
            selectionModel.scale.copy(root.scale);
            selectionModel.updateMatrixWorld(true);

            // Re-apply shading
            reducedModel.traverse(c => { if (c.isMesh) this.shadingMgr.updateMeshShading(c); });
            selectionModel.traverse(c => { if (c.isMesh) this.shadingMgr.updateMeshShading(c); });

            const cmd = new this.commandClasses.SeparateMeshCommand([root], [reducedModel, selectionModel], this.assets, this.scene);
            cmd.redo();
            this.history.push(cmd);

            this.selMgr.selectedObjects = [selectionModel];
            this.viewport.selectedSubElements.delete(activeMesh.uuid);
            this.updateOutliner?.();
            this.frameScene(selectionModel);

        } catch (e) {
            console.error("Comfy3D: Split selection failed:", e);
            alert("Split Selection Failed: " + e.message);
        } finally {
            this.toggleLoading(false);
        }
    }
}
