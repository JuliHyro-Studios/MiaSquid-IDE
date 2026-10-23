module.exports = (ipcRenderer) => ({
  loadFragment(name) {
    if (typeof name !== "string" || !new Set([
      "topbar.html",
      "toolbar.html",
      "activitybar.html",
      "solution.html",
      "editor.html",
      "bottom-panel.html",
      "statusbar.html"
    ]).has(name)) {
      return Promise.reject(new Error("Fragment is not allowed"));
    }
    return ipcRenderer.invoke("miasquid:load-fragment", name);
  },
  openFile: () => ipcRenderer.invoke("miasquid:open-file"),
  openFolder: () => ipcRenderer.invoke("miasquid:open-folder"),
  openProjectItem: () => ipcRenderer.invoke("miasquid:open-project-item"),
  restoreLastProject: () => ipcRenderer.invoke("miasquid:restore-last-project"),
  openWorkspacePath: workspacePath => ipcRenderer.invoke("miasquid:open-workspace-path", workspacePath),
  activateWorkspace: workspacePath => ipcRenderer.invoke("miasquid:activate-workspace", workspacePath),
  clearLastProject: () => ipcRenderer.invoke("miasquid:clear-last-project"),
  readIdeSettings: () => ipcRenderer.invoke("miasquid:ide-settings-read"),
  consumeSettingsRecoveryWarning: () => ipcRenderer.invoke("miasquid:ide-settings-recovery-warning"),
  writeIdeSettings: settings => ipcRenderer.invoke("miasquid:ide-settings-write", settings),
  ideDataPaths: () => ipcRenderer.invoke("miasquid:ide-data-paths"),
  loadSettingsCatalog: () => ipcRenderer.invoke("miasquid:settings-catalog"),
  loadSettingsPage: pageId => ipcRenderer.invoke("miasquid:settings-page", pageId),
  readClipboardText: () => ipcRenderer.invoke("miasquid:clipboard-read"),
  createProjectItems: (workspacePath, entries) => ipcRenderer.invoke("miasquid:project-create-items", workspacePath, entries),
  readFile: filePath => ipcRenderer.invoke("miasquid:read-file", filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke("miasquid:write-file", filePath, content),
  saveAs: (content, defaultPath) => ipcRenderer.invoke("miasquid:save-as", content, defaultPath),
  saveWorkspace: (entries, defaultPath) => ipcRenderer.invoke("miasquid:save-workspace", entries, defaultPath),
  analyzeFile: (workspacePath, filePath, analysis) => ipcRenderer.invoke("miasquid:analyze-file", workspacePath, filePath, analysis),
  readAnalysisCache: (workspacePath, filePath, content) => ipcRenderer.invoke("miasquid:analysis-cache-read", workspacePath, filePath, content),
  writeAnalysisCache: (workspacePath, filePath, content, analysis) =>
    ipcRenderer.invoke("miasquid:analysis-cache-write", workspacePath, filePath, content, analysis),
  analysisCacheStats: () => ipcRenderer.invoke("miasquid:analysis-cache-stats")
});
