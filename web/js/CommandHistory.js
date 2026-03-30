/**
 * CommandHistory.js
 * Undo/redo stack (capped at 500) plus all concrete Command classes.
 *
 * Extracted verbatim from web/3d_viewport.js lines 1908–2168.
 *
 * Exported classes:
 *   CommandHistory, TransformCommand, MultiTransformCommand,
 *   SubMeshSelectionCommand, SubMeshTransformCommand,
 *   AssetCommand, RenameCommand, MultiAssetCommand, SeparateMeshCommand
 */

// ---------------------------------------------------------------------------
// CommandHistory
// ---------------------------------------------------------------------------

export class CommandHistory {
    constructor() {
        this.history = [];
        this.index = -1;
    }

    push(cmd) {
        if (!cmd) return;
        this.history = this.history.slice(0, this.index + 1);
        this.history.push(cmd);
        this.index++;
        if (this.history.length > 500) {
            this.history.shift();
            this.index--;
        }
    }

    undo() {
        if (this.index < 0) return;
        const cmd = this.history[this.index];
        if (cmd && typeof cmd.undo === "function") cmd.undo();
        this.index--;
    }

    redo() {
        if (this.index >= this.history.length - 1) return;
        this.index++;
        const cmd = this.history[this.index];
        if (cmd && typeof cmd.redo === "function") cmd.redo();
    }
}

// ---------------------------------------------------------------------------
// TransformCommand
// ---------------------------------------------------------------------------

export class TransformCommand {
    constructor(obj, oldState, newState) {
        this.obj = obj;
        // Defensive property mapping (p/q/s vs position/quaternion/scale)
        const getS = (s) => (s ? {
            p: (s.p || s.position)?.clone(),
            q: (s.q || s.quaternion)?.clone(),
            s: (s.s || s.scale)?.clone()
        } : null);
        this.old = getS(oldState);
        this.new = getS(newState);
    }

    undo() {
        if (!this.obj || !this.old?.p) return;
        this.obj.position.copy(this.old.p);
        this.obj.quaternion.copy(this.old.q);
        this.obj.scale.copy(this.old.s);
        this.obj.updateMatrixWorld(true);
        // NOTE: callers are responsible for invoking updateSelectionProxy / triggerUpdate
    }

    redo() {
        if (!this.obj || !this.new?.p) return;
        this.obj.position.copy(this.new.p);
        this.obj.quaternion.copy(this.new.q);
        this.obj.scale.copy(this.new.s);
        this.obj.updateMatrixWorld(true);
    }
}

// ---------------------------------------------------------------------------
// MultiTransformCommand
// ---------------------------------------------------------------------------

export class MultiTransformCommand {
    constructor(objs, initialStates, finalStates) {
        this.cmds = objs.map(obj => new TransformCommand(obj, initialStates.get(obj), finalStates.get(obj)));
    }

    undo() { this.cmds.forEach(c => c.undo()); }
    redo() { this.cmds.forEach(c => c.redo()); }
}

// ---------------------------------------------------------------------------
// SubMeshSelectionCommand
// ---------------------------------------------------------------------------

export class SubMeshSelectionCommand {
    constructor(mesh, oldSub, newSub) {
        this.mesh = mesh;
        // Convert Sets to Arrays for storage
        const toArr = (s) => (s ? Array.from(s) : []);
        this.old = { v: toArr(oldSub.vertices), e: toArr(oldSub.edges), f: toArr(oldSub.faces) };
        this.new = { v: toArr(newSub.vertices), e: toArr(newSub.edges), f: toArr(newSub.faces) };
    }

    // NOTE: callers supply the live selectedSubElements map and updateSubMeshHighlights fn
    // These are set by SelectionManager after instantiation.
    _apply(data, selectedSubElements, updateSubMeshHighlights, triggerUpdate) {
        selectedSubElements.set(this.mesh.uuid, {
            vertices: new Set(data.v),
            edges: new Set(data.e),
            faces: new Set(data.f)
        });
        updateSubMeshHighlights();
        triggerUpdate();
    }

    // Bind callbacks after construction for back-compat with original inline closures.
    bind(selectedSubElements, updateSubMeshHighlights, triggerUpdate) {
        this.undo = () => this._apply(this.old, selectedSubElements, updateSubMeshHighlights, triggerUpdate);
        this.redo = () => this._apply(this.new, selectedSubElements, updateSubMeshHighlights, triggerUpdate);
    }
}

// ---------------------------------------------------------------------------
// SubMeshTransformCommand
// ---------------------------------------------------------------------------

export class SubMeshTransformCommand {
    constructor(transformData) {
        // transformData is Map: meshUUID -> { indices: [], old: [], new: [] }
        this.data = new Map();
        transformData.forEach((val, meshUUID) => {
            this.data.set(meshUUID, {
                indices: [...val.indices],
                old: val.old.map(v => v.clone()),
                new: val.new.map(v => v.clone())
            });
        });
    }

    // Bind live scene references after construction.
    bind(scene, updateSubMeshHighlights, updateSelectionProxy, triggerUpdate) {
        const apply = (posKey) => {
            this.data.forEach((val, meshUUID) => {
                const mesh = scene.getObjectByProperty("uuid", meshUUID);
                if (!mesh || !mesh.geometry) return;
                const attr = mesh.geometry.attributes.position;
                val.indices.forEach((idx, i) => {
                    const p = val[posKey][i];
                    attr.setXYZ(idx, p.x, p.y, p.z);
                });
                attr.needsUpdate = true;
                mesh.geometry.computeVertexNormals();
                mesh.geometry.computeBoundingBox();
                mesh.geometry.computeBoundingSphere();
                if (mesh.geometry.computeBoundsTree) mesh.geometry.computeBoundsTree();
            });
            updateSubMeshHighlights();
            updateSelectionProxy();
            triggerUpdate();
        };

        this.undo = () => apply("old");
        this.redo = () => {
            console.log(`Comfy3D: SubMeshTransform Redo starting for ${this.data.size} meshes...`);
            apply("new");
        };
    }
}

// ---------------------------------------------------------------------------
// AssetCommand
// ---------------------------------------------------------------------------

export class AssetCommand {
    constructor(obj, isAdd, assetsArr, scene) {
        this.obj = obj;
        this.isAdd = isAdd;
        this.assetsArr = assetsArr;
        this.scene = scene;
        this.parent = obj.parent || scene;
    }

    undo() { if (this.isAdd) this.remove(); else this.add(); }
    redo() { if (this.isAdd) this.add(); else this.remove(); }

    add() {
        if (!this.assetsArr.includes(this.obj)) this.assetsArr.push(this.obj);
        this.parent.add(this.obj);
    }

    remove() {
        const idx = this.assetsArr.indexOf(this.obj);
        if (idx > -1) this.assetsArr.splice(idx, 1);
        this.obj.parent?.remove(this.obj);
    }
}

// ---------------------------------------------------------------------------
// RenameCommand
// ---------------------------------------------------------------------------

export class RenameCommand {
    constructor(obj, oldName, newName) {
        this.obj = obj;
        this.oldName = oldName;
        this.newName = newName;
    }

    undo() {
        console.log(`Comfy3D: Rename Undo: '${this.newName}' -> '${this.oldName}'`);
        this.obj.name = this.oldName;
    }

    redo() {
        console.log(`Comfy3D: Rename Redo: '${this.oldName}' -> '${this.newName}'`);
        this.obj.name = this.newName;
    }
}

// ---------------------------------------------------------------------------
// MultiAssetCommand
// ---------------------------------------------------------------------------

export class MultiAssetCommand {
    constructor(objs, isAdd, assetsArr, scene) {
        this.cmds = objs.map(obj => new AssetCommand(obj, isAdd, assetsArr, scene));
    }

    undo() { this.cmds.forEach(c => c.undo()); }
    redo() { this.cmds.forEach(c => c.redo()); }
    add() { this.cmds.forEach(c => c.add()); }
    remove() { this.cmds.forEach(c => c.remove()); }
}

// ---------------------------------------------------------------------------
// SeparateMeshCommand
// ---------------------------------------------------------------------------

export class SeparateMeshCommand {
    constructor(originalMeshes, newMeshes, assetsArr, sceneObj) {
        this.originalsCmd = new MultiAssetCommand(originalMeshes, false, assetsArr, sceneObj);
        this.newMeshesCmd = new MultiAssetCommand(newMeshes, true, assetsArr, sceneObj);
        this._oldSelection = null; // set by SelectionManager after construction
        this._newSelection = [...newMeshes];
    }

    // Called by SelectionManager to capture current selection state.
    captureOldSelection(selectedObjects) {
        this._oldSelection = [...selectedObjects];
    }

    // Bind live refs: isolatedObjects map getter, selectedObjects setter, updateOutliner fn
    bind(getIsolatedObjects, setSelectedObjects, updateOutliner) {
        this.undo = () => {
            this.newMeshesCmd.undo();
            this.originalsCmd.undo();
            const iso = getIsolatedObjects();
            if (iso) {
                this.newMeshesCmd.cmds.forEach(c => iso.delete(c.obj));
                this.originalsCmd.cmds.forEach(c => iso.set(c.obj, true));
            }
            if (this._oldSelection) setSelectedObjects([...this._oldSelection]);
            updateOutliner();
        };

        this.redo = () => {
            this.originalsCmd.redo();
            this.newMeshesCmd.redo();
            const iso = getIsolatedObjects();
            if (iso) {
                this.originalsCmd.cmds.forEach(c => iso.set(c.obj, false));
                this.newMeshesCmd.cmds.forEach(c => iso.set(c.obj, true));
            }
            setSelectedObjects([...this._newSelection]);
            updateOutliner();
        };
    }
}
