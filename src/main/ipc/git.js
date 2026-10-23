const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

module.exports = function registerGitIpc({ ipcMain, fs, path, requireApprovedPath, isPathWithin }) {
  const runFile = promisify(execFile);
  async function runGit(root, args, options = {}) {
    const { stdout } = await runFile("git", ["-C", root, ...args], {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      timeout: 60000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...options.env }
    });
    return stdout;
  }

  function parseGitConfig(text) {
    return Object.fromEntries(text.split(/\r?\n/).filter(Boolean).map(line => {
      const separator = line.indexOf("=");
      return separator < 0 ? [line.toLowerCase(), ""] : [line.slice(0, separator).toLowerCase(), line.slice(separator + 1)];
    }));
  }

  function sanitizeRemoteUrl(remoteUrl) {
    return remoteUrl.replace(/(https?:\/\/)[^/@]+@/i, "$1[credentials]@");
  }

  function requireWorkspaceDirectory(event, workspacePath) {
    const root = requireApprovedPath(event.sender, workspacePath);
    return fs.stat(root).then(stats => {
      if (!stats.isDirectory()) throw new Error("Git workspace must be a folder");
      return root;
    });
  }

  ipcMain.handle("miasquid:git-info", async (event, workspacePath) => {
    const root = await requireWorkspaceDirectory(event, workspacePath);
    let version;
    try {
      ({ stdout: version } = await runFile("git", ["--version"], { windowsHide: true, timeout: 5000 }));
    } catch (error) {
      if (error.code === "ENOENT") return { installed: false, repository: false, version: null, status: "", remotes: [], config: {} };
      throw error;
    }
    let repository = false;
    try {
      await runGit(root, ["rev-parse", "--is-inside-work-tree"]);
      repository = true;
    } catch (error) {
      if (error.code !== 1 && error.code !== 128) throw error;
    }
    if (!repository) {
      const { stdout: globalConfig } = await runFile("git", ["config", "--global", "--list"], {
        windowsHide: true,
        timeout: 5000
      }).catch(error => error.code === 1 ? { stdout: "" } : Promise.reject(error));
      return {
        installed: true,
        repository: false,
        version: version.trim(),
        status: "",
        remotes: [],
        config: { local: {}, global: parseGitConfig(globalConfig) }
      };
    }
    const [status, remoteText, localConfig, globalConfig] = await Promise.all([
      runGit(root, ["status", "--porcelain=v1", "--branch"]),
      runGit(root, ["remote", "-v"]),
      runGit(root, ["config", "--local", "--list"]).catch(error => error.code === 1 ? "" : Promise.reject(error)),
      runFile("git", ["config", "--global", "--list"], { cwd: root, windowsHide: true, timeout: 5000 })
        .then(result => result.stdout)
        .catch(error => error.code === 1 ? "" : Promise.reject(error))
    ]);
    const remotes = [...new Map(remoteText.trim().split(/\r?\n/).filter(Boolean).map(line => {
      const match = line.match(/^(\S+)\s+(.+?)\s+\((fetch|push)\)$/);
      return match ? [match[1], { name: match[1], url: sanitizeRemoteUrl(match[2]) }] : [line, null];
    }).filter(([, remote]) => remote)).values()];
    const config = {};
    for (const [scope, text] of [["local", localConfig], ["global", globalConfig]]) {
      config[scope] = parseGitConfig(text);
    }
    const branch = status.match(/^##\s+(.+)$/m)?.[1] || "";
    const upstream = branch.match(/^(.*?)\.\.\.(.*?)(?:\s|$)/);
    let ahead = null;
    let behind = null;
    if (upstream) {
      try {
        const counts = (await runGit(root, ["rev-list", "--left-right", "--count", `${upstream[2]}...HEAD`])).trim().split(/\s+/).map(Number);
        behind = counts[0];
        ahead = counts[1];
      } catch (error) {
        if (error.code !== 128) throw error;
      }
    }
    return { installed: true, repository, version: version.trim(), status, branch, upstream: upstream?.[2] || null, ahead, behind, remotes, config };
  });

  ipcMain.handle("miasquid:git-init", async (event, workspacePath) => {
    const root = await requireWorkspaceDirectory(event, workspacePath);
    await runGit(root, ["init"]);
    return runGit(root, ["status", "--porcelain=v1", "--branch"]);
  });

  ipcMain.handle("miasquid:git-stage", async (event, workspacePath, files, staged) => {
    const root = await requireWorkspaceDirectory(event, workspacePath);
    if (!Array.isArray(files) || files.length === 0 ||
        files.some(file => typeof file !== "string" || !file || path.isAbsolute(file) ||
          file.split(/[\\/]/).some(segment => segment === ".."))) {
      throw new Error("Invalid Git file selection");
    }
    if (typeof staged !== "boolean") throw new Error("Git staging state must be boolean");
    if (staged) await runGit(root, ["--literal-pathspecs", "add", "--", ...files]);
    else await runGit(root, ["reset", "--", ...files]);
  });

  ipcMain.handle("miasquid:git-commit", async (event, workspacePath, message) => {
    const root = await requireWorkspaceDirectory(event, workspacePath);
    if (typeof message !== "string" || !message.trim()) throw new Error("Commit message cannot be empty");
    await runGit(root, ["commit", "-m", message.trim()]);
  });

  ipcMain.handle("miasquid:git-sync", async (event, workspacePath, direction, remoteName) => {
    const root = await requireWorkspaceDirectory(event, workspacePath);
    if (!["push", "pull"].includes(direction)) throw new Error("Invalid Git sync operation");
    if (typeof remoteName !== "string" || !/^[A-Za-z0-9._-]+$/.test(remoteName)) {
      throw new Error("Invalid Git remote name");
    }
    const remotes = (await runGit(root, ["remote"])).split(/\r?\n/).filter(Boolean);
    if (!remotes.includes(remoteName)) throw new Error(`Git remote "${remoteName}" does not exist`);
    if (direction === "pull") return runGit(root, ["pull", "--ff-only", remoteName]);
    const branch = (await runGit(root, ["branch", "--show-current"])).trim();
    if (!branch) throw new Error("Cannot push while HEAD is detached");
    return runGit(root, ["push", "--set-upstream", remoteName, branch]);
  });

  ipcMain.handle("miasquid:git-config-set", async (event, workspacePath, scope, key, value) => {
    const root = await requireWorkspaceDirectory(event, workspacePath);
    if (!["local", "global"].includes(scope) ||
        !["user.name", "user.email", "init.defaultbranch", "pull.rebase", "push.autosetupremote"].includes(String(key).toLowerCase()) ||
        typeof value !== "string" || value.length > 256 || /[\r\n\u0000]/.test(value)) {
      throw new Error("Invalid Git configuration value");
    }
    const args = ["config"];
    if (scope === "global") args.push("--global");
    else args.push("--local");
    args.push(String(key).toLowerCase(), value);
    if (scope === "global") {
      await runFile("git", args, { cwd: root, windowsHide: true, timeout: 5000 });
    } else {
      await runGit(root, args);
    }
  });

  ipcMain.handle("miasquid:git-remote-set", async (event, workspacePath, name, remoteUrl) => {
    const root = await requireWorkspaceDirectory(event, workspacePath);
    if (typeof name !== "string" || !/^[A-Za-z0-9._-]+$/.test(name) ||
        typeof remoteUrl !== "string" || remoteUrl.length > 2048 ||
        !(/^(https?:\/\/|ssh:\/\/|git@)[^\s]+$/i.test(remoteUrl))) {
      throw new Error("Invalid Git remote");
    }
    const remotes = (await runGit(root, ["remote"])).split(/\r?\n/).filter(Boolean);
    if (remotes.includes(name)) await runGit(root, ["remote", "set-url", name, remoteUrl]);
    else await runGit(root, ["remote", "add", name, remoteUrl]);
  });

  ipcMain.handle("miasquid:git-remote-remove", async (event, workspacePath, name) => {
    const root = await requireWorkspaceDirectory(event, workspacePath);
    if (typeof name !== "string" || !/^[A-Za-z0-9._-]+$/.test(name)) throw new Error("Invalid Git remote name");
    await runGit(root, ["remote", "remove", name]);
  });
};
