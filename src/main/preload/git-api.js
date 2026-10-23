module.exports = (ipcRenderer) => ({
  gitInfo: workspacePath => ipcRenderer.invoke("miasquid:git-info", workspacePath),
  gitInit: workspacePath => ipcRenderer.invoke("miasquid:git-init", workspacePath),
  gitStage: (workspacePath, files, staged) => ipcRenderer.invoke("miasquid:git-stage", workspacePath, files, staged),
  gitCommit: (workspacePath, message) => ipcRenderer.invoke("miasquid:git-commit", workspacePath, message),
  gitSync: (workspacePath, direction, remote) => ipcRenderer.invoke("miasquid:git-sync", workspacePath, direction, remote),
  gitConfigSet: (workspacePath, scope, key, value) =>
    ipcRenderer.invoke("miasquid:git-config-set", workspacePath, scope, key, value),
  gitRemoteSet: (workspacePath, name, url) => ipcRenderer.invoke("miasquid:git-remote-set", workspacePath, name, url),
  gitRemoteRemove: (workspacePath, name) => ipcRenderer.invoke("miasquid:git-remote-remove", workspacePath, name)
});
