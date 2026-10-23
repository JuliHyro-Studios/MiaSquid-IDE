export function createWorkspaceController({ state, workspaceLabel, fileTree, docking, showDialog, notify, getTerminal, getSourceControl, clearDocumentState, refreshOutline }) {
  function makeNode(entry, parent = null, relativePath = "") {
    const node = {
      id: entry.path || `scratch-${state.nextScratchId++}`,
      name: entry.name,
      type: entry.type,
      path: entry.path || null,
      relativePath,
      scratch: false,
      content: entry.content,
      expanded: true,
      parent,
      children: []
    };
    if (entry.type === "folder") {
      node.children = (entry.children || []).map(child =>
        makeNode(child, node, relativePath ? `${relativePath}/${child.name}` : child.name));
    }
    return node;
  }

  function updateWorkspaceLabel() {
    workspaceLabel.textContent = state.workspaceRoot?.name || (state.roots.length ? "OPEN FILES" : "NO FOLDER OR FILE HERE");
    workspaceLabel.title = state.workspaceRoot?.path || "";
  }

  function renderNode(node, container) {
    const row = document.createElement("button");
    row.className = `tree-row ${node.type === "folder" ? "folder-row" : "file-row"}`;
    if (node === state.selectedNode) row.classList.add("selected");
    if (node.type === "file" && node.scratch) row.classList.add("pending-file");
    row.dataset.nodeId = node.id;
    row.textContent = node.type === "folder"
      ? `${node.expanded ? "⌄" : "›"} 📁 ${node.name}${node.scratch ? " *" : ""}`
      : `　${node.scratch ? "📄" : "▫"} ${node.name}${node.scratch ? " *" : ""}`;
    container.append(row);
    if (node.type === "folder" && node.children.length) {
      const children = document.createElement("div");
      children.className = "tree-children";
      if (!node.expanded) children.classList.add("collapsed");
      for (const child of node.children) renderNode(child, children);
      container.append(children);
    }
  }

  function renderTree() {
    updateWorkspaceLabel();
    fileTree.replaceChildren();
    if (!state.roots.length) {
      const empty = document.createElement("div");
      empty.className = "tree-empty";
      const title = document.createElement("strong");
      title.textContent = "No Folder or File Here";
      empty.append(title, document.createTextNode("Open a folder or file, or create something new."));
      const actions = document.createElement("div");
      actions.className = "empty-actions";
      for (const [label, action] of [
        ["Create New Folder", "new-folder"],
        ["Create New File", "new-file"],
        ["Open Folder/File", "open-project-item"]
      ]) {
        const button = document.createElement("button");
        button.textContent = label;
        button.dataset.action = action;
        actions.append(button);
      }
      empty.append(actions);
      fileTree.append(empty);
      return;
    }
    for (const node of state.roots) renderNode(node, fileTree);
  }

  function findNode(id, nodes = state.roots) {
    for (const node of nodes) {
      if (node.id === id) return node;
      const found = findNode(id, node.children);
      if (found) return found;
    }
    return null;
  }

  function flattenNodes(nodes = state.roots, result = []) {
    for (const node of nodes) {
      result.push(node);
      flattenNodes(node.children, result);
    }
    return result;
  }

  function scratchEntries(nodes = state.roots, entries = []) {
    for (const node of nodes) {
      if (node.scratch) {
        entries.push({
          relativePath: node.relativePath,
          type: node.type,
          ...(node.type === "file" ? {
            content: docking.getDocument(node.id)?.content ?? node.content ?? ""
          } : {})
        });
      }
      scratchEntries(node.children, entries);
    }
    return entries;
  }

  function updateSavedPaths(nodes, savedPaths) {
    for (const node of nodes) {
      if (node.scratch) {
        const saved = savedPaths.get(node.relativePath);
        if (saved) {
          node.path = saved.path;
          node.scratch = false;
          if (node.type === "file") docking.setDocumentPath(node.id, saved.path);
        }
      }
      updateSavedPaths(node.children, savedPaths);
    }
  }

  async function saveWorkspace() {
    const entries = scratchEntries();
    if (!entries.length) {
      notify("Save workspace", "There are no new files or folders to save.");
      return;
    }
    let created;
    if (state.workspaceRoot?.path) {
      created = await window.miaSquid.createProjectItems(state.workspaceRoot.path, entries);
    } else {
      const result = await window.miaSquid.saveWorkspace(entries, null);
      if (!result) return;
      created = result.paths;
      state.workspaceRoot = { name: result.root.split(/[\\/]/).filter(Boolean).pop() || result.root, path: result.root };
    }
    const savedPaths = new Map(created.map(item => [item.relativePath, item]));
    updateSavedPaths(state.roots, savedPaths);
    renderTree();
    for (const doc of docking.documents.values()) refreshOutline(doc);
    getSourceControl().refreshGitStatus();
  }

  function hasUnsavedChanges() {
    return scratchEntries().length > 0 || docking.hasUnsavedDocuments();
  }

  async function makeNewNode(type) {
    const proposedName = await showDialog({
      title: type === "folder" ? "Create New Folder" : "Create New File",
      message: "The item stays in memory until the workspace is saved.",
      label: "Name",
      value: type === "file" ? "untitled.txt" : "New Folder"
    });
    if (proposedName === null) return;
    const name = proposedName.trim();
    if (!name || name === "." || name === ".." || /[\\/<>:"|?*\u0000-\u001f]/.test(name)) {
      notify("Invalid name", "Enter a valid name without path separators or reserved characters.", "warning");
      return;
    }

    const parent = state.selectedNode?.type === "folder" ? state.selectedNode : state.selectedNode?.parent || null;
    const siblings = parent ? parent.children : state.roots;
    if (siblings.some(node => node.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      notify("Name already exists", `An item named "${name}" already exists here.`, "warning");
      return;
    }
    const parentRelative = parent?.relativePath || "";
    const node = {
      id: `scratch-${state.nextScratchId++}`,
      name,
      type,
      path: null,
      relativePath: parentRelative ? `${parentRelative}/${name}` : name,
      scratch: true,
      content: type === "file" ? "" : undefined,
      expanded: true,
      parent,
      children: []
    };
    siblings.push(node);
    state.selectedNode = node;
    if (parent) parent.expanded = true;
    renderTree();
    if (type === "file") docking.openFile(node.name, "", null, node.id);
  }

  async function activateWorkspace(result, persist = true) {
    if (!result || result.type !== "folder") return false;
    if (hasUnsavedChanges() && !await showDialog({
      title: "Switch Workspace",
      message: "Unsaved changes will be discarded when you switch folders. Continue?",
      actions: ["Cancel", "Switch"]
    })) return false;
    if (persist) await window.miaSquid.activateWorkspace(result.path);
    clearDocumentState();
    docking.closeAllDocuments();
    const root = makeNode({ ...result, type: "folder" }, null, "");
    state.roots = [root];
    state.workspaceRoot = root;
    state.selectedNode = root;
    renderTree();
    getTerminal().changeDirectory(root.path);
    getSourceControl().refreshGitStatus();
    return true;
  }

  async function openFolder() {
    const result = await window.miaSquid.openFolder();
    if (!result) return;
    await activateWorkspace(result);
  }

  async function openFile() {
    const result = await window.miaSquid.openFile();
    if (!result) return;
    const existing = findNode(result.path);
    let node = existing;
    if (!node) {
      node = makeNode({ ...result, type: "file" });
      node.relativePath = node.name;
      state.roots.push(node);
    }
    state.selectedNode = node;
    renderTree();
    if (docking.getDocument(result.path)) docking.activateDocument(result.path);
    else docking.openFile(result.name, result.content, result.path);
  }

  async function openProjectItem() {
    const result = await window.miaSquid.openProjectItem();
    if (!result) return;
    if (result.type === "folder") {
      await activateWorkspace(result);
    } else {
      const existing = findNode(result.path);
      const node = existing || makeNode(result, null, result.name);
      if (!existing) state.roots.push(node);
      state.selectedNode = node;
      renderTree();
      if (docking.getDocument(result.path)) docking.activateDocument(result.path);
      else docking.openFile(result.name, result.content, result.path);
    }
  }

  async function openNode(node) {
    if (node.type === "folder") {
      node.expanded = !node.expanded;
      state.selectedNode = node;
      renderTree();
      return;
    }
    const existingDoc = docking.getDocument(node.path || node.id);
    if (existingDoc) {
      docking.activateDocument(existingDoc.id);
      return;
    }
    const content = node.scratch ? node.content || "" : await window.miaSquid.readFile(node.path);
    state.selectedNode = node;
    renderTree();
    docking.openFile(node.name, content, node.path, node.id);
  }

  async function saveActiveDocument() {
    const doc = docking.getActiveDocument();
    if (scratchEntries().length) await saveWorkspace();
    if (!doc || !doc.dirty) return;
    if (!doc.path) {
      notify("File is not saved", "Choose a workspace location to save this new file.", "warning");
      return;
    }
    await window.miaSquid.writeFile(doc.path, doc.content);
    docking.setDocumentDirty(doc.id, false);
    const node = findNode(doc.path) || findNode(doc.id);
    if (node) node.content = doc.content;
  }

  async function saveActiveDocumentAs() {
    const doc = docking.getActiveDocument();
    if (!doc) return;
    const filePath = await window.miaSquid.saveAs(doc.content, doc.path || doc.name);
    if (!filePath) return;
    docking.setDocumentPath(doc.id, filePath);
    docking.setDocumentDirty(doc.id, false);
    const node = findNode(doc.id);
    if (node) {
      node.path = filePath;
      node.scratch = false;
      node.name = filePath.split(/[\\/]/).pop();
      renderTree();
    }
    refreshOutline(doc);
    notify("File saved", `Saved ${doc.name}.`);
  }

  async function saveAllDocuments() {
    if (scratchEntries().length) await saveWorkspace();
    for (const doc of [...docking.documents.values()]) {
      if (!doc.dirty) continue;
      if (doc.path) {
        await window.miaSquid.writeFile(doc.path, doc.content);
        docking.setDocumentDirty(doc.id, false);
      } else if (doc.id === docking.activeDocumentId) {
        await saveActiveDocumentAs();
      } else {
        notify("Unsaved document", `Save ${doc.name} individually with Save As.`, "warning");
      }
    }
  }
  return {
    makeNode, updateWorkspaceLabel, renderTree, findNode, flattenNodes, scratchEntries,
    saveWorkspace, hasUnsavedChanges, makeNewNode, activateWorkspace, openFolder,
    openFile, openProjectItem, openNode, saveActiveDocument, saveActiveDocumentAs, saveAllDocuments
  };
}
