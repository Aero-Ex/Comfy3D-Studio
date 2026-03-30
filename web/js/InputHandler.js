/**
 * InputHandler.js
 * Manages all mouse and keyboard events: single-click pick, box selection,
 * sub-mesh selection, modal transform live update, brush cursor preview,
 * OrbitControls synchronization, and keyboard shortcuts.
 *
 */

export class InputHandler {
    /**
     * @param {object} THREE
     * @param {object} deps
     * @param {THREE.WebGLRenderer} deps.renderer
     * @param {THREE.Camera} deps.camera
     * @param {THREE.OrbitControls} deps.orbit
     * @param {THREE.Scene} deps.scene
     * @param {object[]} deps.assets
     * @param {object} deps.viewport               - ComfyUI node instance.
     * @param {SelectionManager} deps.selectionManager
     * @param {TransformManager} deps.transformManager
     * @param {CommandHistory} deps.history
     * @param {object} deps.commandClasses          - { SubMeshSelectionCommand, MultiAssetCommand }
     * @param {THREE.Group} deps.pointsGroup
     * @param {HTMLElement} deps.container
     * @param {HTMLElement} deps.selectionRect      - orange dashed selection box DOM element
     * @param {HTMLElement} deps.brushCursor        - brush preview cursor DOM element
     * @param {Function} deps.frameScene
     * @param {Function} deps.toggleIsolate
     * @param {Function} deps.getIsolatedObjects
     * @param {Function} deps.updateSelectionPointsUI
     * @param {Function} deps.addVXZPoint
     * @param {Function} deps.removeVXZPoint
     * @param {Function} deps.toggleSegmentationMode
     * @param {Toolbar} deps.toolbar
     * @param {Function} deps.triggerUpdate
     * @param {Function} deps.updateHUD
     */
    constructor(THREE, deps) {
        this.THREE = THREE;
        Object.assign(this, deps);

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.selectionStartLocal = new THREE.Vector2();
        this.selectionStartScreen = new THREE.Vector2();
        this.mouseDownOnCanvas = false;
        this.mouseInCanvas = false;
        this.isSelecting = false;

        // Expose mouse ref to TransformManager for modal start
        this.transformManager.setMouseRef(this.mouse);

        this._bindEvents();
    }

    // -----------------------------------------------------------------------
    // Utility helpers (forwarded from managers)
    // -----------------------------------------------------------------------
    _getPickableAssets() { return this.selectionManager.getPickableAssets(); }
    _getActiveMesh() { return this.selectionManager.getActiveMesh(); }

    // -----------------------------------------------------------------------
    // handleGlobalMouseDown 
    // -----------------------------------------------------------------------
    _handleGlobalMouseDown(e) {
        const vp = this.viewport;
        const isNavigating = e.altKey || (e.button === 1);

        if (vp.modalTransform.active) {
            if (e.button === 0) { this.transformManager.confirmModalTransform(); e.preventDefault(); e.stopPropagation(); }
            else if (e.button === 2) { this.transformManager.cancelModalTransform(); e.preventDefault(); e.stopPropagation(); }
            return;
        }

        if (vp.pointSelection.active && !isNavigating) {
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            this.raycaster.setFromCamera(this.mouse, this.camera);

            if (e.button === 0) {
                const intersects = this.raycaster.intersectObjects(this._getPickableAssets(), true);
                if (intersects.length > 0) { this.addVXZPoint(intersects[0]); this.mouseDownOnCanvas = false; e.preventDefault(); e.stopPropagation(); return; }
            } else if (e.button === 2) {
                const intersects = this.raycaster.intersectObjects(this.pointsGroup.children, true);
                if (intersects.length > 0) { this.removeVXZPoint(intersects[0].object); this.mouseDownOnCanvas = false; e.preventDefault(); e.stopPropagation(); return; }
            }
        }

        if (e.target !== this.renderer.domElement) { this.mouseDownOnCanvas = false; return; }

        if (vp.brushActive) {
            this.orbit.enabled = isNavigating;
            if (!isNavigating && e.button === 0) e.preventDefault();
        } else {
            const isGizmoHover = vp.transform && (vp.transform.axis || vp.transform.dragging);
            this.orbit.enabled = (!e.shiftKey && !isGizmoHover) || e.altKey || (e.button === 1);
        }

        this.mouseDownOnCanvas = true;
        const mRect = this.renderer.domElement.getBoundingClientRect();
        const mScaleX = mRect.width / (this.renderer.domElement.clientWidth || 1);
        const mScaleY = mRect.height / (this.renderer.domElement.clientHeight || 1);
        this.selectionStartScreen.set(e.clientX, e.clientY);
        this.selectionStartLocal.set((e.clientX - mRect.left) / (mScaleX || 1), (e.clientY - mRect.top) / (mScaleY || 1));
        vp._strokeFrameLog = 0;
        vp._hitLogCount = 0;
    }

    // -----------------------------------------------------------------------
    // handleGlobalMouseUp
    // -----------------------------------------------------------------------
    _handleGlobalMouseUp(e) {
        const vp = this.viewport;
        const selMgr = this.selectionManager;
        const THREE = this.THREE;

        if (vp.modalTransform.active) return;
        if (!this.mouseDownOnCanvas) return;

        if (vp.brushActive) { this.mouseDownOnCanvas = false; return; }

        const rect = this.renderer.domElement.getBoundingClientRect();
        const scaleX = rect.width / this.renderer.domElement.clientWidth;
        const scaleY = rect.height / this.renderer.domElement.clientHeight;
        const currentX = (e.clientX - rect.left) / scaleX;
        const currentY = (e.clientY - rect.top) / scaleY;

        if (this.isSelecting) {
            // --- Box Selection ---
            this.isSelecting = false;
            this.selectionRect.style.display = "none";
            this.orbit.enabled = true;

            const startX = this.selectionStartLocal.x, startY = this.selectionStartLocal.y;
            const left = Math.min(startX, currentX), top = Math.min(startY, currentY);
            const right = Math.max(startX, currentX), bottom = Math.max(startY, currentY);

            const selectedInBox = [];
            const tempV3 = new THREE.Vector3();
            const tempBox = new THREE.Box3();
            const pickable = this._getPickableAssets();

            if (vp.selectionMode !== "object") {
                const activeMesh = this._getActiveMesh();
                if (activeMesh) {
                    const sub = vp.selectedSubElements.get(activeMesh.uuid) || { vertices: new Set(), edges: new Set(), faces: new Set() };
                    const oldSub = { vertices: new Set(sub.vertices), edges: new Set(sub.edges), faces: new Set(sub.faces) };
                    if (!e.shiftKey) { sub.vertices.clear(); sub.edges.clear(); sub.faces.clear(); }

                    const geom = activeMesh.geometry;
                    const pos = geom.attributes.position;
                    const rawPos = pos.array;
                    const worldMatrix = activeMesh.matrixWorld;
                    const camPos = this.camera.position.clone();
                    const normalMatrix = new THREE.Matrix3().getNormalMatrix(worldMatrix);
                    const mvp = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).multiply(worldMatrix);
                    const canvasW = this.renderer.domElement.clientWidth;
                    const canvasH = this.renderer.domElement.clientHeight;

                    // Cache projected vertex coords
                    const vProjCache = new Float32Array(pos.count * 2);
                    const me = mvp.elements;
                    for (let i = 0; i < pos.count; i++) {
                        const o = i * 3;
                        const x = rawPos[o], y = rawPos[o + 1], z = rawPos[o + 2];
                        const w = 1 / (me[3] * x + me[7] * y + me[11] * z + me[15]);
                        vProjCache[i * 2] = ((me[0] * x + me[4] * y + me[8] * z + me[12]) * w + 1) * canvasW / 2;
                        vProjCache[i * 2 + 1] = (-(me[1] * x + me[5] * y + me[9] * z + me[13]) * w + 1) * canvasH / 2;
                    }

                    const vWorld = new THREE.Vector3(), vNormal = new THREE.Vector3(), vToCam = new THREE.Vector3(), vLocal = new THREE.Vector3();
                    const occlusionHits = [];
                    const xrayMode = this._shadingManager?.xrayMode;

                    this.raycaster.firstHitOnly = true;
                    if (!activeMesh.geometry.computeBoundsTree && window.__computeBoundsTree) activeMesh.geometry.computeBoundsTree = window.__computeBoundsTree;
                    if (!activeMesh.geometry.boundsTree && activeMesh.geometry.computeBoundsTree) activeMesh.geometry.computeBoundsTree();
                    if (activeMesh.raycast !== window.__acceleratorRaycast && window.__acceleratorRaycast) activeMesh.raycast = window.__acceleratorRaycast;

                    if (vp.selectionMode === "vertex") {
                        const normals = geom.attributes.normal;
                        const rawNormals = normals ? normals.array : null;
                        const useOcclusion = !xrayMode && pos.count < 150000;
                        for (let i = 0; i < pos.count; i++) {
                            const sx = vProjCache[i * 2], sy = vProjCache[i * 2 + 1];
                            if (sx >= left && sx <= right && sy >= top && sy <= bottom) {
                                const o = i * 3;
                                if (!xrayMode && rawNormals) {
                                    vNormal.set(rawNormals[o], rawNormals[o + 1], rawNormals[o + 2]).applyMatrix3(normalMatrix).normalize();
                                    vWorld.set(rawPos[o], rawPos[o + 1], rawPos[o + 2]).applyMatrix4(worldMatrix);
                                    vToCam.copy(camPos).sub(vWorld).normalize();
                                    if (vNormal.dot(vToCam) < -0.1) continue;
                                }
                                if (useOcclusion) {
                                    vWorld.set(rawPos[o], rawPos[o + 1], rawPos[o + 2]).applyMatrix4(worldMatrix);
                                    vToCam.copy(vWorld).sub(camPos).normalize();
                                    this.raycaster.set(camPos, vToCam);
                                    occlusionHits.length = 0;
                                    try { activeMesh.raycast(this.raycaster, occlusionHits); }
                                    catch (_) { if (window.__origMeshRaycast) window.__origMeshRaycast.call(activeMesh, this.raycaster, occlusionHits); }
                                    if (occlusionHits.length > 0 && occlusionHits[0].distance < camPos.distanceTo(vWorld) - 0.01) continue;
                                }
                                sub.vertices.add(i);
                            }
                        }
                    } else if (vp.selectionMode === "face") {
                        const idxArray = geom.index ? geom.index.array : null;
                        const faceCount = geom.index ? geom.index.count / 3 : pos.count / 3;
                        const useOcclusion = !xrayMode && faceCount < 100000;
                        const fNormal = new THREE.Vector3(), va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
                        for (let i = 0; i < faceCount; i++) {
                            const i1 = idxArray ? idxArray[i * 3] : i * 3;
                            const i2 = idxArray ? idxArray[i * 3 + 1] : i * 3 + 1;
                            const i3 = idxArray ? idxArray[i * 3 + 2] : i * 3 + 2;
                            const sx = (vProjCache[i1 * 2] + vProjCache[i2 * 2] + vProjCache[i3 * 2]) / 3;
                            const sy = (vProjCache[i1 * 2 + 1] + vProjCache[i2 * 2 + 1] + vProjCache[i3 * 2 + 1]) / 3;
                            if (sx >= left && sx <= right && sy >= top && sy <= bottom) {
                                const o1 = i1 * 3, o2 = i2 * 3, o3 = i3 * 3;
                                if (!xrayMode) {
                                    va.set(rawPos[o1], rawPos[o1 + 1], rawPos[o1 + 2]);
                                    vb.set(rawPos[o2], rawPos[o2 + 1], rawPos[o2 + 2]);
                                    vc.set(rawPos[o3], rawPos[o3 + 1], rawPos[o3 + 2]);
                                    fNormal.subVectors(vb, va).cross(vToCam.subVectors(vc, va)).normalize();
                                    fNormal.applyMatrix4(worldMatrix).normalize();
                                    vLocal.copy(va).add(vb).add(vc).divideScalar(3);
                                    vWorld.copy(vLocal).applyMatrix4(worldMatrix);
                                    vToCam.copy(camPos).sub(vWorld).normalize();
                                    if (fNormal.dot(vToCam) < -0.1) continue;
                                }
                                if (useOcclusion) {
                                    va.set(rawPos[o1], rawPos[o1 + 1], rawPos[o1 + 2]);
                                    vb.set(rawPos[o2], rawPos[o2 + 1], rawPos[o2 + 2]);
                                    vc.set(rawPos[o3], rawPos[o3 + 1], rawPos[o3 + 2]);
                                    vLocal.copy(va).add(vb).add(vc).divideScalar(3);
                                    vWorld.copy(vLocal).applyMatrix4(worldMatrix);
                                    vToCam.copy(vWorld).sub(camPos).normalize();
                                    this.raycaster.set(camPos, vToCam);
                                    occlusionHits.length = 0;
                                    try { activeMesh.raycast(this.raycaster, occlusionHits); }
                                    catch (_) { if (window.__origMeshRaycast) window.__origMeshRaycast.call(activeMesh, this.raycaster, occlusionHits); }
                                    if (occlusionHits.length > 0 && occlusionHits[0].distance < camPos.distanceTo(vWorld) - 0.01) continue;
                                }
                                sub.faces.add(i);
                            }
                        }
                    } else if (vp.selectionMode === "edge") {
                        const idxArray = geom.index ? geom.index.array : null;
                        const triangleCount = geom.index ? geom.index.count / 3 : pos.count / 3;
                        const processedEdges = new Set();
                        const checkEdge = (a, b) => {
                            const min = a < b ? a : b, max = a < b ? b : a;
                            const key = min * 10000000 + max;
                            if (processedEdges.has(key)) return;
                            processedEdges.add(key);
                            if ((vProjCache[a * 2] >= left && vProjCache[a * 2] <= right && vProjCache[a * 2 + 1] >= top && vProjCache[a * 2 + 1] <= bottom) ||
                                (vProjCache[b * 2] >= left && vProjCache[b * 2] <= right && vProjCache[b * 2 + 1] >= top && vProjCache[b * 2 + 1] <= bottom)) {
                                if (!xrayMode) {
                                    const oa = a * 3, ob = b * 3;
                                    vNormal.set(rawPos[oa], rawPos[oa + 1], rawPos[oa + 2]).add(vLocal.set(rawPos[ob], rawPos[ob + 1], rawPos[ob + 2])).multiplyScalar(0.5);
                                    vNormal.applyMatrix3(normalMatrix).normalize();
                                    vWorld.set(rawPos[oa], rawPos[oa + 1], rawPos[oa + 2]).applyMatrix4(worldMatrix);
                                    vToCam.copy(camPos).sub(vWorld).normalize();
                                    if (vNormal.dot(vToCam) < -0.1) return;
                                    vWorld.set(rawPos[oa], rawPos[oa + 1], rawPos[oa + 2]).add(vLocal.set(rawPos[ob], rawPos[ob + 1], rawPos[ob + 2])).multiplyScalar(0.5).applyMatrix4(worldMatrix);
                                    vToCam.copy(vWorld).sub(camPos).normalize();
                                    this.raycaster.set(camPos, vToCam);
                                    occlusionHits.length = 0;
                                    try { activeMesh.raycast(this.raycaster, occlusionHits); }
                                    catch (_) { if (window.__origMeshRaycast) window.__origMeshRaycast.call(activeMesh, this.raycaster, occlusionHits); }
                                    if (occlusionHits.length > 0 && occlusionHits[0].distance < camPos.distanceTo(vWorld) - 0.01) return;
                                }
                                sub.edges.add(key);
                            }
                        };
                        for (let i = 0; i < triangleCount; i++) {
                            const i1 = idxArray ? idxArray[i * 3] : i * 3;
                            const i2 = idxArray ? idxArray[i * 3 + 1] : i * 3 + 1;
                            const i3 = idxArray ? idxArray[i * 3 + 2] : i * 3 + 2;
                            checkEdge(i1, i2); checkEdge(i2, i3); checkEdge(i3, i1);
                        }
                    }

                    vp.selectedSubElements.set(activeMesh.uuid, sub);
                    this.history.push(new this.commandClasses.SubMeshSelectionCommand(activeMesh, oldSub, sub));
                    selMgr.updateSubMeshHighlights();
                }
            } else {
                // Object-mode box select
                for (const asset of pickable) {
                    tempBox.setFromObject(asset);
                    tempBox.getCenter(tempV3);
                    tempV3.project(this.camera);
                    const screenX = (tempV3.x + 1) * this.renderer.domElement.clientWidth / 2;
                    const screenY = (-tempV3.y + 1) * this.renderer.domElement.clientHeight / 2;
                    if (screenX >= left && screenX <= right && screenY >= top && screenY <= bottom) {
                        const xrayMode = this._shadingManager?.xrayMode;
                        if (xrayMode) { selectedInBox.push(asset); }
                        else {
                            this.raycaster.setFromCamera(new THREE.Vector2(tempV3.x, tempV3.y), this.camera);
                            const hits = this.raycaster.intersectObjects(pickable, true);
                            if (hits.length > 0) {
                                let hitRoot = hits[0].object;
                                while (hitRoot.parent && !this.assets.includes(hitRoot)) hitRoot = hitRoot.parent;
                                if (hitRoot === asset) selectedInBox.push(asset);
                            }
                        }
                    }
                }
                if (selectedInBox.length > 0) {
                    if (e.shiftKey) { selectedInBox.forEach(a => { if (!selMgr.selectedObjects.includes(a)) selMgr.selectedObjects.push(a); }); }
                    else { selMgr.selectedObjects = selectedInBox; }
                    selMgr.selectObject(null, null, 2);
                } else if (!e.shiftKey) {
                    selMgr.deselectObject();
                }
            }
        } else {
            // --- Single Click Pick ---
            if (vp.transform && vp.transform.dragging) { this.mouseDownOnCanvas = false; return; }

            this.mouse.x = (currentX / this.renderer.domElement.clientWidth) * 2 - 1;
            this.mouse.y = -(currentY / this.renderer.domElement.clientHeight) * 2 + 1;
            this.raycaster.setFromCamera(this.mouse, this.camera);
            const pickable = this._getPickableAssets();
            const intersectsAsset = this.raycaster.intersectObjects(pickable, true);

            if (intersectsAsset.length > 0) {
                const hit = intersectsAsset[0];
                let leaf = hit.object;
                let root = leaf;
                while (root.parent && !this.assets.includes(root)) root = root.parent;

                if (this.assets.includes(root)) {
                    if (vp.selectionMode === "object") {
                        let target = root.userData.isChunked ? root : (leaf.isMesh ? leaf : root);
                        selMgr.selectObject(target, hit.point, e.shiftKey ? 1 : 0);
                    } else if (leaf.isMesh) {
                        const mesh = leaf;
                        if (!selMgr.selectedObjects.includes(mesh)) selMgr.selectObject(mesh, hit.point, 0);

                        const sub = vp.selectedSubElements.get(mesh.uuid) || { vertices: new Set(), edges: new Set(), faces: new Set() };
                        const oldSub = { vertices: new Set(sub.vertices), edges: new Set(sub.edges), faces: new Set(sub.faces) };
                        if (!e.shiftKey) { sub.vertices.clear(); sub.edges.clear(); sub.faces.clear(); }

                        if (vp.selectionMode === "vertex") {
                            const vIdx = selMgr.getClosestVertex(hit);
                            if (e.shiftKey) { if (sub.vertices.has(vIdx)) sub.vertices.delete(vIdx); else sub.vertices.add(vIdx); }
                            else { sub.vertices.add(vIdx); }
                        } else if (vp.selectionMode === "edge") {
                            const edgeKey = selMgr.getClosestEdge(hit);
                            if (e.shiftKey) { if (sub.edges.has(edgeKey)) sub.edges.delete(edgeKey); else sub.edges.add(edgeKey); }
                            else { sub.edges.add(edgeKey); }
                        } else if (vp.selectionMode === "face") {
                            const fIdx = hit.faceIndex;
                            if (e.shiftKey) { if (sub.faces.has(fIdx)) sub.faces.delete(fIdx); else sub.faces.add(fIdx); }
                            else { sub.faces.add(fIdx); }
                        }

                        vp.selectedSubElements.set(mesh.uuid, sub);
                        this.history.push(new this.commandClasses.SubMeshSelectionCommand(mesh, oldSub, sub));
                        selMgr.updateSubMeshHighlights();
                        this.triggerUpdate();
                    }
                } else if (!e.shiftKey) {
                    if (vp.selectionMode === "object") selMgr.deselectObject();
                    else {
                        const activeMesh = this._getActiveMesh();
                        if (activeMesh) {
                            const sub = vp.selectedSubElements.get(activeMesh.uuid);
                            if (sub && (sub.vertices.size > 0 || sub.edges.size > 0 || sub.faces.size > 0)) {
                                const oldSub = { vertices: new Set(sub.vertices), edges: new Set(sub.edges), faces: new Set(sub.faces) };
                                sub.vertices.clear(); sub.edges.clear(); sub.faces.clear();
                                this.history.push(new this.commandClasses.SubMeshSelectionCommand(activeMesh, oldSub, sub));
                                selMgr.updateSubMeshHighlights();
                            }
                        } else { selMgr.deselectObject(); }
                    }
                }
            } else if (!e.shiftKey) {
                if (vp.selectionMode === "object") selMgr.deselectObject();
                else {
                    const activeMesh = this._getActiveMesh();
                    if (activeMesh) {
                        const sub = vp.selectedSubElements.get(activeMesh.uuid);
                        if (sub && (sub.vertices.size > 0 || sub.edges.size > 0 || sub.faces.size > 0)) {
                            const oldSub = { vertices: new Set(sub.vertices), edges: new Set(sub.edges), faces: new Set(sub.faces) };
                            sub.vertices.clear(); sub.edges.clear(); sub.faces.clear();
                            this.history.push(new this.commandClasses.SubMeshSelectionCommand(activeMesh, oldSub, sub));
                            selMgr.updateSubMeshHighlights();
                        }
                    } else { selMgr.deselectObject(); }
                }
            }
        }

        this.mouseDownOnCanvas = false;
        this.triggerUpdate();
    }

    // -----------------------------------------------------------------------
    // onMouseMove
    // -----------------------------------------------------------------------
    _onMouseMove(e) {
        const THREE = this.THREE;
        const vp = this.viewport;
        const rect = this.renderer.domElement.getBoundingClientRect();
        const scaleX = rect.width / this.renderer.domElement.clientWidth;
        const scaleY = rect.height / this.renderer.domElement.clientHeight;
        const localX = (e.clientX - rect.left) / scaleX;
        const localY = (e.clientY - rect.top) / scaleY;

        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        if (vp.modalTransform.active) {
            const mt = vp.modalTransform;
            const mouseDelta = new THREE.Vector2(this.mouse.x - mt.mouseStart.x, this.mouse.y - mt.mouseStart.y);
            const centerScreen = mt.centerScreen;

            if (mt.isSubMesh) {
                const worldTrans = new THREE.Matrix4();
                const fovFactor = Math.tan(this.camera.fov * Math.PI / 360) * 2;
                const distToCenter = mt.center.distanceTo(this.camera.position);
                const sX = distToCenter * fovFactor * (rect.width / rect.height) * 0.5;
                const sY = distToCenter * fovFactor * 0.5;
                const cameraRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
                const cameraUp = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);

                if (mt.mode === "translate") {
                    const deltaWorld = cameraRight.clone().multiplyScalar(mouseDelta.x * sX).add(cameraUp.clone().multiplyScalar(mouseDelta.y * sY));
                    if (mt.axis) { const ad = new THREE.Vector3(mt.axis === "x" ? 1 : 0, mt.axis === "y" ? 1 : 0, mt.axis === "z" ? 1 : 0); deltaWorld.copy(ad).multiplyScalar(deltaWorld.dot(ad)); }
                    worldTrans.makeTranslation(deltaWorld.x, deltaWorld.y, deltaWorld.z);
                } else if (mt.mode === "rotate") {
                    const vs = new THREE.Vector2(mt.mouseStart.x - centerScreen.x, mt.mouseStart.y - centerScreen.y).normalize();
                    const vc = new THREE.Vector2(this.mouse.x - centerScreen.x, this.mouse.y - centerScreen.y).normalize();
                    let angle = Math.atan2(vc.y, vc.x) - Math.atan2(vs.y, vs.x);
                    if (mt.axis) angle *= 2;
                    const ad = mt.axis ? new THREE.Vector3(mt.axis === "x" ? 1 : 0, mt.axis === "y" ? 1 : 0, mt.axis === "z" ? 1 : 0) : new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 2);
                    worldTrans.makeTranslation(-mt.center.x, -mt.center.y, -mt.center.z);
                    worldTrans.premultiply(new THREE.Matrix4().makeRotationAxis(ad, angle));
                    worldTrans.premultiply(new THREE.Matrix4().makeTranslation(mt.center.x, mt.center.y, mt.center.z));
                } else if (mt.mode === "scale") {
                    const dStart = new THREE.Vector2(mt.mouseStart.x - centerScreen.x, mt.mouseStart.y - centerScreen.y).length();
                    const dCurrent = new THREE.Vector2(this.mouse.x - centerScreen.x, this.mouse.y - centerScreen.y).length();
                    const ratio = dStart > 0.001 ? dCurrent / dStart : 1;
                    worldTrans.makeTranslation(-mt.center.x, -mt.center.y, -mt.center.z);
                    worldTrans.premultiply(new THREE.Matrix4().makeScale(...(mt.axis ? [mt.axis === "x" ? ratio : 1, mt.axis === "y" ? ratio : 1, mt.axis === "z" ? ratio : 1] : [ratio, ratio, ratio])));
                    worldTrans.premultiply(new THREE.Matrix4().makeTranslation(mt.center.x, mt.center.y, mt.center.z));
                }

                mt.subTransformData.forEach((data) => {
                    const mesh = data.mesh;
                    const geo = mesh.geometry;
                    const posAttr = geo.attributes.position;
                    mesh.updateMatrixWorld(true);
                    const invWorld = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
                    const localTrans = new THREE.Matrix4().copy(invWorld).multiply(worldTrans).multiply(mesh.matrixWorld);
                    const v = new THREE.Vector3();
                    data.indices.forEach((vIdx, i) => {
                        v.copy(data.startPos[i]).applyMatrix4(localTrans);
                        posAttr.setXYZ(vIdx, v.x, v.y, v.z);
                    });
                    posAttr.needsUpdate = true;
                });
                this.selectionManager.updateSubMeshHighlights();
            } else {
                mt.startStates.forEach(s => {
                    if (mt.mode === "translate") {
                        const cr = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
                        const cu = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
                        const ff = Math.tan(this.camera.fov * Math.PI / 360) * 2;
                        const dc = mt.center.distanceTo(this.camera.position);
                        const sX2 = dc * ff * (rect.width / rect.height) * 0.5;
                        const sY2 = dc * ff * 0.5;
                        if (mt.axis) {
                            const ad = new THREE.Vector3(mt.axis === "x" ? 1 : 0, mt.axis === "y" ? 1 : 0, mt.axis === "z" ? 1 : 0);
                            const sm = cr.clone().multiplyScalar(mouseDelta.x * sX2).add(cu.clone().multiplyScalar(mouseDelta.y * sY2));
                            s.object.position.copy(s.position).add(ad.multiplyScalar(sm.dot(ad)));
                        } else {
                            s.object.position.copy(s.position).add(cr.multiplyScalar(mouseDelta.x * sX2)).add(cu.multiplyScalar(mouseDelta.y * sY2));
                        }
                    } else if (mt.mode === "rotate") {
                        const vs = new THREE.Vector2(mt.mouseStart.x - centerScreen.x, mt.mouseStart.y - centerScreen.y);
                        const vc = new THREE.Vector2(this.mouse.x - centerScreen.x, this.mouse.y - centerScreen.y);
                        if (vs.length() > 0.001 && vc.length() > 0.001) {
                            vs.normalize(); vc.normalize();
                            let angle = Math.atan2(vc.y, vc.x) - Math.atan2(vs.y, vs.x);
                            if (mt.axis) {
                                const ad = new THREE.Vector3(mt.axis === "x" ? 1 : 0, mt.axis === "y" ? 1 : 0, mt.axis === "z" ? 1 : 0);
                                s.object.quaternion.copy(s.quaternion).premultiply(new THREE.Quaternion().setFromAxisAngle(ad, angle * 2));
                            } else {
                                const cd = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 2);
                                s.object.quaternion.copy(s.quaternion).premultiply(new THREE.Quaternion().setFromAxisAngle(cd, angle));
                            }
                        }
                    } else if (mt.mode === "scale") {
                        const dStart = new THREE.Vector2(mt.mouseStart.x - centerScreen.x, mt.mouseStart.y - centerScreen.y).length();
                        const dCurrent = new THREE.Vector2(this.mouse.x - centerScreen.x, this.mouse.y - centerScreen.y).length();
                        if (dStart > 0.001) {
                            const ratio = dCurrent / dStart;
                            if (mt.axis) { s.object.scale.copy(s.scale); s.object.scale[mt.axis] = s.scale[mt.axis] * ratio; }
                            else { s.object.scale.copy(s.scale).multiplyScalar(ratio); }
                        }
                    }
                });
            }
            this.triggerUpdate();
            return;
        }

        // Box selection drag
        if (this.mouseDownOnCanvas && e.shiftKey && !this.isSelecting && !vp.transform.axis && !vp.brushActive) {
            const dist = Math.sqrt(Math.pow(e.clientX - this.selectionStartScreen.x, 2) + Math.pow(e.clientY - this.selectionStartScreen.y, 2));
            if (dist > 5) { this.isSelecting = true; this.selectionRect.style.display = "block"; this.orbit.enabled = false; }
        }
        if (this.isSelecting) {
            const sX = this.selectionStartLocal.x, sY = this.selectionStartLocal.y;
            const lft = Math.min(sX, localX), top = Math.min(sY, localY);
            const wid = Math.abs(localX - sX), hgt = Math.abs(localY - sY);
            this.selectionRect.style.left = lft + "px"; this.selectionRect.style.top = top + "px";
            this.selectionRect.style.width = wid + "px"; this.selectionRect.style.height = hgt + "px";
            return;
        }

        // Orbit mode
        const isNavigating = e.altKey || (e.buttons & 4);
        if (vp.brushActive) {
            this.orbit.enabled = isNavigating; this.orbit.enableRotate = isNavigating;
            this.orbit.enablePan = false; this.orbit.enableZoom = true;
            this.renderer.domElement.style.cursor = isNavigating ? "grab" : "none";
        } else {
            const isTransforming = (vp.transform && (vp.transform.dragging || vp.transform.axis)) || (vp.modalTransform && vp.modalTransform.active);
            this.orbit.enabled = isNavigating || (!this.isSelecting && !e.shiftKey && !isTransforming);
            this.orbit.enableRotate = isNavigating;
            this.orbit.enablePan = isNavigating || (e.buttons & 2);
            this.orbit.enableZoom = true;

            if (isNavigating) {
                this.renderer.domElement.style.cursor = "grab";
            } else if (!this._lastRaycast || performance.now() - this._lastRaycast > 50) {
                this.raycaster.setFromCamera(this.mouse, this.camera);
                this.raycaster.firstHitOnly = true;
                const intersects = this.raycaster.intersectObjects(this._getPickableAssets(), true);
                this.renderer.domElement.style.cursor = (intersects.length > 0 || this.isSelecting) ? "pointer" : "auto";
                this._lastRaycast = performance.now();
            }
        }

        // Brush cursor
        if (vp.brushActive && !e.altKey && e.target === this.renderer.domElement) {
            this.brushCursor.style.display = "block";
            this.brushCursor.style.left = localX + "px";
            this.brushCursor.style.top = localY + "px";
            const visualSize = vp.brushSize * (rect.width / 1024);
            this.brushCursor.style.width = visualSize + "px";
            this.brushCursor.style.height = visualSize + "px";
            this.brushCursor.style.border = `2px solid rgba(255, 149, 0, ${0.4 + vp.brushHardness * 0.6})`;
            this.brushCursor.style.boxShadow = `0 0 10px rgba(255, 149, 0, ${0.2 + vp.brushHardness * 0.4})`;
        } else {
            this.brushCursor.style.display = "none";
        }
    }

    // -----------------------------------------------------------------------
    // handleKeyDown
    // -----------------------------------------------------------------------
    _handleKeyDown(e) {
        const vp = this.viewport;
        const selMgr = this.selectionManager;
        const tm = this.transformManager;
        const h = this.history;

        if (!vp.transform) return;
        const key = e.key.toLowerCase();
        const isCtrl = e.ctrlKey || e.metaKey;
        const isAlt = e.altKey;

        // Modal transform key handling
        if (vp.modalTransform.active) {
            const mt = vp.modalTransform;
            if (key === "x") { mt.axis = mt.axis === "x" ? null : "x"; this.updateHUD(`${mt.mode.toUpperCase()} [${mt.axis ? mt.axis.toUpperCase() + " Locked" : "Free"}]`); }
            if (key === "y") { mt.axis = mt.axis === "y" ? null : "y"; this.updateHUD(`${mt.mode.toUpperCase()} [${mt.axis ? mt.axis.toUpperCase() + " Locked" : "Free"}]`); }
            if (key === "z") { mt.axis = mt.axis === "z" ? null : "z"; this.updateHUD(`${mt.mode.toUpperCase()} [${mt.axis ? mt.axis.toUpperCase() + " Locked" : "Free"}]`); }
            if (key === "escape") tm.cancelModalTransform();
            if (key === "enter" || key === " ") tm.confirmModalTransform();
            e.preventDefault(); e.stopPropagation();
            return;
        }

        if (!isAlt && !isCtrl) {
            if (key === "g") { tm.startModalTransform("translate"); e.preventDefault(); return; }
            if (key === "r") { tm.startModalTransform("rotate"); e.preventDefault(); return; }
            if (key === "s") { tm.startModalTransform("scale"); e.preventDefault(); return; }
        }

        if (isAlt || isCtrl) {
            if (key === "z") {
                if (e.shiftKey) h.redo(); else h.undo();
                this.triggerUpdate(); e.preventDefault(); e.stopPropagation(); return;
            }
            if (key === "y") { h.redo(); this.triggerUpdate(); e.preventDefault(); e.stopPropagation(); return; }
        }

        if (key === "tab") {
            if (vp.selectionMode === "object") {
                let mesh = null;
                selMgr.selectedObjects.forEach(obj => {
                    if (obj.isMesh) { mesh = obj; return; }
                    obj.traverse(c => { if (!mesh && c.isMesh) mesh = c; });
                });
                if (mesh) vp.selectionMode = "vertex";
            } else { vp.selectionMode = "object"; }
            selMgr.updateSubMeshHighlights(); this.toolbar.updateSelectionUI(); this.triggerUpdate(); e.preventDefault();
        }

        if (key === "1") { vp.selectionMode = "vertex"; selMgr.updateSubMeshHighlights(); this.toolbar.updateSelectionUI(); this.triggerUpdate(); }
        if (key === "2") { vp.selectionMode = "edge"; selMgr.updateSubMeshHighlights(); this.toolbar.updateSelectionUI(); this.triggerUpdate(); }
        if (key === "3") { vp.selectionMode = "face"; selMgr.updateSubMeshHighlights(); this.toolbar.updateSelectionUI(); this.triggerUpdate(); }
        if (key === "4") { vp.selectionMode = "object"; selMgr.updateSubMeshHighlights(); this.toolbar.updateSelectionUI(); this.triggerUpdate(); }

        if (key === "a") {
            if (isAlt) {
                if (vp.selectionMode === "object") selMgr.deselectObject();
                else {
                    const mesh = this._getActiveMesh();
                    if (mesh) {
                        const sub = vp.selectedSubElements.get(mesh.uuid);
                        if (sub) {
                            const oldSub = { vertices: new Set(sub.vertices), edges: new Set(sub.edges), faces: new Set(sub.faces) };
                            sub.vertices.clear(); sub.edges.clear(); sub.faces.clear();
                            h.push(new this.commandClasses.SubMeshSelectionCommand(mesh, oldSub, sub));
                            selMgr.updateSubMeshHighlights();
                        }
                    }
                }
            } else if (!isCtrl) {
                if (vp.selectionMode === "object") {
                    selMgr.selectedObjects = [...this.assets];
                    selMgr.selectObject(null, null, 2);
                } else {
                    const mesh = this._getActiveMesh();
                    if (mesh) {
                        const sub = vp.selectedSubElements.get(mesh.uuid) || { vertices: new Set(), edges: new Set(), faces: new Set() };
                        const oldSub = { vertices: new Set(sub.vertices), edges: new Set(sub.edges), faces: new Set(sub.faces) };
                        const pos = mesh.geometry.attributes.position;
                        if (vp.selectionMode === "vertex") { for (let i = 0; i < pos.count; i++) sub.vertices.add(i); }
                        else if (vp.selectionMode === "face") { const count = mesh.geometry.index ? mesh.geometry.index.count / 3 : pos.count / 3; for (let i = 0; i < count; i++) sub.faces.add(i); }
                        vp.selectedSubElements.set(mesh.uuid, sub);
                        h.push(new this.commandClasses.SubMeshSelectionCommand(mesh, oldSub, sub));
                        selMgr.updateSubMeshHighlights();
                    }
                }
            }
            this.triggerUpdate(); e.preventDefault();
        }

        if (key === "f") {
            if (isAlt && this.getIsolatedObjects()) this.toggleIsolate();
            else if (selMgr.selectedObjects.length > 0) this.frameScene(selMgr.selectedObjects);
            else this.frameScene(this.assets);
            e.preventDefault();
        }

        if (key === "h") {
            if (isAlt) {
                this.scene.traverse(obj => { if (obj.isMesh || obj.isGroup) obj.visible = true; });
                if (this.getIsolatedObjects()) this.toggleIsolate();
            } else if (selMgr.selectedObjects.length > 0) {
                selMgr.selectedObjects.forEach(obj => { if (obj) obj.visible = false; });
                selMgr.deselectObject();
            }
            this.triggerUpdate(); if (this._updateOutliner) this._updateOutliner(); e.preventDefault();
        }

        if (key === "x" || key === "delete") {
            if (selMgr.selectedObjects.length > 0) {
                const objs = [...selMgr.selectedObjects];
                const cmd = new this.commandClasses.MultiAssetCommand(objs, false, this.assets, this.scene);
                h.push(cmd); cmd.remove(); selMgr.deselectObject();
            }
            e.preventDefault();
        }

        if (key === "b" && !isCtrl && !isAlt) { const btn = this.toolbar?.toolbarBtns?.["brush"]; if (btn) btn.click(); }
        if (key === "v" && !isCtrl && !isAlt) { const btn = this.toolbar?.toolbarBtns?.["split"]; if (btn) btn.click(); }
        if (key === "j" && !isCtrl && !isAlt) { if (this._segPanel) this._segPanel.joinSelectedMeshes(); e.preventDefault(); }
        if (key === "p" && !isCtrl && !isAlt) { if (this._segPanel) this._segPanel.separateMesh(); e.preventDefault(); }
    }

    // -----------------------------------------------------------------------
    // bind / unbind
    // -----------------------------------------------------------------------
    _bindEvents() {
        this._mousedown = this._handleGlobalMouseDown.bind(this);
        this._mouseup = this._handleGlobalMouseUp.bind(this);
        this._mousemove = this._onMouseMove.bind(this);
        this._keydown = this._handleKeyDown.bind(this);

        window.addEventListener("mousedown", this._mousedown, true);
        window.addEventListener("pointerdown", this._mousedown, true);
        window.addEventListener("mouseup", this._mouseup, true);
        window.addEventListener("pointerup", this._mouseup, true);
        window.addEventListener("mousemove", this._mousemove, true);
        window.addEventListener("pointermove", this._mousemove, true);
        window.addEventListener("contextmenu", e => { if (this.viewport.modalTransform.active) e.preventDefault(); }, true);
        window.addEventListener("keydown", this._keydown, true);

        this.container.addEventListener("mouseenter", () => { this.mouseInCanvas = true; });
        this.container.addEventListener("mouseleave", () => { this.mouseInCanvas = false; });
    }

    dispose() {
        window.removeEventListener("mousedown", this._mousedown, true);
        window.removeEventListener("pointerdown", this._mousedown, true);
        window.removeEventListener("mouseup", this._mouseup, true);
        window.removeEventListener("pointerup", this._mouseup, true);
        window.removeEventListener("mousemove", this._mousemove, true);
        window.removeEventListener("pointermove", this._mousemove, true);
        window.removeEventListener("keydown", this._keydown, true);
    }

    /** Inject ShadingManager ref after construction for xray mode check. */
    setShadingManager(shadingManager) {
        this._shadingManager = shadingManager;
    }

    /** Inject Outliner for H key (hide/show). */
    setUpdateOutlinerCallback(fn) { this._updateOutliner = fn; }

    /** Inject SegmentationPanel ref for J/P shortcuts. */
    setSegmentationPanel(segPanel) { this._segPanel = segPanel; }
}
