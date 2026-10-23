(() => {
  function create(host, { onCommand }) {
    const terminal = new window.Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "Cascadia Code, Consolas, monospace",
      fontSize: 13,
      scrollback: 5000,
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        cursor: "#69b9ff",
        selectionBackground: "#264f78"
      }
    });
    const fit = new window.FitAddon.FitAddon();
    let line = "";

    terminal.loadAddon(fit);
    terminal.open(host);

    const fitTerminal = () => {
      if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit();
    };
    const observer = new ResizeObserver(fitTerminal);
    observer.observe(host);
    fitTerminal();

    const input = terminal.onData(data => {
      for (const character of data) {
        if (character === "\r") {
          terminal.write("\r\n");
          onCommand(line);
          line = "";
        } else if (character === "\u0003") {
          terminal.write("^C\r\n");
          line = "";
        } else if (character === "\u007f" || character === "\b") {
          if (line.length) {
            line = line.slice(0, -1);
            terminal.write("\b \b");
          }
        } else if (character === "\t") {
          line += "  ";
          terminal.write("  ");
        } else if (character >= " ") {
          line += character;
          terminal.write(character);
        }
      }
    });

    host.addEventListener("mousedown", terminal.focus);
    return {
      terminal,
      dispose() {
        observer.disconnect();
        input.dispose();
        host.removeEventListener("mousedown", terminal.focus);
        terminal.dispose();
      },
      focus: () => terminal.focus(),
      write: data => terminal.write(data)
    };
  }

  window.MiaTerminalView = Object.freeze({ create });
})();
