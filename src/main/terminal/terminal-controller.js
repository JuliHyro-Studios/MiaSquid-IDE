export function createTerminalController({ docking, getWorkspacePath, getSettings = () => ({ keybindings: {} }), closeMenus, positionMenu }) {
  const terminalSessions = new Map();
  const terminalViews = new Map();
  const earlyTerminalEvents = new Map();
  const terminalMenu = document.getElementById("terminal-menu");
  const terminalButton = document.querySelector('[data-menu="terminal"]');
  let activeTerminalId = null;
  let splitTerminalIds = null;

  function queueTerminalEvent(id, event) {
    const session = terminalSessions.get(id);
    if (!session) {
      const events = earlyTerminalEvents.get(id) || [];
      events.push(event);
      earlyTerminalEvents.set(id, events);
      return;
    }
    if (event.type === "data") {
      session.output = (session.output + event.data).slice(-200000);
      terminalViews.get(id)?.write(event.data);
    } else if (event.type === "error") {
      const output = `\r\nTerminal error: ${event.message}\r\n`;
      session.output = (session.output + output).slice(-200000);
      terminalViews.get(id)?.write(output);
    } else if (event.type === "exit") {
      session.exited = true;
      const output = `\r\n[Shell exited${event.code === null ? ` (${event.signal || "unknown signal"})` : ` with code ${event.code}`}]\r\n`;
      session.output = (session.output + output).slice(-200000);
      terminalViews.get(id)?.write(output);
      renderTerminalViews();
    }
  }

  window.miaSquid.onTerminalData((id, data) => queueTerminalEvent(id, { type: "data", data }));
  window.miaSquid.onTerminalError((id, message) => queueTerminalEvent(id, { type: "error", message }));
  window.miaSquid.onTerminalExit((id, code, signal) => queueTerminalEvent(id, { type: "exit", code, signal }));

  function disposeTerminalViews() {
    for (const view of terminalViews.values()) view.dispose();
    terminalViews.clear();
  }

  window.addEventListener("miasquid:terminals-unmount", disposeTerminalViews);
  window.addEventListener("miasquid:terminals-mount", renderTerminalViews);

  function renderTerminalViews() {
    disposeTerminalViews();
    document.querySelectorAll(".terminal-view").forEach(container => {
      container.replaceChildren();
      const toolbar = document.createElement("div");
      toolbar.className = "terminal-toolbar";
      const tabs = document.createElement("div");
      tabs.className = "terminal-session-tabs";
      for (const session of terminalSessions.values()) {
        const tab = document.createElement("button");
        tab.className = "terminal-session-tab" + (session.id === activeTerminalId ? " active" : "");
        tab.textContent = `${session.title} ${session.exited ? "(exited)" : ""}`;
        tab.title = session.cwd;
        tab.addEventListener("click", () => {
          activeTerminalId = session.id;
          splitTerminalIds = null;
          renderTerminalViews();
        });
        tabs.append(tab);
      }
      toolbar.append(tabs);
      for (const [label, title, action] of [
        ["＋", "New Terminal", "new-terminal"],
        ["▥", "Split Terminal", "split-terminal"],
        ["×", "Kill Terminal", "kill-terminal"]
      ]) {
        const button = document.createElement("button");
        button.className = "terminal-toolbar-button";
        button.type = "button";
        button.title = title;
        button.textContent = label;
        button.dataset.terminalAction = action;
        toolbar.append(button);
      }

      const grid = document.createElement("div");
      grid.className = "terminal-grid";
      const visibleIds = splitTerminalIds || (activeTerminalId ? [activeTerminalId] : []);
      for (const id of visibleIds) {
        const session = terminalSessions.get(id);
        if (!session) continue;
        const pane = document.createElement("section");
        pane.className = "terminal-pane";
        const host = document.createElement("div");
        host.className = "terminal-xterm";
        pane.append(host);
        grid.append(pane);
        const view = window.MiaTerminalView.create(host, {
          onCommand: line => {
            if (!session.exited) window.miaSquid.writeTerminal(id, line + "\n");
          }
        });
        terminalViews.set(id, view);
        if (session.output) view.write(session.output);
        if (id === activeTerminalId) view.focus();
      }
      if (!visibleIds.length) {
        const empty = document.createElement("div");
        empty.className = "terminal-empty";
        empty.textContent = "Use Terminal → New Terminal to start a shell.";
        grid.append(empty);
      }
      container.append(toolbar, grid);
    });
  }

  async function createTerminal(split = false) {
    const previousId = activeTerminalId;
    const session = await window.miaSquid.createTerminal(getWorkspacePath());
    session.title = `${session.shell} ${terminalSessions.size + 1}`;
    session.output = "";
    session.exited = false;
    terminalSessions.set(session.id, session);
    for (const queued of earlyTerminalEvents.get(session.id) || []) queueTerminalEvent(session.id, queued);
    earlyTerminalEvents.delete(session.id);
    activeTerminalId = session.id;
    splitTerminalIds = split && previousId ? [previousId, session.id] : null;
    document.getElementById("bottom-panel-host").hidden = false;
    docking.addPanel("terminal");
    const terminalLeaf = docking.leafFor("terminal");
    if (terminalLeaf && terminalLeaf.active !== "terminal") {
      terminalLeaf.active = "terminal";
      docking.save();
      docking.render();
    } else {
      renderTerminalViews();
    }
  }

  function changeDirectory(directory) {
    const session = terminalSessions.get(activeTerminalId);
    if (!session || session.exited) return;
    const command = window.navigator.platform.startsWith("Win")
      ? `Set-Location -LiteralPath '${directory.replace(/'/g, "''")}'`
      : `cd -- '${directory.replace(/'/g, "'\\''")}'`;
    window.miaSquid.writeTerminal(session.id, command + "\n");
    session.cwd = directory;
  }

  function closeActiveTerminal() {
    if (!activeTerminalId) return;
    const session = terminalSessions.get(activeTerminalId);
    if (session) {
      window.miaSquid.closeTerminal(session.id);
      terminalSessions.delete(session.id);
    }
    terminalViews.get(activeTerminalId)?.dispose();
    terminalViews.delete(activeTerminalId);
    splitTerminalIds = splitTerminalIds?.filter(id => id !== activeTerminalId) || null;
    activeTerminalId = splitTerminalIds?.[0] || [...terminalSessions.keys()].at(-1) || null;
    if (splitTerminalIds?.length !== 2) splitTerminalIds = null;
    if (!terminalSessions.size) {
      activeTerminalId = null;
      splitTerminalIds = null;
      docking.removePanel("terminal");
      return;
    }
    renderTerminalViews();
  }

  function openMenu() {
    closeMenus();
    terminalMenu.replaceChildren();
    for (const [action, command, label] of [
      ["new-terminal", "terminal.new", "New Terminal"],
      ["split-terminal", "terminal.split", "Split Terminal"],
      ["new-terminal-window", "terminal.newWindow", "New Terminal Window"]
    ]) {
      const button = document.createElement("button");
      button.className = "menu-item has-submenu";
      button.dataset.terminalAction = action;
      const title = document.createElement("span");
      title.textContent = label;
      const shortcut = document.createElement("span");
      shortcut.className = "submenu-arrow";
      shortcut.textContent = getSettings().keybindings?.[command] || "";
      button.append(title, shortcut);
      terminalMenu.append(button);
    }
    terminalMenu.hidden = false;
    terminalButton.setAttribute("aria-expanded", "true");
    terminalButton.classList.add("active");
    positionMenu(terminalMenu, terminalButton);
  }

  return {
    terminalMenu,
    terminalButton,
    createTerminal,
    splitTerminal: () => createTerminal(true),
    changeDirectory,
    closeActiveTerminal,
    openMenu
  };
}
