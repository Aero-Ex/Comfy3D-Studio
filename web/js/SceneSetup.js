/**
 * SceneSetup.js
 * Creates the Three.js scene, camera, renderer, gizmo renderer, studio
 * lighting, infinite grid plane, floor axis lines, and loading overlay DOM.
 *
 * Extracted verbatim from web/3d_viewport.js lines 532–597, 1835–1907.
 */

export class SceneSetup {
    /**
     * @param {object} THREE - Fully patched Three.js namespace from ThreeLoader.
     * @param {HTMLElement} canvasArea - Container div for the renderer canvas.
     */
    constructor(THREE, canvasArea) {
        this.THREE = THREE;
        this.canvasArea = canvasArea;
        this._build();
    }

    _build() {
        const THREE = this.THREE;
        const canvasArea = this.canvasArea;

        // ------------------------------------------------------------------
        // Scene & Camera
        // ------------------------------------------------------------------
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a0a);

        this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
        this.camera.position.set(5, 5, 5);

        // ── Groups and Proxies ───────────────────────────────────────
        this.pointsGroup = new THREE.Group();
        this.scene.add(this.pointsGroup);

        this.selectionProxy = new THREE.Object3D();
        this.selectionProxy.name = "SelectionProxy";
        this.scene.add(this.selectionProxy);

        // Orange bounding-box outline
        this.selectionHelper = new THREE.Group();
        this.selectionWireframe = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
            new THREE.LineBasicMaterial({ color: 0xff9500, linewidth: 2.5, transparent: true, opacity: 0.8 })
        );
        this.selectionHelper.add(this.selectionWireframe);
        this.selectionHelper.visible = false;
        this.scene.add(this.selectionHelper);

        // Sub-mesh highlight overlays
        this.vertexHighlight = new THREE.Points(
            new THREE.BufferGeometry(),
            new THREE.PointsMaterial({ color: 0xff9500, size: 6, sizeAttenuation: false, depthTest: false, transparent: true })
        );
        this.vertexHighlight.renderOrder = 999;
        this.scene.add(this.vertexHighlight);

        this.edgeHighlight = new THREE.LineSegments(
            new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial({ color: 0xff9500, linewidth: 2, depthTest: false, transparent: true })
        );
        this.edgeHighlight.renderOrder = 998;
        this.scene.add(this.edgeHighlight);

        // Persistent background overlays (Blender look)
        this.persistentVertexPoints = new THREE.Points(
            new THREE.BufferGeometry(),
            new THREE.PointsMaterial({ color: 0x000000, size: 5, sizeAttenuation: false, depthTest: true, transparent: true, opacity: 1.0 })
        );
        this.persistentVertexPoints.renderOrder = 991;
        this.scene.add(this.persistentVertexPoints);

        this.persistentWireframe = new THREE.LineSegments(
            new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 1, transparent: true, opacity: 0.5, depthTest: true })
        );
        this.persistentWireframe.renderOrder = 990;
        this.scene.add(this.persistentWireframe);

        this.faceHighlight = new THREE.Mesh(
            new THREE.BufferGeometry(),
            new THREE.MeshBasicMaterial({ color: 0xff9500, side: THREE.DoubleSide, transparent: true, opacity: 0.4, depthTest: false })
        );
        this.faceHighlight.renderOrder = 997;
        this.scene.add(this.faceHighlight);

        // ------------------------------------------------------------------
        // Main Renderer
        // ------------------------------------------------------------------
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            preserveDrawingBuffer: false,
            powerPreference: "high-performance"
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        this.renderer.setClearColor(0x1a1a1a, 1);
        Object.assign(this.renderer.domElement.style, {
            position: "absolute", top: "0", left: "0",
            width: "100%", height: "100%", display: "block"
        });
        canvasArea.appendChild(this.renderer.domElement);

        // WebGL Context Loss Recovery
        this.renderer.domElement.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            console.warn("Comfy3D: WebGL Context Lost! Re-initializing...");
            if (this._animationId) cancelAnimationFrame(this._animationId);
        }, false);

        this.renderer.domElement.addEventListener("webglcontextrestored", () => {
            console.log("Comfy3D: WebGL Context Restored.");
            this.renderer.setClearColor(0x0a0a0a, 1);
            if (this._onContextRestored) this._onContextRestored();
        }, false);

        // ------------------------------------------------------------------
        // Isolated Gizmo Renderer
        // ------------------------------------------------------------------
        this.gizmoRenderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
        this.gizmoRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        this.gizmoRenderer.setSize(100, 100);
        Object.assign(this.gizmoRenderer.domElement.style, {
            position: "absolute", bottom: "10px", left: "10px",
            width: "100px", height: "100px", pointerEvents: "none", zIndex: "10"
        });
        canvasArea.appendChild(this.gizmoRenderer.domElement);

        // Gizmo Scene & Camera
        this.gizmoScene = new THREE.Scene();
        this.gizmoCamera = new THREE.OrthographicCamera(-1.8, 1.8, 1.8, -1.8, 0.1, 10);
        this.gizmoCamera.position.set(0, 0, 5);
        this.gizmoCamera.lookAt(0, 0, 0);

        this.gizmoGroup = new THREE.Group();
        this.gizmoScene.add(this.gizmoGroup);

        // ------------------------------------------------------------------
        // Loading Overlay
        // ------------------------------------------------------------------
        this.loadingOverlay = document.createElement("div");
        Object.assign(this.loadingOverlay.style, {
            position: "absolute", top: "0", left: "0", width: "100%", height: "100%",
            backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
            display: "none", justifyContent: "center", alignItems: "center",
            zIndex: "2000", transition: "opacity 0.3s ease", opacity: "0",
            flexDirection: "column", gap: "12px", color: "white"
        });
        this.loadingOverlay.innerHTML = `
            <div class="comfy3d-spinner" style="width:32px; height:32px; border:3px solid rgba(255,255,255,0.1); border-top-color:#ff9500; border-radius:50%; animation: comfy3d-spin 1s linear infinite;"></div>
            <div style="font-size:10px; font-weight:700; letter-spacing:0.1em; opacity:0.8; color:#ff9500;">PROCESSING MESH...</div>
            <style>
                @keyframes comfy3d-spin { 100% { transform: rotate(360deg); } }
            </style>
        `;
        canvasArea.appendChild(this.loadingOverlay);

        // ── Helper DOM Elements ──────────────────────────────────────
        this.selectionRect = document.createElement("div");
        Object.assign(this.selectionRect.style, {
            position: "absolute", border: "1px dashed #ff9500",
            backgroundColor: "rgba(255,149,0,0.1)", display: "none", pointerEvents: "none", zIndex: "100"
        });
        canvasArea.appendChild(this.selectionRect);

        this.brushCursor = document.createElement("div");
        Object.assign(this.brushCursor.style, {
            position: "absolute", borderRadius: "50%", border: "2px solid rgba(255,149,0,0.5)",
            display: "none", pointerEvents: "none", zIndex: "100", transform: "translate(-50%, -50%)"
        });
        canvasArea.appendChild(this.brushCursor);

        // ------------------------------------------------------------------
        // Grid Plane (shader-based)
        // ------------------------------------------------------------------
        const gridMaterial = new THREE.ShaderMaterial({
            transparent: true,
            uniforms: {
                uColor1: { value: new THREE.Color(0x666666) },
                uColor2: { value: new THREE.Color(0x333333) },
                uFadeDist: { value: 120.0 }
            },
            vertexShader: `
                varying vec3 vWorldPos;
                void main() {
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPos = worldPos.xyz;
                    gl_Position = projectionMatrix * viewMatrix * worldPos;
                }
            `,
            fragmentShader: `
                varying vec3 vWorldPos;
                uniform vec3 uColor1;
                uniform vec3 uColor2;
                uniform float uFadeDist;

                float grid(float size, float thickness) {
                    vec2 r = vWorldPos.xz / size;
                    vec2 grid = abs(fract(r - 0.5) - 0.5) / fwidth(r);
                    float line = min(grid.x, grid.y);
                    return 1.0 - smoothstep(thickness - 0.5, thickness + 0.5, line);
                }

                void main() {
                    float g1 = grid(1.0, 0.8);
                    float g2 = grid(0.1, 0.4);

                    float dist = length(vWorldPos.xz - cameraPosition.xz);
                    float fade = pow(clamp(1.0 - dist / uFadeDist, 0.0, 1.0), 3.0);

                    vec3 color = mix(uColor2, uColor1, g1);
                    float alpha = max(g1 * 0.8, g2 * 0.4) * fade;

                    if (alpha < 0.01) discard;
                    gl_FragColor = vec4(color, alpha);
                }
            `,
            side: THREE.DoubleSide
        });
        const gridPlane = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), gridMaterial);
        gridPlane.rotation.x = -Math.PI / 2;
        gridPlane.position.y = -0.001;
        this.scene.add(gridPlane);

        // ------------------------------------------------------------------
        // Floor Axis Lines
        // ------------------------------------------------------------------
        const xAxisGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-50, 0, 0), new THREE.Vector3(50, 0, 0)
        ]);
        this.xAxis = new THREE.Line(
            xAxisGeom,
            new THREE.LineBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.6 })
        );
        this.scene.add(this.xAxis);

        const zAxisGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, -50), new THREE.Vector3(0, 0, 50)
        ]);
        this.zAxis = new THREE.Line(
            zAxisGeom,
            new THREE.LineBasicMaterial({ color: 0x4cd964, transparent: true, opacity: 0.6 })
        );
        this.scene.add(this.zAxis);

        // ------------------------------------------------------------------
        // Studio Lighting (3-point)
        // ------------------------------------------------------------------
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.0));
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));

        const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
        keyLight.position.set(10, 10, 10);
        this.scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
        fillLight.position.set(-10, 5, 10);
        this.scene.add(fillLight);

        const backLight = new THREE.DirectionalLight(0xffffff, 0.4);
        backLight.position.set(0, 10, -10);
        this.scene.add(backLight);

        // ── Controls ───────────────────────────────────────────────────
        this.orbit = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.orbit.enableDamping = true;
        this.orbit.dampingFactor = 0.05;
        this.orbit.screenSpacePanning = true;

        this.transform = new THREE.TransformControls(this.camera, this.renderer.domElement);
        this.scene.add(this.transform);
    }

    /** 
     * Verbatim extraction of gizmo creation logic from monolithic script.
     */
    createGizmo(gizmoGroup, gizmoRenderer, gizmoCamera, mainCamera, orbit, triggerUpdate) {
        const THREE = this.THREE;
        const gizmo = new THREE.Object3D();
        gizmoGroup.add(gizmo);

        const createAxis = (dir, color, label) => {
            const axis = new THREE.Group();
            const lineGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), dir.clone().multiplyScalar(0.8)]);
            const line = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color, linewidth: 2 }));
            axis.add(line);

            // Cap
            const capGeom = new THREE.SphereGeometry(0.12, 8, 8);
            const cap = new THREE.Mesh(capGeom, new THREE.MeshBasicMaterial({ color }));
            cap.position.copy(dir.clone().multiplyScalar(0.8));
            axis.add(cap);
            return axis;
        };

        const xA = createAxis(new THREE.Vector3(1,0,0), 0xff3b30, "X");
        const yA = createAxis(new THREE.Vector3(0,1,0), 0x4cd964, "Y");
        const zA = createAxis(new THREE.Vector3(0,0,1), 0x007aff, "Z");
        gizmo.add(xA, yA, zA);

        const onDown = (e) => {
            const rect = gizmoRenderer.domElement.getBoundingClientRect();
            const m = new THREE.Vector2(((e.clientX - rect.left)/100)*2 - 1, -((e.clientY - rect.top)/100)*2 + 1);
            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(m, gizmoCamera);
            const intersects = raycaster.intersectObjects([xA, yA, zA], true);
            if (intersects.length > 0) {
                const obj = intersects[0].object;
                if (obj.parent === xA) orbit.setAzimuthalAngle(Math.PI/2);
                else if (obj.parent === yA) orbit.setPolarAngle(0);
                else if (obj.parent === zA) orbit.setAzimuthalAngle(0);
                triggerUpdate();
            }
        };
        gizmoRenderer.domElement.addEventListener("mousedown", onDown);
    }

    // -----------------------------------------------------------------------
    // Public helpers
    // -----------------------------------------------------------------------

    /** Show or hide the loading overlay with a fade transition. */
    toggleLoading(show) {
        if (show) {
            this.loadingOverlay.style.display = "flex";
            setTimeout(() => { this.loadingOverlay.style.opacity = "1"; }, 10);
        } else {
            this.loadingOverlay.style.opacity = "0";
            setTimeout(() => {
                if (this.loadingOverlay.style.opacity === "0")
                    this.loadingOverlay.style.display = "none";
            }, 300);
        }
    }

    /** Resize renderer + camera aspect to match container. */
    resize(w, h) {
        if (w > 0 && h > 0) {
            this.renderer.setSize(w, h, false);
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
        }
    }

    /** Dispose both renderers. */
    dispose() {
        this.renderer.dispose();
        this.gizmoRenderer.dispose();
    }
}
