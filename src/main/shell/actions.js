export function createActionDispatcher({ workspace, sourceControl, terminal, docking, showDialog, notify, getSettings, workspaceState, clearDocumentState, updateOutline, analyzeDocument, symbolsByDocument, activeEditor, findInEditor, toggleLineComment, replaceEditorSelection, moveEditorLine, settings, renderAppearanceMenu, openAppearanceMenu, viewMenu }) {
  function collapseFolders(node) {
    if (node.type !== "folder") return;
    node.expanded = false;
    for (const child of node.children) collapseFolders(child);
  }

  async function runAction(action) {
          switch (action) {
            case "new-file": await workspace.makeNewNode("file"); break;
            case "new-folder": await workspace.makeNewNode("folder"); break;
            case "open-file": await workspace.openFile(); break;
            case "open-folder": await workspace.openFolder(); break;
            case "open-project-item": await workspace.openProjectItem(); break;
            case "save-workspace": await workspace.saveWorkspace(); break;
            case "save": await workspace.saveActiveDocument(); break;
            case "save-as": await workspace.saveActiveDocumentAs(); break;
            case "save-all": await workspace.saveAllDocuments(); break;
            case "new-window": await window.miaSquid.newWindow(); break;
            case "close-window":
              if (workspace.hasUnsavedChanges() && !await showDialog({
                title: "Close Window",
                message: "There are unsaved changes. Close this window anyway?",
                actions: ["Cancel", "Close Window"]
              })) break;
              window.close();
              break;
            case "exit":
              if (workspace.hasUnsavedChanges() && !await showDialog({
                title: "Exit MiaSquid IDE",
                message: "There are unsaved changes. Exit anyway?",
                actions: ["Cancel", "Exit"]
              })) break;
              await window.miaSquid.quit();
              break;
            case "close-folder":
              if (workspace.hasUnsavedChanges() && !await showDialog({
                title: "Close Folder",
                message: "Discard unsaved workspace changes?",
                actions: ["Cancel", "Close Folder"]
              })) break;
              clearDocumentState();
              docking.closeAllDocuments();
              workspaceState.roots = [];
              workspaceState.workspaceRoot = null;
              workspaceState.selectedNode = null;
              await window.miaSquid.clearLastProject();
              workspace.renderTree();
              sourceControl.renderGitPanel();
              await sourceControl.refreshGitStatus();
              break;
            case "close-editor": document.querySelector(".editor-tab.active .tab-close")?.click(); break;
            case "revert-file": {
              const doc = docking.getActiveDocument();
              if (!doc?.path) { notify("Revert file", "The active document has no saved file to revert.", "warning"); break; }
              const approved = await showDialog({ title: "Revert File", message: `Discard unsaved changes to ${doc.name}?`, actions: ["Cancel", "Revert"] });
              if (!approved) break;
              const content = await window.miaSquid.readFile(doc.path);
              doc.content = content;
              docking.setDocumentDirty(doc.id, false);
              docking.renderActiveDocument();
              updateOutline(doc);
              break;
            }
            case "undo": document.execCommand("undo"); break;
            case "redo": document.execCommand("redo"); break;
            case "cut": document.execCommand("cut"); break;
            case "copy": document.execCommand("copy"); break;
            case "paste": {
              const area = activeEditor();
              if (!area) break;
              const text = await window.miaSquid.readClipboardText();
              area.setRangeText(text, area.selectionStart, area.selectionEnd, "end");
              area.dispatchEvent(new Event("input", { bubbles: true }));
              area.focus();
              break;
            }
            case "find": await findInEditor(false); break;
            case "replace": await findInEditor(true); break;
            case "toggle-comment": toggleLineComment(); break;
            case "format-document":
              replaceEditorSelection((text, start, end) => {
                const formatted = text.split("\n").map(line => line.replace(/[ \t]+$/g, "")).join("\n");
                return { text: formatted, start: Math.min(start, formatted.length), end: Math.min(end, formatted.length) };
              });
              break;
            case "select-all": activeEditor()?.select(); break;
            case "select-line":
              replaceEditorSelection((text, start) => {
                const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
                const nextNewline = text.indexOf("\n", start);
                return { text, start: lineStart, end: nextNewline < 0 ? text.length : nextNewline };
              });
              break;
            case "copy-line-up":
              replaceEditorSelection((text, start) => {
                const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
                const lineEndIndex = text.indexOf("\n", start);
                const lineEnd = lineEndIndex < 0 ? text.length : lineEndIndex;
                const line = text.slice(lineStart, lineEnd);
                const insertion = `${line}\n`;
                return { text: text.slice(0, lineStart) + insertion + text.slice(lineStart), start: start + insertion.length, end: start + insertion.length };
              });
              break;
            case "move-line-up": moveEditorLine(-1); break;
            case "move-line-down": moveEditorLine(1); break;
            case "duplicate-selection":
              replaceEditorSelection((text, start, end) => {
                if (start !== end) {
                  const selected = text.slice(start, end);
                  return { text: text.slice(0, end) + `\n${selected}` + text.slice(end), start: end + 1, end: end + 1 + selected.length };
                }
                const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
                const lineEndIndex = text.indexOf("\n", start);
                const lineEnd = lineEndIndex < 0 ? text.length : lineEndIndex;
                const line = text.slice(lineStart, lineEnd);
                const insertion = `\n${line}`;
                return { text: text.slice(0, lineEnd) + insertion + text.slice(lineEnd), start: lineEnd + 1, end: lineEnd + 1 + line.length };
              });
              break;
            case "go-to-line": {
              const area = activeEditor();
              if (!area) break;
              const value = await showDialog({ title: "Go to Line", label: "Line number" });
              const line = Number.parseInt(value, 10);
              if (!Number.isInteger(line) || line < 1) break;
              const index = area.value.split("\n").slice(0, line - 1).join("\n").length + (line > 1 ? 1 : 0);
              area.focus();
              area.setSelectionRange(index, index);
              area.dispatchEvent(new Event("scroll"));
              break;
            }
            case "go-to-file": {
              const query = await showDialog({ title: "Go to File", label: "File name or path" });
              if (!query) break;
              const match = workspace.flattenNodes().find(node =>
                node.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ||
                node.relativePath.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
              if (match) await workspace.openNode(match);
              else notify("Go to File", `No open workspace item matches "${query}".`);
              break;
            }
            case "go-to-symbol": {
              const doc = docking.getActiveDocument();
              if (!doc) break;
              const symbols = symbolsByDocument.get(doc.id) || analyzeDocument(doc.content, doc.name.split(".").pop()).symbols;
              const query = await showDialog({ title: "Go to Symbol", label: "Symbol name" });
              if (!query) break;
              const symbol = symbols.find(item => item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
              if (!symbol) { notify("Go to Symbol", `No symbol matches "${query}".`); break; }
              const area = activeEditor();
              const index = area.value.split("\n").slice(0, symbol.line - 1).join("\n").length + (symbol.line > 1 ? 1 : 0);
              area.focus();
              area.setSelectionRange(index, index);
              area.scrollTop = (symbol.line - 1) * 20.8;
              area.dispatchEvent(new Event("scroll"));
              break;
            }
            case "toggle-autosave":
              await settings.persist({
                ...getSettings(),
                files: { autoSave: !getSettings().files.autoSave }
              });
              notify("Auto Save", getSettings().files.autoSave ? "Auto Save is on." : "Auto Save is off.");
              break;
            case "preferences": settings.open(); break;
            case "git-refresh": await sourceControl.refreshGitStatus(); break;
            case "git-stage-all":
              if (!workspaceState.workspaceRoot?.path) break;
              await window.miaSquid.gitStage(workspaceState.workspaceRoot.path, ["."], true);
              notify("Git", "All workspace changes staged.", "success");
              await sourceControl.refreshGitStatus();
              break;
            case "git-init": {
              if (!workspaceState.workspaceRoot?.path) break;
              if (!await showDialog({
                title: "Initialize Git Repository",
                message: `Create a repository in ${workspaceState.workspaceRoot.path}?`,
                actions: ["Cancel", "Initialize"]
              })) break;
              await window.miaSquid.gitInit(workspaceState.workspaceRoot.path);
              notify("Git repository initialized", workspaceState.workspaceRoot.path, "success");
              await sourceControl.refreshGitStatus();
              break;
            }
            case "git-push": await sourceControl.syncGit("push"); break;
            case "git-pull": await sourceControl.syncGit("pull"); break;
            case "git-config": await sourceControl.configureGit(); break;
            case "git-add-remote": {
              if (!workspaceState.workspaceRoot?.path) break;
              const name = await showDialog({ title: "Add or Change Git Remote", label: "Remote name", value: "origin" });
              if (name === null || !name.trim()) break;
              const url = await showDialog({ title: `Git Remote ${name.trim()}`, message: "HTTPS or SSH remote URL", label: "Remote URL" });
              if (url === null) break;
              await window.miaSquid.gitRemoteSet(workspaceState.workspaceRoot.path, name.trim(), url.trim());
              notify("Git remote saved", `Remote "${name.trim()}" is configured.`, "success");
              await sourceControl.refreshGitStatus();
              break;
            }
            case "git-commit": {
              if (!workspaceState.workspaceRoot?.path) { notify("Git", "Open a workspace folder first.", "warning"); break; }
              const message = document.getElementById("git-commit-message").value.trim();
              if (!message) { notify("Git", "Enter a commit message.", "warning"); break; }
              await window.miaSquid.gitCommit(workspaceState.workspaceRoot.path, message);
              document.getElementById("git-commit-message").value = "";
              notify("Git commit created", message);
              await sourceControl.refreshGitStatus();
              break;
            }
            case "toggle-outline": {
              const panel = document.getElementById("outline-content");
              panel.hidden = !panel.hidden;
              break;
            }
            case "show-appearance": {
              const anchor = viewMenu.querySelector('[data-action="show-appearance"]');
              openAppearanceMenu(anchor);
              break;
            }
            case "new-terminal": await terminal.createTerminal(); break;
            case "split-terminal": await terminal.splitTerminal(); break;
            case "kill-terminal": terminal.closeActiveTerminal(); break;
            case "new-terminal-window":
              await window.miaSquid.openTerminalWindow(workspaceState.workspaceRoot?.path);
              break;
            case "toggle-terminal": {
              const host = document.getElementById("bottom-panel-host");
              host.hidden = !host.hidden;
              break;
            }
            case "split-editor": docking.splitEditor(); break;
            case "collapse-all":
              for (const node of workspaceState.roots) collapseFolders(node);
              workspace.renderTree();
              break;
            case "open-selected": if (workspaceState.selectedNode) await workspace.openNode(workspaceState.selectedNode); break;
            case "collapse-selected":
              if (workspaceState.selectedNode?.type === "folder") {
                workspaceState.selectedNode.expanded = false;
                workspace.renderTree();
              }
              break;
          }
      }
  return { runAction };
}
