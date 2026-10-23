(async () => {
  try {
    const fragments = [
      ["topbar.html", "topbar-host"],
      ["toolbar.html", "toolbar-host"],
      ["activitybar.html", "activitybar-host"],
      ["solution.html", "solution-host"],
      ["editor.html", "editor-host"],
      ["bottom-panel.html", "bottom-panel-host"],
      ["statusbar.html", "statusbar-host"]
    ];
    for (const [file, id] of fragments) {
      document.getElementById(id).innerHTML = await window.miaSquid.loadFragment(file);
    }

    const [{ DockingEngine }, intelligence, { createTerminalController }, { createDialogController }, { createNotificationsController }, { createSourceControlController }, { createSettingsController }, { createKeybindingController }, { createMenuController }, { createWorkspaceController }, { createActionDispatcher }, { createEditorController }] = await Promise.all([
      import("../../main/docking/docking.js"),
      import("../editor/intelligence.js"),
      import("../terminal/terminal-controller.js"),
      import("./dialogs.js"),
      import("../notifications/notification-center.js"),
      import("../git/source-control.js"),
      import("../settings/settings-controller.js"),
      import("../settings/keybinding-controller.js"),
      import("./menus.js"),
      import("../workspace/workspace-controller.js"),
      import("./actions.js"),
      import("../editor/editor-controller.js")
    ]);
    const { analyzeDocument, getCompletions, languageForExtension } = intelligence;
    const docking = new DockingEngine();
    docking.initialize();
    let ideSettings = await window.miaSquid.readIdeSettings();
    document.body.dataset.theme = ideSettings.theme;

    const workspaceLabel = document.getElementById("workspace-name");
    const fileTree = document.getElementById("file-tree");
    const visibilityLabels = new Map([
      ["activitybar-host", "Activity Bar"],
      ["solution-host", "Explorer"],
      ["toolbar-host", "Workspace Toolbar"],
      ["editor-host", "Editor"],
      ["bottom-panel-host", "Panel"],
      ["statusbar-host", "Status Bar"]
    ]);
    let roots = [];
    let workspaceRoot = null;
    let selectedNode = null;
    let nextScratchId = 1;
    let sidebarView = "explorer";
    let editorController;
    const dialogs = createDialogController({ onEditorFocus: editor => editorController?.setLastFocused(editor) });
    const { show: showDialog, overlay: dialogOverlay } = dialogs;
    const notifications = createNotificationsController();
    const { notify, render: renderNotifications, panel: notificationPanel } = notifications;
    const menus = createMenuController({ docking, getSettings: () => ideSettings, visibilityLabels });
    const {
      fileMenu, editMenu, selectionMenu, goMenu, explorerContextMenu, viewMenu, appearanceMenu,
      viewButton, fileButton, editButton, selectionButton, goButton,
      positionMenu, closeMenus, openFileMenu, openEditMenu, openSelectionMenu, openGoMenu,
      renderAppearanceMenu, openViewMenu, openAppearanceMenu
    } = menus;
    const terminal = createTerminalController({
      docking,
      getWorkspacePath: () => workspaceRoot?.path,
      getSettings: () => ideSettings,
      closeMenus,
      positionMenu
    });
    const { terminalMenu, terminalButton } = terminal;

    const workspaceState = {};
    for (const key of ["roots", "workspaceRoot", "selectedNode", "nextScratchId"]) {
      Object.defineProperty(workspaceState, key, {
        get: () => ({ roots, workspaceRoot, selectedNode, nextScratchId })[key],
        set: value => {
          if (key === "roots") roots = value;
          else if (key === "workspaceRoot") workspaceRoot = value;
          else if (key === "selectedNode") selectedNode = value;
          else nextScratchId = value;
        }
      });
    }
    const workspace = createWorkspaceController({
      state: workspaceState,
      workspaceLabel,
      fileTree,
      docking,
      showDialog,
      notify,
      getTerminal: () => terminal,
      getSourceControl: () => sourceControl,
      clearDocumentState: () => editorController.clearWorkspaceDocumentState(),
      refreshOutline: doc => editorController.updateOutline(doc)
    });
    editorController = createEditorController({
      docking,
      analyzeDocument,
      getCompletions,
      languageForExtension,
      getWorkspacePath: () => workspaceRoot?.path,
      getSettings: () => ideSettings,
      notify,
      showDialog
    });
    editorController.bindEvents({ findNode: id => workspace.findNode(id), notify, showDialog, getSettings: () => ideSettings });

    const sourceControl = createSourceControlController({
      getWorkspaceRoot: () => workspaceRoot,
      getSidebarView: () => sidebarView,
      fileTree,
      showDialog,
      notify
    });
    const settings = createSettingsController({
      getSettings: () => ideSettings,
      setSettings: next => { ideSettings = next; },
      updateStatus: editorController.updateStatus,
      notify
    });

    const actionDispatcher = createActionDispatcher({
      workspace,
      sourceControl,
      terminal,
      docking,
      showDialog,
      notify,
      getSettings: () => ideSettings,
      workspaceState,
      clearDocumentState: () => editorController.clearWorkspaceDocumentState(),
      updateOutline: editorController.updateOutline,
      analyzeDocument,
      symbolsByDocument: editorController.symbolsByDocument,
      activeEditor: editorController.activeEditor,
      findInEditor: editorController.findInEditor,
      toggleLineComment: editorController.toggleLineComment,
      replaceEditorSelection: editorController.replaceEditorSelection,
      moveEditorLine: editorController.moveEditorLine,
      settings,
      renderAppearanceMenu,
      openAppearanceMenu,
      viewMenu
    });
    const runAction = action => actionDispatcher.runAction(action);
    const keybindings = createKeybindingController({
      getSettings: () => ideSettings,
      runAction,
      terminal,
      editorController,
      notify
    });

    document.addEventListener("click", async event => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const menuButton = target.closest("[data-menu]");
      if (menuButton === fileButton) {
        event.stopPropagation();
        fileMenu.hidden ? openFileMenu() : closeMenus();
        return;
      }
      if (menuButton === editButton) {
        event.stopPropagation();
        editMenu.hidden ? openEditMenu() : closeMenus();
        return;
      }
      if (menuButton === selectionButton) {
        event.stopPropagation();
        selectionMenu.hidden ? openSelectionMenu() : closeMenus();
        return;
      }
      if (menuButton === goButton) {
        event.stopPropagation();
        goMenu.hidden ? openGoMenu() : closeMenus();
        return;
      }
      if (menuButton === viewButton) {
        event.stopPropagation();
        viewMenu.hidden ? openViewMenu() : closeMenus();
        return;
      }
      if (menuButton === terminalButton) {
        event.stopPropagation();
        terminalMenu.hidden ? terminal.openMenu() : closeMenus();
        return;
      }
      const terminalAction = target.closest("[data-terminal-action]")?.dataset.terminalAction;
      if (terminalAction) {
        event.stopPropagation();
        try {
          await runAction(terminalAction);
        } catch (error) {
          console.error("The terminal action failed", error);
          notify("Terminal action failed", error.message, "error");
        }
        closeMenus();
        return;
      }
      const sidebarButton = target.closest("[data-sidebar]");
      if (sidebarButton) {
        const view = sidebarButton.dataset.sidebar;
        if (["explorer", "git"].includes(view)) {
          sidebarView = view;
          sourceControl.renderGitPanel();
          if (view === "git") await sourceControl.refreshGitStatus();
        } else if (view === "settings") {
          await settings.open();
        } else {
          notify("Not available", `${sidebarButton.title} is not implemented yet.`, "warning");
        }
        return;
      }
      if (target.closest("#status-notifications")) {
        notificationPanel.hidden = !notificationPanel.hidden;
        renderNotifications();
        return;
      }
      const action = target.closest("[data-action]")?.dataset.action;
      if (action) {
        event.stopPropagation();
        try {
          await runAction(action);
        } catch (error) {
          console.error("The requested IDE action failed", error);
          notify("Action failed", error.message, "error");
        }
        if (action !== "show-appearance") closeMenus();
        return;
      }
      const row = target.closest(".tree-row");
      if (row) {
        const node = workspace.findNode(row.dataset.nodeId);
        if (node) {
          try {
            await workspace.openNode(node);
          } catch (error) {
            console.error("Unable to open the selected item", error);
            notify(`Unable to open ${node.name}`, error.message, "error");
          }
        }
        return;
      }
      const bottomTab = target.closest("[data-bottom-tab]");
      if (bottomTab) {
        document.querySelectorAll("[data-bottom-tab]").forEach(item =>
          item.classList.toggle("active", item === bottomTab));
        if (bottomTab.dataset.bottomTab === "problems") editorController.renderProblems(docking.getActiveDocument());
        else {
          const output = document.getElementById("terminal-content");
          output.replaceChildren();
          const empty = document.createElement("p");
          empty.className = "terminal-muted";
          empty.textContent = "No output yet.";
          output.append(empty);
        }
        return;
      }
      if (!fileMenu.contains(target) && !editMenu.contains(target) && !selectionMenu.contains(target) &&
          !goMenu.contains(target) && !explorerContextMenu.contains(target) && !viewMenu.contains(target) &&
          !appearanceMenu.contains(target) && !terminalMenu.contains(target)) {
        closeMenus();
      }
    });

    document.addEventListener("contextmenu", event => {
      const row = event.target instanceof Element ? event.target.closest(".tree-row") : null;
      if (!row) return;
      event.preventDefault();
      const node = workspace.findNode(row.dataset.nodeId);
      if (!node) return;
      selectedNode = node;
      workspace.renderTree();
      explorerContextMenu.replaceChildren();
      const options = node.type === "folder"
        ? [["New File", "new-file"], ["New Folder", "new-folder"], ["Collapse Folder", "collapse-selected"]]
        : [["Open", "open-selected"], ["New File", "new-file"], ["New Folder", "new-folder"]];
      for (const [label, action] of options) {
        const button = document.createElement("button");
        button.className = "menu-item";
        button.dataset.action = action;
        button.textContent = label;
        explorerContextMenu.append(button);
      }
      explorerContextMenu.hidden = false;
      explorerContextMenu.style.left = `${Math.min(event.clientX, innerWidth - 260)}px`;
      explorerContextMenu.style.top = `${Math.min(event.clientY, innerHeight - explorerContextMenu.offsetHeight - 5)}px`;
    });

    document.addEventListener("keydown", async event => {
      const editor = event.target instanceof HTMLTextAreaElement && event.target.classList.contains("editor-textarea")
        ? event.target
        : null;
      if (!dialogOverlay.hidden || !document.getElementById("settings-overlay").hidden) return;
      if (editorController.handleCompletionKey(event, editor)) return;
      if (keybindings.handle(event, editor)) return;
      if (editor && event.key === "Tab") {
        event.preventDefault();
        const indentation = ideSettings.editor.insertSpaces
          ? " ".repeat(ideSettings.editor.tabSize)
          : "\t";
        editor.setRangeText(indentation, editor.selectionStart, editor.selectionEnd, "end");
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      if (editor && event.key === "Enter") {
        const lineStart = editor.value.lastIndexOf("\n", Math.max(0, editor.selectionStart - 1)) + 1;
        const indent = editor.value.slice(lineStart, editor.selectionStart).match(/^\s*/)?.[0] || "";
        if (indent) {
          event.preventDefault();
          editor.setRangeText(`\n${indent}`, editor.selectionStart, editor.selectionEnd, "end");
          editor.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      if (event.key === "Escape") {
        closeMenus();
      }
    });

    document.addEventListener("click", event => {
      const folder = event.target.closest("[data-folder]");
      if (folder) {
        const children = folder.nextElementSibling;
        if (children?.classList.contains("tree-children")) children.classList.toggle("collapsed");
      }
    });

    document.getElementById("topbar-host").dataset.layoutLocked = "true";
    workspace.renderTree();
    sourceControl.renderGitPanel();
    renderNotifications();
    editorController.updateOutline(docking.getActiveDocument());
    editorController.updateStatus();
    const settingsRecoveryWarning = await window.miaSquid.consumeSettingsRecoveryWarning();
    if (settingsRecoveryWarning) notify("Settings recovered", settingsRecoveryWarning, "warning");
    const lastProject = await window.miaSquid.restoreLastProject();
    if (lastProject) await workspace.activateWorkspace(lastProject, false);
    docking.removePanel("terminal");
  } catch (error) {
    console.error("Unable to initialize MiaSquid IDE", error);
    const panel = document.getElementById("notification-panel");
    if (panel) {
      panel.hidden = false;
      panel.setAttribute("role", "alert");
      panel.textContent = `Unable to initialize MiaSquid IDE: ${error.message}`;
    }
  }
})();
