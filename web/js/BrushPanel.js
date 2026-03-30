/**
 * BrushPanel.js
 * Floating brush settings panel (Size, Hardness, Value, Color, Channel, Tri-Planar).
 *
 * Extracted verbatim from web/3d_viewport.js lines 1734–1833.
 */

export class BrushPanel {
    /**
     * @param {HTMLElement} canvasArea
     * @param {object} viewport - ComfyUI node instance (holds brush* properties).
     */
    constructor(canvasArea, viewport) {
        this.canvasArea = canvasArea;
        this.viewport = viewport;
        this._build();
    }

    _build() {
        const vp = this.viewport;
        this.panel = document.createElement("div");
        Object.assign(this.panel.style, {
            position: "absolute", bottom: "72px", left: "50%",
            transform: "translateX(-50%)", display: "none", gap: "16px",
            padding: "12px 20px", backgroundColor: "rgba(18, 18, 18, 0.7)",
            backdropFilter: "blur(18px)", borderRadius: "14px",
            border: "1px solid rgba(255,255,255,0.08)", zIndex: "110",
            alignItems: "center", color: "white", fontSize: "11px",
            boxShadow: "0 10px 40px rgba(0,0,0,0.6)"
        });
        this.canvasArea.appendChild(this.panel);

        const createControl = (label, min, max, val, onChange) => {
            const row = document.createElement("div");
            row.style.cssText = "display:flex; flex-direction:column; gap:6px;";
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

        const sizeCtrl = createControl("Size", 1, 100, vp.brushSize, v => { vp.brushSize = v; });
        const hardnessCtrl = createControl("Hardness", 0, 1, vp.brushHardness, v => { vp.brushHardness = v; });
        const valueCtrl = createControl("Value", 0, 1, 1.0, v => { vp.brushValue = v; });

        // Channel Selector
        const channelWrapper = document.createElement("div");
        channelWrapper.style.cssText = "display:flex; flex-direction:column; gap:6px;";
        const chanLbl = document.createElement("div");
        Object.assign(chanLbl.style, { opacity: "0.4", fontSize: "9px", fontWeight: "700", letterSpacing: "0.1em", color: "white", marginBottom: "2px" });
        chanLbl.textContent = "CHANNEL";
        const chanSel = document.createElement("select");
        chanSel.className = "comfy3d-brush-select";
        ["color", "roughness", "metallic"].forEach(c => {
            const opt = document.createElement("option");
            opt.value = opt.textContent = c;
            chanSel.appendChild(opt);
        });
        chanSel.onchange = () => { vp.brushChannel = chanSel.value; };
        channelWrapper.appendChild(chanLbl);
        channelWrapper.appendChild(chanSel);

        // Tri-Planar Toggle
        const triWrapper = document.createElement("div");
        triWrapper.style.cssText = "display:flex; flex-direction:column; gap:6px; align-items:center;";
        const triLbl = document.createElement("div");
        Object.assign(triLbl.style, { opacity: "0.4", fontSize: "9px", fontWeight: "700", letterSpacing: "0.1em", color: "white", marginBottom: "2px" });
        triLbl.textContent = "TRI-PLANAR";
        const triCheck = document.createElement("input");
        triCheck.type = "checkbox";
        triCheck.className = "comfy3d-brush-checkbox";
        triCheck.checked = vp.brushTriPlanar;
        triCheck.onchange = () => { vp.brushTriPlanar = triCheck.checked; };
        triWrapper.appendChild(triLbl);
        triWrapper.appendChild(triCheck);

        // Brush Color Picker
        const colorWrapper = document.createElement("div");
        colorWrapper.style.cssText = "display:flex; flex-direction:column; gap:6px;";
        const colorLbl = document.createElement("div");
        Object.assign(colorLbl.style, { opacity: "0.4", fontSize: "9px", fontWeight: "700", letterSpacing: "0.1em", color: "white", marginBottom: "2px" });
        colorLbl.textContent = "BRUSH COLOR";
        const colorInp = document.createElement("input");
        colorInp.type = "color";
        colorInp.className = "comfy3d-brush-color";
        colorInp.value = vp.brushColor || "#ffffff";
        colorInp.oninput = () => { vp.brushColor = colorInp.value; };
        colorWrapper.appendChild(colorLbl);
        colorWrapper.appendChild(colorInp);

        this.panel.appendChild(sizeCtrl.row);
        this.panel.appendChild(hardnessCtrl.row);
        this.panel.appendChild(valueCtrl.row);
        this.panel.appendChild(colorWrapper);
        this.panel.appendChild(channelWrapper);
        this.panel.appendChild(triWrapper);
    }

    show() { this.panel.style.display = "flex"; }
    hide() { this.panel.style.display = "none"; }
    get element() { return this.panel; }
}
