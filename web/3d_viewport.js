import { app } from "../../../scripts/app.js";

async function loadThreeJS() {
    if (window.THREE && window.THREE.OrbitControls && window.THREE.GLTFLoader && window.THREE.TransformControls) return window.THREE;
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
        script.onload = () => {
            const loaders = [
                "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js",
                "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js",
                "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/OBJLoader.js",
                "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/STLLoader.js",
                "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/TransformControls.js"
            ];
            let loadedCount = 0;
            loaders.forEach(url => {
                const s = document.createElement("script");
                s.src = url;
                s.onload = () => {
                    loadedCount++;
                    if (loadedCount === loaders.length) resolve(window.THREE);
                };
                document.head.appendChild(s);
            });
        };
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

app.registerExtension({
    name: "Comfy3D-Studio",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "Comfy3D-Studio") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = async function () {
                onNodeCreated?.apply(this, arguments);
                console.log("Comfy3D: Node created, initializing threejs...");
                await this.initThreeJS();
                this.size = [1200, 720];

                if (!document.getElementById("comfy3d-studio-styles")) {
                    const style = document.createElement("style");
                    style.id = "comfy3d-studio-styles";
                    style.textContent = `
                        .comfy3d-brush-slider {
                            -webkit-appearance: none;
                            width: 100px;
                            height: 4px;
                            background: rgba(255, 255, 255, 0.1);
                            border-radius: 2px;
                            outline: none;
                            transition: all 0.2s;
                        }
                        .comfy3d-brush-slider::-webkit-slider-thumb {
                            -webkit-appearance: none;
                            width: 14px;
                            height: 14px;
                            background: #ff9500;
                            border-radius: 50%;
                            cursor: pointer;
                            border: 2px solid white;
                            box-shadow: 0 0 10px rgba(255, 149, 0, 0.5);
                            transition: transform 0.2s;
                        }
                        .comfy3d-brush-slider::-moz-range-thumb {
                            width: 12px;
                            height: 12px;
                            background: #ff9500;
                            border-radius: 50%;
                            cursor: pointer;
                            border: 2px solid white;
                            box-shadow: 0 0 10px rgba(255, 149, 0, 0.5);
                            transition: transform 0.2s;
                        }
                        .comfy3d-brush-slider::-webkit-slider-thumb:hover,
                        .comfy3d-brush-slider::-moz-range-thumb:hover {
                            transform: scale(1.15);
                            box-shadow: 0 0 15px rgba(255, 149, 0, 0.8);
                        }
                        .comfy3d-brush-select {
                            appearance: none;
                            background: rgba(0,0,0,0.4);
                            color: white;
                            border: 1px solid rgba(255,255,255,0.1);
                            border-radius: 6px;
                            padding: 4px 10px;
                            font-size: 10px;
                            outline: none;
                            cursor: pointer;
                            transition: border-color 0.2s;
                        }
                        .comfy3d-brush-select:hover {
                            border-color: rgba(255, 149, 0, 0.5);
                        }
                        .comfy3d-brush-color {
                            padding: 0;
                            border: 1px solid rgba(255,255,255,0.1);
                            border-radius: 6px;
                            width: 34px;
                            height: 22px;
                            cursor: pointer;
                            background: none;
                        }
                        .comfy3d-brush-color::-webkit-color-swatch-wrapper { padding: 2px; }
                        .comfy3d-brush-color::-webkit-color-swatch { border-radius: 4px; border: none; }
                        .comfy3d-brush-checkbox {
                            appearance: none;
                            width: 16px;
                            height: 16px;
                            background: rgba(255,255,255,0.05);
                            border: 1px solid rgba(255,255,255,0.1);
                            border-radius: 4px;
                            cursor: pointer;
                            position: relative;
                            transition: all 0.2s;
                        }
                        .comfy3d-brush-checkbox:checked {
                            background: #ff9500;
                            border-color: #ff9500;
                        }
                        .comfy3d-brush-checkbox:checked::after {
                            content: '✓';
                            position: absolute;
                            top: 50%;
                            left: 50%;
                            transform: translate(-50%, -50%);
                            color: white;
                            font-size: 10px;
                        }
                        .comfy3d-toolbar-btn {
                            transition: all 0.4s cubic-bezier(0.23, 1, 0.32, 1) !important;
                        }
                        .comfy3d-toolbar-btn:hover {
                            background-color: rgba(255, 255, 255, 0.12) !important;
                            border-color: rgba(255, 255, 255, 0.2) !important;
                            transform: translateY(-2px) !important;
                            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
                        }
                        .comfy3d-toolbar-btn:active {
                            transform: translateY(0) scale(0.92) !important;
                        }
                    `;
                    document.head.appendChild(style);
                }
            };

            nodeType.prototype.initThreeJS = async function () {
                const viewport = this;
                console.log("Comfy3D: initThreeJS starting");
                const container = document.createElement("div");
                container.className = "comfy3d-studio-viewport";
                Object.assign(container.style, {
                    flex: "1", width: "100%", height: "100%",
                    maxHeight: "calc(100% - 10px)", // Isolation safety margin
                    background: "#0a0a0a", position: "relative",
                    display: "flex", flexDirection: "column",
                    overflow: "hidden", pointerEvents: "auto",
                    zIndex: 1000, margin: "0", padding: "0"
                });

                const domWidget = this.addDOMWidget("threejs_studio", "viewport", container);
                domWidget.y = 0;
                this.widgets_start_y = 60; // Baseline for layout overhead
                // Use an aggressive -80px margin to provide a fail-safe "dead-band" at the bottom
                domWidget.computeSize = (width) => [width, Math.max(300, Math.floor(this.size[1] - 80))];


                let THREE;
                try {
                    THREE = await loadThreeJS();
                    if (!THREE.OrbitControls && window.OrbitControls) THREE.OrbitControls = window.OrbitControls;
                    if (!THREE.GLTFLoader && window.GLTFLoader) THREE.GLTFLoader = window.GLTFLoader;
                    if (!THREE.OBJLoader && window.OBJLoader) THREE.OBJLoader = window.OBJLoader;
                    if (!THREE.STLLoader && window.STLLoader) THREE.STLLoader = window.STLLoader;
                    if (!THREE.TransformControls && window.TransformControls) THREE.TransformControls = window.TransformControls;
                    console.log("Comfy3D: THREE and controls loaded:", {
                        THREE: !!THREE,
                        Orbit: !!THREE.OrbitControls,
                        GLTF: !!THREE.GLTFLoader,
                        OBJ: !!THREE.OBJLoader,
                        STL: !!THREE.STLLoader,
                        Transform: !!THREE.TransformControls
                    });
                } catch (e) {
                    console.error("Comfy3D: Library load failed:", e);
                    container.innerHTML = `<div style="color:red;padding:20px;">${e.message}</div>`;
                    return;
                }

                const canvasArea = document.createElement("div");
                Object.assign(canvasArea.style, {
                    flex: "1", position: "relative",
                    pointerEvents: "auto",
                    margin: "0", padding: "0", overflow: "hidden"
                });
                container.appendChild(canvasArea);

                const scene = new THREE.Scene();
                scene.background = new THREE.Color(0x1a1a1a); // Dark charcoal instead of pitch black

                const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
                camera.position.set(5, 5, 5);

                const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
                renderer.setPixelRatio(window.devicePixelRatio);
                renderer.outputEncoding = THREE.sRGBEncoding;
                renderer.setClearColor(0x1a1a1a, 1);
                Object.assign(renderer.domElement.style, {
                    position: "absolute", top: "0", left: "0", width: "100%", height: "100%", display: "block"
                });
                canvasArea.appendChild(renderer.domElement);

                // Isolated Gizmo Renderer
                const gizmoRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
                gizmoRenderer.setPixelRatio(window.devicePixelRatio);
                gizmoRenderer.setSize(100, 100);
                Object.assign(gizmoRenderer.domElement.style, {
                    position: "absolute", bottom: "10px", left: "10px",
                    width: "100px", height: "100px", pointerEvents: "none", zIndex: "10"
                });
                canvasArea.appendChild(gizmoRenderer.domElement);

                // Create Loading Overlay
                const loadingOverlay = document.createElement("div");
                Object.assign(loadingOverlay.style, {
                    position: "absolute", top: "0", left: "0", width: "100%", height: "100%",
                    backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
                    display: "none", justifyContent: "center", alignItems: "center",
                    zIndex: "2000", transition: "opacity 0.3s ease", opacity: "0",
                    flexDirection: "column", gap: "12px", color: "white"
                });
                loadingOverlay.innerHTML = `
                    <div class="comfy3d-spinner" style="width:32px; height:32px; border:3px solid rgba(255,255,255,0.1); border-top-color:#ff9500; border-radius:50%; animation: comfy3d-spin 1s linear infinite;"></div>
                    <div style="font-size:10px; font-weight:700; letter-spacing:0.1em; opacity:0.8; color:#ff9500;">PROCESSING MESH...</div>
                    <style>
                        @keyframes comfy3d-spin { 100% { transform: rotate(360deg); } }
                    </style>
                `;
                canvasArea.appendChild(loadingOverlay);

                const toggleLoading = (show) => {
                    if (show) {
                        loadingOverlay.style.display = "flex";
                        setTimeout(() => { loadingOverlay.style.opacity = "1"; }, 10);
                    } else {
                        loadingOverlay.style.opacity = "0";
                        setTimeout(() => { if (loadingOverlay.style.opacity === "0") loadingOverlay.style.display = "none"; }, 300);
                    }
                };

                const assets = [];
                const getPickableAssets = () => assets.filter(a => !!a.parent && a.visible !== false);
                let selectedObjects = [];
                const selectionProxy = new THREE.Object3D();
                scene.add(selectionProxy);

                // Brush State Initialization
                viewport.brushActive = false;
                viewport.brushSize = 20;
                viewport.brushHardness = 0.5;
                this.brushValue = 1.0;
                viewport.brushColor = "#ffffff";
                viewport.brushChannel = "color"; // "color", "roughness", "metallic"
                viewport.brushTriPlanar = false;

                // Interactive Point Selection State
                viewport.pointSelection = {
                    active: false,
                    points: [] // [{ world, local, vxz, mesh }]
                };

                // State for Segmentation Mode
                viewport.segmentationMode = {
                    active: false,
                    quantization: 6.0
                };
                const pointsGroup = new THREE.Group();
                scene.add(pointsGroup);

                // Create Segmentation Panel (Styled like Brush Panel)
                const segPanel = document.createElement("div");
                Object.assign(segPanel.style, {
                    position: "absolute", bottom: "72px", left: "50%",
                    transform: "translateX(-50%) translateY(20px)", display: "none", gap: "24px",
                    padding: "12px 24px", backgroundColor: "rgba(18, 18, 18, 0.7)",
                    backdropFilter: "blur(18px)", borderRadius: "14px",
                    border: "1px solid rgba(255,255,255,0.08)", zIndex: "110",
                    alignItems: "center", color: "white", fontSize: "11px",
                    boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
                    transition: "all 0.3s cubic-bezier(0.23, 1, 0.32, 1)",
                    opacity: "0", pointerEvents: "none"
                });
                segPanel.innerHTML = `
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        <div style="opacity:0.4; font-size:8px; font-weight:700; letter-spacing:0.1em; color:white; margin-bottom:2px;">MATERIAL SPLIT</div>
                        <div style="display:flex; align-items:center; gap:12px;">
                             <input type="range" class="comfy3d-brush-slider" id="seg-quant-slider" min="1.0" max="64.0" step="1.0" value="16.0" style="width:100px;">
                             <button class="comfy3d-segmentation-btn-primary" id="seg-mat-btn" style="padding:4px 12px; border-radius:6px; border:none; background:#ff9500; color:white; font-size:10px; cursor:pointer; font-weight:700; letter-spacing:0.05em;">BY MATERIAL</button>
                        </div>
                    </div>
                    <div style="width:1px; height:24px; background:rgba(255,255,255,0.1);"></div>
                    <div style="display:flex; flex-direction:column; gap:6px; align-items:center;">
                        <div style="opacity:0.4; font-size:8px; font-weight:700; letter-spacing:0.1em; color:white; margin-bottom:2px;">MERGE</div>
                        <button class="comfy3d-segmentation-btn-secondary" id="seg-join-btn" style="padding:4px 12px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:none; color:white; font-size:10px; cursor:pointer; font-weight:700; letter-spacing:0.05em;">JOIN SELECTED</button>
                    </div>
                    <div style="width:1px; height:24px; background:rgba(255,255,255,0.1);"></div>
                    <button class="comfy3d-segmentation-btn-secondary" id="seg-cancel-btn" style="padding:4px 8px; border-radius:6px; border:none; background:none; color:rgba(255,255,255,0.4); font-size:10px; cursor:pointer; font-weight:700;">EXIT</button>
                `;
                canvasArea.appendChild(segPanel);

                const quantSlider = segPanel.querySelector("#seg-quant-slider");
                quantSlider.addEventListener("input", (e) => {
                    viewport.segmentationMode.quantization = parseFloat(e.target.value);
                });

                const joinSelectedMeshes = async () => {
                    const originalRoots = [];
                    selectedObjects.forEach(obj => {
                        let root = obj;
                        while (root.parent && !assets.includes(root)) root = root.parent;
                        if (!originalRoots.includes(root)) originalRoots.push(root);
                    });

                    if (originalRoots.length < 2) {
                        alert("Select at least 2 distinct objects to join.");
                        return;
                    }

                    const filenames = originalRoots.map(obj => obj.userData.filename).filter(f => !!f);
                    if (filenames.length < 2) {
                        alert("Selected objects must have associated files to join.");
                        return;
                    }

                    try {
                        toggleLoading(true);
                        const resp = await fetch("/comfy3d/join_mesh", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ filenames: filenames })
                        });
                        const result = await resp.json();
                        if (result.error) throw new Error(result.error);

                        // Load result silently
                        const model = await loadAssetSilent(result.filename, result.type);

                        // Record in history
                        const cmd = new SeparateMeshCommand(originalRoots, [model], assets, scene);
                        cmd.redo();
                        history.push(cmd);

                        selectedObjects = [model];
                        updateOutliner();
                        frameScene(model);
                        console.log("Comfy3D: Joined into " + result.filename);
                    } catch (e) {
                        console.error("Comfy3D: Join Failed:", e);
                        alert("Join error: " + e.message);
                    } finally {
                        toggleLoading(false);
                    }
                };

                const toggleSegmentationMode = (active) => {
                    viewport.segmentationMode.active = active !== undefined ? active : !viewport.segmentationMode.active;
                    if (viewport.segmentationMode.active) {
                        // Close other modes
                        viewport.brushActive = false;
                        if (typeof brushPanel !== 'undefined' && brushPanel) brushPanel.style.display = "none";
                        viewport.pointSelection.active = false;

                        // Auto-Isolate if not already isolated for focus
                        if (!isolatedObjects && selectedObjects.length > 0) {
                            toggleIsolate();
                            if (typeof frameScene === "function") frameScene(selectedObjects);
                        }

                        Object.assign(segPanel.style, {
                            display: "flex", opacity: "1", transform: "translateX(-50%) translateY(0)", pointerEvents: "auto"
                        });
                        updateToolbar();
                    } else {
                        // De-isolate on exit? Usually better to leave it up to user, but 
                        // if we want 'robust communication', we could auto-exit isolation.
                        // For now, let's keep it isolated so user can see result, but frame it.

                        Object.assign(segPanel.style, {
                            opacity: "0", transform: "translateX(-50%) translateY(20px)", pointerEvents: "none"
                        });
                        setTimeout(() => { if (!viewport.segmentationMode.active) segPanel.style.display = "none"; }, 300);
                        updateToolbar();
                    }
                };

                segPanel.querySelector("#seg-cancel-btn").addEventListener("click", () => toggleSegmentationMode(false));

                segPanel.querySelector("#seg-mat-btn").addEventListener("click", () => {
                    if (selectedObjects.length === 0) return alert("Select a mesh first.");
                    separateMesh({ quantization: viewport.segmentationMode.quantization });
                });

                segPanel.querySelector("#seg-join-btn").addEventListener("click", joinSelectedMeshes);

                viewport.modalTransform = {
                    active: false,
                    mode: null, // "translate", "rotate", "scale"
                    startMouse: new THREE.Vector2(),
                    startStates: [], // { object, position, quaternion, scale }
                    center: new THREE.Vector3(),
                    centerScreen: new THREE.Vector3()
                };

                let needsUpdate = true; // Flag for on-demand rendering

                const triggerUpdate = () => { needsUpdate = true; };

                // Box Selection Rect
                const selectionRect = document.createElement("div");
                Object.assign(selectionRect.style, {
                    position: "absolute", border: "1px dashed #ff9500",
                    backgroundColor: "rgba(255, 149, 0, 0.1)", pointerEvents: "none",
                    display: "none", zIndex: "100", boxSizing: "border-box"
                });
                canvasArea.appendChild(selectionRect);

                // Brush Preview Cursor
                const brushCursor = document.createElement("div");
                Object.assign(brushCursor.style, {
                    position: "absolute", width: "20px", height: "20px",
                    border: "1px solid rgba(255,255,255,0.8)", borderRadius: "50%",
                    pointerEvents: "none", display: "none", zIndex: "200",
                    transform: "translate(-50%, -50%)", boxSizing: "border-box",
                    boxShadow: "0 0 4px rgba(0,0,0,0.5)"
                });
                canvasArea.appendChild(brushCursor);

                // Viewport Shading UI
                const shadingUI = document.createElement("div");
                Object.assign(shadingUI.style, {
                    position: "absolute", top: "12px", right: "12px",
                    display: "flex", gap: "6px", zIndex: "100",
                    padding: "4px", backgroundColor: "rgba(0,0,0,0.3)",
                    borderRadius: "20px", backdropFilter: "blur(4px)",
                    border: "1px solid rgba(255,255,255,0.1)"
                });
                canvasArea.appendChild(shadingUI);

                // Scene Outliner UI
                const outlinerPanel = document.createElement("div");
                Object.assign(outlinerPanel.style, {
                    position: "absolute", top: "86px", right: "12px",
                    width: "250px", maxHeight: "calc(100% - 130px)",
                    backgroundColor: "rgba(18, 18, 18, 0.7)", backdropFilter: "blur(18px)",
                    borderRadius: "14px", border: "1px solid rgba(255,255,255,0.08)",
                    display: "flex", flexDirection: "column", zIndex: "110",
                    overflow: "hidden", color: "rgba(255,255,255,0.9)",
                    fontFamily: "system-ui, -apple-system, sans-serif", fontSize: "12px",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.4)"
                });
                canvasArea.appendChild(outlinerPanel);

                const outlinerHeader = document.createElement("div");
                Object.assign(outlinerHeader.style, {
                    padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    fontWeight: "700", letterSpacing: "1px", background: "rgba(255,255,255,0.03)",
                    cursor: "grab", fontSize: "10px", color: "rgba(255,255,255,0.5)"
                });

                let isDraggingOutliner = false;
                let initialDragPos = { x: 0, y: 0 };
                let initialPanelPos = { left: 0, top: 0 };

                outlinerHeader.addEventListener("pointerdown", e => {
                    isDraggingOutliner = true;
                    outlinerHeader.style.cursor = "grabbing";

                    // Initial positions in screen pixels
                    initialDragPos.x = e.clientX;
                    initialDragPos.y = e.clientY;

                    // Current panel position in element pixels (unscaled)
                    initialPanelPos.left = outlinerPanel.offsetLeft;
                    initialPanelPos.top = outlinerPanel.offsetTop;

                    outlinerHeader.setPointerCapture(e.pointerId);
                    e.stopPropagation();
                });

                outlinerHeader.addEventListener("pointermove", e => {
                    if (!isDraggingOutliner) return;
                    const containerRect = canvasArea.getBoundingClientRect();
                    const scale = containerRect.width / canvasArea.clientWidth;

                    // Difference in screen pixels converted to element pixels
                    let dx = (e.clientX - initialDragPos.x) / scale;
                    let dy = (e.clientY - initialDragPos.y) / scale;

                    // New position in element pixels
                    let x = initialPanelPos.left + dx;
                    let y = initialPanelPos.top + dy;

                    // Clamp to viewport bounds (element-pixel space)
                    x = Math.max(0, Math.min(x, canvasArea.clientWidth - outlinerPanel.offsetWidth));
                    y = Math.max(0, Math.min(y, canvasArea.clientHeight - outlinerPanel.offsetHeight));

                    outlinerPanel.style.left = x + "px";
                    outlinerPanel.style.top = y + "px";
                    outlinerPanel.style.right = "auto";
                });

                outlinerHeader.addEventListener("pointerup", e => {
                    isDraggingOutliner = false;
                    outlinerHeader.style.cursor = "grab";
                    outlinerHeader.releasePointerCapture(e.pointerId);
                });

                outlinerHeader.innerHTML = '<span>SCENE COLLECTION</span>';

                const searchWrapper = document.createElement("div");
                Object.assign(searchWrapper.style, {
                    margin: "8px 12px", position: "relative",
                    display: "flex", alignItems: "center"
                });

                const searchInput = document.createElement("input");
                searchInput.placeholder = "Search objects...";
                Object.assign(searchInput.style, {
                    width: "100%", padding: "6px 10px 6px 28px",
                    backgroundColor: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.05)",
                    borderRadius: "8px", color: "white", fontSize: "11px", outline: "none",
                    transition: "border-color 0.2s, box-shadow 0.2s"
                });
                searchInput.onfocus = () => {
                    searchInput.style.borderColor = "rgba(255,149,0,0.4)";
                    searchInput.style.boxShadow = "0 0 0 2px rgba(255,149,0,0.1)";
                };
                searchInput.onblur = () => {
                    searchInput.style.borderColor = "rgba(255,255,255,0.05)";
                    searchInput.style.boxShadow = "none";
                };

                const searchIcon = document.createElement("div");
                searchIcon.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" style="opacity:0.4"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
                Object.assign(searchIcon.style, {
                    position: "absolute", left: "8px", pointerEvents: "none", display: "flex"
                });

                searchWrapper.appendChild(searchIcon);
                searchWrapper.appendChild(searchInput);
                outlinerPanel.appendChild(searchWrapper);
                searchInput.oninput = () => updateOutliner();

                const outlinerContent = document.createElement("div");
                Object.assign(outlinerContent.style, {
                    flex: "1", overflowY: "auto", overflowX: "hidden", padding: "4px 0"
                });

                outlinerPanel.appendChild(outlinerHeader);
                outlinerPanel.appendChild(searchWrapper);
                outlinerPanel.appendChild(outlinerContent);

                const expandedObjects = new Set();
                let renamingId = null;
                let lastSelectedObject = null;
                let visibleUUIDs = [];
                let lastFocusSelection = [];
                let isolationHistory = [];

                const updateOutlinerSelection = () => {
                    const rows = outlinerContent.querySelectorAll(".outliner-row");
                    rows.forEach(row => {
                        const uuid = row.dataset.uuid;
                        const obj = assets.find(o => o.uuid === uuid) || scene.getObjectByProperty("uuid", uuid);
                        const isSelected = selectedObjects.includes(obj);
                        Object.assign(row.style, {
                            backgroundColor: isSelected ? "rgba(255, 149, 0, 0.08)" : "transparent",
                            backgroundImage: isSelected ? "linear-gradient(90deg, rgba(255, 149, 0, 0.15) 0%, transparent 100%)" : "none",
                            borderLeft: isSelected ? "2px solid #ff9500" : "2px solid transparent",
                            color: isSelected ? "#fff" : "rgba(255,255,255,0.7)"
                        });
                    });
                };

                const updateOutliner = () => {
                    const filter = searchInput.value.toLowerCase();
                    outlinerContent.innerHTML = "";
                    visibleUUIDs = [];

                    const renderObject = (obj, depth = 0) => {
                        visibleUUIDs.push(obj.uuid);
                        const name = obj.name || (obj.isMesh ? "Mesh" : "Object");
                        const hasChildren = obj.children && obj.children.length > 0;
                        const isExpanded = expandedObjects.has(obj.uuid);

                        // If filtering, we check if this object or any child matches
                        if (filter) {
                            let match = name.toLowerCase().includes(filter);
                            let childMatch = false;
                            if (!match) {
                                obj.traverse(c => { if (c !== obj && (c.name || "").toLowerCase().includes(filter)) childMatch = true; });
                            }
                            if (!match && !childMatch) return;
                        }

                        const row = document.createElement("div");
                        row.classList.add("outliner-row");
                        row.dataset.uuid = obj.uuid;
                        Object.assign(row.style, {
                            display: "flex", alignItems: "center", padding: "6px 14px 6px " + (14 + depth * 16) + "px",
                            cursor: "pointer", transition: "all 0.2s ease",
                            backgroundColor: "transparent",
                            borderLeft: "2px solid transparent",
                            fontSize: "11px", color: "rgba(255,255,255,0.7)",
                            gap: "2px"
                        });

                        row.onmouseenter = () => {
                            if (!selectedObjects.includes(obj)) {
                                row.style.backgroundColor = "rgba(255,255,255,0.03)";
                            }
                        };
                        row.onmouseleave = () => {
                            if (!selectedObjects.includes(obj)) {
                                row.style.backgroundColor = "transparent";
                            }
                        };

                        row.onclick = (e) => {
                            e.stopPropagation();
                            if (e.shiftKey && lastSelectedObject && lastSelectedObject !== obj) {
                                // Range Select
                                const startIdx = visibleUUIDs.indexOf(lastSelectedObject.uuid);
                                const endIdx = visibleUUIDs.indexOf(obj.uuid);
                                if (startIdx !== -1 && endIdx !== -1) {
                                    const min = Math.min(startIdx, endIdx);
                                    const max = Math.max(startIdx, endIdx);
                                    for (let i = min; i <= max; i++) {
                                        const uuid = visibleUUIDs[i];
                                        const o = assets.find(a => a.uuid === uuid) || scene.getObjectByProperty("uuid", uuid);
                                        if (o && !selectedObjects.includes(o)) selectedObjects.push(o);
                                    }
                                    selectObject(null, null, 2);
                                    return;
                                }
                            }
                            selectObject(obj, null, e.shiftKey ? 1 : 0);
                        };

                        // Expansion Chevron
                        const chevron = document.createElement("div");
                        chevron.style.width = "18px";
                        chevron.style.display = "flex";
                        chevron.style.alignItems = "center";
                        chevron.style.justifyContent = "center";
                        chevron.style.marginRight = "2px";
                        chevron.style.opacity = hasChildren ? "0.4" : "0";
                        chevron.style.cursor = hasChildren ? "pointer" : "default";
                        chevron.innerHTML = `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3" style="transform: ${isExpanded ? "rotate(90deg)" : "rotate(0deg)"}; transition: transform 0.2s;"><polyline points="9 18 15 12 9 6"></polyline></svg>`;

                        chevron.onclick = (e) => {
                            if (!hasChildren) return;
                            e.stopPropagation();
                            if (isExpanded) expandedObjects.delete(obj.uuid);
                            else expandedObjects.add(obj.uuid);
                            updateOutliner();
                        };

                        const icon = document.createElement("div");
                        let iconSvg = obj.isMesh ?
                            `<path d="M12 2l9 4.9V17L12 22l-9-4.9V7L12 2zm0 11.5l7.5-4.1M12 13.5l-7.5-4.1M12 13.5V21" />` :
                            `<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"></path>`;
                        icon.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.5">${iconSvg}</svg>`;
                        Object.assign(icon.style, { marginRight: "6px", display: "flex" });

                        const isRenaming = renamingId === obj.uuid;
                        let label;
                        if (isRenaming) {
                            label = document.createElement("input");
                            label.value = name;
                            Object.assign(label.style, {
                                flex: "1", backgroundColor: "rgba(0,0,0,0.4)", border: "1px solid #ff9500",
                                color: "white", fontSize: "11px", padding: "2px 6px", outline: "none",
                                borderRadius: "4px", boxShadow: "0 0 8px rgba(255,149,0,0.2)"
                            });
                            setTimeout(() => { label.focus(); label.select(); }, 10);

                            const commit = () => {
                                if (renamingId !== obj.uuid) return;
                                const newName = label.value.trim();
                                console.log(`Comfy3D: Committing Rename: '${obj.name}' -> '${newName}'`);
                                if (newName && newName !== name) {
                                    history.push(new RenameCommand(obj, obj.name, newName));
                                    obj.name = newName;
                                }
                                renamingId = null;
                                updateOutliner();
                            };

                            label.onblur = commit;
                            label.onclick = (e) => e.stopPropagation();
                            label.onmousedown = (e) => e.stopPropagation();
                            label.onkeydown = (e) => {
                                if (e.key === "Enter") commit();
                                if (e.key === "Escape") { renamingId = null; updateOutliner(); }
                                e.stopPropagation();
                            };
                        } else {
                            label = document.createElement("span");
                            label.textContent = name;
                            label.style.flex = "1";
                            label.style.whiteSpace = "nowrap";
                            label.style.overflow = "hidden";
                            label.style.textOverflow = "ellipsis";
                            if (filter && name.toLowerCase().includes(filter)) label.style.color = "#ff9500";

                            label.ondblclick = (e) => {
                                console.log("Comfy3D: Rename Triggered for:", obj.uuid, obj.name);
                                e.stopPropagation();
                                renamingId = obj.uuid;
                                updateOutliner();
                            };
                        }

                        const actions = document.createElement("div");
                        actions.style.display = "flex";
                        actions.style.gap = "6px";

                        const isArchived = !obj.parent && assets.includes(obj);
                        const isVisible = obj.visible && !isArchived;

                        const eyeBtn = document.createElement("div");
                        eyeBtn.innerHTML = isVisible ?
                            `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>` :
                            `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
                        eyeBtn.style.opacity = isVisible ? "0.7" : (isArchived ? "0.15" : "0.3");
                        eyeBtn.style.cursor = "pointer";
                        eyeBtn.title = isArchived ? "Archived (Click to Restore)" : "Toggle Visibility";
                        eyeBtn.onclick = (e) => {
                            e.stopPropagation();
                            if (isArchived) {
                                scene.add(obj);
                                obj.visible = true;
                            } else {
                                obj.visible = !obj.visible;
                            }
                            triggerUpdate();
                            updateOutliner();
                        };

                        const delBtn = document.createElement("div");
                        delBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>`;
                        delBtn.style.opacity = "0.4";
                        delBtn.style.cursor = "pointer";
                        delBtn.onmouseenter = () => { delBtn.style.color = "#ff4444"; delBtn.style.opacity = "1"; };
                        delBtn.onmouseleave = () => { delBtn.style.color = "inherit"; delBtn.style.opacity = "0.4"; };
                        delBtn.onclick = (e) => {
                            e.stopPropagation();
                            const cmd = new AssetCommand(obj, false, assets, scene);
                            history.push(cmd);
                            cmd.remove();
                            deselectObject();
                            updateOutliner();
                        };

                        actions.appendChild(eyeBtn);
                        actions.appendChild(delBtn);

                        row.appendChild(chevron);
                        row.appendChild(icon);
                        row.appendChild(label);
                        row.appendChild(actions);
                        outlinerContent.appendChild(row);

                        if (isExpanded || filter) {
                            obj.children.forEach(child => {
                                // Ignore non-essential children (hidden helpers, etc.)
                                if (child.name || child.isMesh || child.type === "Group") {
                                    renderObject(child, depth + 1);
                                }
                            });
                        }
                    };

                    assets.forEach(asset => renderObject(asset, 0));
                    updateOutlinerSelection(); // Apply selection styles after rendering
                    if (typeof updateToolbar === "function") updateToolbar();
                };

                // Asset loading hook - call updateOutliner when assets change
                const originalAdd = scene.add;
                scene.add = function (obj) {
                    originalAdd.apply(this, arguments);
                    if (assets.includes(obj)) updateOutliner();
                };

                const shadingModes = [
                    { id: "wireframe", icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/><ellipse cx="12" cy="12" rx="9" ry="4"/><ellipse cx="12" cy="12" rx="4" ry="9"/></svg>`, title: "Wireframe" },
                    { id: "solid", icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="12" cy="12" r="9"/></svg>`, title: "Solid" },
                    { id: "material", icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 16.2a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4z"/><path d="M12 3a9 9 0 0 1 0 18z" opacity="0.5"/></svg>`, title: "Material" },
                    { id: "normal", icon: `<svg viewBox="0 0 24 24" width="16" height="16"><defs><linearGradient id="gn" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ff0000"/><stop offset="50%" stop-color="#00ff00"/><stop offset="100%" stop-color="#0000ff"/></linearGradient></defs><circle cx="12" cy="12" r="9" fill="url(#gn)"/></svg>`, title: "Normal" },
                    { id: "xray", icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="10" height="10" rx="1"/><rect x="11" y="11" width="10" height="10" rx="1" stroke-dasharray="3 2"/></svg>`, title: "X-Ray Mode" },
                    { id: "outliner", icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>`, title: "Toggle Scene Management" }
                ];

                let outlinerVisible = true;
                const setOutlinerVisible = (v) => {
                    outlinerVisible = v;
                    outlinerPanel.style.display = v ? "flex" : "none";
                    if (shadingBtns["outliner"]) {
                        shadingBtns["outliner"].style.backgroundColor = v ? "rgba(255, 149, 0, 0.4)" : "rgba(0,0,0,0.5)";
                    }
                };

                let currentShadingMode = "material";
                let xrayMode = false;
                const shadingBtns = {};
                const solidMaterial = new THREE.MeshPhongMaterial({ color: 0x777777, specular: 0x111111, shininess: 20, flatShading: true, side: THREE.DoubleSide });
                const normalMaterial = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });

                const updateMeshShading = (mesh) => {
                    if (!mesh || !mesh.isMesh) return;
                    if (!mesh.userData.origMat) {
                        mesh.userData.origMat = mesh.material;
                        mesh.userData.origTransparent = mesh.material.transparent;
                        mesh.userData.origOpacity = mesh.material.opacity;
                        mesh.userData.origDepthWrite = mesh.material.depthWrite;
                        mesh.userData.origSide = mesh.material.side;
                    }

                    // Support models with missing normals in diagnostic modes
                    if (currentShadingMode === "solid" || currentShadingMode === "normal") {
                        if (mesh.geometry && !mesh.geometry.attributes.normal) {
                            mesh.geometry.computeVertexNormals();
                        }
                    }

                    switch (currentShadingMode) {
                        case "wireframe":
                            mesh.material = mesh.userData.origMat;
                            mesh.material.wireframe = true;
                            break;
                        case "solid":
                            mesh.material = solidMaterial;
                            break;
                        case "normal":
                            mesh.material = normalMaterial;
                            break;
                        default:
                            mesh.material = mesh.userData.origMat;
                            mesh.material.wireframe = false;
                            break;
                    }

                    // Apply X-Ray Overrides
                    if (xrayMode) {
                        mesh.material.transparent = true;
                        mesh.material.opacity = 0.5;
                        mesh.material.depthWrite = false;
                        mesh.material.side = THREE.DoubleSide;
                    } else {
                        // Restore from defaults or userData
                        if (mesh.material === mesh.userData.origMat) {
                            mesh.material.transparent = mesh.userData.origTransparent;
                            mesh.material.opacity = mesh.userData.origOpacity;
                            mesh.material.depthWrite = mesh.userData.origDepthWrite;
                            mesh.material.side = mesh.userData.origSide;
                        } else {
                            // If using solidMaterial/normalMaterial, reset them to fixed defaults
                            mesh.material.transparent = false;
                            mesh.material.opacity = 1.0;
                            mesh.material.depthWrite = true;
                            mesh.material.side = THREE.DoubleSide;
                        }
                    }
                };

                const updateShadingUI = () => {
                    Object.keys(shadingBtns).forEach(m => {
                        const btn = shadingBtns[m];
                        let isActive = (m === currentShadingMode);
                        if (m === "xray") isActive = xrayMode;
                        if (m === "outliner") isActive = outlinerVisible;

                        btn.style.backgroundColor = isActive ? "rgba(255, 68, 0, 0.4)" : "rgba(0,0,0,0.5)";
                        btn.style.border = isActive ? "1px solid rgba(255, 68, 0, 0.6)" : "1px solid rgba(255,255,255,0.05)";
                        btn.style.boxShadow = isActive ? "0 0 10px rgba(255, 68, 0, 0.3)" : "none";
                    });
                };

                const setShadingMode = (mode) => {
                    currentShadingMode = mode;
                    assets.forEach(root => root.traverse(updateMeshShading));
                    updateShadingUI();
                    triggerUpdate();
                };

                shadingModes.forEach(m => {
                    const btn = document.createElement("button");
                    btn.innerHTML = m.icon; btn.title = m.title;
                    btn.className = "comfy3d-toolbar-btn";
                    Object.assign(btn.style, {
                        width: "32px", height: "32px", borderRadius: "16px",
                        border: "1px solid rgba(255,255,255,0.05)", backgroundColor: "rgba(0,0,0,0.5)",
                        color: "white", cursor: "pointer", display: "flex",
                        alignItems: "center", justifyContent: "center",
                        outline: "none", boxSizing: "border-box"
                    });
                    btn.onmouseenter = () => { /* CSS handled */ };
                    btn.onmouseleave = () => { /* CSS handled */ };
                    btn.onmousedown = () => { };
                    btn.onmouseup = () => { };
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        if (m.id === "outliner") {
                            setOutlinerVisible(!outlinerVisible);
                        } else if (m.id === "xray") {
                            xrayMode = !xrayMode;
                            assets.forEach(root => root.traverse(updateMeshShading));
                            updateShadingUI();
                            triggerUpdate();
                        } else {
                            setShadingMode(m.id);
                        }
                    };
                    shadingUI.appendChild(btn);
                    shadingBtns[m.id] = btn;
                });
                // Main Viewport Toolbar (Floating Bottom Center)
                const mainToolbar = document.createElement("div");
                Object.assign(mainToolbar.style, {
                    position: "absolute", bottom: "16px", left: "50%",
                    transform: "translateX(-50%)", display: "flex", gap: "8px",
                    padding: "6px", backgroundColor: "rgba(0,0,0,0.4)",
                    borderRadius: "12px", backdropFilter: "blur(8px)",
                    border: "1px solid rgba(255,255,255,0.1)", zIndex: "100"
                });
                canvasArea.appendChild(mainToolbar);

                const toolButtons = [
                    { id: "select", icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>`, title: "Select" },
                    { id: "translate", icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l-7 7 7 7M19 12l-7-7M19 12l-7 7"/></svg>`, title: "Move (G)" },
                    { id: "rotate", icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-9-9c2.52 0 4.85.83 6.72 2.25L21 3v5h-5"/></svg>`, title: "Rotate (R)" },
                    { id: "scale", icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 17l10-10M17 17V7M7 7h10"/></svg>`, title: "Scale (S)" },
                    { id: "brush", icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 11V6a2 2 0 00-2-2v0a2 2 0 00-2 2v0"/><path d="M14 10V8a2 2 0 00-2-2v0a2 2 0 00-2 2v0"/><path d="M10 10.5V6a2 2 0 00-2-2v0a2 2 0 00-2 2v0"/><path d="M18 8a2 2 0 114 0v6a8 8 0 01-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 012.83-2.82L7 15"/></svg>`, title: "Brush (B)" },
                    { id: "point", icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>`, title: "Point Selection (P)" },
                    { id: "split", icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 21L3 13.5l8-7.5M13 3l8 7.5L13 18"/><line x1="12" y1="2" x2="12" y2="22"/></svg>`, title: "Separate Mesh (V)" },
                    { id: "divider", isDivider: true },
                    { id: "undo", icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 14L4 9l5-5"/><path d="M20 20v-7a4 4 0 00-4-4H4"/></svg>`, title: "Undo (Alt+Z)" },
                    { id: "redo", icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 14l5-5-5-5"/><path d="M4 20v-7a4 4 0 014-4h12"/></svg>`, title: "Redo (Alt+Y)" }
                ];

                const toolbarBtns = {};
                const updateToolbar = () => {
                    const mode = viewport.transform.mode;
                    const isAttached = !!viewport.transform.object;

                    Object.keys(toolbarBtns).forEach(id => {
                        const btn = toolbarBtns[id];
                        if (id === "undo") {
                            const canUndo = history.index >= 0;
                            btn.style.opacity = canUndo ? "1" : "0.3";
                            btn.style.pointerEvents = canUndo ? "auto" : "none";
                            return;
                        }
                        if (id === "redo") {
                            const canRedo = history.index < history.history.length - 1;
                            btn.style.opacity = canRedo ? "1" : "0.3";
                            btn.style.pointerEvents = canRedo ? "auto" : "none";
                            return;
                        }

                        // Tools (Select, Move, Rotate, Scale, Brush)
                        let isActive = false;
                        if (id === "brush") {
                            isActive = (viewport.brushActive === true);
                        } else if (id === "point") {
                            isActive = (viewport.pointSelection.active === true);
                        } else if (id === "split") {
                            isActive = (viewport.segmentationMode.active === true);
                        } else if (viewport.modalTransform.active) {
                            isActive = (id === viewport.modalTransform.mode);
                        } else if (!viewport.transform.enabled) {
                            isActive = (id === "select" && !viewport.brushActive && !viewport.pointSelection.active);
                        } else {
                            isActive = (id === mode && !viewport.brushActive && !viewport.pointSelection.active);
                        }

                        btn.style.backgroundColor = isActive ? "rgba(255, 68, 0, 0.4)" : "transparent";
                        btn.style.border = isActive ? "1px solid rgba(255, 68, 0, 0.6)" : "1px solid rgba(255,255,255,0.05)";
                        btn.style.boxShadow = isActive ? "0 0 10px rgba(255, 68, 0, 0.2)" : "none";
                    });
                };

                toolButtons.forEach(tool => {
                    if (tool.isDivider) {
                        const div = document.createElement("div");
                        div.style.width = "1px"; div.style.backgroundColor = "rgba(255,255,255,0.1)";
                        div.style.margin = "4px 2px";
                        mainToolbar.appendChild(div);
                        return;
                    }
                    const btn = document.createElement("button");
                    btn.innerHTML = tool.icon; btn.title = tool.title;
                    btn.className = "comfy3d-toolbar-btn";
                    Object.assign(btn.style, {
                        width: "38px", height: "38px", borderRadius: "10px",
                        border: "1px solid rgba(255,255,255,0.05)", backgroundColor: "transparent",
                        color: "white", cursor: "pointer", display: "flex",
                        alignItems: "center", justifyContent: "center",
                        outline: "none", boxSizing: "border-box"
                    });

                    btn.onmousedown = () => { /* Handled by CSS :active mostly, but keep for state if needed */ };
                    btn.onmouseup = () => { };

                    btn.onclick = (e) => {
                        e.stopPropagation();
                        if (tool.id === "undo") { history.undo(); triggerUpdate(); }
                        else if (tool.id === "redo") { history.redo(); triggerUpdate(); }
                        else if (tool.id === "split") { toggleSegmentationMode(); }
                        else if (tool.id === "brush") {
                            viewport.brushActive = !viewport.brushActive;
                            console.log(`Comfy3D: Brush Tool ${viewport.brushActive ? "ACTIVATED" : "DEACTIVATED"}`);
                            if (viewport.brushActive) {
                                viewport.pointSelection.active = false; // Mutually exclusive
                                viewport.transform.enabled = false;
                                if (selectionHelper) selectionHelper.visible = false;
                                viewport.transform.detach();
                                brushPanel.style.display = "flex";
                            } else {
                                brushPanel.style.display = "none";
                            }
                        }
                        else if (tool.id === "point") {
                            viewport.pointSelection.active = !viewport.pointSelection.active;
                            if (viewport.pointSelection.active) {
                                viewport.brushActive = false;
                                viewport.transform.enabled = false;
                                if (selectionHelper) selectionHelper.visible = false;
                                viewport.transform.detach();
                                brushPanel.style.display = "none";
                            }
                        }
                        else {
                            viewport.brushActive = false;
                            viewport.pointSelection.active = false; // Mutually exclusive
                            brushPanel.style.display = "none";
                            if (tool.id === "select") {
                                viewport.transform.enabled = false;
                                viewport.transform.detach();
                            } else {
                                viewport.transform.enabled = true;
                                viewport.transform.setMode(tool.id);
                                if (selectedObjects.length > 0) {
                                    viewport.transform.attach(selectionProxy);
                                }
                            }
                        }
                        updateToolbar();
                        triggerUpdate();
                    };
                    mainToolbar.appendChild(btn);
                    toolbarBtns[tool.id] = btn;
                });

                // Brush Settings Panel
                const brushPanel = document.createElement("div");
                Object.assign(brushPanel.style, {
                    position: "absolute", bottom: "72px", left: "50%",
                    transform: "translateX(-50%)", display: "none", gap: "16px",
                    padding: "12px 20px", backgroundColor: "rgba(18, 18, 18, 0.7)",
                    backdropFilter: "blur(18px)", borderRadius: "14px",
                    border: "1px solid rgba(255,255,255,0.08)", zIndex: "110",
                    alignItems: "center", color: "white", fontSize: "11px",
                    boxShadow: "0 10px 40px rgba(0,0,0,0.6)"
                });
                canvasArea.appendChild(brushPanel);

                const createBrushControl = (label, min, max, val, onChange) => {
                    const row = document.createElement("div");
                    row.style.display = "flex"; row.style.flexDirection = "column"; row.style.gap = "6px";
                    const lbl = document.createElement("div");
                    Object.assign(lbl.style, {
                        opacity: "0.4", fontSize: "9px", fontWeight: "700",
                        letterSpacing: "0.1em", color: "white", marginBottom: "2px"
                    });
                    lbl.textContent = label.toUpperCase();
                    const input = document.createElement("input");
                    input.type = "range"; input.min = min; input.max = max; input.value = val;
                    input.className = "comfy3d-brush-slider";
                    input.oninput = () => onChange(parseFloat(input.value));
                    row.appendChild(lbl);
                    row.appendChild(input);
                    return { row, input };
                };

                viewport.brushSize = 20;
                viewport.brushHardness = 0.5;
                this.brushValue = 1.0;

                const sizeCtrl = createBrushControl("Size", 1, 100, viewport.brushSize, v => { viewport.brushSize = v; });
                const hardnessCtrl = createBrushControl("Hardness", 0, 1, viewport.brushHardness, v => { viewport.brushHardness = v; });
                const valueCtrl = createBrushControl("Value", 0, 1, this.brushValue, v => { this.brushValue = v; });

                // Channel Selector
                const channelWrapper = document.createElement("div");
                Object.assign(channelWrapper.style, { display: "flex", flexDirection: "column", gap: "6px" });
                const chanLbl = document.createElement("div");
                Object.assign(chanLbl.style, {
                    opacity: "0.4", fontSize: "9px", fontWeight: "700",
                    letterSpacing: "0.1em", color: "white", marginBottom: "2px"
                });
                chanLbl.textContent = "CHANNEL";
                const chanSel = document.createElement("select");
                chanSel.className = "comfy3d-brush-select";
                ["color", "roughness", "metallic"].forEach(c => {
                    const opt = document.createElement("option");
                    opt.value = opt.textContent = c;
                    chanSel.appendChild(opt);
                });
                chanSel.onchange = () => { viewport.brushChannel = chanSel.value; };
                channelWrapper.appendChild(chanLbl);
                channelWrapper.appendChild(chanSel);

                // Tri-Planar Toggle
                const triWrapper = document.createElement("div");
                Object.assign(triWrapper.style, { display: "flex", flexDirection: "column", gap: "6px", alignItems: "center" });
                const triLbl = document.createElement("div");
                Object.assign(triLbl.style, {
                    opacity: "0.4", fontSize: "9px", fontWeight: "700",
                    letterSpacing: "0.1em", color: "white", marginBottom: "2px"
                });
                triLbl.textContent = "TRI-PLANAR";
                const triCheck = document.createElement("input");
                triCheck.type = "checkbox";
                triCheck.className = "comfy3d-brush-checkbox";
                triCheck.checked = viewport.brushTriPlanar;
                triCheck.onchange = () => { viewport.brushTriPlanar = triCheck.checked; };
                triWrapper.appendChild(triLbl);
                triWrapper.appendChild(triCheck);

                // Brush Color Selector (for color channel)
                const colorWrapper = document.createElement("div");
                Object.assign(colorWrapper.style, { display: "flex", flexDirection: "column", gap: "6px" });
                const colorLbl = document.createElement("div");
                Object.assign(colorLbl.style, {
                    opacity: "0.4", fontSize: "9px", fontWeight: "700",
                    letterSpacing: "0.1em", color: "white", marginBottom: "2px"
                });
                colorLbl.textContent = "BRUSH COLOR";
                const colorInp = document.createElement("input");
                colorInp.type = "color";
                colorInp.className = "comfy3d-brush-color";
                colorInp.value = viewport.brushColor || "#ffffff";
                colorInp.oninput = () => { viewport.brushColor = colorInp.value; };

                colorWrapper.appendChild(colorLbl);
                colorWrapper.appendChild(colorInp);

                brushPanel.appendChild(sizeCtrl.row);
                brushPanel.appendChild(hardnessCtrl.row);
                brushPanel.appendChild(valueCtrl.row);
                brushPanel.appendChild(colorWrapper);
                brushPanel.appendChild(channelWrapper);
                brushPanel.appendChild(triWrapper);
                // Smart Fade Grid (Shader-based)
                const gridMaterial = new THREE.ShaderMaterial({
                    transparent: true,
                    uniforms: {
                        uColor1: { value: new THREE.Color(0x666666) }, // Major grid (Brighter)
                        uColor2: { value: new THREE.Color(0x333333) }, // Minor grid (Brighter)
                        uFadeDist: { value: 120.0 } // Increased fade distance
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
                            float g1 = grid(1.0, 0.8);  // Major grid (sharper)
                            float g2 = grid(0.1, 0.4);  // Minor grid (sharper)
                            
                            float dist = length(vWorldPos.xz - cameraPosition.xz);
                            float fade = pow(clamp(1.0 - dist / uFadeDist, 0.0, 1.0), 3.0);
                            
                            vec3 color = mix(uColor2, uColor1, g1);
                            float alpha = max(g1 * 0.8, g2 * 0.4) * fade; // Sharper alpha
                            
                            if (alpha < 0.01) discard;
                            gl_FragColor = vec4(color, alpha);
                        }
                    `,
                    side: THREE.DoubleSide
                });
                const gridPlane = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), gridMaterial);
                gridPlane.rotation.x = -Math.PI / 2;
                gridPlane.position.y = -0.001; // Avoid z-fight
                scene.add(gridPlane);
                // Floor Axis Lines (Red = X, Green = Z/Floor-Y)
                const xAxisGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-50, 0, 0), new THREE.Vector3(50, 0, 0)]);
                const xAxis = new THREE.Line(xAxisGeom, new THREE.LineBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.6 }));
                scene.add(xAxis);

                const zAxisGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -50), new THREE.Vector3(0, 0, 50)]);
                const zAxis = new THREE.Line(zAxisGeom, new THREE.LineBasicMaterial({ color: 0x4cd964, transparent: true, opacity: 0.6 }));
                scene.add(zAxis);

                // Neutral Lighting Setup                scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.4)); // Balanced sky/ground fill
                scene.add(new THREE.AmbientLight(0xffffff, 0.2)); // Natural global fill
                const dirLight = new THREE.DirectionalLight(0xffffff, 0.65);
                dirLight.position.set(10, 10, 10);
                scene.add(dirLight);

                // Command Pattern Undo/Redo System
                class CommandHistory {
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
                const history = new CommandHistory();

                // Selection Helper (Orange Outline)
                const selectionHelper = new THREE.BoxHelper(undefined, 0xff4400);
                selectionHelper.visible = false;
                scene.add(selectionHelper);

                const updateSelectionProxy = () => {
                    const visibleSelected = selectedObjects.filter(o => o && (o.visible !== false));
                    if (visibleSelected.length === 0) return;
                    const box = new THREE.Box3();
                    visibleSelected.forEach(o => box.expandByObject(o));
                    const center = box.getCenter(new THREE.Vector3());
                    selectionProxy.position.copy(center);
                    selectionProxy.quaternion.set(0, 0, 0, 1);
                    selectionProxy.scale.set(1, 1, 1);
                    selectionProxy.updateMatrixWorld(true);
                };



                class TransformCommand {
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
                        updateSelectionProxy();
                        triggerUpdate();
                    }
                    redo() {
                        if (!this.obj || !this.new?.p) return;
                        this.obj.position.copy(this.new.p);
                        this.obj.quaternion.copy(this.new.q);
                        this.obj.scale.copy(this.new.s);
                        this.obj.updateMatrixWorld(true);
                        updateSelectionProxy();
                        triggerUpdate();
                    }
                }

                class MultiTransformCommand {
                    constructor(objs, initialStates, finalStates) {
                        this.cmds = objs.map(obj => new TransformCommand(obj, initialStates.get(obj), finalStates.get(obj)));
                    }
                    undo() {
                        this.cmds.forEach(c => c.undo());
                        updateSelectionProxy();
                    }
                    redo() {
                        this.cmds.forEach(c => c.redo());
                        updateSelectionProxy();
                    }
                }

                class AssetCommand {
                    constructor(obj, isAdd, assetsArr, scene) {
                        this.obj = obj;
                        this.isAdd = isAdd;
                        this.assetsArr = assetsArr;
                        this.scene = scene;
                        this.parent = obj.parent || scene;
                    }
                    undo() { if (this.isAdd) this.remove(); else this.add(); updateOutliner(); }
                    redo() { if (this.isAdd) this.add(); else this.remove(); updateOutliner(); }
                    add() {
                        if (!this.assetsArr.includes(this.obj)) this.assetsArr.push(this.obj);
                        this.parent.add(this.obj);
                    }
                    remove() {
                        const idx = this.assetsArr.indexOf(this.obj);
                        if (idx > -1) this.assetsArr.splice(idx, 1);
                        this.obj.parent?.remove(this.obj);
                        updateOutliner();
                    }
                }

                class RenameCommand {
                    constructor(obj, oldName, newName) {
                        this.obj = obj;
                        this.oldName = oldName;
                        this.newName = newName;
                    }
                    undo() {
                        console.log(`Comfy3D: Rename Undo: '${this.newName}' -> '${this.oldName}'`);
                        this.obj.name = this.oldName;
                        updateOutliner();
                    }
                    redo() {
                        console.log(`Comfy3D: Rename Redo: '${this.oldName}' -> '${this.newName}'`);
                        this.obj.name = this.newName;
                        updateOutliner();
                    }
                }

                class MultiAssetCommand {
                    constructor(objs, isAdd, assetsArr, scene) {
                        this.cmds = objs.map(obj => new AssetCommand(obj, isAdd, assetsArr, scene));
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
                        this.oldSelection = [...selectedObjects];
                        
                        // Select the new roots (groups) instead of the individual parts to keep outliner tidy
                        this.newSelection = [...newMeshes];
                    }
                    undo() {
                        this.newMeshesCmd.undo();
                        this.originalsCmd.undo();

                        // Sync isolation if active
                        if (isolatedObjects) {
                            this.newMeshesCmd.cmds.forEach(c => isolatedObjects.delete(c.obj));
                            this.originalsCmd.cmds.forEach(c => isolatedObjects.set(c.obj, true));
                        }

                        selectedObjects = [...this.oldSelection];
                        updateOutliner();
                    }
                    redo() {
                        this.originalsCmd.redo();
                        this.newMeshesCmd.redo();

                        // Sync isolation if active
                        if (isolatedObjects) {
                            this.originalsCmd.cmds.forEach(c => isolatedObjects.set(c.obj, false));
                            this.newMeshesCmd.cmds.forEach(c => isolatedObjects.set(c.obj, true));
                        }

                        selectedObjects = [...this.newSelection];
                        updateOutliner();
                    }
                }

                const getObjectPath = (obj) => {
                    const path = [];
                    let p = obj;
                    while (p && p !== scene) {
                        path.unshift(p.name || p.type);
                        p = p.parent;
                    }
                    return path.join(" > ");
                };

                const frameScene = (objects = assets) => {
                    const box = new THREE.Box3();
                    let hasTargets = false;
                    const targets = Array.isArray(objects) ? objects : [objects];
                    console.log(`Comfy3D: frameScene called for ${targets.length} objects`);
                    targets.forEach(obj => {
                        if (obj) {
                            obj.updateMatrixWorld(true);
                            // Deep traversal box expansion to ensure sub-meshes are included correctly
                            obj.traverse(c => {
                                if (c.isMesh) {
                                    if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
                                    const b = c.geometry.boundingBox.clone();
                                    b.applyMatrix4(c.matrixWorld);
                                    box.union(b);
                                    hasTargets = true;
                                }
                            });
                            // If it's a group with no meshes yet (empty), still expand by its position
                            if (!hasTargets) {
                                box.expandByObject(obj);
                                hasTargets = true;
                            }
                        }
                    });

                    if (!hasTargets || box.isEmpty()) {
                        console.warn("Comfy3D: frameScene - No targets or empty bounding box");
                        return;
                    }

                    const center = box.getCenter(new THREE.Vector3());
                    const size = box.getSize(new THREE.Vector3());
                    const maxDim = Math.max(size.x, size.y, size.z) || 1;
                    console.log(`Comfy3D: Bounding Box: Min:`, box.min, `Max:`, box.max, `Size:`, size);
                    const fov = camera.fov * (Math.PI / 180);

                    // Improved camera distance calculation
                    let cameraDist = (maxDim / 2) / Math.tan(fov / 2);
                    cameraDist *= 1.4; // Slightly tighter padding than before but still generous

                    console.log(`Comfy3D: Focusing on center:`, center, `Dist:`, cameraDist.toFixed(3), `MaxDim:`, maxDim.toFixed(3));

                    // Keep current view direction if possible
                    let direction = new THREE.Vector3().subVectors(camera.position, orbit.target).normalize();
                    if (direction.length() < 0.1) direction.set(1, 1, 1).normalize();

                    const targetPos = center.clone().add(direction.multiplyScalar(cameraDist));
                    const startPos = camera.position.clone();
                    const startTarget = orbit.target.clone();
                    const startTime = performance.now();
                    const duration = 400; // 0.4s for smooth focus

                    const animateFocus = (time) => {
                        const t = Math.min((time - startTime) / duration, 1);
                        const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // easeInOutQuad
                        camera.position.lerpVectors(startPos, targetPos, ease);
                        orbit.target.lerpVectors(startTarget, center, ease);
                        camera.lookAt(orbit.target);
                        orbit.update();
                        triggerUpdate();
                        if (t < 1) requestAnimationFrame(animateFocus);
                    };
                    requestAnimationFrame(animateFocus);
                };

                const addAsset = (obj) => {
                    const cmd = new AssetCommand(obj, true, assets, scene);
                    history.push(cmd);
                    cmd.add();
                    obj.traverse(updateMeshShading); // Respect current viewport mode
                    console.log("Comfy3D: Asset added via Command:", obj.name);
                    selectObject(obj);
                };

                /**
                 * Mode: 0 = SET (replace), 1 = TOGGLE (add/remove), 2 = BATCH (array already updated)
                 */
                const selectObject = (obj, point, mode = 0) => {
                    // Optimized Non-Destructive Auto-Restore:
                    // If we select an asset that was "Archived" (removed from scene for performance), 
                    // re-add it to the scene graph immediately.
                    if (obj && !obj.parent && assets.includes(obj)) {
                        console.log("Comfy3D: Restoring archived asset to scene for interaction:", obj.name);
                        scene.add(obj);
                        obj.visible = true;
                        updateOutliner();
                    }

                    if (mode === 0) {
                        selectedObjects = [obj];
                        lastSelectedObject = obj;
                    } else if (mode === 1) {
                        const idx = selectedObjects.indexOf(obj);
                        if (idx > -1) {
                            selectedObjects.splice(idx, 1);
                            if (lastSelectedObject === obj) lastSelectedObject = selectedObjects[selectedObjects.length - 1] || null;
                        } else {
                            selectedObjects.push(obj);
                            lastSelectedObject = obj;
                        }
                    } else if (mode === 2) {
                        // Batch: selectedObjects is already updated externally
                        if (selectedObjects.length > 0) lastSelectedObject = selectedObjects[selectedObjects.length - 1];
                    }

                    // Auto-expand parents in outliner to show selected child
                    let anyExpanded = false;
                    selectedObjects.forEach(o => {
                        if (!o) return;
                        let curr = o.parent;
                        while (curr && curr !== scene && !assets.includes(curr.parent)) {
                            // Only expand if it's within an asset's hierarchy
                            if (curr.children && curr.children.length > 0 && !expandedObjects.has(curr.uuid)) {
                                expandedObjects.add(curr.uuid);
                                anyExpanded = true;
                            }
                            curr = curr.parent;
                        }
                        // Also expand the root asset if it has children
                        if (assets.includes(curr) && curr.children && curr.children.length > 0 && !expandedObjects.has(curr.uuid)) {
                            expandedObjects.add(curr.uuid);
                            anyExpanded = true;
                        }
                    });
                    if (anyExpanded && typeof updateOutliner === "function") updateOutliner();

                    const visibleSelected = selectedObjects.filter(o => o && (o.visible !== false));
                    if (visibleSelected.length > 0) {
                        // Update selection helper (ensure valid object for setFromObject)
                        if (visibleSelected.length === 1) {
                            selectionHelper.setFromObject(visibleSelected[0]);
                        } else {
                            const box = new THREE.Box3();
                            visibleSelected.forEach(o => box.expandByObject(o));
                            const size = box.getSize(new THREE.Vector3());
                            const center = box.getCenter(new THREE.Vector3());
                            if (!this._selectionBoxMesh) this._selectionBoxMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
                            this._selectionBoxMesh.scale.set(size.x || 0.1, size.y || 0.1, size.z || 0.1);
                            this._selectionBoxMesh.position.copy(center);
                            this._selectionBoxMesh.quaternion.set(0, 0, 0, 1);
                            this._selectionBoxMesh.updateMatrixWorld(true);
                            selectionHelper.setFromObject(this._selectionBoxMesh);
                        }
                        selectionHelper.visible = !viewport.brushActive;

                        // Update selectionProxy to selection center
                        updateSelectionProxy();

                        if (viewport.transform.enabled) {
                            console.log("Comfy3D: Attaching gizmo to selection proxy");
                            viewport.transform.attach(selectionProxy);
                        } else {
                            viewport.transform.detach();
                        }
                    } else {
                        deselectObject();
                    }

                    console.log(`Comfy3D: Selection updated. Total: ${selectedObjects.length}, Visible: ${viewport.transform.visible}`);
                    if (typeof updateToolbar === "function") updateToolbar();
                    if (typeof updateOutlinerSelection === "function") updateOutlinerSelection();
                    triggerUpdate();
                };


                const deselectObject = () => {
                    selectedObjects = [];
                    if (viewport.transform) viewport.transform.detach();
                    if (selectionHelper) selectionHelper.visible = false;
                    if (typeof updateToolbar === "function") updateToolbar();
                    if (typeof updateOutlinerSelection === "function") updateOutlinerSelection();
                    triggerUpdate();
                };

                const addVXZPoint = (intersect) => {
                    const obj = intersect.object;
                    const worldPoint = intersect.point;

                    // Convert world to local
                    const localPoint = worldPoint.clone();
                    obj.worldToLocal(localPoint);

                    // Get bounding box in local space
                    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
                    const bbox = obj.geometry.boundingBox;
                    const size = bbox.getSize(new THREE.Vector3());
                    const min = bbox.min;

                    // Map to 0-511 VXZ space
                    const vxz = [
                        Math.round(((localPoint.x - min.x) / size.x) * 511),
                        Math.round(((localPoint.y - min.y) / size.y) * 511),
                        Math.round(((localPoint.z - min.z) / size.z) * 511)
                    ];

                    // Clamp
                    vxz[0] = Math.max(0, Math.min(511, vxz[0]));
                    vxz[1] = Math.max(0, Math.min(511, vxz[1]));
                    vxz[2] = Math.max(0, Math.min(511, vxz[2]));

                    console.log(`Comfy3D: POINT ADDED -> World: ${worldPoint.toArray().map(v => v.toFixed(2))}, VXZ: ${vxz}`);

                    const pointData = {
                        world: worldPoint.clone(),
                        vxz: vxz,
                        mesh: obj
                    };

                    viewport.pointSelection.points.push(pointData);
                    if (viewport.pointSelection.points.length > 20) viewport.pointSelection.points.shift();

                    updateSelectionPointsUI();
                    triggerUpdate();
                };

                const updateSelectionPointsUI = () => {
                    // Remove old spheres
                    while (pointsGroup.children.length > 0) {
                        pointsGroup.remove(pointsGroup.children[0]);
                    }

                    // Add new spheres
                    viewport.pointSelection.points.forEach(p => {
                        const sphere = new THREE.Mesh(
                            new THREE.SphereGeometry(0.04, 24, 24),
                            new THREE.MeshStandardMaterial({
                                color: 0x00ffff,
                                emissive: 0x00ffff,
                                emissiveIntensity: 2.0,
                                transparent: true,
                                opacity: 0.8
                            })
                        );
                        sphere.position.copy(p.world);
                        pointsGroup.add(sphere);
                    });

                    // Update ComfyUI Widget
                    const pointsStr = viewport.pointSelection.points.map(p => p.vxz.join(",")).join(";");
                    const widget = this.widgets?.find(w => w.name === "vxz_points");
                    if (widget) {
                        widget.value = pointsStr;
                        if (widget.callback) widget.callback(widget.value);
                    } else {
                        // Fallback to custom property if widget not found
                        this.vxz_points = pointsStr;
                    }
                };

                const removeVXZPoint = (sphere) => {
                    const index = pointsGroup.children.indexOf(sphere);
                    if (index !== -1) {
                        viewport.pointSelection.points.splice(index, 1);
                        updateSelectionPointsUI();
                        triggerUpdate();
                    }
                };


                let resizeObserver = null;
                let isolatedObjects = null;
                const toggleIsolate = () => {
                    if (isolatedObjects) {
                        isolatedObjects.forEach((visible, obj) => { if (obj) obj.visible = visible; });
                        isolatedObjects = null;
                        console.log("Comfy3D: Isolation mode DISABLED");
                    } else if (selectedObjects.length > 0) {
                        isolatedObjects = new Map();
                        const selectedMeshes = new Set();
                        selectedObjects.forEach(obj => {
                            if (obj) obj.traverse(c => selectedMeshes.add(c));
                        });

                        console.log(`Comfy3D: Isolating ${selectedObjects.length} objects...`);

                        scene.traverse(obj => {
                            // Don't hide core scene elements or helpers
                            if (obj === scene || obj === camera || obj.isLight || obj.isTransformControls ||
                                obj.type === "BoxHelper" || obj.type === "GridHelper" || obj.name === "SelectionProxy" ||
                                obj.name === "OrbitControls") return;

                            if (obj.isMesh || obj.isGroup) {
                                isolatedObjects.set(obj, obj.visible);

                                let isParentOfSelection = false;
                                selectedObjects.forEach(sel => {
                                    let p = sel;
                                    while (p) { if (p === obj) isParentOfSelection = true; p = p.parent; }
                                });

                                if (!selectedMeshes.has(obj) && !isParentOfSelection) {
                                    obj.visible = false;
                                }
                            }
                        });
                        console.log("Comfy3D: Isolation mode ENABLED - Hiddens recorded in Map");
                    }
                    triggerUpdate();
                    updateSelectionProxy();
                    if (typeof updateOutliner === "function") updateOutliner();
                    if (typeof updateOutlinerSelection === "function") updateOutlinerSelection();
                };

                const deleteSelected = () => {
                    if (selectedObjects.length > 0) {
                        const objs = [...selectedObjects];
                        const cmd = new MultiAssetCommand(objs, false, assets, scene);
                        history.push(cmd);
                        cmd.remove();
                        deselectObject();
                    }
                };

                const separateMesh = async (options = { quantization: 6.0 }) => {
                    const targets = selectedObjects.filter(o => o.isMesh || (o.children && o.children.some(c => c.isMesh)));
                    if (targets.length === 0) {
                        console.warn("Comfy3D: No meshes selected for separation.");
                        return;
                    }

                    const btn = toolbarBtns["split"];
                    if (btn) {
                        btn.style.backgroundColor = "rgba(0, 255, 128, 0.3)";
                        btn.style.boxShadow = "0 0 15px rgba(0, 255, 128, 0.2)";
                    }

                    try {
                        toggleLoading(true);
                        const originalRoots = [];
                        const newModels = [];

                        for (const target of targets) {
                            let root = target;
                            while (root.parent && !assets.includes(root)) root = root.parent;
                            if (!originalRoots.includes(root)) originalRoots.push(root);

                            const filename = root.userData.filename;
                            const folderType = root.userData.type || "output";

                            if (!filename) continue;

                            console.log(`Comfy3D: Splitting ${filename} via backend...`);

                            const response = await fetch("/comfy3d/split_mesh", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    filename: filename,
                                    type: folderType,
                                    quantization_steps: options.quantization
                                })
                            });

                            const result = await response.json();
                            if (result.error) throw new Error(result.error);

                            // Load result silently to record in command
                            const model = await loadAssetSilent(result.filename, result.type);

                            // Keep parts in their result group for outliner organization
                            // but still allow leaf-first selection in the viewport.
                            model.name = filename.split("/").pop().replace(".glb", "_Split");
                            model.userData.filename = result.filename;
                            model.userData.type = result.type;
                            
                            model.traverse(c => {
                                if (c.isMesh) {
                                    updateMeshShading(c);
                                    c.userData.filename = result.filename; 
                                    c.userData.type = result.type;
                                }
                            });

                            newModels.push(model); 
                        }

                        if (newModels.length > 0) {
                            // Record in history
                            const cmd = new SeparateMeshCommand(originalRoots, newModels, assets, scene);
                            cmd.redo(); // Performs removal and addition
                            history.push(cmd);

                            // Select new results
                            selectedObjects = [...newModels];
                            updateOutliner();
                            frameScene(newModels[0]);
                        }
                    } catch (e) {
                        console.error("Comfy3D: Separation failed:", e);
                        alert("Separation Failed: " + e.message);
                    } finally {
                        toggleLoading(false);
                        if (btn) {
                            btn.style.backgroundColor = "transparent";
                            btn.style.boxShadow = "none";
                        }
                    }
                };

                const orbit = new THREE.OrbitControls(camera, renderer.domElement);
                orbit.enableDamping = true;
                orbit.target.set(0, 0, 0); // Explicitly center target
                orbit.mouseButtons = {
                    LEFT: THREE.MOUSE.ROTATE,
                    MIDDLE: THREE.MOUSE.ROTATE,
                    RIGHT: THREE.MOUSE.PAN
                };
                orbit.enablePan = true;
                orbit.addEventListener("change", triggerUpdate);
                orbit.update();

                viewport.transform = new THREE.TransformControls(camera, renderer.domElement);
                scene.add(viewport.transform);

                const initialStates = new Map();
                let initialProxyMatrixInverse = new THREE.Matrix4();

                viewport.transform.addEventListener("mouseDown", () => {
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

                viewport.transform.addEventListener("change", () => {
                    if (viewport.transform.dragging && selectedObjects.length > 0) {
                        selectionProxy.updateMatrixWorld(true);
                        const deltaMatrix = selectionProxy.matrixWorld.clone().multiply(initialProxyMatrixInverse);
                        selectedObjects.forEach(obj => {
                            const initial = initialStates.get(obj);
                            if (initial) {
                                // Apply delta to world matrix, then decompose to local
                                const newWorldMatrix = deltaMatrix.clone().multiply(initial.matrix);

                                // To get local matrix: parentWorldMatrixInverse * newWorldMatrix
                                if (obj.parent) {
                                    const parentInverse = new THREE.Matrix4().copy(obj.parent.matrixWorld).invert();
                                    const localMatrix = parentInverse.multiply(newWorldMatrix);
                                    localMatrix.decompose(obj.position, obj.quaternion, obj.scale);
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
                        if (changed) {
                            history.push(new MultiTransformCommand(selectedObjects, initialStates, finalStates));
                        }
                    }
                    initialStates.clear();
                });

                viewport.transform.addEventListener("dragging-changed", e => {
                    orbit.enabled = !e.value;
                });

                // 3D Axis Gizmo Setup
                const gizmoScene = new THREE.Scene();
                const gizmoCamera = new THREE.OrthographicCamera(-1.8, 1.8, 1.8, -1.8, 0.1, 10);
                gizmoCamera.position.set(0, 0, 5);
                gizmoCamera.lookAt(0, 0, 0);

                const gizmoGroup = new THREE.Group();
                gizmoScene.add(gizmoGroup);

                const createGizmo = () => {
                    const axes = [
                        { axis: new THREE.Vector3(1, 0, 0), color: 0xff3b30, label: "X" }, // Red
                        { axis: new THREE.Vector3(0, 1, 0), color: 0x4cd964, label: "Y" }, // Green
                        { axis: new THREE.Vector3(0, 0, 1), color: 0x007aff, label: "Z" }  // Blue
                    ];

                    axes.forEach(a => {
                        // Positive axis line
                        const lineGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), a.axis]);
                        const line = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color: a.color, linewidth: 2 }));
                        gizmoGroup.add(line);

                        // Negative axis line (dashed or faded)
                        const negLineGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), a.axis.clone().multiplyScalar(-1)]);
                        const negLine = new THREE.Line(negLineGeom, new THREE.LineBasicMaterial({ color: a.color, transparent: true, opacity: 0.2, linewidth: 1 }));
                        gizmoGroup.add(negLine);

                        // Positive axis sphere
                        const sphere = new THREE.Mesh(
                            new THREE.SphereGeometry(0.2, 16, 16),
                            new THREE.MeshBasicMaterial({ color: a.color })
                        );
                        sphere.position.copy(a.axis).multiplyScalar(1.1);
                        sphere.userData.dir = a.axis.clone(); // Store for raycasting
                        gizmoGroup.add(sphere);

                        // Negative axis sphere (faded/smaller)
                        const negSphere = new THREE.Mesh(
                            new THREE.SphereGeometry(0.12, 16, 16),
                            new THREE.MeshBasicMaterial({ color: a.color, transparent: true, opacity: 0.2 })
                        );
                        negSphere.position.copy(a.axis).multiplyScalar(-1.1);
                        negSphere.userData.dir = a.axis.clone().multiplyScalar(-1);
                        gizmoGroup.add(negSphere);
                    });
                };
                createGizmo();

                // Interactive Gizmo Clicks
                gizmoRenderer.domElement.style.pointerEvents = "auto";
                gizmoRenderer.domElement.addEventListener("mousedown", (e) => {
                    e.stopPropagation();
                    const rect = gizmoRenderer.domElement.getBoundingClientRect();
                    const gMouse = new THREE.Vector2(
                        ((e.clientX - rect.left) / rect.width) * 2 - 1,
                        -((e.clientY - rect.top) / rect.height) * 2 + 1
                    );
                    const gRaycaster = new THREE.Raycaster();
                    gRaycaster.setFromCamera(gMouse, gizmoCamera);
                    const intersects = gRaycaster.intersectObjects(gizmoGroup.children);
                    if (intersects.length > 0) {
                        const clicked = intersects[0].object;
                        if (clicked.userData.dir) {
                            const dir = clicked.userData.dir.clone();
                            const dist = camera.position.distanceTo(orbit.target);
                            const targetPos = orbit.target.clone().add(dir.multiplyScalar(dist));

                            // Align 'up' vector for top/bottom views
                            let targetUp = new THREE.Vector3(0, 1, 0);
                            if (Math.abs(dir.y) > 0.99) targetUp.set(0, 0, -1);

                            // Simple smooth lerp animation
                            const startPos = camera.position.clone();
                            const startTime = performance.now();
                            const duration = 250;

                            const animateLerp = (time) => {
                                const t = Math.min((time - startTime) / duration, 1);
                                const ease = t * (2 - t); // easeOutQuad
                                camera.position.lerpVectors(startPos, targetPos, ease);
                                camera.up.lerp(targetUp, ease);
                                camera.lookAt(orbit.target);
                                orbit.update();
                                triggerUpdate();
                                if (t < 1) requestAnimationFrame(animateLerp);
                            };
                            requestAnimationFrame(animateLerp);
                        }
                    }
                });

                const raycaster = new THREE.Raycaster();
                const mouse = new THREE.Vector2();
                let selectionStartLocal = new THREE.Vector2();
                let selectionStartScreen = new THREE.Vector2();
                let mouseDownOnCanvas = false;
                let mouseInCanvas = false;
                let isSelecting = false;


                const handleGlobalMouseDown = e => {
                    const isNavigating = e.altKey || (e.button === 1); // Alt or MMB

                    if (viewport.modalTransform.active) {
                        if (e.button === 0) { // Left click confirm
                            const mt = viewport.modalTransform;
                            const initialMap = new Map();
                            const finalMap = new Map();

                            mt.startStates.forEach(s => {
                                initialMap.set(s.object, { p: s.position, q: s.quaternion, s: s.scale });
                                finalMap.set(s.object, { p: s.object.position.clone(), q: s.object.quaternion.clone(), s: s.object.scale.clone() });
                            });

                            const cmd = new MultiTransformCommand(mt.startStates.map(s => s.object), initialMap, finalMap);
                            history.push(cmd);

                            mt.active = false;
                            orbit.enabled = true;
                            if (viewport.transform) viewport.transform.enabled = true;
                            triggerUpdate();
                            e.preventDefault();
                            e.stopPropagation();
                        } else if (e.button === 2) { // Right click cancel
                            viewport.modalTransform.startStates.forEach(s => {
                                s.object.position.copy(s.position);
                                s.object.quaternion.copy(s.quaternion);
                                s.object.scale.copy(s.scale);
                            });
                            viewport.modalTransform.active = false;
                            orbit.enabled = true;
                            if (viewport.transform) viewport.transform.enabled = true;
                            triggerUpdate();
                            e.preventDefault();
                            e.stopPropagation();
                        }
                        return;
                    }

                    if (viewport.pointSelection.active && !isNavigating) {
                        const rect = renderer.domElement.getBoundingClientRect();
                        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                        raycaster.setFromCamera(mouse, camera);

                        if (e.button === 0) { // Left Click: Add Point
                            const intersects = raycaster.intersectObjects(getPickableAssets(), true);
                            if (intersects.length > 0) {
                                addVXZPoint(intersects[0]);
                                mouseDownOnCanvas = false;
                                e.preventDefault();
                                e.stopPropagation();
                                return;
                            }
                        } else if (e.button === 2) { // Right Click: Delete Point
                            const intersects = raycaster.intersectObjects(pointsGroup.children, true);
                            if (intersects.length > 0) {
                                const sphere = intersects[0].object;
                                removeVXZPoint(sphere);
                                mouseDownOnCanvas = false;
                                e.preventDefault();
                                e.stopPropagation();
                                return;
                            }
                        }
                    }

                    if (e.target !== renderer.domElement) {
                        mouseDownOnCanvas = false;
                        return;
                    }

                    // Synchronize OrbitControls state immediately on mousedown
                    if (viewport.brushActive) {
                        orbit.enabled = isNavigating;
                        if (!isNavigating && e.button === 0) {
                            e.preventDefault(); // Prevent browser drag
                        }
                    } else {
                        // Suppress navigation if Shift is held for box selection, or if we are hovering/clicking a transformation gizmo
                        const isGizmoHover = viewport.transform && (viewport.transform.axis || viewport.transform.dragging);
                        orbit.enabled = !e.shiftKey && !isGizmoHover || e.altKey || (e.button === 1);
                    }

                    mouseDownOnCanvas = true;
                    const mRect = renderer.domElement.getBoundingClientRect();
                    const mScaleX = mRect.width / (renderer.domElement.clientWidth || 1);
                    const mScaleY = mRect.height / (renderer.domElement.clientHeight || 1);

                    selectionStartScreen.set(e.clientX, e.clientY);
                    selectionStartLocal.set(
                        (e.clientX - mRect.left) / (mScaleX || 1),
                        (e.clientY - mRect.top) / (mScaleY || 1)
                    );
                    viewport._strokeFrameLog = 0;
                    viewport._hitLogCount = 0;

                    if (viewport.brushActive) {
                        // Start stroke tracking
                        // Capture state for undo if implemented for GPU

                    }
                    // Box selection will only start if shift is held AND we drag > 5px (handled in mousemove)
                };

                const handleGlobalMouseUp = e => {
                    if (!mouseDownOnCanvas) return;

                    if (viewport.brushActive) {

                        mouseDownOnCanvas = false;
                        return;
                    }

                    const rect = renderer.domElement.getBoundingClientRect();
                    const scaleX = rect.width / renderer.domElement.clientWidth;
                    const scaleY = rect.height / renderer.domElement.clientHeight;

                    const currentX = (e.clientX - rect.left) / scaleX;
                    const currentY = (e.clientY - rect.top) / scaleY;

                    if (isSelecting) {
                        // Box Selection Finalize
                        isSelecting = false;
                        selectionRect.style.display = "none";
                        orbit.enabled = true;

                        const rectStart = renderer.domElement.getBoundingClientRect();
                        const startX = selectionStartLocal.x;
                        const startY = selectionStartLocal.y;

                        const left = Math.min(startX, currentX);
                        const top = Math.min(startY, currentY);
                        const right = Math.max(startX, currentX);
                        const bottom = Math.max(startY, currentY);

                        // Collect all assets in box
                        const selectedInBox = [];
                        const tempV3 = new THREE.Vector3();
                        const tempBox = new THREE.Box3();
                        const pickable = getPickableAssets();
                        for (const asset of pickable) {
                            tempBox.setFromObject(asset);
                            tempBox.getCenter(tempV3);
                            tempV3.project(camera);
                            const screenX = (tempV3.x + 1) * renderer.domElement.clientWidth / 2;
                            const screenY = (-tempV3.y + 1) * renderer.domElement.clientHeight / 2;

                            if (screenX >= left && screenX <= right && screenY >= top && screenY <= bottom) {
                                if (xrayMode) {
                                    // X-Ray Mode: Select everything in frustum
                                    selectedInBox.push(asset);
                                } else {
                                    // Standard Mode: Occlusion Check (Raycast to center)
                                    // We use a small offset if the center is likely inside the mesh, 
                                    // but for generic assets, hitting the asset's own surface is enough.
                                    raycaster.setFromCamera(new THREE.Vector2(tempV3.x, tempV3.y), camera);
                                    const hits = raycaster.intersectObjects(pickable, true);
                                    if (hits.length > 0) {
                                        let hitRoot = hits[0].object;
                                        while (hitRoot.parent && !assets.includes(hitRoot)) hitRoot = hitRoot.parent;
                                        if (hitRoot === asset) {
                                            selectedInBox.push(asset);
                                        }
                                    }
                                }
                            }
                        }

                        if (selectedInBox.length > 0) {
                            if (e.shiftKey) {
                                selectedInBox.forEach(a => {
                                    if (!selectedObjects.includes(a)) selectedObjects.push(a);
                                });
                            } else {
                                selectedObjects = selectedInBox;
                            }
                            selectObject(null, null, 2);
                        } else if (!e.shiftKey) {
                            deselectObject();
                        }
                    } else {
                        // Single Pick (Click)
                        if (viewport.transform && viewport.transform.dragging) {
                            mouseDownOnCanvas = false;
                            return;
                        }

                        mouse.x = (currentX / renderer.domElement.clientWidth) * 2 - 1;
                        mouse.y = -(currentY / renderer.domElement.clientHeight) * 2 + 1;

                        raycaster.setFromCamera(mouse, camera);
                        const intersectsAsset = raycaster.intersectObjects(getPickableAssets(), true);

                        if (intersectsAsset.length > 0) {
                            const hit = intersectsAsset[0];
                            let leaf = hit.object;
                            let root = leaf;
                            while (root.parent && !assets.includes(root)) {
                                root = root.parent;
                            }

                            if (assets.includes(root)) {
                                // Precision Selection Logic:
                                // ALWAYS prioritize the leaf mesh for direct interaction.
                                // This solves the "Root Selection" problem where clicking a mesh picked its group.
                                let target = leaf.isMesh ? leaf : root;

                                console.log(`Comfy3D: Viewport Pick: ${target.name} (isLeaf: ${target !== root})`);
                                selectObject(target, hit.point, e.shiftKey ? 1 : 0);
                            } else if (!e.shiftKey && !viewport.transform.axis) {
                                deselectObject();
                            }
                        } else if (!e.shiftKey && !viewport.transform.axis) {
                            deselectObject();
                        }
                    }

                    if (viewport.brushActive) {

                    }
                    mouseDownOnCanvas = false;
                    triggerUpdate();
                };



                window.addEventListener("mousedown", handleGlobalMouseDown, true);
                window.addEventListener("pointerdown", handleGlobalMouseDown, true);
                window.addEventListener("mouseup", handleGlobalMouseUp, true);
                window.addEventListener("pointerup", handleGlobalMouseUp, true);

                const onKeyDown = (e) => {
                    const key = e.key.toLowerCase();
                    if (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA") return;
                    if (mouseInCanvas && (e.altKey || (e.ctrlKey && key !== "r" && key !== "t" && key !== "n"))) {
                        console.log("Comfy3D: Blocking browser shortcut:", key);
                        e.preventDefault();
                    }
                    if (key === "f") {
                        console.log("Comfy3D: Hotkey \"F\" detected. alt:", e.altKey, "shift:", e.shiftKey, "ctrl:", e.ctrlKey);
                        if (e.altKey) {
                            console.log("Comfy3D: Triggering Unhide All (Alt+F)");
                            if (isolatedObjects) toggleIsolate();
                            return;
                        }
                        if (selectedObjects.length > 0) {
                            isolationHistory.push([...selectedObjects]);
                            console.log(`Comfy3D: Focus In [Step ${isolationHistory.length}] - Isolating ${selectedObjects.length} items...`);
                            selectedObjects.forEach(obj => {
                                console.log(`Comfy3D: Path: ${getObjectPath(obj)}`);
                            });
                            frameScene(selectedObjects);
                            if (isolatedObjects) toggleIsolate(); // Toggle OFF to restore everything
                            toggleIsolate(); // Toggle ON to re-isolate based on NEW selection
                        } else if (isolatedObjects && isolationHistory.length > 0) {
                            // Breadcrumb Unfocus (Selection History)
                            isolationHistory.pop(); // Remove current focus level

                            if (isolationHistory.length > 0) {
                                const prevSelection = isolationHistory[isolationHistory.length - 1];
                                console.log(`Comfy3D: Focus Out [Step ${isolationHistory.length}] - Restoring to previous selection of ${prevSelection.length} items...`);

                                // Temporarily update globals for focus/isolate logic
                                const currentSel = selectedObjects;
                                selectedObjects = prevSelection;

                                frameScene(prevSelection);
                                toggleIsolate(); // Restore
                                toggleIsolate(); // Re-isolate to previous level

                                selectedObjects = currentSel;
                                if (typeof updateOutlinerSelection === "function") updateOutlinerSelection();
                            } else {
                                console.log("Comfy3D: Focus Restore [Step 0] - History empty, framing entire scene.");
                                if (isolatedObjects) toggleIsolate();
                                frameScene(assets);
                            }
                        } else {
                            console.log("Comfy3D: Focus Restore - Nothing selected, framing entire scene.");
                            if (isolatedObjects) toggleIsolate();
                            frameScene(assets);
                            isolationHistory = [];
                        }
                    }
                    if (key === "h") {
                        console.log("Comfy3D: Hotkey \"H\" detected. alt:", e.altKey);
                        if (e.altKey) {
                            console.log("Comfy3D: Triggering Unhide All (Alt+H)");
                            if (isolatedObjects) toggleIsolate();
                            else {
                                scene.traverse(obj => { if (obj.isMesh || obj.isGroup) obj.visible = true; });
                                triggerUpdate();
                                if (typeof updateOutliner === "function") updateOutliner();
                            }
                        } else if (selectedObjects.length > 0) {
                            console.log("Comfy3D: Hiding selection...");
                            selectedObjects.forEach(obj => { if (obj) obj.visible = false; });
                            deselectObject();
                        }
                    }
                };
                window.addEventListener("keydown", onKeyDown, true);

                window.addEventListener("click", e => { }, true);

                container.addEventListener("mouseenter", () => { mouseInCanvas = true; });
                container.addEventListener("mouseleave", () => { mouseInCanvas = false; });

                const onMouseMove = e => {
                    const rect = renderer.domElement.getBoundingClientRect();
                    const scaleX = rect.width / renderer.domElement.clientWidth;
                    const scaleY = rect.height / renderer.domElement.clientHeight;
                    const localX = (e.clientX - rect.left) / scaleX;
                    const localY = (e.clientY - rect.top) / scaleY;

                    // NDC for raycaster: must be in range [-1, 1] relative to the element size
                    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

                    if (mouseDownOnCanvas && viewport.brushActive) {
                        // Drawing logic removed. Brush UI is preserved.
                    }

                    if (viewport.modalTransform.active) {
                        const mt = viewport.modalTransform;
                        const mouseDelta = new THREE.Vector2(mouse.x - mt.startMouse.x, mouse.y - mt.startMouse.y);
                        const centerScreen = mt.centerScreen;

                        mt.startStates.forEach(s => {
                            if (mt.mode === "translate") {
                                const cameraRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
                                const cameraUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);

                                const fovFactor = Math.tan(camera.fov * Math.PI / 360) * 2;
                                const distToCenter = mt.center.distanceTo(camera.position);
                                const scaleX = distToCenter * fovFactor * (rect.width / rect.height) * 0.5;
                                const scaleY = distToCenter * fovFactor * 0.5;

                                s.object.position.copy(s.position)
                                    .add(cameraRight.multiplyScalar(mouseDelta.x * scaleX))
                                    .add(cameraUp.multiplyScalar(mouseDelta.y * scaleY));

                            } else if (mt.mode === "rotate") {
                                const vStart = new THREE.Vector2(mt.startMouse.x - centerScreen.x, mt.startMouse.y - centerScreen.y);
                                const vCurrent = new THREE.Vector2(mouse.x - centerScreen.x, mouse.y - centerScreen.y);

                                if (vStart.length() > 0.001 && vCurrent.length() > 0.001) {
                                    vStart.normalize();
                                    vCurrent.normalize();
                                    let angle = Math.atan2(vCurrent.y, vCurrent.x) - Math.atan2(vStart.y, vStart.x);

                                    const cameraDir = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2);
                                    const q = new THREE.Quaternion().setFromAxisAngle(cameraDir, angle);
                                    s.object.quaternion.copy(s.quaternion).premultiply(q);
                                }

                            } else if (mt.mode === "scale") {
                                const dStart = new THREE.Vector2(mt.startMouse.x - centerScreen.x, mt.startMouse.y - centerScreen.y).length();
                                const dCurrent = new THREE.Vector2(mouse.x - centerScreen.x, mouse.y - centerScreen.y).length();

                                if (dStart > 0.001) {
                                    const ratio = dCurrent / dStart;
                                    s.object.scale.copy(s.scale).multiplyScalar(ratio);
                                }
                            }
                        });
                        triggerUpdate();
                        return;
                    }


                    // Support starting box selection only if dragging > 5px and Shift held
                    if (mouseDownOnCanvas && e.shiftKey && !isSelecting && !viewport.transform.axis && !viewport.brushActive) {
                        const dist = Math.sqrt(Math.pow(e.clientX - selectionStartScreen.x, 2) + Math.pow(e.clientY - selectionStartScreen.y, 2));
                        if (dist > 5) {
                            isSelecting = true;
                            selectionRect.style.display = "block";
                            orbit.enabled = false;
                        }
                    }

                    if (isSelecting) {
                        const startX = selectionStartLocal.x;
                        const startY = selectionStartLocal.y;
                        const left = Math.min(startX, localX);
                        const top = Math.min(startY, localY);
                        const width = Math.abs(localX - startX);
                        const height = Math.abs(localY - startY);
                        selectionRect.style.left = left + "px";
                        selectionRect.style.top = top + "px";
                        selectionRect.style.width = width + "px";
                        selectionRect.style.height = height + "px";
                        return;
                    }

                    // Update OrbitControls based on mode and keys
                    const isNavigating = e.altKey || (e.buttons & 4); // Alt or MMB
                    if (viewport.brushActive) {
                        orbit.enabled = isNavigating;
                        orbit.enableRotate = isNavigating;
                        orbit.enablePan = false; // "readd only rotate" restriction
                        orbit.enableZoom = true;
                        renderer.domElement.style.cursor = isNavigating ? "grab" : "none";
                    } else {
                        // Allow navigation ONLY if explicitly navigating via Alt/MMB, or if not selecting/holding Shift/Transforming
                        const isTransforming = (viewport.transform && (viewport.transform.dragging || viewport.transform.axis)) || (viewport.modalTransform && viewport.modalTransform.active);
                        orbit.enabled = isNavigating || (!isSelecting && !e.shiftKey && !isTransforming);
                        orbit.enableRotate = isNavigating;
                        orbit.enablePan = isNavigating || (e.buttons & 2); // Alt, MMB or RMB
                        orbit.enableZoom = true;
                        viewport._strokeFrameLog = 0; // Reset log counter when brush not in active use

                        if (isNavigating) {
                            renderer.domElement.style.cursor = "grab";
                        } else {
                            if (!this._lastRaycast || performance.now() - this._lastRaycast > 50) {
                                raycaster.setFromCamera(mouse, camera);
                                const intersects = raycaster.intersectObjects(getPickableAssets(), true);
                                renderer.domElement.style.cursor = (intersects.length > 0 || isSelecting) ? "pointer" : "auto";
                                this._lastRaycast = performance.now();
                            }
                        }
                    }

                    if (viewport.brushActive && !e.altKey && e.target === renderer.domElement) {
                        brushCursor.style.display = "block";
                        brushCursor.style.left = localX + "px";
                        brushCursor.style.top = localY + "px";

                        const visualSize = viewport.brushSize * (rect.width / 1024);
                        brushCursor.style.width = visualSize + "px";
                        brushCursor.style.height = visualSize + "px";

                        brushCursor.style.border = `2px solid rgba(255, 149, 0, ${0.4 + viewport.brushHardness * 0.6})`;
                        brushCursor.style.boxShadow = `0 0 10px rgba(255, 149, 0, ${0.2 + viewport.brushHardness * 0.4})`;
                    } else {
                        brushCursor.style.display = "none";
                        if (!viewport.brushActive) {
                            if (!this._lastRaycast || performance.now() - this._lastRaycast > 50) {
                                raycaster.setFromCamera(mouse, camera);
                                const intersects = raycaster.intersectObjects(getPickableAssets(), true);
                                renderer.domElement.style.cursor = (intersects.length > 0 || isSelecting) ? "pointer" : "auto";
                                this._lastRaycast = performance.now();
                            }
                        }
                    }
                };
                window.addEventListener("mousemove", onMouseMove, true);
                window.addEventListener("pointermove", onMouseMove, true);
                window.addEventListener("mouseup", handleGlobalMouseUp, true);
                window.addEventListener("pointerup", handleGlobalMouseUp, true);
                window.addEventListener("contextmenu", e => {
                    if (viewport.modalTransform.active) e.preventDefault();
                }, true);

                let lastRenderTime = 0;
                const animate = (time) => {
                    requestAnimationFrame(animate);

                    const changed = orbit.update(); // Returns true if damping is still active
                    if (changed) needsUpdate = true;

                    if (needsUpdate) {
                        // 1. Main Scene Render
                        if (selectionHelper && selectionHelper.visible && selectedObjects.length > 0) {
                            if (selectedObjects.length > 1 && this._selectionBoxMesh) {
                                const box = new THREE.Box3();
                                selectedObjects.forEach(o => box.expandByObject(o));
                                const size = box.getSize(new THREE.Vector3());
                                const center = box.getCenter(new THREE.Vector3());
                                this._selectionBoxMesh.scale.set(size.x || 0.1, size.y || 0.1, size.z || 0.1);
                                this._selectionBoxMesh.position.copy(center);
                                this._selectionBoxMesh.updateMatrixWorld(true);
                                selectionHelper.setFromObject(this._selectionBoxMesh);
                            } else {
                                selectionHelper.update();
                            }
                        }
                        renderer.render(scene, camera);

                        // 2. Gizmo Overlay Render - COMPLETELY ISOLATED
                        gizmoGroup.quaternion.copy(camera.quaternion).invert();
                        gizmoRenderer.render(gizmoScene, gizmoCamera);

                        needsUpdate = false;
                        lastRenderTime = time;
                    }
                };
                animate();

                const handleKeyDown = (e) => {
                    if (!viewport.transform) return;
                    const key = e.key.toLowerCase();
                    const isCtrl = e.ctrlKey || e.metaKey;
                    const isAlt = e.altKey;

                    // Undo / Redo (Primary: Alt+Z, Secondary: Ctrl+Z)
                    if (isAlt || isCtrl) {
                        if (key === "z") {
                            if (e.shiftKey) history.redo();
                            else history.undo();
                            triggerUpdate();
                            e.preventDefault();
                            e.stopPropagation();
                            return;
                        }
                        if (key === "y") {
                            history.redo();
                            triggerUpdate();
                            e.preventDefault();
                            e.stopPropagation();
                            return;
                        }
                    }

                    if (isAlt || isCtrl || e.metaKey) {
                        return; // Ignore transformation tools if any modifier is pressed
                    }

                    const initiateModalTransform = (mode) => {
                        if (selectedObjects.length === 0) return;
                        viewport.modalTransform.active = true;
                        viewport.modalTransform.mode = mode;
                        viewport.modalTransform.startMouse.copy(mouse);
                        viewport.modalTransform.startStates = selectedObjects.map(obj => ({
                            object: obj,
                            position: obj.position.clone(),
                            quaternion: obj.quaternion.clone(),
                            scale: obj.scale.clone()
                        }));

                        // Calculate center
                        const box = new THREE.Box3();
                        selectedObjects.forEach(o => box.expandByObject(o));
                        box.getCenter(viewport.modalTransform.center);
                        viewport.modalTransform.centerScreen.copy(viewport.modalTransform.center).project(camera);

                        orbit.enabled = false;
                        if (viewport.transform) {
                            viewport.transform.setMode(mode);
                            viewport.transform.enabled = false;
                        }
                        viewport.brushActive = false;
                        viewport.pointSelection.active = false; // Mutually exclusive
                        if (typeof updateToolbar === "function") updateToolbar();
                        triggerUpdate();
                    };

                    const confirmModalTransform = () => {
                        if (!viewport.modalTransform.active) return;

                        const mt = viewport.modalTransform;
                        const initialMap = new Map();
                        const finalMap = new Map();

                        mt.startStates.forEach(s => {
                            initialMap.set(s.object, { p: s.position, q: s.quaternion, s: s.scale });
                            finalMap.set(s.object, { p: s.object.position.clone(), q: s.object.quaternion.clone(), s: s.object.scale.clone() });
                        });

                        const cmd = new MultiTransformCommand(mt.startStates.map(s => s.object), initialMap, finalMap);
                        history.push(cmd);

                        mt.active = false;
                        orbit.enabled = true;
                        if (viewport.transform) viewport.transform.enabled = true;
                        triggerUpdate();
                    };

                    switch (key) {
                        case "g": initiateModalTransform("translate"); break;
                        case "r": initiateModalTransform("rotate"); break;
                        case "s": initiateModalTransform("scale"); break;
                        case "escape":
                            if (viewport.modalTransform.active) {
                                viewport.modalTransform.startStates.forEach(s => {
                                    s.object.position.copy(s.position);
                                    s.object.quaternion.copy(s.quaternion);
                                    s.object.scale.copy(s.scale);
                                });
                                viewport.modalTransform.active = false;
                                orbit.enabled = true;
                                if (viewport.transform) viewport.transform.enabled = true;
                                triggerUpdate();
                            }
                            break;
                        case "enter":
                            confirmModalTransform();
                            break;
                        case "b":
                            const bBtn = toolbarBtns["brush"];
                            if (bBtn) bBtn.click();
                            break;
                        case "v":
                            const vBtn = toolbarBtns["split"];
                            if (vBtn) vBtn.click();
                            break;
                        case "x": case "delete": deleteSelected(); break;
                    }
                    if (typeof updateToolbar === "function") updateToolbar();
                };
                window.addEventListener("keydown", handleKeyDown);


                this.onRemoved = () => {
                    window.removeEventListener("keydown", handleKeyDown);
                    window.removeEventListener("mousedown", handleGlobalMouseDown, true);
                    window.removeEventListener("mouseup", handleGlobalMouseUp, true);
                    window.removeEventListener("pointerdown", handleGlobalMouseDown, true);
                    window.removeEventListener("pointerup", handleGlobalMouseUp, true);
                    container.removeEventListener("mousemove", onMouseMove, true);
                    if (resizeObserver) resizeObserver.disconnect();
                    if (viewport.transform) viewport.transform.dispose();
                    if (renderer) renderer.dispose();
                    if (gizmoRenderer) gizmoRenderer.dispose();
                };

                // Initial toolbar update
                if (typeof updateToolbar === "function") updateToolbar();

                // Drag and Drop Handling
                container.addEventListener("dragover", e => {
                    e.preventDefault();
                    container.style.border = "2px dashed #00ff88";
                });
                container.addEventListener("dragleave", () => container.style.border = "none");
                container.addEventListener("drop", async e => {
                    e.preventDefault();
                    container.style.border = "none";
                    const files = Array.from(e.dataTransfer.files);
                    files.forEach((file, idx) => {
                        const ext = file.name.split(".").pop().toLowerCase();
                        if (["glb", "gltf", "obj", "stl"].includes(ext)) {
                            const reader = new FileReader();
                            reader.onload = async event => {
                                const buffer = event.target.result;
                                let loader;
                                let onLoaded = (model) => {
                                    model.name = file.name;
                                    model.userData.filename = file.name;
                                    model.userData.type = "temp";
                                    addAsset(model);
                                    if (files.length === 1 || idx === 0) frameScene(model);
                                };

                                if (ext === "glb" || ext === "gltf") {
                                    loader = new THREE.GLTFLoader();
                                    loader.parse(buffer, "", gltf => onLoaded(gltf.scene));
                                } else if (ext === "obj") {
                                    loader = new THREE.OBJLoader();
                                    const text = new TextDecoder().decode(buffer);
                                    onLoaded(loader.parse(text));
                                } else if (ext === "stl") {
                                    loader = new THREE.STLLoader();
                                    const geometry = loader.parse(buffer);
                                    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xcccccc }));
                                    onLoaded(mesh);
                                }
                            };
                            reader.readAsArrayBuffer(file);
                        }
                    });
                });

                let lastW = 0, lastH = 0;
                const resize = () => {
                    const w = Math.floor(canvasArea.clientWidth);
                    const h = Math.floor(canvasArea.clientHeight);

                    // Guard against sub-pixel jitter and noise
                    if (Math.abs(w - lastW) < 2 && Math.abs(h - lastH) < 2) return;

                    if (w > 0 && h > 0) {
                        renderer.setSize(w, h, false); // Crucial: don't let ThreeJS fight the CSS
                        camera.aspect = w / h;
                        camera.updateProjectionMatrix();
                        triggerUpdate();
                        lastW = w; lastH = h;
                    }
                };

                // Initialization Delay: Wait for LiteGraph to finish its first few layout passes
                setTimeout(() => {
                    resizeObserver = new ResizeObserver(resize);
                    resizeObserver.observe(canvasArea);
                    resize();
                }, 1000);

                let lastBase64Update = 0;
                setInterval(() => {
                    if (renderer.domElement && needsUpdate === false && performance.now() - lastBase64Update > 2000) {
                        const data = renderer.domElement.toDataURL("image/jpeg", 0.85); // Use JPEG with slightly lower quality for preview
                        const widget = this.widgets?.find(w => w.name === "base64_image");
                        if (widget) widget.value = data;
                        else this.base64_image = data;
                        lastBase64Update = performance.now();
                    }
                }, 1000);

                const loadAssetSilent = (filename, type = "output") => {
                    return new Promise((resolve, reject) => {
                        const ext = filename.split(".").pop().toLowerCase();
                        let loader;
                        if (ext === "glb" || ext === "gltf") loader = new THREE.GLTFLoader();
                        else if (ext === "obj") loader = new THREE.OBJLoader();
                        else if (ext === "stl") loader = new THREE.STLLoader();
                        else return reject(new Error("Unsupported format"));

                        const url = `/view?filename=${encodeURIComponent(filename)}&type=${type}`;
                        loader.load(url, (result) => {
                            let raw = result.scene || result;
                            if (ext === "stl" && result.isBufferGeometry) {
                                raw = new THREE.Mesh(result, new THREE.MeshStandardMaterial({ color: 0xcccccc }));
                            }

                            // Unpack Scene/Groups - promote meshes to top-level assets for precision
                            // This solves the  "click root not mesh" problem globally
                            const meshes = [];
                            raw.traverse(c => { if (c.isMesh) meshes.push(c); });

                            if (meshes.length === 1) {
                                let model = meshes[0];
                                model.name = filename;
                                model.userData.filename = filename;
                                model.userData.type = type;
                                model.traverse(updateMeshShading);
                                resolve(model);
                            } else {
                                // Keep hierarchy if multi-mesh, but still mark root for identification
                                raw.name = filename;
                                raw.userData.filename = filename;
                                raw.userData.type = type;
                                raw.traverse(updateMeshShading);
                                resolve(raw);
                            }
                        }, undefined, (err) => reject(new Error("Load failed: " + err)));
                    });
                };

                this.loadExternalAsset = (path, type = "temp") => {
                    const ext = path.split(".").pop().toLowerCase();
                    let filename = path;
                    let subfolder = "";
                    if (path.includes("/") || path.includes("\\")) {
                        const parts = path.split(/[/\\]/);
                        filename = parts.pop();
                        subfolder = parts.join("/");
                    }

                    let url = `/view?filename=${encodeURIComponent(filename)}`;
                    if (subfolder) url += `&subfolder=${encodeURIComponent(subfolder)}`;
                    url += `&type=${type}`;

                    let loader;
                    if (ext === "glb" || ext === "gltf") loader = new THREE.GLTFLoader();
                    else if (ext === "obj") loader = new THREE.OBJLoader();
                    else if (ext === "stl") loader = new THREE.STLLoader();
                    else return;

                    console.log(`Comfy3D: Attempting load from ${type}:`, url);

                    const onLoaded = (result) => {
                        console.log(`Comfy3D: Successfully loaded asset from ${type}:`, path);
                        let model = result.scene || result;
                        if (ext === "stl" && result.isBufferGeometry) {
                            model = new THREE.Mesh(result, new THREE.MeshStandardMaterial({ color: 0xcccccc }));
                        }
                        model.name = filename;
                        model.userData.filename = filename;
                        model.userData.type = type;
                        addAsset(model);
                        frameScene(model);
                    };

                    const onError = (error) => {
                        console.error(`Comfy3D: Failed to load from ${type}:`, error);
                        if (type === "temp") {
                            console.log("Comfy3D: Retrying from 'output' folder...");
                            this.loadExternalAsset(path, "output");
                        }
                    };

                    loader.load(url, onLoaded, undefined, onError);
                };
            };

            const onExecuted = nodeType.prototype.onExecuted;
            nodeType.prototype.onExecuted = function (message) {
                onExecuted?.apply(this, arguments);
                console.log("Comfy3D: onExecuted received message:", message);
                if (message?.mesh_path) {
                    const mesh_info = message.mesh_path[0];
                    let path, type;

                    if (typeof mesh_info === "string") {
                        path = mesh_info;
                        type = "temp";
                    } else {
                        path = mesh_info.filename;
                        type = mesh_info.type;
                    }

                    console.log(`Comfy3D: Target mesh: ${path} (type: ${type})`);

                    if (this.last_imported_mesh === path) {
                        console.log("Comfy3D: Path unchanged, skipping redundant load.");
                        return;
                    }
                    this.last_imported_mesh = path;

                    if (!this.loadExternalAsset) {
                        console.warn("Comfy3D: loadExternalAsset not ready yet, retrying in 1s...");
                        setTimeout(() => this.loadExternalAsset?.(path, type), 1000);
                    } else {
                        this.loadExternalAsset(path, type);
                    }
                }
            };
        }
    }
});
