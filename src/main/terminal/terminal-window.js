(async () => {
  let session;
  let terminalView;
  const pendingOutput = [];
  const host = document.getElementById("standalone-terminal-view");
  const query = new URLSearchParams(window.location.search);
  const cwd = query.get("cwd") || undefined;
  const removeDataListener = window.miaSquid.onTerminalData((id, data) => {
    if (!session) pendingOutput.push({ id, data });
    else if (session.id === id) terminalView?.write(data);
  });
  const removeErrorListener = window.miaSquid.onTerminalError((id, message) => {
    if (!session) pendingOutput.push({ id, data: `\r\nTerminal error: ${message}\r\n` });
    else if (session.id === id) terminalView?.write(`\r\nTerminal error: ${message}\r\n`);
  });
  const removeExitListener = window.miaSquid.onTerminalExit((id, code) => {
    if (!session) pendingOutput.push({ id, data: `\r\n[Shell exited with code ${code}]\r\n` });
    else if (session.id === id) terminalView?.write(`\r\n[Shell exited with code ${code}]\r\n`);
  });

  try {
    session = await window.miaSquid.createTerminal(cwd);
    terminalView = window.MiaTerminalView.create(host, {
      onCommand: line => window.miaSquid.writeTerminal(session.id, line + "\n")
    });
    for (const output of pendingOutput) {
      if (output.id === session.id) terminalView.write(output.data);
    }
    pendingOutput.length = 0;
    document.querySelector(".terminal-titlebar").textContent = `${session.shell} · ${session.cwd}`;
  } catch (error) {
    host.textContent = `Unable to start terminal: ${error.message}`;
  }

  window.addEventListener("beforeunload", () => {
    if (session) window.miaSquid.closeTerminal(session.id);
    terminalView?.dispose();
    removeDataListener();
    removeErrorListener();
    removeExitListener();
  });
})();
