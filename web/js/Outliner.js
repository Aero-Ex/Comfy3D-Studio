/**
 * Outliner.js
 * Scene outliner panel: tree view of all assets, search, expand/collapse,
 * rename-in-place, visibility toggle, delete, drag-to-reposition header.
 */

export class Outliner {

    constructor(THREE, deps) {
        this.THREE = THREE;
        Object.assign(this, deps);
        this.canvasArea = deps.container;
        this.selMgr = deps.selectionManager;
        this.visible = true;
        this.expandedObjects = new Set();
        this.visibleUUIDs = [];
        this.renamingId = null;
        // Pull command classes from shared deps
        this.RenameCommand = deps.commandClasses?.RenameCommand;
        this.AssetCommand = deps.commandClasses?.AssetCommand;
        this._buildDOM();
    }

    _buildDOM() {
        const canvasArea = this.canvasArea;

        this.panel = document.createElement("div");
        Object.assign(this.panel.style, {
            position: "absolute", top: "86px", right: "12px",
            width: "250px", maxHeight: "calc(100% - 130px)",
            backgroundColor: "rgba(18, 18, 18, 0.7)", backdropFilter: "blur(18px)",
            borderRadius: "14px", border: "1px solid rgba(255,255,255,0.08)",
            display: "flex", flexDirection: "column", zIndex: "110",
            overflow: "hidden", color: "rgba(255,255,255,0.9)",
            fontFamily: "system-ui, -apple-system, sans-serif", fontSize: "12px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)"
        });
        canvasArea.appendChild(this.panel);

        // --- Draggable Header ---
        this.header = document.createElement("div");
        Object.assign(this.header.style, {
            padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            fontWeight: "700", letterSpacing: "1px", background: "rgba(255,255,255,0.03)",
            cursor: "grab", fontSize: "10px", color: "rgba(255,255,255,0.5)"
        });
        this.header.innerHTML = '<span>SCENE COLLECTION</span>';
        this._bindDragHeader();

        // --- Search ---
        const searchWrapper = document.createElement("div");
        Object.assign(searchWrapper.style, {
            margin: "8px 12px", position: "relative",
            display: "flex", alignItems: "center"
        });
        this.searchInput = document.createElement("input");
        this.searchInput.placeholder = "Search objects...";
        Object.assign(this.searchInput.style, {
            width: "100%", padding: "6px 10px 6px 28px",
            backgroundColor: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.05)",
            borderRadius: "8px", color: "white", fontSize: "11px", outline: "none",
            transition: "border-color 0.2s, box-shadow 0.2s"
        });
        this.searchInput.onfocus = () => {
            this.searchInput.style.borderColor = "rgba(255,149,0,0.4)";
            this.searchInput.style.boxShadow = "0 0 0 2px rgba(255,149,0,0.1)";
        };
        this.searchInput.onblur = () => {
            this.searchInput.style.borderColor = "rgba(255,255,255,0.05)";
            this.searchInput.style.boxShadow = "none";
        };
        const searchIcon = document.createElement("div");
        searchIcon.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" style="opacity:0.4"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
        Object.assign(searchIcon.style, {
            position: "absolute", left: "8px", pointerEvents: "none", display: "flex"
        });
        searchWrapper.appendChild(searchIcon);
        searchWrapper.appendChild(this.searchInput);
        this.searchInput.oninput = () => this.update();

        // --- Content Scroll Area ---
        this.content = document.createElement("div");
        Object.assign(this.content.style, {
            flex: "1", overflowY: "auto", overflowX: "hidden", padding: "4px 0"
        });

        this.panel.appendChild(this.header);
        this.panel.appendChild(searchWrapper);
        this.panel.appendChild(this.content);
    }

    _bindDragHeader() {
        let isDragging = false;
        let initialDragPos = { x: 0, y: 0 };
        let initialPanelPos = { left: 0, top: 0 };
        const canvasArea = this.canvasArea;
        const panel = this.panel;
        const header = this.header;

        header.addEventListener("pointerdown", e => {
            isDragging = true;
            header.style.cursor = "grabbing";
            initialDragPos.x = e.clientX;
            initialDragPos.y = e.clientY;
            initialPanelPos.left = panel.offsetLeft;
            initialPanelPos.top = panel.offsetTop;
            header.setPointerCapture(e.pointerId);
            e.stopPropagation();
        });

        header.addEventListener("pointermove", e => {
            if (!isDragging) return;
            const containerRect = canvasArea.getBoundingClientRect();
            const scale = containerRect.width / canvasArea.clientWidth;
            let x = initialPanelPos.left + (e.clientX - initialDragPos.x) / scale;
            let y = initialPanelPos.top + (e.clientY - initialDragPos.y) / scale;
            x = Math.max(0, Math.min(x, canvasArea.clientWidth - panel.offsetWidth));
            y = Math.max(0, Math.min(y, canvasArea.clientHeight - panel.offsetHeight));
            panel.style.left = x + "px";
            panel.style.top = y + "px";
            panel.style.right = "auto";
        });

        header.addEventListener("pointerup", e => {
            isDragging = false;
            header.style.cursor = "grab";
            header.releasePointerCapture(e.pointerId);
        });
    }

    // -----------------------------------------------------------------------
    // update() — full re-render of outliner
    // -----------------------------------------------------------------------
    update() {
        const filter = this.searchInput.value.toLowerCase();
        this.content.innerHTML = "";
        this.visibleUUIDs = [];

        const renderObject = (obj, depth = 0) => {
            this.visibleUUIDs.push(obj.uuid);
            const name = obj.name || (obj.isMesh ? "Mesh" : "Object");
            const hasChildren = obj.children && obj.children.length > 0;
            const isExpanded = this.expandedObjects.has(obj.uuid);

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
                backgroundColor: "transparent", borderLeft: "2px solid transparent",
                fontSize: "11px", color: "rgba(255,255,255,0.7)", gap: "2px"
            });
            row.onmouseenter = () => { if (!this.selMgr.selectedObjects.includes(obj)) row.style.backgroundColor = "rgba(255,255,255,0.03)"; };
            row.onmouseleave = () => { if (!this.selMgr.selectedObjects.includes(obj)) row.style.backgroundColor = "transparent"; };

            row.onclick = (e) => {
                e.stopPropagation();
                if (e.shiftKey && this.selMgr.lastSelectedObject && this.selMgr.lastSelectedObject !== obj) {
                    const startIdx = this.visibleUUIDs.indexOf(this.selMgr.lastSelectedObject.uuid);
                    const endIdx = this.visibleUUIDs.indexOf(obj.uuid);
                    if (startIdx !== -1 && endIdx !== -1) {
                        const min = Math.min(startIdx, endIdx), max = Math.max(startIdx, endIdx);
                        for (let i = min; i <= max; i++) {
                            const u = this.visibleUUIDs[i];
                            const o = this.assets.find(a => a.uuid === u) || this.scene.getObjectByProperty("uuid", u);
                            if (o && !this.selMgr.selectedObjects.includes(o)) this.selMgr.selectedObjects.push(o);
                        }
                        this.selMgr.selectObject(null, null, 2);
                        return;
                    }
                }
                this.selMgr.selectObject(obj, null, e.shiftKey ? 1 : 0);
            };

            // Expand chevron
            const chevron = document.createElement("div");
            chevron.style.cssText = `width:18px; display:flex; align-items:center; justify-content:center; margin-right:2px; opacity:${hasChildren ? "0.4" : "0"}; cursor:${hasChildren ? "pointer" : "default"};`;
            chevron.innerHTML = `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3" style="transform: ${isExpanded ? "rotate(90deg)" : "rotate(0deg)"}; transition: transform 0.2s;"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
            chevron.onclick = (e) => {
                if (!hasChildren) return;
                e.stopPropagation();
                if (isExpanded) this.expandedObjects.delete(obj.uuid);
                else this.expandedObjects.add(obj.uuid);
                this.update();
            };

            // Icon
            const icon = document.createElement("div");
            const iconSvg = obj.isMesh
                ? `<path d="M12 2l9 4.9V17L12 22l-9-4.9V7L12 2z" opacity="0.3"/><path d="M12 22V12m0 0l9-4.9M12 12L3 7.1" />`
                : `<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" opacity="0.3"/><path d="M9 3l2 3h9a2 2 0 012 2v11a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5"></path>`;
            icon.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${iconSvg}</svg>`;
            Object.assign(icon.style, { marginRight: "8px", display: "flex", alignItems: "center", color: obj.isMesh ? "#ff9500" : "rgba(255,255,255,0.5)" });

            // Label / Rename input
            const isRenaming = this.renamingId === obj.uuid;
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
                    if (this.renamingId !== obj.uuid) return;
                    const newName = label.value.trim();
                    if (newName && newName !== name) {
                        this.history.push(new this.RenameCommand(obj, obj.name, newName));
                        obj.name = newName;
                    }
                    this.renamingId = null;
                    this.update();
                };
                label.onblur = commit;
                label.onclick = e => e.stopPropagation();
                label.onmousedown = e => e.stopPropagation();
                label.onkeydown = e => {
                    if (e.key === "Enter") commit();
                    if (e.key === "Escape") { this.renamingId = null; this.update(); }
                    e.stopPropagation();
                };
            } else {
                label = document.createElement("span");
                label.textContent = name;
                label.style.cssText = "flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;";
                if (filter && name.toLowerCase().includes(filter)) label.style.color = "#ff9500";
                label.ondblclick = (e) => {
                    e.stopPropagation();
                    this.renamingId = obj.uuid;
                    this.update();
                };
            }

            // Actions (eye + delete)
            const actions = document.createElement("div");
            actions.style.cssText = "display:flex; gap:6px;";
            const isArchived = !obj.parent && this.assets.includes(obj);
            const isVisible = obj.visible && !isArchived;

            const eyeBtn = document.createElement("div");
            eyeBtn.innerHTML = isVisible
                ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`
                : `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
            eyeBtn.style.cssText = `opacity:${isVisible ? "0.6" : (isArchived ? "0.15" : "0.25")}; cursor:pointer; display:flex; align-items:center; transition: opacity 0.2s;`;
            eyeBtn.title = isArchived ? "Archived (Click to Restore)" : "Toggle Visibility";
            eyeBtn.onclick = (e) => {
                e.stopPropagation();
                if (isArchived) { this.scene.add(obj); obj.visible = true; }
                else { obj.visible = !obj.visible; }
                this.triggerUpdate();
                this.update();
            };

            const delBtn = document.createElement("div");
            delBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>`;
            delBtn.style.cssText = "opacity:0.25; cursor:pointer; display:flex; align-items:center; transition: all 0.2s;";
            delBtn.onmouseenter = () => { delBtn.style.color = "#ff4444"; delBtn.style.opacity = "1"; };
            delBtn.onmouseleave = () => { delBtn.style.color = "inherit"; delBtn.style.opacity = "0.4"; };
            delBtn.onclick = (e) => {
                e.stopPropagation();
                const cmd = new this.AssetCommand(obj, false, this.assets, this.scene);
                this.history.push(cmd);
                cmd.remove();
                this.selMgr.deselectObject();
                this.update();
            };

            actions.appendChild(eyeBtn);
            actions.appendChild(delBtn);
            row.appendChild(chevron);
            row.appendChild(icon);
            row.appendChild(label);
            row.appendChild(actions);
            this.content.appendChild(row);

            if (isExpanded || filter) {
                obj.children.forEach(child => {
                    if (child.name || child.isMesh || child.type === "Group") {
                        renderObject(child, depth + 1);
                    }
                });
            }
        };

        this.assets.forEach(asset => {
            let isDescendantOfAnotherAsset = false;
            let p = asset.parent;
            while (p) {
                if (this.assets.includes(p)) { isDescendantOfAnotherAsset = true; break; }
                p = p.parent;
            }
            if (!isDescendantOfAnotherAsset) renderObject(asset, 0);
        });
        this.updateSelection();
        if (this._updateToolbar) this._updateToolbar();
    }

    // -----------------------------------------------------------------------
    // updateSelection — restyle rows after selection changes
    // -----------------------------------------------------------------------
    updateSelection() {
        const rows = this.content.querySelectorAll(".outliner-row");
        rows.forEach(row => {
            const uuid = row.dataset.uuid;
            const obj = this.assets.find(o => o.uuid === uuid) || this.scene.getObjectByProperty("uuid", uuid);
            const isSelected = this.selMgr.selectedObjects.includes(obj);
            Object.assign(row.style, {
                backgroundColor: isSelected ? "rgba(255, 149, 0, 0.08)" : "transparent",
                backgroundImage: isSelected ? "linear-gradient(90deg, rgba(255, 149, 0, 0.15) 0%, transparent 100%)" : "none",
                borderLeft: isSelected ? "2px solid #ff9500" : "2px solid transparent",
                color: isSelected ? "#fff" : "rgba(255,255,255,0.7)"
            });
        });
    }

    /** Show or hide the panel. */
    setVisible(v) {
        this.visible = v;
        this.panel.style.display = v ? "flex" : "none";
    }

    /** Allow Toolbar to call updateToolbar after outliner renders. */
    setUpdateToolbarCallback(fn) {
        this._updateToolbar = fn;
    }
}
