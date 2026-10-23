export function createMenuController({ docking, getSettings, visibilityLabels }) {
  const fileMenu = document.getElementById("file-menu");
  const editMenu = document.getElementById("edit-menu");
  const selectionMenu = document.getElementById("selection-menu");
  const goMenu = document.getElementById("go-menu");
  const explorerContextMenu = document.getElementById("explorer-context-menu");
  const viewMenu = document.getElementById("view-menu");
  const appearanceMenu = document.getElementById("appearance-menu");
  const viewButton = document.querySelector('[data-menu="view"]');
  const fileButton = document.querySelector('[data-menu="file"]');
  const editButton = document.querySelector('[data-menu="edit"]');
  const selectionButton = document.querySelector('[data-menu="selection"]');
  const goButton = document.querySelector('[data-menu="go"]');
      function positionMenu(menu, anchor, offset = 0) {
        const rect = anchor.getBoundingClientRect();
        menu.style.left = Math.max(5, Math.min(rect.left + offset, innerWidth - menu.offsetWidth - 5)) + "px";
        menu.style.top = Math.min(rect.bottom + 3, innerHeight - menu.offsetHeight - 5) + "px";
      }

      function closeMenus() {
        for (const menu of [fileMenu, editMenu, selectionMenu, goMenu, explorerContextMenu, viewMenu, appearanceMenu, document.getElementById("terminal-menu")]) menu.hidden = true;
        for (const button of [fileButton, editButton, selectionButton, goButton, viewButton, document.querySelector('[data-menu="terminal"]')]) {
          button.setAttribute("aria-expanded", "false");
          button.classList.remove("active");
        }
      }

      function shortcut(command) {
        return getSettings().keybindings?.[command] || "";
      }

      function renderMenu(menu, button, entries) {
        closeMenus();
        menu.replaceChildren();
        for (const entry of entries) {
          if (entry.divider) {
            const divider = document.createElement("div");
            divider.className = "menu-divider";
            menu.append(divider);
            continue;
          }
          const item = document.createElement("button");
          item.className = "menu-item";
          item.dataset.action = entry.action;
          item.textContent = entry.label;
          if (entry.shortcut) {
            const shortcut = document.createElement("span");
            shortcut.className = "menu-shortcut";
            shortcut.textContent = entry.shortcut;
            item.append(shortcut);
          }
          if (entry.disabled) {
            item.disabled = true;
            item.title = entry.reason || "Not available yet";
          }
          menu.append(item);
        }
        menu.hidden = false;
        button.setAttribute("aria-expanded", "true");
        button.classList.add("active");
        positionMenu(menu, button);
      }

      function openFileMenu() {
        renderMenu(fileMenu, fileButton, [
          { label: "New Text File", action: "new-file", shortcut: shortcut("file.new") },
          { label: "New File...", action: "new-file" },
          { label: "New Window", action: "new-window", shortcut: shortcut("workbench.newWindow") },
          { divider: true },
          { label: "Open File...", action: "open-file", shortcut: shortcut("file.open") },
          { label: "Open Folder...", action: "open-folder", shortcut: shortcut("file.openFolder") },
          { label: "Open Workspace...", action: "open-folder", shortcut: shortcut("file.openFolder") },
          { label: "Add Folder to Workspace...", action: "add-folder", disabled: true, reason: "Multi-root workspaces are not implemented." },
          { label: "Open Recent", action: "open-recent", disabled: true, reason: "Recent workspaces are not implemented." },
          { divider: true },
          { label: "Save", action: "save", shortcut: shortcut("file.save") },
          { label: "Save As...", action: "save-as", shortcut: shortcut("file.saveAs") },
          { label: "Save All", action: "save-all", shortcut: shortcut("file.saveAll") },
          { label: "Save Workspace...", action: "save-workspace" },
          { label: `Auto Save${getSettings().files.autoSave ? " (On)" : ""}`, action: "toggle-autosave" },
          { label: "Preferences", action: "preferences" },
          { divider: true },
          { label: "Revert File", action: "revert-file" },
          { label: "Close Editor", action: "close-editor", shortcut: shortcut("editor.close") },
          { label: "Close Folder", action: "close-folder" },
          { label: "Close Window", action: "close-window" },
          { label: "Exit", action: "exit" }
        ]);
      }

      function openEditMenu() {
        renderMenu(editMenu, editButton, [
          { label: "Undo", action: "undo", shortcut: shortcut("editor.undo") },
          { label: "Redo", action: "redo", shortcut: shortcut("editor.redo") },
          { divider: true },
          { label: "Cut", action: "cut", shortcut: shortcut("editor.cut") },
          { label: "Copy", action: "copy", shortcut: shortcut("editor.copy") },
          { label: "Paste", action: "paste", shortcut: shortcut("editor.paste") },
          { label: "Find", action: "find", shortcut: shortcut("editor.find") },
          { label: "Replace", action: "replace", shortcut: shortcut("editor.replace") },
          { label: "Find in Files", action: "find-in-files", disabled: true, reason: "Workspace-wide search is not implemented." },
          { label: "Replace in Files", action: "replace-in-files", disabled: true, reason: "Workspace-wide replacement is not implemented." },
          { divider: true },
          { label: "Toggle Line Comment", action: "toggle-comment", shortcut: shortcut("editor.toggleLineComment") },
          { label: "Trim Trailing Whitespace", action: "format-document" },
          { label: "Emmet: Expand Abbreviation", action: "emmet", disabled: true, reason: "Emmet is not implemented." }
        ]);
      }

      function openSelectionMenu() {
        renderMenu(selectionMenu, selectionButton, [
          { label: "Select All", action: "select-all", shortcut: shortcut("editor.selectAll") },
          { label: "Expand Selection to Line", action: "select-line" },
          { label: "Copy Line Up", action: "copy-line-up" },
          { label: "Move Line Up", action: "move-line-up", shortcut: shortcut("editor.moveLineUp") },
          { label: "Move Line Down", action: "move-line-down", shortcut: shortcut("editor.moveLineDown") },
          { label: "Duplicate Selection", action: "duplicate-selection", shortcut: "Shift+Alt+Down" },
          { label: "Add Cursor Above", action: "add-cursor-above", disabled: true, reason: "Multiple cursors are not supported by the current editor surface." },
          { label: "Add Cursor Below", action: "add-cursor-below", disabled: true, reason: "Multiple cursors are not supported by the current editor surface." }
        ]);
      }

      function openGoMenu() {
        renderMenu(goMenu, goButton, [
          { label: "Go to Line/Column...", action: "go-to-line", shortcut: shortcut("editor.goToLine") },
          { label: "Go to File...", action: "go-to-file", shortcut: shortcut("workbench.quickOpen") },
          { label: "Go to Symbol...", action: "go-to-symbol", shortcut: shortcut("editor.goToSymbol") }
        ]);
      }

      function renderAppearanceMenu() {
        appearanceMenu.innerHTML = '<div class="menu-caption">Appearance</div>';
        for (const [id, label] of visibilityLabels) {
          const host = document.getElementById(id);
          const item = document.createElement("button");
          item.className = "menu-item";
          item.setAttribute("role", "menuitemcheckbox");
          item.setAttribute("aria-checked", String(!host.hidden));
          item.innerHTML = `<span class="check">${host.hidden ? "" : "✓"}</span><span>${label}</span>`;
          item.addEventListener("click", () => {
            host.hidden = !host.hidden;
            host.setAttribute("aria-hidden", String(host.hidden));
            renderAppearanceMenu();
          });
          appearanceMenu.append(item);
        }

        const divider = document.createElement("div");
        divider.className = "menu-divider";
        appearanceMenu.append(divider);

        const split = document.createElement("button");
        split.className = "menu-item";
        split.textContent = "Split Editor";
        split.addEventListener("click", () => {
          docking.splitEditor();
          closeMenus();
        });
        appearanceMenu.append(split);

        const reset = document.createElement("button");
        reset.className = "menu-item";
        reset.textContent = "Reset UI Layout";
        reset.addEventListener("click", () => {
          for (const id of visibilityLabels.keys()) {
            const host = document.getElementById(id);
            host.hidden = false;
            host.removeAttribute("aria-hidden");
          }
          docking.root = docking.defaultLayout();
          docking.save();
          docking.render();
          closeMenus();
        });
        appearanceMenu.append(reset);
      }

      function openViewMenu() {
        closeMenus();
        viewMenu.innerHTML = '<button class="menu-item has-submenu" data-action="show-appearance"><span>Appearance</span><span class="submenu-arrow">›</span></button>';
        viewMenu.hidden = false;
        viewButton.setAttribute("aria-expanded", "true");
        viewButton.classList.add("active");
        positionMenu(viewMenu, viewButton);
      }

      function openAppearanceMenu(anchor) {
        if (!anchor || viewMenu.hidden) {
          openViewMenu();
          anchor = viewMenu.querySelector('[data-action="show-appearance"]');
        }
        renderAppearanceMenu();
        appearanceMenu.hidden = false;
        positionMenu(appearanceMenu, anchor, viewMenu.offsetWidth - 4);
      }
  return {
    fileMenu, editMenu, selectionMenu, goMenu, explorerContextMenu, viewMenu, appearanceMenu,
    viewButton, fileButton, editButton, selectionButton, goButton,
    positionMenu, closeMenus, openFileMenu, openEditMenu, openSelectionMenu, openGoMenu,
    renderAppearanceMenu, openViewMenu, openAppearanceMenu
  };
}
