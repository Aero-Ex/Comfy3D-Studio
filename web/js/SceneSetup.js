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
        this.scene.background = new THREE.Color(0x1a1a1a);

        this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
        this.camera.position.set(5, 5, 5);

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
            this.renderer.setClearColor(0x1a1a1a, 1);
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
        const xAxis = new THREE.Line(
            xAxisGeom,
            new THREE.LineBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.6 })
        );
        this.scene.add(xAxis);

        const zAxisGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, -50), new THREE.Vector3(0, 0, 50)
        ]);
        const zAxis = new THREE.Line(
            zAxisGeom,
            new THREE.LineBasicMaterial({ color: 0x4cd964, transparent: true, opacity: 0.6 })
        );
        this.scene.add(zAxis);

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
