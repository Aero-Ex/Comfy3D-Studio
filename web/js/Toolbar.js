/**
 * Toolbar.js
 * Main floating bottom toolbar (select/translate/rotate/scale/brush/point/split/undo/redo)
 * and top-right shading toolbar (wireframe/solid/material/normal/xray/outliner toggle).
 * Also manages selection-mode buttons (top-left panel).
 *
 * Extracted verbatim from web/3d_viewport.js lines 939–999 (selection mode UI),
 * 1349–1587 (shading toolbar), and 1588–1732 (main toolbar).
 */

export class Toolbar {
    /**
     * @param {object} deps
     * @param {HTMLElement} deps.canvasArea
     * @param {object} deps.viewport                - ComfyUI node instance.
     * @param {SelectionManager} deps.selectionManager
     * @param {ShadingManager} deps.shadingManager
     * @param {Outliner} deps.outliner
     * @param {BrushPanel} deps.brushPanel
     * @param {CommandHistory} deps.history
     * @param {Function} deps.toggleSegmentationMode
     * @param {Function} deps.triggerUpdate
     */
    constructor(deps) {
        this.canvasArea = deps.canvasArea;
        this.viewport = deps.viewport;
        this.selMgr = deps.selectionManager;
        this.shadingMgr = deps.shadingManager;
        this.outliner = deps.outliner;
        this.brushPanel = deps.brushPanel;
        this.history = deps.history;
        this.toggleSegmentationMode = deps.toggleSegmentationMode;
        this.triggerUpdate = deps.triggerUpdate;

        this.toolbarBtns = {};
        this.shadingBtns = {};
        this.selectionBtns = {};

        this._buildSelectionModeUI();
        this._buildShadingUI();
        this._buildMainToolbar();

        // Expose update fns to SelectionManager
        const self = this;
        this.selMgr.setUICallbacks({
            updateOutliner: () => this.outliner?.update(),
            updateOutlinerSelection: () => this.outliner?.updateSelection(),
            updateSelectionUI: () => this.updateSelectionUI(),
            updateToolbar: () => this.updateToolbar()
        });

        // Give Outliner access to updateToolbar
        if (this.outliner) this.outliner.setUpdateToolbarCallback(() => this.updateToolbar());
    }

    // -----------------------------------------------------------------------
    // Selection Mode UI (top-left)
    // -----------------------------------------------------------------------
    _buildSelectionModeUI() {
        const modePanel = document.createElement("div");
        modePanel.className = "comfy3d-selection-mode-panel";
        this.canvasArea.appendChild(modePanel);

        const modes = [
            { id: "object", title: "Object Selection", icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l9 4.9V17L12 22l-9-4.9V7L12 2z"/></svg>` },
            { id: "vertex", title: "Vertex Selection", icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" opacity="0.2"/><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none"/></svg>` },
            { id: "edge",   title: "Edge Selection",   icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" opacity="0.2"/><path d="M9 3v18" stroke="currentColor" stroke-width="3"/></svg>` },
            { id: "face",   title: "Face Selection",   icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" opacity="0.2"/><rect x="7" y="7" width="10" height="10" fill="currentColor" opacity="0.8" stroke="none"/></svg>` }
        ];

        modes.forEach(m => {
            const btn = document.createElement("button");
            btn.className = "comfy3d-selection-btn";
            btn.innerHTML = m.icon;
            btn.title = m.title;
            btn.onclick = (e) => {
                e.stopPropagation();
                this.viewport.selectionMode = m.id;
                this.selMgr.updateSubMeshHighlights();
                this.updateSelectionUI();
                this.triggerUpdate();
            };
            modePanel.appendChild(btn);
            this.selectionBtns[m.id] = btn;
        });
        this.updateSelectionUI();
    }

    updateSelectionUI() {
        Object.keys(this.selectionBtns).forEach(id => {
            this.selectionBtns[id].classList.toggle("active", this.viewport.selectionMode === id);
        });
        if (this.viewport.transform) {
            this.viewport.transform.visible = (this.viewport.selectionMode === "object" && this.selMgr.selectedObjects.length > 0);
        }
        if (this.selMgr.selectionHelper) this.selMgr.updateSelectionHelper();
    }

    // -----------------------------------------------------------------------
    // Shading UI (top-right)
    // -----------------------------------------------------------------------
    _buildShadingUI() {
        const shadingUI = document.createElement("div");
        Object.assign(shadingUI.style, {
            position: "absolute", top: "12px", right: "12px",
            display: "flex", gap: "6px", zIndex: "100",
            padding: "4px", backgroundColor: "rgba(0,0,0,0.3)",
            borderRadius: "20px", backdropFilter: "blur(4px)",
            border: "1px solid rgba(255,255,255,0.1)"
        });
        this.canvasArea.appendChild(shadingUI);

        const shadingModes = [
            { id: "wireframe", icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/><ellipse cx="12" cy="12" rx="9" ry="4"/><ellipse cx="12" cy="12" rx="4" ry="9"/></svg>`, title: "Wireframe" },
            { id: "solid",     icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="12" cy="12" r="9"/></svg>`, title: "Solid" },
            { id: "material",  icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 16.2a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4z"/><path d="M12 3a9 9 0 0 1 0 18z" opacity="0.5"/></svg>`, title: "Material" },
            { id: "normal",    icon: `<svg viewBox="0 0 24 24" width="16" height="16"><defs><linearGradient id="gn" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ff0000"/><stop offset="50%" stop-color="#00ff00"/><stop offset="100%" stop-color="#0000ff"/></linearGradient></defs><circle cx="12" cy="12" r="9" fill="url(#gn)"/></svg>`, title: "Normal" },
            { id: "xray",      icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="10" height="10" rx="1"/><rect x="11" y="11" width="10" height="10" rx="1" stroke-dasharray="3 2"/></svg>`, title: "X-Ray Mode" },
            { id: "outliner",  icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`, title: "Toggle Scene Management" }
        ];

        shadingModes.forEach(m => {
            const btn = document.createElement("button");
            btn.innerHTML = m.icon; btn.title = m.title;
            btn.className = "comfy3d-toolbar-btn";
            Object.assign(btn.style, {
                width: "32px", height: "32px", borderRadius: "16px",
                color: "white", cursor: "pointer", display: "flex",
                alignItems: "center", justifyContent: "center",
                outline: "none", boxSizing: "border-box"
            });
            btn.onclick = (e) => {
                e.stopPropagation();
                if (m.id === "outliner") {
                    const newVal = !this.outliner.visible;
                    this.outliner.setVisible(newVal);
                    this.updateShadingUI();
                } else if (m.id === "xray") {
                    this.shadingMgr.toggleXray();
                    this.updateShadingUI();
                } else {
                    this.shadingMgr.setShadingMode(m.id);
                    this.updateShadingUI();
                    this.triggerUpdate();
                }
            };
            shadingUI.appendChild(btn);
            this.shadingBtns[m.id] = btn;
        });
        this.updateShadingUI();
    }

    updateShadingUI() {
        Object.keys(this.shadingBtns).forEach(m => {
            const btn = this.shadingBtns[m];
            let isActive = (m === this.shadingMgr.currentShadingMode);
            if (m === "xray") isActive = this.shadingMgr.xrayMode;
            if (m === "outliner") isActive = this.outliner.visible;

            btn.classList.toggle("active", isActive);
            if (!isActive) {
                btn.style.backgroundColor = "rgba(0,0,0,0.5)";
                btn.style.border = "1px solid rgba(255,255,255,0.05)";
                btn.style.boxShadow = "none";
            } else {
                btn.style.backgroundColor = "";
                btn.style.border = "";
                btn.style.boxShadow = "";
            }
        });
    }

    // -----------------------------------------------------------------------
    // Main Toolbar (bottom center)
    // -----------------------------------------------------------------------
    _buildMainToolbar() {
        this.mainToolbar = document.createElement("div");
        Object.assign(this.mainToolbar.style, {
            position: "absolute", bottom: "16px", left: "50%",
            transform: "translateX(-50%)", display: "flex", gap: "8px",
            padding: "6px", backgroundColor: "rgba(0,0,0,0.4)",
            borderRadius: "12px", backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.1)", zIndex: "100"
        });
        this.canvasArea.appendChild(this.mainToolbar);

        const toolButtons = [
            { id: "select",    icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>`, title: "Select" },
            { id: "translate", icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l-7 7 7 7M19 12l-7-7M19 12l-7 7"/></svg>`, title: "Move (G)" },
            { id: "rotate",    icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-9-9c2.52 0 4.85.83 6.72 2.25L21 3v5h-5"/></svg>`, title: "Rotate (R)" },
            { id: "scale",     icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 17l10-10M17 17V7M7 7h10"/></svg>`, title: "Scale (S)" },
            { id: "brush",     icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 11V6a2 2 0 00-2-2v0a2 2 0 00-2 2v0"/><path d="M14 10V8a2 2 0 00-2-2v0a2 2 0 00-2 2v0"/><path d="M10 10.5V6a2 2 0 00-2-2v0a2 2 0 00-2 2v0"/><path d="M18 8a2 2 0 114 0v6a8 8 0 01-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 012.83-2.82L7 15"/></svg>`, title: "Brush (B)" },
            { id: "point",     icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>`, title: "Point Selection (P)" },
            { id: "split",     icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 21L3 13.5l8-7.5M13 3l8 7.5L13 18"/><line x1="12" y1="2" x2="12" y2="22"/></svg>`, title: "Separate Mesh (V)" },
            { id: "divider", isDivider: true },
            { id: "undo",      icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 14L4 9l5-5"/><path d="M20 20v-7a4 4 0 00-4-4H4"/></svg>`, title: "Undo (Alt+Z)" },
            { id: "redo",      icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 14l5-5-5-5"/><path d="M4 20v-7a4 4 0 014-4h12"/></svg>`, title: "Redo (Alt+Y)" }
        ];

        toolButtons.forEach(tool => {
            if (tool.isDivider) {
                const div = document.createElement("div");
                div.style.cssText = "width:1px; background-color:rgba(255,255,255,0.1); margin:4px 2px;";
                this.mainToolbar.appendChild(div);
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
            btn.onclick = (e) => {
                e.stopPropagation();
                this._handleToolClick(tool.id);
            };
            this.mainToolbar.appendChild(btn);
            this.toolbarBtns[tool.id] = btn;
        });
        this.updateToolbar();
    }

    _handleToolClick(id) {
        const vp = this.viewport;
        if (id === "undo") { this.history.undo(); this.triggerUpdate(); }
        else if (id === "redo") { this.history.redo(); this.triggerUpdate(); }
        else if (id === "split") { this.toggleSegmentationMode(); }
        else if (id === "brush") {
            vp.brushActive = !vp.brushActive;
            if (vp.brushActive) {
                vp.pointSelection.active = false;
                vp.transform.enabled = false;
                if (this.selMgr.selectionHelper) this.selMgr.selectionHelper.visible = false;
                vp.transform.detach();
                this.brushPanel.show();
            } else {
                this.brushPanel.hide();
            }
        }
        else if (id === "point") {
            vp.pointSelection.active = !vp.pointSelection.active;
            if (vp.pointSelection.active) {
                vp.brushActive = false;
                vp.transform.enabled = false;
                if (this.selMgr.selectionHelper) this.selMgr.selectionHelper.visible = false;
                vp.transform.detach();
                this.brushPanel.hide();
            }
        }
        else {
            vp.brushActive = false;
            vp.pointSelection.active = false;
            this.brushPanel.hide();
            if (id === "select") {
                vp.transform.enabled = false;
                vp.transform.detach();
            } else {
                vp.transform.enabled = true;
                vp.transform.setMode(id);
                if (this.selMgr.selectedObjects.length > 0) {
                    vp.transform.attach(this.selMgr.selectionProxy);
                }
            }
        }
        this.updateToolbar();
        this.triggerUpdate();
    }

    updateToolbar() {
        const vp = this.viewport;
        if (!vp.transform) return;
        const mode = vp.transform.mode;

        Object.keys(this.toolbarBtns).forEach(id => {
            const btn = this.toolbarBtns[id];
            if (id === "undo") {
                const canUndo = this.history.index >= 0;
                btn.style.opacity = canUndo ? "1" : "0.3";
                btn.style.pointerEvents = canUndo ? "auto" : "none";
                return;
            }
            if (id === "redo") {
                const canRedo = this.history.index < this.history.history.length - 1;
                btn.style.opacity = canRedo ? "1" : "0.3";
                btn.style.pointerEvents = canRedo ? "auto" : "none";
                return;
            }

            let isActive = false;
            if (id === "brush") isActive = (vp.brushActive === true);
            else if (id === "point") isActive = (vp.pointSelection.active === true);
            else if (id === "split") isActive = (vp.segmentationMode.active === true);
            else if (vp.modalTransform.active) isActive = (id === vp.modalTransform.mode);
            else if (!vp.transform.enabled) isActive = (id === "select" && !vp.brushActive && !vp.pointSelection.active);
            else isActive = (id === mode && !vp.brushActive && !vp.pointSelection.active);

            btn.classList.toggle("active", isActive);
            if (isActive) { btn.style.backgroundColor = ""; btn.style.border = ""; btn.style.boxShadow = ""; }
            else { btn.style.backgroundColor = "transparent"; btn.style.border = "1px solid rgba(255,255,255,0.05)"; btn.style.boxShadow = "none"; }
        });
    }
}
