const COMMAND_ACTIONS = {
  "workbench.newWindow": "new-window",
  "file.new": "new-file",
  "file.open": "open-file",
  "file.openFolder": "open-folder",
  "file.save": "save",
  "file.saveAs": "save-as",
  "file.saveAll": "save-all",
  "editor.close": "close-editor",
  "editor.undo": "undo",
  "editor.redo": "redo",
  "editor.cut": "cut",
  "editor.copy": "copy",
  "editor.paste": "paste",
  "editor.find": "find",
  "editor.replace": "replace",
  "editor.toggleLineComment": "toggle-comment",
  "editor.selectAll": "select-all",
  "editor.goToLine": "go-to-line",
  "workbench.quickOpen": "go-to-file",
  "editor.goToSymbol": "go-to-symbol",
  "editor.moveLineUp": "move-line-up",
  "editor.moveLineDown": "move-line-down"
};

const EDITOR_COMMANDS = new Set([
  "editor.undo", "editor.redo", "editor.cut", "editor.copy", "editor.paste",
  "editor.triggerSuggest",
  "editor.find", "editor.replace", "editor.toggleLineComment", "editor.selectAll",
  "editor.goToLine", "workbench.quickOpen", "editor.goToSymbol",
  "editor.moveLineUp", "editor.moveLineDown"
]);

function normalizeChord(chord) {
  return chord.split("+").map(part => part.trim().toLocaleLowerCase()).sort((left, right) => {
    const order = ["ctrl", "alt", "shift"];
    const leftIndex = order.indexOf(left);
    const rightIndex = order.indexOf(right);
    if (leftIndex < 0 && rightIndex < 0) return left.localeCompare(right);
    if (leftIndex < 0) return 1;
    if (rightIndex < 0) return -1;
    return leftIndex - rightIndex;
  }).join("+");
}

function eventChord(event) {
  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  let key = event.key;
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
  else if (event.code === "Backquote") key = "`";
  else if (event.code === "Slash") key = "/";
  if (key === " ") key = "Space";
  if (key.length === 1) key = key.toUpperCase();
  if (["Control", "Alt", "Shift", "Meta"].includes(key)) return null;
  parts.push(key);
  return normalizeChord(parts.join("+"));
}

export function createKeybindingController({ getSettings, runAction, terminal, editorController, notify }) {
  let pendingChord = null;
  let pendingTimer = null;

  function runCommand(command) {
    if (command === "terminal.split") return terminal.splitTerminal();
    if (command === "terminal.new") return runAction("new-terminal");
    if (command === "terminal.newWindow") return runAction("new-terminal-window");
    if (command === "editor.triggerSuggest") {
      const editor = editorController.activeEditor();
      if (!editor) return Promise.resolve();
      editor.dataset.completionRequested = "true";
      editorController.showCompletions(editor);
      return Promise.resolve();
    }
    const action = COMMAND_ACTIONS[command];
    if (action) return runAction(action);
    return Promise.resolve();
  }

  function handle(event, editor) {
    if (event.isComposing || event.repeat) return false;
    const target = event.target;
    if (!editor && target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))) return false;
    const chord = eventChord(event);
    if (!chord) return false;

    const bindings = Object.entries(getSettings().keybindings)
      .filter(([, accelerator]) => typeof accelerator === "string" && accelerator.trim())
      .map(([command, accelerator]) => ({
        command,
        chords: accelerator.trim().split(/\s+/).map(normalizeChord)
      }));
    if (pendingChord) {
      const sequence = `${pendingChord} ${chord}`;
      const match = bindings.find(binding => binding.chords.join(" ") === sequence);
      clearTimeout(pendingTimer);
      pendingChord = null;
      if (match) {
        event.preventDefault();
        runCommand(match.command).catch(error => {
          console.error(`Keyboard command failed: ${match.command}`, error);
          notify("Keyboard shortcut failed", error.message, "error");
        });
        return true;
      }
    }

    const matching = bindings.filter(binding => binding.chords[0] === chord);
    const binding = matching.find(candidate => candidate.chords.length === 1);
    if (binding && (!EDITOR_COMMANDS.has(binding.command) || editor)) {
      event.preventDefault();
      runCommand(binding.command).catch(error => {
        console.error(`Keyboard command failed: ${binding.command}`, error);
        notify("Keyboard shortcut failed", error.message, "error");
      });
      return true;
    }
    if (matching.some(candidate => candidate.chords.length > 1)) {
      event.preventDefault();
      pendingChord = chord;
      clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => { pendingChord = null; }, 1200);
      return true;
    }
    return false;
  }

  return { handle };
}
