/**
 * ViewportNode.js
 * Main ComfyUI node orchestrator for Comfy3D-Studio.
 * Wires all 12 modules together and registers the ComfyUI extension.
 *
 * This file replaces the guts of web/3d_viewport.js.
 * The new entry point (3d_viewport.js shim) will import and call registerViewportNode().
 */

import { loadThreeJS } from "./ThreeLoader.js";
import { CommandHistory, MultiTransformCommand, SubMeshTransformCommand } from "./CommandHistory.js";
import { SceneSetup } from "./SceneSetup.js";
import { ShadingManager } from "./ShadingManager.js";
import { SelectionManager } from "./SelectionManager.js";
import { TransformManager } from "./TransformManager.js";
import { Outliner } from "./Outliner.js";
import { Toolbar } from "./Toolbar.js";
import { BrushPanel } from "./BrushPanel.js";
import { SegmentationPanel } from "./SegmentationPanel.js";
import { AssetLoader } from "./AssetLoader.js";
import { InputHandler } from "./InputHandler.js";

// ─────────────────────────────────────────────────────────────────────────────
// Command classes that depend on shared mutable state.
// These are defined here (inline in the orchestrator) because they close over
// selectedObjects / isolatedObjects references that are managed by the managers.
// ─────────────────────────────────────────────────────────────────────────────

function makeCommandClasses({ assets, scene, selMgr, getIsolatedObjects }) {
    class AssetCommand {
        constructor(obj, isAdd, assetsArr, sceneObj) {
            this.obj = obj; this.isAdd = isAdd; this.assetsArr = assetsArr;
            this.scene = sceneObj; this.parent = obj.parent || sceneObj;
        }
        undo() { this.isAdd ? this.remove() : this.add(); selMgr.updateOutliner?.(); }
        redo() { this.isAdd ? this.add() : this.remove(); selMgr.updateOutliner?.(); }
        add() { if (!this.assetsArr.includes(this.obj)) this.assetsArr.push(this.obj); this.parent.add(this.obj); }
        remove() {
            const idx = this.assetsArr.indexOf(this.obj);
            if (idx > -1) this.assetsArr.splice(idx, 1);
            this.obj.parent?.remove(this.obj);
            selMgr.updateOutliner?.();
        }
    }

    class RenameCommand {
        constructor(obj, oldName, newName) { this.obj = obj; this.oldName = oldName; this.newName = newName; }
        undo() { this.obj.name = this.oldName; selMgr.updateOutliner?.(); }
        redo() { this.obj.name = this.newName; selMgr.updateOutliner?.(); }
    }

    class MultiAssetCommand {
        constructor(objs, isAdd, assetsArr, sceneObj) {
            this.cmds = objs.map(obj => new AssetCommand(obj, isAdd, assetsArr, sceneObj));
        }
        undo() { this.cmds.forEach(c => c.undo()); }
        redo() { this.cmds.forEach(c => c.redo()); }
        add() { this.cmds.forEach(c => c.add()); }
        remove() { this.cmds.forEach(c => c.remove()); }
    }

    class SeparateMeshCommand {
        constructor(originalMeshes, newMeshes, assetsArr, sceneObj) {
            this.originalsCmd = new MultiAssetCommand(originalMeshes, false, assetsArr, sceneObj);
            this.newMeshesCmd = new MultiAssetCommand(newMeshes, true, assetsArr, sceneObj);
            this.oldSelection = [...selMgr.selectedObjects];
            this.newSelection = [...newMeshes];
        }
        undo() {
            this.newMeshesCmd.undo(); this.originalsCmd.undo();
            const iso = getIsolatedObjects();
            if (iso) {
                this.newMeshesCmd.cmds.forEach(c => iso.delete(c.obj));
                this.originalsCmd.cmds.forEach(c => iso.set(c.obj, true));
            }
            selMgr.selectedObjects = [...this.oldSelection];
            selMgr.updateOutliner?.();
        }
        redo() {
            this.originalsCmd.redo(); this.newMeshesCmd.redo();
            const iso = getIsolatedObjects();
            if (iso) {
                this.originalsCmd.cmds.forEach(c => iso.set(c.obj, false));
                this.newMeshesCmd.cmds.forEach(c => iso.set(c.obj, true));
            }
            selMgr.selectedObjects = [...this.newSelection];
            selMgr.updateOutliner?.();
        }
    }

    class SubMeshSelectionCommand {
        constructor(mesh, oldSub, newSub) {
            this.mesh = mesh;
            const toArr = s => s ? Array.from(s) : [];
            this.old = { v: toArr(oldSub.vertices), e: toArr(oldSub.edges), f: toArr(oldSub.faces) };
            this.new = { v: toArr(newSub.vertices), e: toArr(newSub.edges), f: toArr(newSub.faces) };
        }
        _apply(d) {
            const viewport = selMgr._viewport;
            if (!viewport) return;
            viewport.selectedSubElements.set(this.mesh.uuid, {
                vertices: new Set(d.v), edges: new Set(d.e), faces: new Set(d.f)
            });
            selMgr.updateSubMeshHighlights();
        }
        undo() { this._apply(this.old); }
        redo() { this._apply(this.new); }
    }

    return { AssetCommand, RenameCommand, MultiAssetCommand, SeparateMeshCommand, SubMeshSelectionCommand, MultiTransformCommand };
}

// ─────────────────────────────────────────────────────────────────────────────
// registerViewportNode — call this once from the entry shim
// ─────────────────────────────────────────────────────────────────────────────
export async function registerViewportNode(app, THREE) {
    app.registerExtension({
        name: "Comfy3D.Viewport",
        async beforeRegisterNodeDef(nodeType, nodeData, app) {
            if (nodeData.name !== "Comfy3D-Studio") return;

            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = async function () {
                onNodeCreated?.apply(this, arguments);

                // ── Viewport state object (mirrors original `viewport`) ──────────
                const viewport = this;
                viewport.brushSize = 30;
                viewport.brushHardness = 0.5;
                viewport.brushValue = 1.0;
                viewport.brushColor = "#ffffff";
                viewport.brushChannel = "color";
                viewport.brushTriPlanar = false;
                viewport.brushActive = false;
                viewport.selectionMode = "object";
                viewport.pointSelection = { active: false, points: [] };
                viewport.segmentationMode = { active: false, quantization: 16 };
                viewport.selectedSubElements = new Map();
                viewport.raycaster = null;
                viewport.modalTransform = {
                    active: false, mode: null, axis: null, isSubMesh: false,
                    mouseStart: null, centerScreen: null, center: null,
                    startStates: [], subTransformData: new Map()
                };

                // ── Assets and history ─────────────────────────────────────────
                const assets = [];
                const history = new CommandHistory();

                // ── DOM Layout ────────────────────────────────────────────────
                const container = document.createElement("div");
                container.className = "comfy3d-studio-viewport";
                Object.assign(container.style, {
                    flex: "1", width: "100%", height: "100%",
                    maxHeight: "calc(100% - 10px)", background: "#0a0a0a",
                    position: "relative", display: "flex", flexDirection: "column",
                    overflow: "hidden", pointerEvents: "auto", zIndex: 1000
                });

                const domWidget = this.addDOMWidget("threejs_studio", "viewport", container);
                domWidget.y = 0;
                this.size = [1200, 720];
                domWidget.computeSize = (width) => [width, Math.max(300, Math.floor(this.size[1] - 80))];

                const canvasArea = document.createElement("div");
                Object.assign(canvasArea.style, {
                    flex: "1", position: "relative", pointerEvents: "auto",
                    margin: "0", padding: "0", overflow: "hidden"
                });
                container.appendChild(canvasArea);

                // ── Scene Setup ───────────────────────────────────────────────
                const sceneSetup = new SceneSetup(THREE, canvasArea);
                const {
                    renderer, gizmoRenderer, camera, scene, selectionProxy, pointsGroup,
                    xAxis, gizmoScene, gizmoCamera, gizmoGroup, selectionRect, brushCursor,
                    selectionHelper, vertexHighlight, edgeHighlight, persistentVertexPoints,
                    persistentWireframe, faceHighlight
                } = sceneSetup;

                viewport.transform = sceneSetup.transform;

                // ── Shared helpers ─────────────────────────────────────────────
                let needsUpdate = false;
                const triggerUpdate = () => { needsUpdate = true; };
                sceneSetup.orbit.addEventListener("change", triggerUpdate);

                let loadingOverlay = null;
                const toggleLoading = (on) => {
                    if (on && !loadingOverlay) {
                        loadingOverlay = document.createElement("div");
                        Object.assign(loadingOverlay.style, {
                            position: "absolute", inset: "0", display: "flex",
                            alignItems: "center", justifyContent: "center",
                            backgroundColor: "rgba(0,0,0,0.4)", zIndex: "200",
                            color: "white", fontSize: "14px", fontFamily: "system-ui"
                        });
                        loadingOverlay.textContent = "Loading...";
                        canvasArea.appendChild(loadingOverlay);
                    } else if (!on && loadingOverlay) {
                        loadingOverlay.remove(); loadingOverlay = null;
                    }
                };

                let isolatedObjects = null;
                const getIsolatedObjects = () => isolatedObjects;
                const toggleIsolate = () => {
                    const selMgr = selectionManager;
                    if (isolatedObjects) {
                        isolatedObjects.forEach((visible, obj) => { if (obj) obj.visible = visible; });
                        isolatedObjects = null;
                    } else if (selMgr.selectedObjects.length > 0) {
                        isolatedObjects = new Map();
                        const selectedMeshes = new Set();
                        selMgr.selectedObjects.forEach(obj => { if (obj) obj.traverse(c => selectedMeshes.add(c)); });
                        scene.traverse(obj => {
                            if (obj === scene || obj === camera || obj.isLight || obj.isTransformControls ||
                                obj.type === "BoxHelper" || obj.type === "GridHelper" || obj.name === "SelectionProxy") return;
                            if (obj.isMesh || obj.isGroup) {
                                isolatedObjects.set(obj, obj.visible);
                                let isParent = false;
                                selMgr.selectedObjects.forEach(sel => {
                                    let p = sel;
                                    while (p) { if (p === obj) isParent = true; p = p.parent; }
                                });
                                if (!selectedMeshes.has(obj) && !isParent) obj.visible = false;
                            }
                        });
                    }
                    triggerUpdate();
                    selectionManager.updateOutliner?.();
                };

                const frameScene = (objects = assets) => {
                    const box = new THREE.Box3();
                    let hasTargets = false;
                    const targets = Array.isArray(objects) ? objects : [objects];
                    targets.forEach(obj => {
                        if (obj) {
                            obj.updateMatrixWorld(true);
                            obj.traverse(c => {
                                if (c.isMesh) {
                                    if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
                                    const b = c.geometry.boundingBox.clone().applyMatrix4(c.matrixWorld);
                                    box.union(b); hasTargets = true;
                                }
                            });
                            if (!hasTargets) { box.expandByObject(obj); hasTargets = true; }
                        }
                    });
                    if (!hasTargets || box.isEmpty()) return;
                    const center = box.getCenter(new THREE.Vector3());
                    const size = box.getSize(new THREE.Vector3());
                    const maxDim = Math.max(size.x, size.y, size.z) || 1;
                    const fov = camera.fov * (Math.PI / 180);
                    let cameraDist = (maxDim / 2) / Math.tan(fov / 2) * 1.4;
                    let direction = new THREE.Vector3().subVectors(camera.position, sceneSetup.orbit.target).normalize();
                    if (direction.length() < 0.1) direction.set(1, 1, 1).normalize();
                    const targetPos = center.clone().add(direction.multiplyScalar(cameraDist));
                    const startPos = camera.position.clone(), startTarget = sceneSetup.orbit.target.clone();
                    const startTime = performance.now(), duration = 400;
                    const animateFocus = (time) => {
                        const t = Math.min((time - startTime) / duration, 1);
                        const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
                        camera.position.lerpVectors(startPos, targetPos, ease);
                        sceneSetup.orbit.target.lerpVectors(startTarget, center, ease);
                        camera.lookAt(sceneSetup.orbit.target);
                        sceneSetup.orbit.update(); triggerUpdate();
                        if (t < 1) requestAnimationFrame(animateFocus);
                    };
                    requestAnimationFrame(animateFocus);
                };

                const updateHUD = (msg) => {
                    let hud = canvasArea.querySelector(".comfy3d-hud");
                    if (!hud) {
                        hud = document.createElement("div");
                        hud.className = "comfy3d-hud";
                        Object.assign(hud.style, {
                            position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
                            color: "white", fontSize: "22px", fontWeight: "700", pointerEvents: "none",
                            textShadow: "0 2px 8px rgba(0,0,0,0.8)", zIndex: "200",
                            fontFamily: "system-ui, sans-serif"
                        });
                        canvasArea.appendChild(hud);
                    }
                    hud.textContent = msg;
                };

                const addVXZPoint = (intersect) => {
                    const obj = intersect.object;
                    const worldPoint = intersect.point.clone();
                    const localPoint = worldPoint.clone();
                    obj.worldToLocal(localPoint);
                    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
                    const bbox = obj.geometry.boundingBox;
                    const size = bbox.getSize(new THREE.Vector3());
                    const min = bbox.min;
                    const vxz = [
                        Math.max(0, Math.min(511, Math.round(((localPoint.x - min.x) / size.x) * 511))),
                        Math.max(0, Math.min(511, Math.round(((localPoint.y - min.y) / size.y) * 511))),
                        Math.max(0, Math.min(511, Math.round(((localPoint.z - min.z) / size.z) * 511)))
                    ];
                    viewport.pointSelection.points.push({ world: worldPoint, vxz, mesh: obj });
                    if (viewport.pointSelection.points.length > 20) viewport.pointSelection.points.shift();
                    updateSelectionPointsUI();
                    triggerUpdate();
                };

                const removeVXZPoint = (sphere) => {
                    const index = pointsGroup.children.indexOf(sphere);
                    if (index !== -1) {
                        viewport.pointSelection.points.splice(index, 1);
                        updateSelectionPointsUI(); triggerUpdate();
                    }
                };

                const updateSelectionPointsUI = () => {
                    while (pointsGroup.children.length > 0) pointsGroup.remove(pointsGroup.children[0]);
                    viewport.pointSelection.points.forEach(p => {
                        const sphere = new THREE.Mesh(
                            new THREE.SphereGeometry(0.04, 24, 24),
                            new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 2.0, transparent: true, opacity: 0.8 })
                        );
                        sphere.position.copy(p.world);
                        pointsGroup.add(sphere);
                    });
                    const pointsStr = viewport.pointSelection.points.map(p => p.vxz.join(",")).join(";");
                    const widget = viewport.widgets?.find(w => w.name === "vxz_points");
                    if (widget) { widget.value = pointsStr; if (widget.callback) widget.callback(widget.value); }
                    else { viewport.vxz_points = pointsStr; }
                };

                // ── Transform event listeners ────────────────────────────────
                const initialStates = new Map();
                let initialProxyMatrixInverse = new THREE.Matrix4();

                viewport.transform.addEventListener("mouseDown", () => {
                    if (selectionManager.selectedObjects.length > 0) {
                        selectionProxy.updateMatrixWorld(true);
                        initialProxyMatrixInverse.copy(selectionProxy.matrixWorld).invert();
                        initialStates.clear();
                        selectionManager.selectedObjects.forEach(obj => {
                            obj.updateMatrixWorld(true);
                            initialStates.set(obj, { matrix: obj.matrixWorld.clone(), p: obj.position.clone(), q: obj.quaternion.clone(), s: obj.scale.clone() });
                        });
                    }
                });

                viewport.transform.addEventListener("change", () => {
                    if (viewport.transform.dragging && selectionManager.selectedObjects.length > 0) {
                        selectionProxy.updateMatrixWorld(true);
                        const deltaMatrix = selectionProxy.matrixWorld.clone().multiply(initialProxyMatrixInverse);
                        selectionManager.selectedObjects.forEach(obj => {
                            const initial = initialStates.get(obj);
                            if (initial) {
                                const newWorldMatrix = deltaMatrix.clone().multiply(initial.matrix);
                                if (obj.parent) {
                                    const parentInverse = new THREE.Matrix4().copy(obj.parent.matrixWorld).invert();
                                    parentInverse.multiply(newWorldMatrix).decompose(obj.position, obj.quaternion, obj.scale);
                                } else {
                                    newWorldMatrix.decompose(obj.position, obj.quaternion, obj.scale);
                                }
                                obj.updateMatrixWorld(true);
                            }
                        });
                    }
                    triggerUpdate();
                });

                viewport.transform.addEventListener("mouseUp", () => {
                    if (selectionManager.selectedObjects.length > 0 && initialStates.size > 0) {
                        const finalStates = new Map();
                        let changed = false;
                        selectionManager.selectedObjects.forEach(obj => {
                            const initial = initialStates.get(obj);
                            if (initial) {
                                if (initial.p.distanceTo(obj.position) > 0.0001 ||
                                    initial.q.angleTo(obj.quaternion) > 0.0001 ||
                                    initial.s.distanceTo(obj.scale) > 0.0001) changed = true;
                                finalStates.set(obj, { p: obj.position.clone(), q: obj.quaternion.clone(), s: obj.scale.clone() });
                            }
                        });
                        if (changed && !viewport.modalTransform.active) {
                            history.push(transformManager.makeMultiTransformCommand(selectionManager.selectedObjects, initialStates, finalStates));
                        }
                    }
                    initialStates.clear();
                });

                viewport.transform.addEventListener("dragging-changed", e => {
                    sceneSetup.orbit.enabled = !e.value;
                });

                // ── Shared Deps (passed to every manager) ────────────────────
                const sharedDeps = {
                    THREE, scene, camera, renderer, viewport, assets, history,
                    orbit: sceneSetup.orbit,
                    container: canvasArea,
                    // SceneSetup objects
                    selectionProxy: sceneSetup.selectionProxy,
                    selectionHelper: sceneSetup.selectionHelper,
                    vertexHighlight: sceneSetup.vertexHighlight,
                    edgeHighlight: sceneSetup.edgeHighlight,
                    faceHighlight: sceneSetup.faceHighlight,
                    persistentVertexPoints: sceneSetup.persistentVertexPoints,
                    persistentWireframe: sceneSetup.persistentWireframe,
                    gizmoGroup: sceneSetup.gizmoGroup,
                    gizmoRenderer: sceneSetup.gizmoRenderer,
                    gizmoCamera: sceneSetup.gizmoCamera,
                    gizmoScene: sceneSetup.gizmoScene,
                    loadingOverlay: sceneSetup.loadingOverlay,
                    // Shared helpers
                    triggerUpdate, updateHUD, frameScene, toggleIsolate, getIsolatedObjects,
                    toggleLoading, pointsGroup, selectionRect, brushCursor,
                    updateSelectionPointsUI: null, addVXZPoint, removeVXZPoint,
                    selectionManager: null, // to be patched
                    selMgr: null,           // to be patched
                    commandClasses: null    // to be patched
                };
                // Circular: updateSelectionPointsUI is defined above sharedDeps, patch it in
                sharedDeps.updateSelectionPointsUI = updateSelectionPointsUI;

                // ── Manager Instantiation ────────────────────────────────────
                const selectionManager = new SelectionManager(THREE, sharedDeps);
                const commandClasses = makeCommandClasses({ assets, scene, selMgr: selectionManager, getIsolatedObjects });
                
                sharedDeps.selectionManager = selectionManager;
                sharedDeps.selMgr = selectionManager;
                sharedDeps.commandClasses = commandClasses;

                const transformManager = new TransformManager(THREE, sharedDeps);
                selectionManager.setTransformManager(transformManager);
                sharedDeps.transformManager = transformManager;

                const shadingManager = new ShadingManager(THREE, sharedDeps);
                sharedDeps.shadingManager = shadingManager;
                sharedDeps.shadingMgr = shadingManager;

                const assetLoader = new AssetLoader(THREE, sharedDeps);
                sharedDeps.assetLoader = assetLoader;

                const outliner = new Outliner(THREE, sharedDeps);
                const updateOutliner = () => outliner.update();
                sharedDeps.updateOutliner = updateOutliner;
                selectionManager._expandedObjects = outliner.expandedObjects;

                const brushPanel = new BrushPanel(THREE, sharedDeps);
                const segPanel = new SegmentationPanel(THREE, sharedDeps);

                const toolbar = new Toolbar(THREE, {
                    ...sharedDeps, outliner, brushPanel,
                    toggleSegmentationMode: () => segPanel.toggle()
                });

                // ── Wire cross-module callbacks ───────────────────────────────
                selectionManager.setUICallbacks({
                    updateOutliner: updateOutliner,
                    updateOutlinerSelection: () => outliner.updateSelection?.(),
                    updateSelectionUI: () => toolbar.updateSelectionUI?.(),
                    updateToolbar: () => toolbar.updateToolbar()
                });
                selectionManager.updateOutliner = updateOutliner;

                // ── Wire TransformManager command classes ─────────────────────
                transformManager.setCommandClasses(commandClasses.MultiTransformCommand);
                transformManager.setSubMeshTransformCommand(SubMeshTransformCommand);

                const inputHandler = new InputHandler(THREE, {
                    ...sharedDeps, selectionManager, transformManager, shadingManager,
                    toolbar, outliner, segPanel,
                    toggleSegmentationMode: () => segPanel.toggle()
                });
                inputHandler.setShadingManager?.(shadingManager);
                inputHandler.setUpdateOutlinerCallback?.(() => outliner.update());
                inputHandler.setSegmentationPanel?.(segPanel);

                // ── Resize Observer ───────────────────────────────────────────
                let lastW = 0, lastH = 0;
                const resize = () => {
                    const w = Math.floor(canvasArea.clientWidth);
                    const h = Math.floor(canvasArea.clientHeight);
                    if (Math.abs(w - lastW) < 2 && Math.abs(h - lastH) < 2) return;
                    if (w > 0 && h > 0) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); triggerUpdate(); lastW = w; lastH = h; }
                };
                let resizeObserver;
                setTimeout(() => { resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvasArea); resize(); }, 1000);

                // ── Render Loop ───────────────────────────────────────────────
                let lastBase64Update = 0, wasUpdating = false;
                const animate = (time) => {
                    requestAnimationFrame(animate);
                    const changed = sceneSetup.orbit.update();
                    if (changed) needsUpdate = true;
                    if (needsUpdate) {
                        renderer.render(scene, camera);
                        gizmoGroup.quaternion.copy(camera.quaternion).invert();
                        gizmoRenderer.render(gizmoScene, gizmoCamera);
                        needsUpdate = false; wasUpdating = true;
                    } else if (wasUpdating && performance.now() - lastBase64Update > 2000) {
                        const data = renderer.domElement.toDataURL("image/jpeg", 0.85);
                        const widget = viewport.widgets?.find(w => w.name === "base64_image");
                        if (widget) widget.value = data; else viewport.base64_image = data;
                        lastBase64Update = performance.now(); wasUpdating = false;
                    }
                };
                animate();

                // Initial UI sync
                toolbar.updateSelectionUI();
                toolbar.updateShadingUI();
                toolbar.updateToolbar();
                outliner.update();
                selectionManager.updateSelectionHelper?.();
                triggerUpdate();

                // ── Cleanup ────────────────────────────────────────────────────
                viewport.onRemoved = () => {
                    inputHandler.dispose();
                    if (resizeObserver) resizeObserver.disconnect();
                    if (viewport.transform) viewport.transform.dispose();
                    if (renderer) renderer.dispose();
                    if (gizmoRenderer) gizmoRenderer.dispose();
                };

                // ── loadExternalAsset (called by onExecuted) ──────────────────
                viewport.loadExternalAsset = (path, type) => assetLoader.loadExternalAsset(path, type);
            };

            // ── onExecuted hook ────────────────────────────────────────────
            const onExecuted = nodeType.prototype.onExecuted;
            nodeType.prototype.onExecuted = function (message) {
                onExecuted?.apply(this, arguments);
                console.log("Comfy3D: onExecuted received message:", message);
                if (message?.mesh_path) {
                    const mesh_info = message.mesh_path[0];
                    let path, type;
                    if (typeof mesh_info === "string") { path = mesh_info; type = "temp"; }
                    else { path = mesh_info.filename; type = mesh_info.type; }
                    console.log(`Comfy3D: Target mesh: ${path} (type: ${type})`);
                    if (this.last_imported_mesh === path) { console.log("Comfy3D: Path unchanged, skipping."); return; }
                    this.last_imported_mesh = path;
                    if (!this.loadExternalAsset) {
                        console.warn("Comfy3D: loadExternalAsset not ready yet, retrying in 1s...");
                        setTimeout(() => this.loadExternalAsset?.(path, type), 1000);
                    } else { this.loadExternalAsset(path, type); }
                }
            };
        }
    });
}
