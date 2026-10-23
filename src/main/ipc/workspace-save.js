module.exports = function registerWorkspaceSaveIpc({ ipcMain, dialog, BrowserWindow, fs, path, workspaceAccess }) {
  ipcMain.handle("miasquid:save-workspace", async (event, entries, defaultPath) => {
    if (!Array.isArray(entries)) throw new Error("Workspace entries must be an array");
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      defaultPath: typeof defaultPath === "string" ? defaultPath : undefined,
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const root = path.resolve(result.filePaths[0]);
    await workspaceAccess.ensureWorkspaceMetadata(root);
    await workspaceAccess.saveLastProject(root);
    const normalizedEntries = entries.map(entry => {
      if (!entry || typeof entry.relativePath !== "string" ||
          !["file", "folder"].includes(entry.type) ||
          (entry.type === "file" && typeof entry.content !== "string")) {
        throw new Error("Invalid workspace entry");
      }
      const segments = entry.relativePath.replace(/\\/g, "/").split("/");
      if (segments.some(segment => !segment || segment === "." || segment === "..") ||
          path.isAbsolute(entry.relativePath)) {
        throw new Error("Invalid workspace path");
      }
      return { ...entry, destination: path.resolve(root, ...segments) };
    });
    const destinations = new Set();
    for (const entry of normalizedEntries) {
      const relativeDestination = path.relative(root, entry.destination);
      if (!relativeDestination || !workspaceAccess.isPathWithin(root, entry.destination) ||
          destinations.has(entry.destination)) {
        throw new Error("Workspace paths must be unique and stay inside the selected folder");
      }
      destinations.add(entry.destination);
    }

    for (const entry of normalizedEntries) {
      try {
        const stats = await fs.lstat(entry.destination);
        if (stats.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in a new workspace: ${entry.destination}`);
        if (entry.type === "file" || !stats.isDirectory()) {
          throw new Error(`An item already exists at ${entry.destination}`);
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      let parent = path.dirname(entry.destination);
      while (parent !== root && workspaceAccess.isPathWithin(root, parent)) {
        try {
          const stats = await fs.lstat(parent);
          if (stats.isSymbolicLink() || !stats.isDirectory()) {
            throw new Error(`Workspace parent is not a safe directory: ${parent}`);
          }
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        parent = path.dirname(parent);
      }
    }
    for (const entry of normalizedEntries) {
      if (entry.type === "folder") {
        await fs.mkdir(entry.destination, { recursive: true });
      } else {
        await fs.mkdir(path.dirname(entry.destination), { recursive: true });
        await fs.writeFile(entry.destination, entry.content, { encoding: "utf8", flag: "wx" });
      }
      workspaceAccess.approvePath(event.sender, entry.destination);
    }
    workspaceAccess.approvePath(event.sender, root);
    return {
      root,
      paths: normalizedEntries.map(entry => ({
        relativePath: entry.relativePath,
        type: entry.type,
        path: entry.destination
      }))
    };
  });
};
