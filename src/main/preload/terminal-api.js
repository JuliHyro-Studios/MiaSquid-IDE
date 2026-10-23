function subscribe(ipcRenderer, channel, callback, mapArguments) {
  if (typeof callback !== "function") throw new TypeError("Terminal event callback must be a function");
  const listener = (_event, ...args) => callback(...mapArguments(args));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

module.exports = (ipcRenderer) => ({
  createTerminal: cwd => ipcRenderer.invoke("miasquid:terminal-create", cwd),
  writeTerminal: (id, data) => ipcRenderer.send("miasquid:terminal-write", id, data),
  closeTerminal: id => ipcRenderer.send("miasquid:terminal-close", id),
  openTerminalWindow: cwd => ipcRenderer.invoke("miasquid:terminal-window", cwd),
  onTerminalData: callback => subscribe(ipcRenderer, "miasquid:terminal-data", callback, args => args),
  onTerminalError: callback => subscribe(ipcRenderer, "miasquid:terminal-error", callback, args => args),
  onTerminalExit: callback => subscribe(ipcRenderer, "miasquid:terminal-exit", callback, args => args)
});
