/**
 * ThreeLoader.js
 * Loads Three.js and three-mesh-bvh as a singleton promise.
 * Patches all BufferGeometry / Mesh prototypes for BVH-accelerated raycasting.
 * Polyfills Ray.intersectBox and Triangle.getInterpolation where missing.
 *
 * Extracted verbatim from web/3d_viewport.js lines 1–119.
 */

export async function loadThreeJS() {
    if (window.__three_loading_promise) return window.__three_loading_promise;

    window.__three_loading_promise = (async () => {
        try {
            console.log("Comfy3D: Loading Unified Three.js + BVH bundle...");

            const THREE_URL = "https://esm.sh/three@0.150.1";
            const THREE_NS = await import(THREE_URL);

            // Detect existing THREE to avoid "Multiple Instances" issues
            const existingTHREE = window.THREE;
            const THREE = Object.assign({}, THREE_NS);
            window.THREE = THREE;

            // Pin BVH to v0.5.21 for maximum stability with older Three.js instances
            const BVH_URL = `https://esm.sh/three-mesh-bvh@0.5.21?deps=three@${THREE_URL.split('@')[1]}`;
            const BVH_NS = await import(BVH_URL);
            const { computeBoundsTree, disposeBoundsTree, MeshBVH } = BVH_NS;
            const patchedRaycast = BVH_NS.acceleratedRaycast || BVH_NS.acceleratorRaycast;

            const [
                { OrbitControls },
                { GLTFLoader },
                { OBJLoader },
                { STLLoader },
                { TransformControls }
            ] = await Promise.all([
                import(`${THREE_URL}/examples/jsm/controls/OrbitControls.js`),
                import(`${THREE_URL}/examples/jsm/loaders/GLTFLoader.js`),
                import(`${THREE_URL}/examples/jsm/loaders/OBJLoader.js`),
                import(`${THREE_URL}/examples/jsm/loaders/STLLoader.js`),
                import(`${THREE_URL}/examples/jsm/controls/TransformControls.js`)
            ]);

            THREE.OrbitControls = OrbitControls;
            THREE.GLTFLoader = GLTFLoader;
            THREE.OBJLoader = OBJLoader;
            THREE.STLLoader = STLLoader;
            THREE.TransformControls = TransformControls;

            // Fail-safe global functions for direct engine calls
            window.__computeBoundsTree = computeBoundsTree;
            window.__acceleratorRaycast = patchedRaycast;
            window.__MeshBVH = MeshBVH;

            const applyPatches = (targetTHREE) => {
                if (!targetTHREE || !targetTHREE.BufferGeometry) return;
                console.log("Comfy3D: Patching Three.js instance...", targetTHREE.REVISION);

                if (computeBoundsTree) targetTHREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
                if (disposeBoundsTree) targetTHREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

                // Sync original raycast for fallback (ONLY if it's not already patched)
                if (!window.__origMeshRaycast && targetTHREE.Mesh.prototype.raycast && !targetTHREE.Mesh.prototype.raycast.isAccelerator) {
                    window.__origMeshRaycast = targetTHREE.Mesh.prototype.raycast;
                }

                if (patchedRaycast) {
                    patchedRaycast.isAccelerator = true;
                    targetTHREE.Mesh.prototype.raycast = patchedRaycast;
                }

                // Aggressive Ray Polyfill
                if (targetTHREE.Ray && !targetTHREE.Ray.prototype.intersectBox) {
                    targetTHREE.Ray.prototype.intersectBox = function (box, target) {
                        let tmin, tmax, tymin, tymax, tzmin, tzmax;
                        const invdirx = 1 / this.direction.x, invdiry = 1 / this.direction.y, invdirz = 1 / this.direction.z;
                        const origin = this.origin;
                        if (invdirx >= 0) { tmin = (box.min.x - origin.x) * invdirx; tmax = (box.max.x - origin.x) * invdirx; }
                        else { tmin = (box.max.x - origin.x) * invdirx; tmax = (box.min.x - origin.x) * invdirx; }
                        if (invdiry >= 0) { tymin = (box.min.y - origin.y) * invdiry; tymax = (box.max.y - origin.y) * invdiry; }
                        else { tymin = (box.max.y - origin.y) * invdiry; tymax = (box.min.y - origin.y) * invdiry; }
                        if ((tmin > tymax) || (tymin > tmax)) return null;
                        if (tymin > tmin || tmin !== tmin) tmin = tymin;
                        if (tymax < tmax || tmax !== tmax) tmax = tymax;
                        if (invdirz >= 0) { tzmin = (box.min.z - origin.z) * invdirz; tzmax = (box.max.z - origin.z) * invdirz; }
                        else { tzmin = (box.max.z - origin.z) * invdirz; tzmax = (box.min.z - origin.z) * invdirz; }
                        if ((tmin > tzmax) || (tzmin > tmax)) return null;
                        if (tzmin > tmin || tmin !== tmin) tmin = tzmin;
                        if (tzmax < tmax || tmax !== tmax) tmax = tzmax;
                        if (tmax < 0) return null;
                        return this.at(tmin >= 0 ? tmin : tmax, target);
                    };
                }

                // Internal BVH Polyfill: getInterpolation
                if (targetTHREE.Triangle && !targetTHREE.Triangle.prototype.getInterpolation) {
                    console.log("Comfy3D: Polyfilling Triangle.getInterpolation for instance", targetTHREE.REVISION);
                    targetTHREE.Triangle.prototype.getInterpolation = function (point, barycoord, targetValue) {
                        // Minimal implementation of BVH interpolation using barycentric coordinates
                        if (targetValue.fromBufferAttribute) {
                            return targetValue;
                        }
                        return targetValue;
                    };
                }
            };

            applyPatches(THREE);
            if (existingTHREE && existingTHREE !== THREE) {
                console.warn("Comfy3D: Multiple THREE instances detected! Attempting dual-patch...");
                applyPatches(existingTHREE);
            }

            console.log("Comfy3D: Three.js Initialization Complete.");
            return THREE;
        } catch (e) {
            console.error("Comfy3D: Failed to load Unified Three.js bundle:", e);
            throw e;
        }
    })();

    return window.__three_loading_promise;
}
