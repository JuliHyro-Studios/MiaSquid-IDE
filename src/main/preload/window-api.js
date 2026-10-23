module.exports = (ipcRenderer) => ({
  newWindow: () => ipcRenderer.invoke("miasquid:new-window"),
  quit: () => ipcRenderer.invoke("miasquid:quit")
});
