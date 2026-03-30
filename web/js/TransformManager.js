/**
 * TransformManager.js
 * Wraps THREE.TransformControls (gizmo) and the Blender-style modal transform
 * system (G/R/S keys). Also builds the 3D axis orientation gizmo.
 *
 * Extracted verbatim from web/3d_viewport.js
 */

export class TransformManager {
    /**
     * @param {object} THREE
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {THREE.WebGLRenderer} renderer
     * @param {THREE.OrbitControls} orbit
     * @param {THREE.Group} gizmoGroup - Orientation gizmo group from SceneSetup.
     * @param {THREE.WebGLRenderer} gizmoRenderer
     * @param {THREE.Scene} gizmoScene
     * @param {THREE.Camera} gizmoCamera
     * @param {SelectionManager} selectionManager
     * @param {object} viewport - ComfyUI node instance.
     * @param {CommandHistory} history
     * @param {Function} triggerUpdate
     * @param {Function} updateHUD
     */
    constructor(THREE, scene, camera, renderer, orbit,
        gizmoGroup, gizmoRenderer, gizmoScene, gizmoCamera,
        selectionManager, viewport, history, triggerUpdate, updateHUD) {
        this.THREE = THREE;
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.orbit = orbit;
        this.gizmoGroup = gizmoGroup;
        this.gizmoRenderer = gizmoRenderer;
        this.gizmoScene = gizmoScene;
        this.gizmoCamera = gizmoCamera;
        this.selMgr = selectionManager;
        this.viewport = viewport;
        this.history = history;
        this.triggerUpdate = triggerUpdate;
        this.updateHUD = updateHUD;

        this._buildTransformControls();
        this._buildAxisGizmo();
        this._initModalTransform();
        this._bindGizmoControls();
        this._bindTransformGizmoEvents();
    }

    // -----------------------------------------------------------------------
    // TransformControls
    // -----------------------------------------------------------------------
    _buildTransformControls() {
        const THREE = this.THREE;
        this.transformControls = new THREE.TransformControls(this.camera, this.renderer.domElement);
        this.viewport.transform = this.transformControls;
        this.transformControls.addEventListener("change", () => {
            if (this.selMgr.selectionHelper.visible) this.selMgr.updateSelectionHelper();
            this.triggerUpdate();
        });
        this.scene.add(this.transformControls);
    }

    // -----------------------------------------------------------------------
    // Modal Transform state init
    // -----------------------------------------------------------------------
    _initModalTransform() {
        const THREE = this.THREE;
        this.viewport.modalTransform = {
            active: false,
            mode: null,
            axis: null,
            mouseStart: new THREE.Vector2(),
            startStates: [],
            center: new THREE.Vector3(),
            centerScreen: new THREE.Vector3(),
            isSubMesh: false,
            subTransformData: new Map()
        };
    }

    // -----------------------------------------------------------------------
    // Axis Orientation Gizmo
    // -----------------------------------------------------------------------
    _buildAxisGizmo() {
        const THREE = this.THREE;
        const axes = [
            { axis: new THREE.Vector3(1, 0, 0), color: 0xff3b30, label: "X" },
            { axis: new THREE.Vector3(0, 1, 0), color: 0x4cd964, label: "Y" },
            { axis: new THREE.Vector3(0, 0, 1), color: 0x007aff, label: "Z" }
        ];

        axes.forEach(a => {
            const lineGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), a.axis]);
            const line = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color: a.color, linewidth: 2 }));
            this.gizmoGroup.add(line);

            const negLineGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), a.axis.clone().multiplyScalar(-1)]);
            const negLine = new THREE.Line(negLineGeom, new THREE.LineBasicMaterial({ color: a.color, transparent: true, opacity: 0.2, linewidth: 1 }));
            this.gizmoGroup.add(negLine);

            const sphere = new THREE.Mesh(
                new THREE.SphereGeometry(0.2, 16, 16),
                new THREE.MeshBasicMaterial({ color: a.color })
            );
            sphere.position.copy(a.axis).multiplyScalar(1.1);
            sphere.userData.dir = a.axis.clone();
            this.gizmoGroup.add(sphere);

            const negSphere = new THREE.Mesh(
                new THREE.SphereGeometry(0.12, 16, 16),
                new THREE.MeshBasicMaterial({ color: a.color, transparent: true, opacity: 0.2 })
            );
            negSphere.position.copy(a.axis).multiplyScalar(-1.1);
            negSphere.userData.dir = a.axis.clone().multiplyScalar(-1);
            this.gizmoGroup.add(negSphere);
        });
    }

    // -----------------------------------------------------------------------
    // Gizmo click → snap camera to axis
    // -----------------------------------------------------------------------
    _bindGizmoControls() {
        const THREE = this.THREE;
        this.gizmoRenderer.domElement.style.pointerEvents = "auto";
        this.gizmoRenderer.domElement.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            const rect = this.gizmoRenderer.domElement.getBoundingClientRect();
            const gMouse = new THREE.Vector2(
                ((e.clientX - rect.left) / rect.width) * 2 - 1,
                -((e.clientY - rect.top) / rect.height) * 2 + 1
            );
            const gRaycaster = new THREE.Raycaster();
            gRaycaster.setFromCamera(gMouse, this.gizmoCamera);
            const intersects = gRaycaster.intersectObjects(this.gizmoGroup.children);
            if (intersects.length > 0) {
                const clicked = intersects[0].object;
                if (clicked.userData.dir) {
                    const dir = clicked.userData.dir.clone();
                    const dist = this.camera.position.distanceTo(this.orbit.target);
                    const targetPos = this.orbit.target.clone().add(dir.multiplyScalar(dist));

                    let targetUp = new THREE.Vector3(0, 1, 0);
                    if (Math.abs(dir.y) > 0.99) targetUp.set(0, 0, -1);

                    const startPos = this.camera.position.clone();
                    const startTime = performance.now();
                    const duration = 250;

                    const animateLerp = (time) => {
                        const t = Math.min((time - startTime) / duration, 1);
                        const ease = t * (2 - t);
                        this.camera.position.lerpVectors(startPos, targetPos, ease);
                        this.camera.up.lerp(targetUp, ease);
                        this.camera.lookAt(this.orbit.target);
                        this.orbit.update();
                        this.triggerUpdate();
                        if (t < 1) requestAnimationFrame(animateLerp);
                    };
                    requestAnimationFrame(animateLerp);
                }
            }
        });
    }

    // -----------------------------------------------------------------------
    // TransformControls gizmo drag events
    // -----------------------------------------------------------------------
    _bindTransformGizmoEvents() {
        const { MultiTransformCommand } = this._commandClasses || {};
        const initialStates = new Map();
        let initialProxyMatrixInverse = new this.THREE.Matrix4();

        this.transformControls.addEventListener("mouseDown", () => {
            const { selectedObjects, selectionProxy } = this.selMgr;
            if (selectedObjects.length > 0) {
                selectionProxy.updateMatrixWorld(true);
                initialProxyMatrixInverse.copy(selectionProxy.matrixWorld).invert();
                initialStates.clear();
                selectedObjects.forEach(obj => {
                    obj.updateMatrixWorld(true);
                    initialStates.set(obj, {
                        matrix: obj.matrixWorld.clone(),
                        p: obj.position.clone(),
                        q: obj.quaternion.clone(),
                        s: obj.scale.clone()
                    });
                });
            }
        });

        this.transformControls.addEventListener("change", () => {
            const { selectedObjects, selectionProxy } = this.selMgr;
            if (this.transformControls.dragging && selectedObjects.length > 0) {
                selectionProxy.updateMatrixWorld(true);
                const deltaMatrix = selectionProxy.matrixWorld.clone().multiply(initialProxyMatrixInverse);
                selectedObjects.forEach(obj => {
                    const initial = initialStates.get(obj);
                    if (initial) {
                        const newWorldMatrix = deltaMatrix.clone().multiply(initial.matrix);
                        if (obj.parent) {
                            const parentInverse = new this.THREE.Matrix4().copy(obj.parent.matrixWorld).invert();
                            const localMatrix = parentInverse.multiply(newWorldMatrix);
                            localMatrix.decompose(obj.position, obj.quaternion, obj.scale);
                        } else {
                            newWorldMatrix.decompose(obj.position, obj.quaternion, obj.scale);
                        }
                        obj.updateMatrixWorld(true);
                    }
                });
            }
            this.triggerUpdate();
        });

        this.transformControls.addEventListener("mouseUp", () => {
            const { selectedObjects } = this.selMgr;
            if (selectedObjects.length > 0 && initialStates.size > 0) {
                const finalStates = new Map();
                let changed = false;
                selectedObjects.forEach(obj => {
                    const initial = initialStates.get(obj);
                    if (initial) {
                        if (initial.p.distanceTo(obj.position) > 0.0001 ||
                            initial.q.angleTo(obj.quaternion) > 0.0001 ||
                            initial.s.distanceTo(obj.scale) > 0.0001) {
                            changed = true;
                        }
                        finalStates.set(obj, {
                            p: obj.position.clone(),
                            q: obj.quaternion.clone(),
                            s: obj.scale.clone()
                        });
                    }
                });
                if (changed && !this.viewport.modalTransform.active && this._MultiTransformCommand) {
                    this.history.push(new this._MultiTransformCommand(selectedObjects, initialStates, finalStates));
                }
            }
            initialStates.clear();
        });

        this.transformControls.addEventListener("dragging-changed", e => {
            this.orbit.enabled = !e.value;
        });
    }

    /** Called after CommandHistory module is available. */
    setCommandClasses(MultiTransformCommand) {
        this._MultiTransformCommand = MultiTransformCommand;
    }

    // -----------------------------------------------------------------------
    // startModalTransform
    // -----------------------------------------------------------------------
    startModalTransform(mode) {
        const THREE = this.THREE;
        const { selectedObjects, selectionProxy } = this.selMgr;
        if (selectedObjects.length === 0) return;
        const activeMesh = this.selMgr.getActiveMesh();
        const isSubMesh = this.viewport.selectionMode !== "object" && activeMesh;

        const mt = this.viewport.modalTransform;
        mt.active = true;
        mt.mode = mode;
        mt.axis = null;
        mt.mouseStart = { x: this._mouse?.x || 0, y: this._mouse?.y || 0 };
        mt.startStates = [];
        mt.isSubMesh = false;

        if (isSubMesh) {
            mt.isSubMesh = true;
            mt.subTransformData = new Map();
            const totalBox = new THREE.Box3();

            this.viewport.selectedSubElements.forEach((sub, meshUUID) => {
                const mesh = this.scene.getObjectByProperty("uuid", meshUUID);
                if (!mesh || !mesh.isMesh) return;
                const geo = mesh.geometry;
                const posAttr = geo.attributes.position;
                let vIdxSet = new Set(sub.vertices);
                sub.faces.forEach(fIdx => {
                    vIdxSet.add(geo.index.getX(fIdx * 3));
                    vIdxSet.add(geo.index.getX(fIdx * 3 + 1));
                    vIdxSet.add(geo.index.getX(fIdx * 3 + 2));
                });
                sub.edges.forEach(edgeKey => {
                    let i1, i2;
                    if (typeof edgeKey === "number") {
                        i1 = Math.floor(edgeKey / 10000000);
                        i2 = edgeKey % 10000000;
                    } else {
                        const parts = edgeKey.split("-");
                        if (parts.length === 2) { i1 = parseInt(parts[0]); i2 = parseInt(parts[1]); }
                    }
                    if (i1 !== undefined && i2 !== undefined) { vIdxSet.add(i1); vIdxSet.add(i2); }
                });
                const indices = Array.from(vIdxSet);
                const startPos = indices.map(idx => new THREE.Vector3(posAttr.getX(idx), posAttr.getY(idx), posAttr.getZ(idx)));
                mt.subTransformData.set(meshUUID, { indices, startPos, mesh });

                const v3 = new THREE.Vector3();
                indices.forEach(idx => {
                    v3.fromBufferAttribute(posAttr, idx).applyMatrix4(mesh.matrixWorld);
                    totalBox.expandByPoint(v3);
                });
            });
            mt.center = totalBox.getCenter(new THREE.Vector3());
        }

        if (!mt.isSubMesh) {
            const box = new THREE.Box3();
            selectedObjects.forEach(obj => { obj.updateMatrixWorld(true); box.expandByObject(obj); });
            mt.center = box.getCenter(new THREE.Vector3());
            selectedObjects.forEach(obj => {
                mt.startStates.push({
                    object: obj, position: obj.position.clone(),
                    quaternion: obj.quaternion.clone(), scale: obj.scale.clone(),
                    matrixWorld: obj.matrixWorld.clone()
                });
            });
        }

        const cs = mt.center.clone().project(this.camera);
        mt.centerScreen = { x: cs.x, y: cs.y };
        this.orbit.enabled = false;
        this.transformControls.detach();
        this.updateHUD(`${mode.charAt(0).toUpperCase() + mode.slice(1)} Mode [X,Y,Z to lock, ESC to cancel]`);
    }

    // -----------------------------------------------------------------------
    // cancelModalTransform
    // -----------------------------------------------------------------------
    cancelModalTransform() {
        const mt = this.viewport.modalTransform;
        if (!mt.active) return;
        console.log("Comfy3D: Cancelling Modal Transform...");
        if (mt.isSubMesh) {
            mt.subTransformData.forEach((data, meshUUID) => {
                const mesh = data.mesh;
                const attr = mesh.geometry.attributes.position;
                data.indices.forEach((vIdx, i) => {
                    const p = data.startPos[i];
                    attr.setXYZ(vIdx, p.x, p.y, p.z);
                });
                attr.needsUpdate = true;
                mesh.geometry.computeVertexNormals();
                if (mesh.geometry.computeBoundsTree) mesh.geometry.computeBoundsTree();
            });
            this.selMgr.updateSubMeshHighlights();
        } else {
            mt.startStates.forEach(s => {
                s.object.position.copy(s.position);
                s.object.quaternion.copy(s.quaternion);
                s.object.scale.copy(s.scale);
            });
        }
        mt.active = false;
        this.orbit.enabled = true;
        this.updateHUD(null);
        this.selMgr.updateSelectionProxy();
        this.transformControls.enabled = true;
        this.transformControls.attach(this.selMgr.selectionProxy);
        this.triggerUpdate();
    }

    // -----------------------------------------------------------------------
    // confirmModalTransform
    // -----------------------------------------------------------------------
    confirmModalTransform() {
        const mt = this.viewport.modalTransform;
        if (!mt.active) return;
        console.log(`Comfy3D: Confirming Modal Transform. isSubMesh=${mt.isSubMesh}`);
        if (mt.isSubMesh) {
            const transformData = new Map();
            mt.subTransformData.forEach((data, meshUUID) => {
                const posAttr = data.mesh.geometry.attributes.position;
                const finalPos = data.indices.map(idx => new this.THREE.Vector3(posAttr.getX(idx), posAttr.getY(idx), posAttr.getZ(idx)));
                transformData.set(meshUUID, { indices: data.indices, old: data.startPos, new: finalPos });
            });
            if (this._SubMeshTransformCommand) {
                const cmd = new this._SubMeshTransformCommand(transformData);
                cmd.bind(this.scene,
                    () => this.selMgr.updateSubMeshHighlights(),
                    () => this.selMgr.updateSelectionProxy(),
                    this.triggerUpdate);
                this.history.push(cmd);
            }
            mt.subTransformData.forEach((data, meshUUID) => {
                const mesh = data.mesh;
                const geo = mesh.geometry;
                geo.computeVertexNormals();
                if (geo.computeBoundsTree) geo.computeBoundsTree();
                if (mesh.userData.wireframeGeom) {
                    mesh.userData.wireframeGeom.dispose();
                    mesh.userData.wireframeGeom = null;
                }
            });
            this.selMgr._lastSubmeshUUID = null;
            this.selMgr.updateSubMeshHighlights();
        } else {
            if (this._MultiTransformCommand) {
                const initialMap = new Map();
                const finalMap = new Map();
                mt.startStates.forEach(s => {
                    initialMap.set(s.object, { p: s.position.clone(), q: s.quaternion.clone(), s: s.scale.clone() });
                    finalMap.set(s.object, { p: s.object.position.clone(), q: s.object.quaternion.clone(), s: s.object.scale.clone() });
                });
                this.history.push(new this._MultiTransformCommand(mt.startStates.map(s => s.object), initialMap, finalMap));
            }
        }
        mt.active = false;
        this.orbit.enabled = true;
        this.updateHUD(null);
        this.selMgr.updateSelectionProxy();
        this.transformControls.enabled = true;
        this.transformControls.attach(this.selMgr.selectionProxy);
        this.triggerUpdate();
    }

    /** Called by ViewportNode to inject command class references after construction. */
    setSubMeshTransformCommand(SubMeshTransformCommand) {
        this._SubMeshTransformCommand = SubMeshTransformCommand;
    }

    /** Called by InputHandler to sync current mouse NDC coords for modal start. */
    setMouseRef(mouse) {
        this._mouse = mouse;
    }

    /** Render the orientation gizmo overlay (called each frame). */
    renderGizmo() {
        this.gizmoGroup.quaternion.copy(this.camera.quaternion).invert();
        this.gizmoRenderer.render(this.gizmoScene, this.gizmoCamera);
    }
}
