const path = require("node:path");

module.exports = function registerApplication({ app, BrowserWindow, shell, ipcMain, dialog, ensureIdeData }) {
  const appRoot = path.resolve(__dirname, "..", "..", "..");

  function createWindow() {
    const win = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 900,
      minHeight: 600,
      title: "MiaSquid IDE",
      backgroundColor: "#1e1e1e",
      show: false,
      webPreferences: {
        preload: path.join(appRoot, "src", "main", "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    win.loadFile(path.join(appRoot, "src", "resource", "htmls", "IDEShell.html"));
    win.once("ready-to-show", () => win.show());
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) shell.openExternal(url);
      return { action: "deny" };
    });
  }

  ipcMain.handle("miasquid:new-window", () => createWindow());
  ipcMain.handle("miasquid:quit", () => app.quit());

  app.whenReady().then(async () => {
    try {
      await ensureIdeData();
    } catch (error) {
      console.error("Unable to initialize IDE roaming data", error);
      dialog.showErrorBox("MiaSquid IDE data error", error.message);
      app.quit();
      return;
    }
    createWindow();
    app.on("activate", () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
};
