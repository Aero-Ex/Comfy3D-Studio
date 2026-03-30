/**
 * ShadingManager.js
 * Manages viewport shading modes (wireframe / solid / material / normal),
 * X-ray transparency, and large-mesh chunking for sub-frustum culling.
 *
 * Extracted verbatim from web/3d_viewport.js lines 1349–1529.
 */

export class ShadingManager {
    /**
     * @param {object} THREE
     * @param {object[]} assets - Live array of root scene objects.
     * @param {Function} triggerUpdate - Requests a render frame.
     */
    constructor(THREE, assets, triggerUpdate) {
        this.THREE = THREE;
        this.assets = assets;
        this.triggerUpdate = triggerUpdate;

        this.currentShadingMode = "material";
        this.xrayMode = false;

        this.solidMaterial = new THREE.MeshPhongMaterial({
            color: 0x777777, specular: 0x111111, shininess: 20,
            flatShading: true, side: THREE.DoubleSide
        });
        this.normalMaterial = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
    }

    // -----------------------------------------------------------------------
    // chunkMesh — splits a massive mesh into draw-range sub-chunks
    //
    // -----------------------------------------------------------------------
    chunkMesh(mesh, targetTriangles = 500000) {
        const THREE = this.THREE;
        if (!mesh || !mesh.geometry || !mesh.geometry.index) return mesh;
        const geo = mesh.geometry;
        const totalTriangles = geo.index.count / 3;
        if (totalTriangles <= targetTriangles * 1.2) return mesh;

        console.log(`Comfy3D: Chunking massive mesh (${(totalTriangles / 1e6).toFixed(1)}M faces) into ${Math.ceil(totalTriangles / targetTriangles)} parts...`);

        const numChunks = Math.ceil(totalTriangles / targetTriangles);
        const group = new THREE.Group();
        group.name = mesh.name + "_chunked";
        group.userData = { ...mesh.userData, isChunked: true, originalMesh: mesh };

        group.position.copy(mesh.position);
        group.quaternion.copy(mesh.quaternion);
        group.scale.copy(mesh.scale);
        group.matrixAutoUpdate = mesh.matrixAutoUpdate;

        const posAttr = geo.attributes.position;
        const indexAttr = geo.index;

        for (let i = 0; i < numChunks; i++) {
            const start = i * targetTriangles * 3;
            const count = Math.min(targetTriangles * 3, geo.index.count - start);
            if (count <= 0) break;

            const chunkGeo = new THREE.BufferGeometry();
            // Share all attributes to avoid memory duplication
            Object.keys(geo.attributes).forEach(key => {
                chunkGeo.setAttribute(key, geo.attributes[key]);
            });
            chunkGeo.setIndex(indexAttr);
            chunkGeo.setDrawRange(start, count);

            // Manually compute accurate bounding box for this chunk's range
            const box = new THREE.Box3();
            const v3 = new THREE.Vector3();
            for (let j = start; j < start + count; j++) {
                const vIdx = indexAttr.getX(j);
                v3.fromBufferAttribute(posAttr, vIdx);
                box.expandByPoint(v3);
            }
            chunkGeo.boundingBox = box;

            // Compute bounding sphere for frustum culling
            const sphere = new THREE.Sphere();
            box.getCenter(sphere.center);
            sphere.radius = box.min.distanceTo(box.max) / 2;
            chunkGeo.boundingSphere = sphere;

            const chunkMeshObj = new THREE.Mesh(chunkGeo, mesh.material);
            chunkMeshObj.name = `${mesh.name}_chunk_${i}`;
            chunkMeshObj.frustumCulled = true;
            chunkMeshObj.castShadow = mesh.castShadow;
            chunkMeshObj.receiveShadow = mesh.receiveShadow;

            group.add(chunkMeshObj);
        }

        if (mesh.parent) {
            mesh.parent.add(group);
            mesh.parent.remove(mesh);
        }

        const assetIdx = this.assets.indexOf(mesh);
        if (assetIdx > -1) {
            this.assets[assetIdx] = group;
        }

        mesh.visible = false;
        return group;
    }

    // -----------------------------------------------------------------------
    // updateMeshShading — applies current mode to one mesh
    //
    // -----------------------------------------------------------------------
    updateMeshShading(mesh) {
        const THREE = this.THREE;
        if (!mesh || !mesh.isMesh) return;
        if (mesh.userData.isChunked) return;

        // Compute BVH and bounding volume once
        if (mesh.geometry) {
            if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
            if (mesh.geometry.computeBoundsTree && !mesh.geometry.boundsTree) {
                console.log(`Comfy3D: Computing BVH for ${mesh.name || "mesh"}...`);
                mesh.geometry.computeBoundsTree();

                if (mesh.geometry.index && mesh.geometry.index.count / 3 > 1000000) {
                    mesh = this.chunkMesh(mesh, 500000);
                }
            }
        }

        const applyToMesh = (m) => {
            if (m.isGroup) { m.children.forEach(applyToMesh); return; }
            if (!m.isMesh) return;

            if (!m.userData.origMat) {
                m.userData.origMat = m.material;
                m.userData.origTransparent = m.material.transparent;
                m.userData.origOpacity = m.material.opacity;
                m.userData.origDepthWrite = m.material.depthWrite;
                m.userData.origSide = m.material.side;
            }

            if (this.currentShadingMode === "solid" || this.currentShadingMode === "normal") {
                if (m.geometry && !m.geometry.attributes.normal) {
                    m.geometry.computeVertexNormals();
                }
            }

            switch (this.currentShadingMode) {
                case "wireframe":
                    m.material = m.userData.origMat;
                    m.material.wireframe = true;
                    break;
                case "solid":
                    m.material = this.solidMaterial;
                    break;
                case "normal":
                    m.material = this.normalMaterial;
                    break;
                default:
                    m.material = m.userData.origMat;
                    m.material.wireframe = false;
                    break;
            }

            if (this.xrayMode) {
                m.material.transparent = true;
                m.material.opacity = 0.5;
                m.material.depthWrite = false;
                m.material.side = THREE.DoubleSide;
            } else {
                if (m.material === m.userData.origMat) {
                    m.material.transparent = m.userData.origTransparent;
                    m.material.opacity = m.userData.origOpacity;
                    m.material.depthWrite = m.userData.origDepthWrite;
                    m.material.side = m.userData.origSide;
                } else {
                    m.material.transparent = false;
                    m.material.opacity = 1.0;
                    m.material.depthWrite = true;
                    m.material.side = THREE.DoubleSide;
                }
            }
        };

        applyToMesh(mesh);
    }

    // -----------------------------------------------------------------------
    // setShadingMode
    //
    // -----------------------------------------------------------------------
    setShadingMode(mode) {
        this.currentShadingMode = mode;
        this.assets.forEach(root => root.traverse(m => this.updateMeshShading(m)));
        this.triggerUpdate();
    }

    /** Toggle X-ray transparency on all assets. */
    toggleXray() {
        this.xrayMode = !this.xrayMode;
        this.assets.forEach(root => root.traverse(m => this.updateMeshShading(m)));
        this.triggerUpdate();
    }
}
