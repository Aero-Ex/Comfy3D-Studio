/**
 * SelectionManager.js
 * Manages object selection state, sub-mesh selection (vertex/edge/face),
 * selection helper (bounding-box outline), and all highlight overlays.
 */

export class SelectionManager {
    /**
     * @param {object} THREE
     * @param {object} deps
     */
    constructor(THREE, deps) {
        this.THREE = THREE;
        Object.assign(this, deps);

        this.selectedObjects = [];
        this.lastSelectedObject = null;

        // Sub-element selection: Map<meshUUID, {vertices: Set, edges: Set, faces: Set}>
        this.viewport.selectedSubElements = new Map();
        this._lastSubmeshUUID = null;
        this._lastSubmeshMode = null;
    }


    // -----------------------------------------------------------------------
    // Helpers bound by external managers (set after construction)
    // -----------------------------------------------------------------------

    /** Called by TransformManager to attach/detach the gizmo. */
    setTransformManager(transformManager) {
        this._transformManager = transformManager;
    }

    /** Called by Outliner/Toolbar references. */
    setUICallbacks({ updateOutliner, updateOutlinerSelection, updateSelectionUI, updateToolbar, updateSubMeshHighlights }) {
        this._updateOutliner = updateOutliner || (() => { });
        this._updateOutlinerSelection = updateOutlinerSelection || (() => { });
        this._updateSelectionUI = updateSelectionUI || (() => { });
        this._updateToolbar = updateToolbar || (() => { });
        // Allow external override but default to our own
        if (updateSubMeshHighlights) this.updateSubMeshHighlights = updateSubMeshHighlights;
    }

    // -----------------------------------------------------------------------
    // updateSelectionProxy
    // -----------------------------------------------------------------------
    updateSelectionProxy() {
        const THREE = this.THREE;
        const visibleSelected = this.selectedObjects.filter(o => o && (o.visible !== false));
        if (visibleSelected.length === 0) return;
        const box = new THREE.Box3();
        visibleSelected.forEach(o => box.expandByObject(o));
        const center = box.getCenter(new THREE.Vector3());
        this.selectionProxy.position.copy(center);
        this.selectionProxy.quaternion.set(0, 0, 0, 1);
        this.selectionProxy.scale.set(1, 1, 1);
        this.selectionProxy.updateMatrixWorld(true);
    }

    // -----------------------------------------------------------------------
    // updateSelectionHelper
    // -----------------------------------------------------------------------
    updateSelectionHelper() {
        const THREE = this.THREE;
        if (!this.selectionHelper) return;
        const visibleSelected = this.selectedObjects.filter(o => o && (o.visible !== false));
        if (visibleSelected.length === 0) {
            this.selectionHelper.visible = false;
            this.triggerUpdate();
            return;
        }

        const box = new THREE.Box3();
        visibleSelected.forEach(o => {
            if (o.geometry && !o.geometry.boundingBox) o.geometry.computeBoundingBox();
            box.expandByObject(o);
        });

        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        this.selectionHelper.position.copy(center);
        this.selectionHelper.scale.set(size.x || 0.1, size.y || 0.1, size.z || 0.1);
        this.selectionHelper.visible = (this.viewport.selectionMode === "object" && !this.viewport.brushActive);
        this.triggerUpdate();
    }

    // -----------------------------------------------------------------------
    // getActiveMesh
    // -----------------------------------------------------------------------
    getActiveMesh() {
        const sel = this.selectedObjects.filter(o => o && o.visible !== false)[0];
        if (!sel) return null;
        if (sel.isMesh) return sel;
        let mesh = null;
        sel.traverse(c => { if (!mesh && c.isMesh && c.visible !== false) mesh = c; });
        return mesh;
    }

    /** Returns all pickable (visible, parented) assets. */
    getPickableAssets() {
        return this.assets.filter(a => !!a.parent && a.visible !== false);
    }

    // -----------------------------------------------------------------------
    // getClosestVertex
    // -----------------------------------------------------------------------
    getClosestVertex(hit) {
        const THREE = this.THREE;
        const mesh = hit.object;
        const geometry = mesh.geometry;
        const position = geometry.attributes.position;
        const face = hit.face;
        const indices = [face.a, face.b, face.c];

        let minDist = Infinity;
        let bestIdx = indices[0];
        indices.forEach(idx => {
            const v = new THREE.Vector3().fromBufferAttribute(position, idx);
            mesh.localToWorld(v);
            const d = hit.point.distanceTo(v);
            if (d < minDist) { minDist = d; bestIdx = idx; }
        });
        return bestIdx;
    }

    // -----------------------------------------------------------------------
    // getClosestEdge
    // -----------------------------------------------------------------------
    getClosestEdge(hit) {
        const THREE = this.THREE;
        const mesh = hit.object;
        const geometry = mesh.geometry;
        const position = geometry.attributes.position;
        const face = hit.face;
        const indices = [face.a, face.b, face.c];

        let minDist = Infinity;
        let bestEdge = null;
        for (let i = 0; i < 3; i++) {
            const i1 = indices[i];
            const i2 = indices[(i + 1) % 3];
            const v1 = new THREE.Vector3().fromBufferAttribute(position, i1);
            const v2 = new THREE.Vector3().fromBufferAttribute(position, i2);
            mesh.localToWorld(v1); mesh.localToWorld(v2);
            const line = new THREE.Line3(v1, v2);
            const closestPoint = new THREE.Vector3();
            line.closestPointToPoint(hit.point, true, closestPoint);
            const d = hit.point.distanceTo(closestPoint);
            if (d < minDist) {
                minDist = d;
                bestEdge = [i1, i2].sort((a, b) => a - b).join("-");
            }
        }
        return bestEdge;
    }

    // -----------------------------------------------------------------------
    // selectObject
    // Mode: 0 = SET, 1 = TOGGLE, 2 = BATCH (array already updated externally)
    // -----------------------------------------------------------------------
    selectObject(obj, point, mode = 0) {
        // Auto-restore archived (removed from scene) assets
        if (obj && !obj.parent && this.assets.includes(obj)) {
            console.log("Comfy3D: Restoring archived asset to scene for interaction:", obj.name);
            this.scene.add(obj);
            obj.visible = true;
            this._updateOutliner();
        }

        if (mode === 0) {
            this.selectedObjects = [obj];
            this.lastSelectedObject = obj;
        } else if (mode === 1) {
            const idx = this.selectedObjects.indexOf(obj);
            if (idx > -1) {
                this.selectedObjects.splice(idx, 1);
                if (this.lastSelectedObject === obj) {
                    this.lastSelectedObject = this.selectedObjects[this.selectedObjects.length - 1] || null;
                }
            } else {
                this.selectedObjects.push(obj);
                this.lastSelectedObject = obj;
            }
        } else if (mode === 2) {
            if (this.selectedObjects.length > 0)
                this.lastSelectedObject = this.selectedObjects[this.selectedObjects.length - 1];
        }

        // Auto-expand parents in outliner
        let anyExpanded = false;
        const expandedObjects = this._expandedObjects;
        if (expandedObjects instanceof Set) {
            this.selectedObjects.forEach(o => {
                if (!o) return;
                let curr = o.parent;
                while (curr && curr !== this.scene && !this.assets.includes(curr.parent)) {
                    if (curr.children && curr.children.length > 0 && !expandedObjects.has(curr.uuid)) {
                        expandedObjects.add(curr.uuid); anyExpanded = true;
                    }
                    curr = curr.parent;
                }
                if (this.assets.includes(curr) && curr.children && curr.children.length > 0 && !expandedObjects.has(curr.uuid)) {
                    expandedObjects.add(curr.uuid); anyExpanded = true;
                }
            });
        }
        if (anyExpanded) this._updateOutliner();

        const visibleSelected = this.selectedObjects.filter(o => o && (o.visible !== false));
        if (visibleSelected.length > 0) {
            this.updateSelectionHelper();
            this.updateSelectionProxy();
            const tm = this._transformManager;
            if (tm) {
                if (tm.transformControls.enabled) {
                    console.log("Comfy3D: Attaching gizmo to selection proxy");
                    tm.transformControls.attach(this.selectionProxy);
                } else {
                    tm.transformControls.detach();
                }
            }
        } else {
            this.deselectObject();
        }

        console.log(`Comfy3D: Selection updated. Total: ${this.selectedObjects.length}`);
        this._updateToolbar();
        this._updateOutlinerSelection();
        this._updateSelectionUI();
        this.updateSubMeshHighlights();
        this.triggerUpdate();
    }

    // -----------------------------------------------------------------------
    // deselectObject
    // -----------------------------------------------------------------------
    deselectObject() {
        this.selectedObjects = [];
        const tm = this._transformManager;
        if (tm) tm.transformControls.detach();
        if (this.selectionHelper) this.selectionHelper.visible = false;

        this.vertexHighlight.visible = false;
        this.edgeHighlight.visible = false;
        this.faceHighlight.visible = false;

        this._updateToolbar();
        this._updateOutlinerSelection();
        this._updateSelectionUI();
        this.triggerUpdate();
    }

    // -----------------------------------------------------------------------
    // updateSubMeshHighlights
    // -----------------------------------------------------------------------
    updateSubMeshHighlights() {
        const THREE = this.THREE;
        const viewport = this.viewport;
        const activeMesh = this.getActiveMesh();

        if (!activeMesh || viewport.selectionMode === "object") {
            this.vertexHighlight.visible = false;
            this.edgeHighlight.visible = false;
            this.faceHighlight.visible = false;
            this.persistentVertexPoints.visible = false;
            this.persistentWireframe.visible = false;
            this._lastSubmeshUUID = null;
            this._lastSubmeshMode = null;
            return;
        }

        const syncTransform = (obj) => {
            obj.matrix.copy(activeMesh.matrixWorld);
            obj.matrixWorld.copy(activeMesh.matrixWorld);
            obj.matrixAutoUpdate = false;
        };

        this.persistentWireframe.visible = !viewport.modalTransform.active;
        this.persistentVertexPoints.visible = (!viewport.modalTransform.active && viewport.selectionMode === "vertex");

        const modeChanged = this._lastSubmeshMode !== viewport.selectionMode;
        const meshChanged = this._lastSubmeshUUID !== activeMesh.uuid;

        if (meshChanged || modeChanged || viewport.modalTransform.active) {
            const geo = activeMesh.geometry;
            if (meshChanged || (viewport.modalTransform.active && !this.persistentWireframe.userData.lastSync)) {
                if (viewport.modalTransform.active) {
                    this.persistentWireframe.userData.lastSync = true;
                } else {
                    if (!activeMesh.userData.wireframeGeom) {
                        activeMesh.userData.wireframeGeom = new THREE.EdgesGeometry(geo);
                    }
                    this.persistentWireframe.geometry = activeMesh.userData.wireframeGeom;
                    this.persistentWireframe.userData.lastSync = false;
                }
                syncTransform(this.persistentWireframe);
            }

            if (this.persistentVertexPoints.visible) {
                if (this.persistentVertexPoints.geometry !== geo) this.persistentVertexPoints.geometry = geo;
                syncTransform(this.persistentVertexPoints);
            }

            this._lastSubmeshUUID = activeMesh.uuid;
            this._lastSubmeshMode = viewport.selectionMode;
        } else {
            syncTransform(this.persistentWireframe);
            if (this.persistentVertexPoints.visible) syncTransform(this.persistentVertexPoints);
        }

        const sub = viewport.selectedSubElements.get(activeMesh.uuid) || { vertices: new Set(), edges: new Set(), faces: new Set() };
        const meshPos = activeMesh.geometry.attributes.position;
        const meshData = meshPos.array;

        // Vertex Highlights
        if (sub.vertices.size > 0) {
            const positions = new Float32Array(sub.vertices.size * 3);
            let i = 0;
            sub.vertices.forEach(idx => {
                const offset = idx * 3;
                positions[i++] = meshData[offset];
                positions[i++] = meshData[offset + 1];
                positions[i++] = meshData[offset + 2];
            });
            this.vertexHighlight.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            this.vertexHighlight.geometry.attributes.position.needsUpdate = true;
            this.vertexHighlight.geometry.computeBoundingSphere();
            syncTransform(this.vertexHighlight);
            this.vertexHighlight.visible = true;
        } else {
            this.vertexHighlight.visible = false;
        }

        // Edge Highlights
        if (sub.edges.size > 0) {
            const positions = new Float32Array(sub.edges.size * 6);
            let i = 0;
            sub.edges.forEach(edgeKey => {
                let i1, i2;
                if (typeof edgeKey === "number") {
                    i1 = Math.floor(edgeKey / 10000000);
                    i2 = edgeKey % 10000000;
                } else {
                    const dashIdx = edgeKey.indexOf("-");
                    i1 = parseInt(edgeKey.substring(0, dashIdx));
                    i2 = parseInt(edgeKey.substring(dashIdx + 1));
                }
                const o1 = i1 * 3, o2 = i2 * 3;
                positions[i++] = meshData[o1]; positions[i++] = meshData[o1 + 1]; positions[i++] = meshData[o1 + 2];
                positions[i++] = meshData[o2]; positions[i++] = meshData[o2 + 1]; positions[i++] = meshData[o2 + 2];
            });
            this.edgeHighlight.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            this.edgeHighlight.geometry.attributes.position.needsUpdate = true;
            this.edgeHighlight.geometry.computeBoundingSphere();
            syncTransform(this.edgeHighlight);
            this.edgeHighlight.visible = true;
        } else {
            this.edgeHighlight.visible = false;
        }

        // Face Highlights
        if (sub.faces.size > 0) {
            const positions = new Float32Array(sub.faces.size * 9);
            const index = activeMesh.geometry.index;
            const idxData = index ? index.array : null;
            let i = 0;
            sub.faces.forEach(faceIdx => {
                let i1, i2, i3;
                if (idxData) {
                    i1 = idxData[faceIdx * 3]; i2 = idxData[faceIdx * 3 + 1]; i3 = idxData[faceIdx * 3 + 2];
                } else {
                    i1 = faceIdx * 3; i2 = faceIdx * 3 + 1; i3 = faceIdx * 3 + 2;
                }
                const o1 = i1 * 3, o2 = i2 * 3, o3 = i3 * 3;
                positions[i++] = meshData[o1]; positions[i++] = meshData[o1 + 1]; positions[i++] = meshData[o1 + 2];
                positions[i++] = meshData[o2]; positions[i++] = meshData[o2 + 1]; positions[i++] = meshData[o2 + 2];
                positions[i++] = meshData[o3]; positions[i++] = meshData[o3 + 1]; positions[i++] = meshData[o3 + 2];
            });
            this.faceHighlight.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            this.faceHighlight.geometry.attributes.position.needsUpdate = true;
            this.faceHighlight.geometry.computeBoundingSphere();
            syncTransform(this.faceHighlight);
            this.faceHighlight.visible = true;
        } else {
            this.faceHighlight.visible = false;
        }
    }
}
