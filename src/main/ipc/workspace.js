const { app, BrowserWindow, clipboard, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const defaultSettings = require("../settings/default-settings");

module.exports = function registerWorkspaceIpc() {
  const appRoot = path.resolve(__dirname, "..", "..", "..");
  const fragmentDirectory = path.join(appRoot, "src", "resource", "htmls");
  const allowedFragments = new Set([
    "topbar.html",
    "toolbar.html",
    "activitybar.html",
    "solution.html",
    "editor.html",
    "bottom-panel.html",
    "statusbar.html"
  ]);
  const approvedPaths = new WeakMap();
  const ideDataDirectory = path.join(app.getPath("appData"), "MiaSquid IDE");
  const ideCacheDirectories = ["analysis", "files", "git", "packages"];
  const settingsFile = path.join(ideDataDirectory, "settings.json");
  const legacySettingsFile = path.join(ideDataDirectory, "settings.txt");
  const lastProjectFile = path.join(ideDataDirectory, "lastproject.json");
  const settingsPagesDirectory = path.join(appRoot, "src", "resource", "settings");
  const settingsPageIds = new Set(["general", "editor", "files", "cache", "keybindings"]);
  const analysisCache = { hits: 0, misses: 0, writes: 0 };
  const maxAnalysisCacheBytes = 256 * 1024 * 1024;
  let settingsRecoveryWarning = null;

  async function writeSettingsFile(settings) {
    const temporaryFile = `${settingsFile}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporaryFile, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    try {
      await fs.rename(temporaryFile, settingsFile);
    } catch (error) {
      await fs.unlink(temporaryFile).catch(cleanupError => {
        if (cleanupError.code !== "ENOENT") throw cleanupError;
      });
      throw error;
    }
  }

  function mergeSettings(settings = {}) {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      throw new Error("IDE settings must be an object");
    }
    const configuredKeybindings = settings.keybindings || {};
    if (!configuredKeybindings || typeof configuredKeybindings !== "object" || Array.isArray(configuredKeybindings)) {
      throw new Error("Keyboard shortcuts must be an object");
    }
    for (const [command, accelerator] of Object.entries(configuredKeybindings)) {
      if (!Object.hasOwn(defaultSettings.keybindings, command) ||
          typeof accelerator !== "string" || accelerator.length > 80 ||
          (accelerator && !/^[A-Za-z0-9+`/ ]+$/.test(accelerator))) {
        throw new Error(`Invalid keyboard shortcut for ${command}`);
      }
    }
    return {
      ...defaultSettings,
      ...settings,
      editor: { ...defaultSettings.editor, ...settings.editor },
      files: { ...defaultSettings.files, ...settings.files },
      keybindings: { ...defaultSettings.keybindings, ...settings.keybindings }
    };
  }

  async function ensureIdeData() {
    await fs.mkdir(ideDataDirectory, { recursive: true });
    for (const directory of ideCacheDirectories) {
      await fs.mkdir(path.join(ideDataDirectory, "cache", directory), { recursive: true });
    }
    try {
      await fs.access(settingsFile);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      let initialSettings = defaultSettings;
      try {
        initialSettings = mergeSettings(JSON.parse(await fs.readFile(legacySettingsFile, "utf8")));
      } catch (legacyError) {
        if (legacyError.code !== "ENOENT") throw legacyError;
      }
      await writeSettingsFile(initialSettings).catch(createError => {
        if (createError.code !== "EEXIST") throw createError;
      });
    }
    try {
      await fs.access(lastProjectFile);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await fs.writeFile(lastProjectFile, `${JSON.stringify({ path: null })}\n`, { encoding: "utf8", flag: "wx" })
        .catch(createError => { if (createError.code !== "EEXIST") throw createError; });
    }
  }

  async function readSettings() {
    await ensureIdeData();
    try {
      const raw = await fs.readFile(settingsFile, "utf8");
      const parsed = JSON.parse(raw);
      const settings = mergeSettings(parsed);
      if (!Number.isInteger(settings.editor.tabSize) || settings.editor.tabSize < 1 || settings.editor.tabSize > 8 ||
          typeof settings.editor.insertSpaces !== "boolean" || typeof settings.files.autoSave !== "boolean" ||
          !["dark", "light"].includes(settings.theme)) {
        throw new Error("IDE settings contain invalid values");
      }
      const normalized = `${JSON.stringify(settings, null, 2)}\n`;
      if (raw !== normalized) await writeSettingsFile(settings);
      return settings;
    } catch (error) {
      if (!(error instanceof SyntaxError) && error.message !== "IDE settings contain invalid values" &&
          error.message !== "IDE settings must be an object" &&
          error.message !== "Keyboard shortcuts must be an object" &&
          !error.message.startsWith("Invalid keyboard shortcut for ")) {
        throw error;
      }
      const backupFile = `${settingsFile}.corrupt-${Date.now()}`;
      await fs.rename(settingsFile, backupFile);
      const settings = mergeSettings(defaultSettings);
      await writeSettingsFile(settings);
      settingsRecoveryWarning = `The damaged settings file was preserved as ${path.basename(backupFile)}. Default settings have been restored.`;
      console.error("IDE settings JSON was invalid and has been recovered", { backupFile, error });
      return settings;
    }
  }

  async function writeSettings(settings) {
    if (!settings || typeof settings !== "object" ||
        !Number.isInteger(settings.editor?.tabSize) || settings.editor.tabSize < 1 || settings.editor.tabSize > 8 ||
        typeof settings.editor.insertSpaces !== "boolean" || typeof settings.files?.autoSave !== "boolean" ||
        !["dark", "light"].includes(settings.theme)) {
      throw new Error("IDE settings contain invalid values");
    }
    const merged = mergeSettings(settings);
    await ensureIdeData();
    await writeSettingsFile(merged);
  }

  async function saveLastProject(projectPath) {
    await ensureIdeData();
    await fs.writeFile(lastProjectFile, `${JSON.stringify({ path: projectPath }, null, 2)}\n`, "utf8");
  }

  async function ensureWorkspaceMetadata(root) {
    const metadata = path.join(root, ".miasquid");
    const analysis = path.join(metadata, "analysis");
    for (const directory of [metadata, analysis]) {
      try {
        const stats = await fs.lstat(directory);
        if (stats.isSymbolicLink() || !stats.isDirectory()) {
          throw new Error(`Workspace metadata path is not a safe directory: ${directory}`);
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await fs.mkdir(directory).catch(createError => { if (createError.code !== "EEXIST") throw createError; });
        const stats = await fs.lstat(directory);
        if (stats.isSymbolicLink() || !stats.isDirectory()) {
          throw new Error(`Workspace metadata path is not a safe directory: ${directory}`);
        }
      }
      const ignoreFile = path.join(metadata, ".gitignore");
      await fs.writeFile(ignoreFile, "*\n!.gitignore\n", { encoding: "utf8", flag: "wx" })
        .catch(error => { if (error.code !== "EEXIST") throw error; });
    }
  }

  function getApprovedPaths(webContents) {
    let paths = approvedPaths.get(webContents);
    if (!paths) {
      paths = new Set();
      approvedPaths.set(webContents, paths);
    }
    return paths;
  }

  function approvePath(webContents, filePath) {
    const resolved = path.resolve(filePath);
    getApprovedPaths(webContents).add(resolved);
    return resolved;
  }

  function requireApprovedPath(webContents, filePath) {
    if (typeof filePath !== "string" || !getApprovedPaths(webContents).has(path.resolve(filePath))) {
      throw new Error("This file has not been selected by the user");
    }
    return path.resolve(filePath);
  }

  function isPathWithin(root, target) {
    const relative = path.relative(root, target);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  }

  function getAnalysisCachePath(root, relativePath, contentHash) {
    const normalizedRoot = process.platform === "win32" ? root.toLocaleLowerCase() : root;
    const normalizedRelative = process.platform === "win32" ? relativePath.toLocaleLowerCase() : relativePath;
    const key = createHash("sha256")
      .update(`${normalizedRoot}\0${normalizedRelative}\0${contentHash}`)
      .digest("hex");
    return path.join(ideDataDirectory, "cache", "analysis", `${key}.json`);
  }

  function validateCachedAnalysis(analysis) {
    if (!analysis || typeof analysis !== "object" ||
        !Array.isArray(analysis.symbols) || analysis.symbols.length > 5000 ||
        analysis.symbols.some(symbol => !symbol || typeof symbol.name !== "string" ||
          typeof symbol.kind !== "string" || !Number.isInteger(symbol.line) || symbol.line < 1) ||
        !Array.isArray(analysis.completionTokens) || analysis.completionTokens.length > 10000 ||
        analysis.completionTokens.some(token => typeof token !== "string") ||
        !Array.isArray(analysis.diagnostics) || analysis.diagnostics.length > 5000 ||
        analysis.diagnostics.some(item => !item || typeof item.message !== "string" ||
          !Number.isInteger(item.line) || !Number.isInteger(item.column))) {
      throw new Error("Invalid cached analysis");
    }
  }

  async function pruneAnalysisCache(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const filePath = path.join(directory, entry.name);
      const stats = await fs.stat(filePath);
      files.push({ path: filePath, size: stats.size, modified: stats.mtimeMs });
    }
    let total = files.reduce((sum, file) => sum + file.size, 0);
    if (total <= maxAnalysisCacheBytes) return;
    files.sort((left, right) => left.modified - right.modified);
    for (const file of files) {
      if (total <= maxAnalysisCacheBytes) break;
      await fs.unlink(file.path).catch(error => {
        if (error.code !== "ENOENT") throw error;
      });
      total -= file.size;
    }
  }

  async function readDirectory(webContents, directoryPath) {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    const items = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink() || entry.name === ".miasquid") continue;
      const entryPath = approvePath(webContents, path.join(directoryPath, entry.name));
      if (entry.isDirectory()) {
        items.push({
          name: entry.name,
          path: entryPath,
          type: "folder",
          children: await readDirectory(webContents, entryPath)
        });
      } else if (entry.isFile()) {
        items.push({ name: entry.name, path: entryPath, type: "file" });
      }
    }
    return items;
  }

  ipcMain.handle("miasquid:load-fragment", async (_event, name) => {
    if (typeof name !== "string" || !allowedFragments.has(name)) {
      throw new Error("Fragment is not allowed");
    }
    const filePath = path.join(fragmentDirectory, name);
    return fs.readFile(filePath, "utf8");
  });

  ipcMain.handle("miasquid:settings-catalog", async () => {
    return JSON.parse(await fs.readFile(path.join(settingsPagesDirectory, "settings-pages.json"), "utf8"));
  });

  ipcMain.handle("miasquid:settings-page", async (_event, id) => {
    if (typeof id !== "string" || !settingsPageIds.has(id)) throw new Error("Settings page is not available");
    const [page, markdown] = await Promise.all([
      fs.readFile(path.join(settingsPagesDirectory, `${id}.json`), "utf8"),
      fs.readFile(path.join(settingsPagesDirectory, `${id}.md`), "utf8")
    ]);
    const parsed = JSON.parse(page);
    if (parsed.id !== id || typeof parsed.title !== "string" || !Array.isArray(parsed.settings)) {
      throw new Error(`Settings page metadata is invalid: ${id}`);
    }
    return { ...parsed, markdown };
  });

  ipcMain.handle("miasquid:open-file", async (event) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      properties: ["openFile"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = approvePath(event.sender, result.filePaths[0]);
    return {
      name: path.basename(filePath),
      path: filePath,
      content: await fs.readFile(filePath, "utf8")
    };
  });

  ipcMain.handle("miasquid:open-folder", async (event) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const folderPath = approvePath(event.sender, result.filePaths[0]);
    return {
      type: "folder",
      name: path.basename(folderPath) || folderPath,
      path: folderPath,
      children: await readDirectory(event.sender, folderPath)
    };
  });

  ipcMain.handle("miasquid:open-project-item", async (event) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      properties: ["openFile", "openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const selectedPath = approvePath(event.sender, result.filePaths[0]);
    const stats = await fs.stat(selectedPath);
    if (stats.isDirectory()) {
      return {
        type: "folder",
        name: path.basename(selectedPath) || selectedPath,
        path: selectedPath,
        children: await readDirectory(event.sender, selectedPath)
      };
    }
    return {
      type: "file",
      name: path.basename(selectedPath),
      path: selectedPath,
      content: await fs.readFile(selectedPath, "utf8")
    };
  });

  ipcMain.handle("miasquid:activate-workspace", async (event, workspacePath) => {
    const root = requireApprovedPath(event.sender, workspacePath);
    const stats = await fs.stat(root);
    if (!stats.isDirectory()) throw new Error("Workspace path must be a folder");
    await ensureWorkspaceMetadata(root);
    await saveLastProject(root);
  });

  ipcMain.handle("miasquid:clear-last-project", () => saveLastProject(null));
  ipcMain.handle("miasquid:clipboard-read", () => clipboard.readText());

  ipcMain.handle("miasquid:restore-last-project", async (event) => {
    await ensureIdeData();
    const saved = JSON.parse(await fs.readFile(lastProjectFile, "utf8"));
    if (!saved.path) return null;
    let stats;
    try {
      stats = await fs.stat(saved.path);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    if (!stats.isDirectory()) return null;
    const root = approvePath(event.sender, saved.path);
    await ensureWorkspaceMetadata(root);
    return { name: path.basename(root) || root, path: root, type: "folder", children: await readDirectory(event.sender, root) };
  });

  ipcMain.handle("miasquid:open-workspace-path", async (event, requestedPath) => {
    if (typeof requestedPath !== "string" || !path.isAbsolute(requestedPath)) {
      throw new Error("Workspace path must be an absolute path");
    }
    const root = path.resolve(requestedPath);
    const stats = await fs.stat(root);
    if (!stats.isDirectory()) throw new Error("Workspace path must be a folder");
    approvePath(event.sender, root);
    await ensureWorkspaceMetadata(root);
    await saveLastProject(root);
    return { name: path.basename(root) || root, path: root, type: "folder", children: await readDirectory(event.sender, root) };
  });

  ipcMain.handle("miasquid:ide-settings-read", () => readSettings());
  ipcMain.handle("miasquid:ide-settings-recovery-warning", () => {
    const warning = settingsRecoveryWarning;
    settingsRecoveryWarning = null;
    return warning;
  });
  ipcMain.handle("miasquid:ide-settings-write", (_event, settings) => writeSettings(settings));
  ipcMain.handle("miasquid:ide-data-paths", async () => {
    await ensureIdeData();
    return {
      directory: ideDataDirectory,
      settings: settingsFile,
      lastProject: lastProjectFile,
      cacheDirectories: ideCacheDirectories.map(directory => path.join(ideDataDirectory, "cache", directory))
    };
  });

  ipcMain.handle("miasquid:project-create-items", async (event, workspacePath, entries) => {
    const root = requireApprovedPath(event.sender, workspacePath);
    const rootStats = await fs.stat(root);
    if (!rootStats.isDirectory() || !Array.isArray(entries) || entries.length === 0) {
      throw new Error("A workspace folder and at least one item are required");
    }
    const normalized = entries.map(entry => {
      if (!entry || typeof entry.relativePath !== "string" ||
          !["file", "folder"].includes(entry.type) ||
          (entry.type === "file" && typeof entry.content !== "string")) {
        throw new Error("Invalid workspace item");
      }
      const segments = entry.relativePath.replace(/\\/g, "/").split("/");
      if (segments.some(segment => !segment || segment === "." || segment === "..") ||
          path.isAbsolute(entry.relativePath) || segments.some(segment => /[<>:"|?*\u0000-\u001f]/.test(segment))) {
        throw new Error("Invalid workspace item path");
      }
      const destination = path.resolve(root, ...segments);
      const relative = path.relative(root, destination);
      if (!relative || !isPathWithin(root, destination)) {
        throw new Error("Workspace item must stay inside the selected folder");
      }
      return { ...entry, destination };
    });
    const destinations = new Set(normalized.map(entry => process.platform === "win32" ? entry.destination.toLowerCase() : entry.destination));
    if (destinations.size !== normalized.length) throw new Error("Workspace item paths must be unique");
    for (const entry of normalized) {
      try {
        await fs.lstat(entry.destination);
        throw new Error(`An item already exists at ${entry.destination}`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      let parent = path.dirname(entry.destination);
      while (parent !== root && isPathWithin(root, parent)) {
        try {
          const stats = await fs.lstat(parent);
          if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`Workspace parent is not a safe directory: ${parent}`);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        parent = path.dirname(parent);
      }
    }
    const created = [];
    for (const entry of normalized) {
      if (entry.type === "folder") {
        await fs.mkdir(entry.destination);
      } else {
        await fs.mkdir(path.dirname(entry.destination), { recursive: true });
        await fs.writeFile(entry.destination, entry.content, { encoding: "utf8", flag: "wx" });
      }
      approvePath(event.sender, entry.destination);
      created.push({ relativePath: entry.relativePath, type: entry.type, path: entry.destination });
    }
    return created;
  });

  ipcMain.handle("miasquid:read-file", async (event, filePath) => {
    return fs.readFile(requireApprovedPath(event.sender, filePath), "utf8");
  });

  ipcMain.handle("miasquid:write-file", async (event, filePath, content) => {
    if (typeof content !== "string") throw new Error("File content must be text");
    await fs.writeFile(requireApprovedPath(event.sender, filePath), content, "utf8");
  });

  ipcMain.handle("miasquid:save-as", async (event, content, defaultPath) => {
    if (typeof content !== "string") throw new Error("File content must be text");
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      defaultPath: typeof defaultPath === "string" ? defaultPath : undefined
    });
    if (result.canceled || !result.filePath) return null;
    const filePath = approvePath(event.sender, result.filePath);
    await fs.writeFile(filePath, content, "utf8");
    return filePath;
  });

  ipcMain.handle("miasquid:analyze-file", async (event, workspacePath, filePath, analysis) => {
    const root = requireApprovedPath(event.sender, workspacePath);
    const source = requireApprovedPath(event.sender, filePath);
    const relative = path.relative(root, source);
    if (!relative || !isPathWithin(root, source)) {
      throw new Error("Analysis files must belong to the current workspace");
    }
    if (!analysis || typeof analysis !== "object" || !Array.isArray(analysis.symbols)) {
      throw new Error("Invalid file analysis");
    }
    if (analysis.symbols.length > 5000 || analysis.symbols.some(symbol =>
      !symbol || typeof symbol.name !== "string" || typeof symbol.kind !== "string" ||
      !Number.isInteger(symbol.line) || symbol.line < 1)) {
      throw new Error("Invalid analysis symbols");
    }
    const completionTokens = analysis.completionTokens || [];
    if (!Array.isArray(completionTokens) || completionTokens.length > 10000 ||
        completionTokens.some(token => typeof token !== "string")) {
      throw new Error("Invalid inline completion analysis");
    }
    const key = createHash("sha256").update(relative).digest("hex");
    const metadataDirectory = path.join(root, ".miasquid");
    const directory = path.join(metadataDirectory, "analysis");
    for (const candidate of [metadataDirectory, directory]) {
      try {
        const stats = await fs.lstat(candidate);
        if (stats.isSymbolicLink() || !stats.isDirectory()) {
          throw new Error(`Workspace analysis path is not a safe directory: ${candidate}`);
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await fs.mkdir(candidate).catch(createError => {
          if (createError.code !== "EEXIST") throw createError;
        });
        const stats = await fs.lstat(candidate);
        if (stats.isSymbolicLink() || !stats.isDirectory()) {
          throw new Error(`Workspace analysis path is not a safe directory: ${candidate}`);
        }
      }
    }
    await fs.writeFile(path.join(directory, `${key}.json`), JSON.stringify({
      version: 1,
      file: relative,
      symbols: analysis.symbols,
      completionTokens
    }, null, 2), "utf8");
  });

  ipcMain.handle("miasquid:analysis-cache-read", async (event, workspacePath, filePath, content) => {
    if (typeof content !== "string" || content.length > 5_000_000) {
      throw new Error("Analysis cache content is invalid or too large");
    }
    const root = requireApprovedPath(event.sender, workspacePath);
    const source = requireApprovedPath(event.sender, filePath);
    const relative = path.relative(root, source);
    if (!relative || !isPathWithin(root, source)) throw new Error("Analysis cache file is outside the workspace");
    const contentHash = createHash("sha256").update(content).digest("hex");
    const cachePath = getAnalysisCachePath(root, relative, contentHash);
    try {
      const cached = JSON.parse(await fs.readFile(cachePath, "utf8"));
      if (cached.version !== 1 || cached.contentHash !== contentHash) {
        throw new Error("Analysis cache entry is invalid");
      }
      validateCachedAnalysis(cached.analysis);
      analysisCache.hits++;
      return cached.analysis;
    } catch (error) {
      if (error.code === "ENOENT") {
        analysisCache.misses++;
        return null;
      }
      throw error;
    }
  });

  ipcMain.handle("miasquid:analysis-cache-write", async (event, workspacePath, filePath, content, analysis) => {
    if (typeof content !== "string" || content.length > 5_000_000) {
      throw new Error("Analysis cache content is invalid or too large");
    }
    validateCachedAnalysis(analysis);
    const root = requireApprovedPath(event.sender, workspacePath);
    const source = requireApprovedPath(event.sender, filePath);
    const relative = path.relative(root, source);
    if (!relative || !isPathWithin(root, source)) throw new Error("Analysis cache file is outside the workspace");
    await ensureIdeData();
    const contentHash = createHash("sha256").update(content).digest("hex");
    const cachePath = getAnalysisCachePath(root, relative, contentHash);
    const temporaryPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify({
      version: 1,
      workspace: root,
      file: relative,
      contentHash,
      analysis
    }), { encoding: "utf8", flag: "wx" });
    try {
      await fs.rename(temporaryPath, cachePath);
    } catch (error) {
      await fs.unlink(temporaryPath).catch(unlinkError => {
        if (unlinkError.code !== "ENOENT") throw unlinkError;
      });
      if (error.code !== "EEXIST" && error.code !== "EPERM") throw error;
      await fs.access(cachePath);
    }
    analysisCache.writes++;
    await pruneAnalysisCache(path.dirname(cachePath));
  });

  ipcMain.handle("miasquid:analysis-cache-stats", () => ({ ...analysisCache }));

    return { approvePath, requireApprovedPath, isPathWithin, ensureWorkspaceMetadata, saveLastProject, ensureIdeData };
};
