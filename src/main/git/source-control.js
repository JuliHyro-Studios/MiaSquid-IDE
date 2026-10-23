export function createSourceControlController({ getWorkspaceRoot, getSidebarView, fileTree, showDialog, notify }) {
  function renderGitPanel() {
    const explorerHeading = document.querySelector(".sidebar-heading span");
    const explorerParts = [document.querySelector(".workspace-label"), fileTree, document.querySelector(".explorer-footer")];
    const gitPanel = document.getElementById("git-panel");
    const showGit = getSidebarView() === "git";
    explorerParts.forEach(element => { if (element) element.hidden = showGit; });
    explorerHeading.textContent = showGit ? "SOURCE CONTROL" : "EXPLORER";
    document.querySelector(".explorer-actions").hidden = showGit;
    gitPanel.hidden = !showGit;
    document.querySelectorAll("[data-sidebar]").forEach(button => button.classList.toggle("active", button.dataset.sidebar === getSidebarView()));
  }

  async function refreshGitStatus() {
    if (!getWorkspaceRoot()?.path) {
      document.getElementById("git-branch").textContent = "Open a workspace folder to use source control.";
      document.getElementById("git-changes").replaceChildren();
      document.getElementById("git-init").hidden = true;
      document.getElementById("git-pull").hidden = true;
      document.getElementById("git-push").hidden = true;
      document.getElementById("git-config").hidden = true;
      document.getElementById("git-add-remote").hidden = true;
      document.getElementById("git-stage-all").hidden = true;
      document.getElementById("git-commit").hidden = true;
      document.getElementById("git-config-summary").replaceChildren();
      document.getElementById("git-remotes").replaceChildren();
      document.getElementById("status-branch").textContent = "⎇ No workspace";
      return;
    }
    try {
      const info = await window.miaSquid.gitInfo(getWorkspaceRoot().path);
      const host = document.getElementById("git-changes");
      host.replaceChildren();
      document.getElementById("git-init").hidden = !info.installed || info.repository;
      document.getElementById("git-pull").hidden = !info.repository || !info.remotes.length;
      document.getElementById("git-push").hidden = !info.repository || !info.remotes.length;
      document.getElementById("git-config").hidden = !info.installed;
      document.getElementById("git-add-remote").hidden = !info.repository;
      document.getElementById("git-stage-all").hidden = !info.installed || !info.repository;
      document.getElementById("git-commit").hidden = !info.installed || !info.repository;
      if (!info.installed) {
        document.getElementById("git-branch").textContent = "Git is not installed or is not available on PATH.";
        document.getElementById("git-config-summary").textContent = "Install Git and restart MiaSquid IDE to enable source control.";
        document.getElementById("status-branch").textContent = "⎇ Git not installed";
        document.getElementById("git-remotes").replaceChildren();
        return;
      }
      if (!info.repository) {
        document.getElementById("git-branch").textContent = `Git ${info.version} is available. This folder is not a repository.`;
        const global = info.config.global || {};
        document.getElementById("git-config-summary").textContent =
          `Global Git identity: ${global["user.name"] || "name not set"} <${global["user.email"] || "email not set"}>`;
        document.getElementById("git-remotes").replaceChildren();
        document.getElementById("git-changes-count").textContent = "0";
        document.getElementById("status-branch").textContent = "⎇ No repository";
        return;
      }
      const branch = info.branch || "detached HEAD";
      const sync = info.upstream
        ? ` · ↑${info.ahead ?? 0} ↓${info.behind ?? 0}`
        : " · no upstream";
      document.getElementById("git-branch").textContent = `Git ${info.version} · ⎇ ${branch}${sync}`;
      document.getElementById("status-branch").textContent = `⎇ ${branch.split("...")[0] || "detached"}`;
      const remotes = document.getElementById("git-remotes");
      remotes.replaceChildren();
      for (const remote of info.remotes) {
        const row = document.createElement("div");
        row.className = "git-remote";
        const detail = document.createElement("span");
        detail.textContent = `${remote.name}  ${remote.url}`;
        const remove = document.createElement("button");
        remove.textContent = "×";
        remove.title = `Remove ${remote.name}`;
        remove.addEventListener("click", async () => {
          if (!await showDialog({ title: "Remove Git Remote", message: `Remove remote "${remote.name}"?`, actions: ["Cancel", "Remove"] })) return;
          try {
            await window.miaSquid.gitRemoteRemove(getWorkspaceRoot().path, remote.name);
            await refreshGitStatus();
          } catch (error) {
            console.error("Unable to remove Git remote", error);
            notify("Git remote could not be removed", error.message, "error");
          }
        });
        row.append(detail, remove);
        remotes.append(row);
      }
      const local = info.config.local || {};
      const global = info.config.global || {};
      const configSummary = document.getElementById("git-config-summary");
      configSummary.textContent = `Local: ${local["user.name"] || "name not set"} <${local["user.email"] || "email not set"}> · Global: ${global["user.name"] || "name not set"} <${global["user.email"] || "email not set"}>`;
      const entries = info.status.trimEnd().split(/\r?\n/);
      entries.shift();
      document.getElementById("git-changes-count").textContent = String(entries.filter(Boolean).length);
      for (const line of entries.filter(Boolean)) {
        const staged = line[0] !== " " && line[0] !== "?";
        const file = line.slice(3).replace(/^"(.*)"$/, "$1");
        const row = document.createElement("div");
        row.className = "git-entry";
        const name = document.createElement("span");
        name.className = "git-entry-name";
        name.textContent = `${line.slice(0, 2)} ${file}`;
        const button = document.createElement("button");
        button.textContent = staged ? "Unstage" : "Stage";
        button.addEventListener("click", async () => {
          try {
            await window.miaSquid.gitStage(getWorkspaceRoot().path, [file], !staged);
            await refreshGitStatus();
          } catch (error) {
            console.error("Unable to update Git staging", error);
            notify("Git action failed", error.message, "error");
          }
        });
        row.append(name, button);
        host.append(row);
      }
      if (!host.childElementCount) host.textContent = "No changes.";
    } catch (error) {
      console.error("Unable to read Git status", error);
      document.getElementById("git-branch").textContent = "Git status unavailable";
      document.getElementById("git-changes").textContent = error.message;
      document.getElementById("git-init").hidden = true;
      document.getElementById("git-pull").hidden = true;
      document.getElementById("git-push").hidden = true;
      document.getElementById("git-config").hidden = true;
      document.getElementById("git-add-remote").hidden = true;
      document.getElementById("git-stage-all").hidden = true;
      document.getElementById("git-commit").hidden = true;
      document.getElementById("status-branch").textContent = "⎇ Git unavailable";
    }
  }

  async function syncGit(direction) {
    const info = getWorkspaceRoot()?.path ? await window.miaSquid.gitInfo(getWorkspaceRoot().path) : null;
    if (!info?.repository) {
      notify("Source Control", info?.installed ? "Initialize a Git repository first." : "Git is unavailable.", "warning");
      return;
    }
    if (!info.remotes.length) {
      notify("Source Control", "Add a remote before pushing or pulling.", "warning");
      return;
    }
    let remote = info.remotes[0].name;
    if (info.remotes.length > 1) {
      const selected = await showDialog({
        title: direction === "push" ? "Push" : "Pull",
        message: `Available remotes: ${info.remotes.map(item => item.name).join(", ")}`,
        label: "Remote name",
        value: remote
      });
      if (selected === null) return;
      remote = selected.trim();
    }
    const accepted = await showDialog({
      title: `Git ${direction}`,
      message: direction === "pull"
        ? `Pull from ${remote} using fast-forward only?`
        : `Push branch ${info.branch || "(detached)"} to ${remote}?`,
      actions: ["Cancel", direction === "pull" ? "Pull" : "Push"]
    });
    if (!accepted) return;
    await window.miaSquid.gitSync(getWorkspaceRoot().path, direction, remote);
    notify(`Git ${direction} complete`, `${direction === "pull" ? "Pulled from" : "Pushed to"} ${remote}.`, "success");
    await refreshGitStatus();
  }

  async function configureGit() {
    if (!getWorkspaceRoot()?.path) return;
    const info = await window.miaSquid.gitInfo(getWorkspaceRoot().path);
    if (!info.installed) {
      notify("Git configuration", "Git must be installed and available on PATH.", "warning");
      return;
    }
    const scope = await showDialog({
      title: "Git Configuration Scope",
      message: "Choose which Git configuration to edit.",
      actions: info.repository ? ["Cancel", "Workspace", "Global"] : ["Cancel", "Global"]
    });
    if (!scope) return;
    const target = scope === "Global" ? "global" : "local";
    const values = info.config[target] || {};
    const name = await showDialog({ title: `${scope} Git Identity`, label: "user.name", value: values["user.name"] || "" });
    if (name === null) return;
    const email = await showDialog({ title: `${scope} Git Identity`, label: "user.email", value: values["user.email"] || "" });
    if (email === null) return;
    await window.miaSquid.gitConfigSet(getWorkspaceRoot().path, target, "user.name", name.trim());
    await window.miaSquid.gitConfigSet(getWorkspaceRoot().path, target, "user.email", email.trim());
    notify("Git configuration saved", `Updated ${scope} user.name and user.email.`, "success");
    await refreshGitStatus();
  }
  return { renderGitPanel, refreshGitStatus, syncGit, configureGit };
}
