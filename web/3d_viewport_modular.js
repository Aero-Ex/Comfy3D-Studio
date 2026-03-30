/**
 * 3d_viewport_modular.js
 * Thin ES6 entry-point shim — imports all modules and boots the ComfyUI node.
 *
 * Usage: rename/replace the existing web/3d_viewport.js import in the extension's
 * __init__.py WEB_DIRECTORY to point at this file.
 * Or: add this file as an additional web resource, whichever is preferred.
 */

import { app } from "../../../scripts/app.js";
import { loadThreeJS } from "./js/ThreeLoader.js";
import { registerViewportNode } from "./js/ViewportNode.js";

(async () => {
    // Inject styles once (preserved verbatim from original 3d_viewport.js)
    if (!document.getElementById("comfy3d-studio-styles")) {
        const style = document.createElement("style");
        style.id = "comfy3d-studio-styles";
        style.textContent = `
            .comfy3d-brush-slider {
                -webkit-appearance: none; width: 100px; height: 4px;
                background: rgba(255, 255, 255, 0.1); border-radius: 2px;
                outline: none; transition: all 0.2s;
            }
            .comfy3d-brush-slider::-webkit-slider-thumb {
                -webkit-appearance: none; width: 14px; height: 14px;
                background: #ff9500; border-radius: 50%; cursor: pointer;
                border: 2px solid white; box-shadow: 0 0 10px rgba(255, 149, 0, 0.5);
                transition: transform 0.2s;
            }
            .comfy3d-brush-slider::-moz-range-thumb {
                width: 12px; height: 12px; background: #ff9500;
                border-radius: 50%; cursor: pointer; border: 2px solid white;
                box-shadow: 0 0 10px rgba(255, 149, 0, 0.5); transition: transform 0.2s;
            }
            .comfy3d-brush-slider::-webkit-slider-thumb:hover,
            .comfy3d-brush-slider::-moz-range-thumb:hover {
                transform: scale(1.15); box-shadow: 0 0 15px rgba(255, 149, 0, 0.8);
            }
            .comfy3d-brush-select {
                appearance: none; background: rgba(0,0,0,0.4); color: white;
                border: 1px solid rgba(255,255,255,0.1); border-radius: 6px;
                padding: 4px 10px; font-size: 10px; outline: none; cursor: pointer;
                transition: border-color 0.2s;
            }
            .comfy3d-brush-select:hover { border-color: rgba(255, 149, 0, 0.5); }
            .comfy3d-brush-color {
                padding: 0; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px;
                width: 34px; height: 22px; cursor: pointer; background: none;
            }
            .comfy3d-brush-color::-webkit-color-swatch-wrapper { padding: 2px; }
            .comfy3d-brush-color::-webkit-color-swatch { border-radius: 4px; border: none; }
            .comfy3d-brush-checkbox {
                appearance: none; width: 16px; height: 16px;
                background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
                border-radius: 4px; cursor: pointer; position: relative; transition: all 0.2s;
            }
            .comfy3d-brush-checkbox:checked { background: #ff9500; border-color: #ff9500; }
            .comfy3d-brush-checkbox:checked::after {
                content: '✓'; position: absolute; top: 50%; left: 50%;
                transform: translate(-50%, -50%); color: white; font-size: 10px;
            }
            .comfy3d-selection-mode-panel {
                position: absolute; top: 14px; left: 14px;
                display: flex; gap: 4px; z-index: 100; padding: 6px;
                background: rgba(0,0,0,0.4); border-radius: 12px;
                backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.1);
                box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            }
            .comfy3d-selection-btn {
                width: 34px; height: 34px; display: flex; align-items: center;
                justify-content: center; background: transparent;
                border: 1px solid rgba(255,255,255,0.05); border-radius: 8px;
                color: rgba(255,255,255,0.7); cursor: pointer;
                transition: all 0.3s cubic-bezier(0.23, 1, 0.32, 1); outline: none;
            }
            .comfy3d-selection-btn:hover {
                background: rgba(255,255,255,0.08); color: white; transform: translateY(-1px);
            }
            .comfy3d-selection-btn.active,
            .comfy3d-toolbar-btn.active {
                background: rgba(255, 68, 0, 0.45) !important;
                border: 1px solid rgba(255, 68, 0, 0.7) !important;
                box-shadow: 0 0 14px rgba(255, 68, 0, 0.35) !important;
                color: white !important;
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
            .comfy3d-toolbar-btn:active { transform: translateY(0) scale(0.92) !important; }
            .comfy3d-hud {
                position: absolute; bottom: 80px; left: 20px;
                background: rgba(0,0,0,0.7); color: #ff9500;
                padding: 8px 16px; border-radius: 8px;
                font-family: 'Inter', sans-serif; font-size: 14px;
                pointer-events: none; display: none; z-index: 200;
                border-left: 4px solid #ff9500; box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            }
        `;
        document.head.appendChild(style);
    }

    // Load Three.js first so it's available to the extension registration
    const THREE = await loadThreeJS();

    // Register the ComfyUI extension (wires all 12 modules together)
    await registerViewportNode(app, THREE);
})();
