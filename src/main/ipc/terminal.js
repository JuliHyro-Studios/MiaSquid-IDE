const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");

module.exports = function registerTerminalIpc({ approvePath, requireApprovedPath }) {
  const appRoot = path.resolve(__dirname, "..", "..", "..");
  const terminals = new Map();
  function createShellProcess(cwd) {
    const options = {
      cwd,
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    };
    if (process.platform === "win32") {
      const powershell = path.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe"
      );
      const script = [
        "$ErrorActionPreference = 'Continue'",
        "$utf8 = New-Object System.Text.UTF8Encoding -ArgumentList $false",
        "[Console]::InputEncoding = $utf8",
        "[Console]::OutputEncoding = $utf8",
        "[Console]::Out.Write(('PS ' + (Get-Location).Path + '> '))",
        "[Console]::Out.Flush()",
        "while ($null -ne ($line = [Console]::In.ReadLine())) {",
        "  if ($line.Trim()) { try { Invoke-Expression $line } catch { Write-Error $_ } }",
        "  [Console]::Out.Write(('PS ' + (Get-Location).Path + '> '))",
        "  [Console]::Out.Flush()",
        "}"
      ].join("; ");
      return spawn(powershell, ["-NoLogo", "-NoProfile", "-Command", script], options);
    }
    const shellPath = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
    return spawn(shellPath, ["-i"], options);
  }

  function stopTerminal(id) {
    const terminal = terminals.get(id);
    if (!terminal) return;
    terminals.delete(id);
    terminal.process.kill();
  }

  ipcMain.handle("miasquid:terminal-create", async (event, requestedCwd) => {
    let cwd = process.cwd();
    if (requestedCwd !== undefined && requestedCwd !== null) {
      cwd = requireApprovedPath(event.sender, requestedCwd);
      const stats = await fs.stat(cwd);
      if (!stats.isDirectory()) throw new Error("Terminal working directory must be a folder");
    }
    const id = randomUUID();
    const child = createShellProcess(cwd);
    const terminal = { id, owner: event.sender, process: child };
    terminals.set(id, terminal);
    const send = (channel, ...args) => {
      if (!event.sender.isDestroyed()) event.sender.send(channel, id, ...args);
    };
    child.stdin.on("error", error => send("miasquid:terminal-error", error.message));
    child.stdout.on("data", data => send("miasquid:terminal-data", data.toString()));
    child.stderr.on("data", data => send("miasquid:terminal-data", data.toString()));
    child.on("error", error => send("miasquid:terminal-error", error.message));
    child.on("exit", (code, signal) => {
      terminals.delete(id);
      send("miasquid:terminal-exit", code, signal);
    });
    return { id, cwd, shell: process.platform === "win32" ? "PowerShell" : path.basename(process.env.SHELL || "/bin/bash") };
  });

  ipcMain.on("miasquid:terminal-write", (event, id, data) => {
    const terminal = terminals.get(id);
    if (!terminal || terminal.owner !== event.sender || typeof data !== "string" || data.length > 65536) {
      if (!event.sender.isDestroyed()) event.sender.send("miasquid:terminal-error", id, "Invalid terminal input");
      return;
    }
    terminal.process.stdin.write(data, error => {
      if (error && !event.sender.isDestroyed()) {
        event.sender.send("miasquid:terminal-error", id, error.message);
      }
    });
  });

  ipcMain.on("miasquid:terminal-close", (event, id) => {
    const terminal = terminals.get(id);
    if (terminal?.owner === event.sender) stopTerminal(id);
  });

  ipcMain.handle("miasquid:terminal-window", async (event, requestedCwd) => {
    let cwd;
    if (requestedCwd) {
      cwd = requireApprovedPath(event.sender, requestedCwd);
      const stats = await fs.stat(cwd);
      if (!stats.isDirectory()) throw new Error("Terminal working directory must be a folder");
    }
    const window = new BrowserWindow({
      width: 1000,
      height: 650,
      minWidth: 600,
      minHeight: 350,
      title: "MiaSquid IDE - Terminal",
      backgroundColor: "#1e1e1e",
      webPreferences: {
        preload: path.join(appRoot, "src", "main", "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    if (cwd) approvePath(window.webContents, cwd);
    await window.loadFile(path.join(appRoot, "src", "resource", "htmls", "TerminalWindow.html"), {
      query: cwd ? { cwd } : {}
    });
    window.once("ready-to-show", () => window.show());
  });

  app.on("web-contents-created", (_event, contents) => {
    contents.once("destroyed", () => {
      for (const [id, terminal] of terminals) {
        if (terminal.owner === contents) stopTerminal(id);
      }
    });
  });
};
