const { app, BrowserWindow, shell, ipcMain, dialog } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const registerWorkspaceIpc = require("./src/main/ipc/workspace");
const registerWorkspaceSaveIpc = require("./src/main/ipc/workspace-save");
const registerGitIpc = require("./src/main/ipc/git");
const registerTerminalIpc = require("./src/main/ipc/terminal");
const registerApplication = require("./src/main/ipc/application");

const workspaceAccess = registerWorkspaceIpc();
registerWorkspaceSaveIpc({ ipcMain, dialog, BrowserWindow, fs, path, workspaceAccess });
registerGitIpc({ ipcMain, fs, path, ...workspaceAccess });
registerTerminalIpc(workspaceAccess);
registerApplication({ app, BrowserWindow, shell, ipcMain, dialog, ensureIdeData: workspaceAccess.ensureIdeData });
