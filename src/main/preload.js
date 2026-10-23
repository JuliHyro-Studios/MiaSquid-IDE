const { contextBridge, ipcRenderer } = require("electron");
const createIdeApi = require("./preload/ide-api");
const createGitApi = require("./preload/git-api");
const createTerminalApi = require("./preload/terminal-api");
const createWindowApi = require("./preload/window-api");

contextBridge.exposeInMainWorld("miaSquid", Object.freeze({
  ...createIdeApi(ipcRenderer),
  ...createGitApi(ipcRenderer),
  ...createTerminalApi(ipcRenderer),
  ...createWindowApi(ipcRenderer)
}));
