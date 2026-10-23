export function createEditorController({ docking, analyzeDocument, getCompletions, languageForExtension, getWorkspacePath, getSettings, notify, showDialog }) {
      function activeEditor() {
        return lastFocusedEditor?.isConnected
          ? lastFocusedEditor
          : document.querySelector(".editor-textarea");
      }

      function replaceEditorSelection(transform) {
        const area = activeEditor();
        const doc = docking.getActiveDocument();
        if (!area || !doc) return;
        const start = area.selectionStart;
        const end = area.selectionEnd;
        const value = transform(area.value, start, end);
        area.value = value.text;
        area.setSelectionRange(value.start, value.end);
        area.dispatchEvent(new Event("input", { bubbles: true }));
        area.focus();
      }

      async function findInEditor(replace = false) {
        const query = await showDialog({ title: replace ? "Find and Replace" : "Find", label: "Find", value: activeEditor()?.value.slice(activeEditor().selectionStart, activeEditor().selectionEnd) || "" });
        if (query === null || !query) return;
        if (!replace) {
          const area = activeEditor();
          if (!area) return;
          const index = area.value.indexOf(query, area.selectionEnd);
          const match = index >= 0 ? index : area.value.indexOf(query);
          if (match < 0) notify("Find", `No match for "${query}".`);
          else { area.focus(); area.setSelectionRange(match, match + query.length); }
          return;
        }
        const replacement = await showDialog({ title: "Replace", label: "Replace with" });
        if (replacement === null) return;
        replaceEditorSelection((text, start, end) => {
          const index = text.indexOf(query, end);
          const match = index >= 0 ? index : text.indexOf(query);
          if (match < 0) {
            notify("Find", `No match for "${query}".`);
            return { text, start, end };
          }
          return {
            text: text.slice(0, match) + replacement + text.slice(match + query.length),
            start: match,
            end: match + replacement.length
          };
        });
      }

      function toggleLineComment() {
        replaceEditorSelection((text, start, end) => {
          const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
          const lineEndIndex = text.indexOf("\n", end);
          const lineEnd = lineEndIndex < 0 ? text.length : lineEndIndex;
          const lines = text.slice(lineStart, lineEnd).split("\n");
          const prefix = /\.(py|rb|yml|yaml|sh|ps1)$/i.test(docking.getActiveDocument()?.name || "") ? "#" : "//";
          const uncomment = lines.every(line => !line.trim() || line.trimStart().startsWith(prefix));
          const updated = lines.map(line => {
            if (!line.trim()) return line;
            const indentation = line.match(/^\s*/)[0];
            return uncomment
              ? indentation + line.slice(indentation.length).replace(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s?`), "")
              : `${indentation}${prefix} ${line.slice(indentation.length)}`;
          }).join("\n");
          return { text: text.slice(0, lineStart) + updated + text.slice(lineEnd), start: lineStart, end: lineStart + updated.length };
        });
      }

      function moveEditorLine(direction) {
        replaceEditorSelection((text, start, end) => {
          const lines = text.split("\n");
          const lineIndex = text.slice(0, start).split("\n").length - 1;
          const targetIndex = lineIndex + direction;
          if (targetIndex < 0 || targetIndex >= lines.length) return { text, start, end };
          [lines[lineIndex], lines[targetIndex]] = [lines[targetIndex], lines[lineIndex]];
          const lineStart = lines.slice(0, targetIndex).join("\n").length + (targetIndex ? 1 : 0);
          const lineLength = lines[targetIndex].length;
          const offsetStart = start - (text.slice(0, start).lastIndexOf("\n") + 1);
          const offsetEnd = end - (text.slice(0, start).lastIndexOf("\n") + 1);
          const moved = lines.join("\n");
          return {
            text: moved,
            start: lineStart + Math.min(offsetStart, lineLength),
            end: lineStart + Math.min(offsetEnd, lineLength)
          };
        });
      }

      const symbolsByDocument = new Map();
      const analysisByDocument = new Map();
      const analysisTimers = new Map();
      const autoSaveTimers = new Map();
      const analysisGenerations = new Map();
      let nextAnalysisGeneration = 0;
      let completionState = null;
      let lastFocusedEditor = null;

      function clearWorkspaceDocumentState() {
        for (const timer of analysisTimers.values()) clearTimeout(timer);
        for (const timer of autoSaveTimers.values()) clearTimeout(timer);
        analysisTimers.clear();
        autoSaveTimers.clear();
        symbolsByDocument.clear();
        analysisByDocument.clear();
        analysisGenerations.clear();
      }

      function updateOutline(doc) {
        const panel = document.getElementById("outline-content");
        if (!doc) {
          panel.replaceChildren();
          panel.textContent = "Open a file to view its symbols.";
          renderProblems(null);
          return;
        }
        const extension = doc.name.split(".").pop()?.toLowerCase() || "";
        const content = doc.content;
        const workspacePath = getWorkspacePath();
        const workspacePrefix = workspacePath
          ? workspacePath.replace(/[\\/]+$/, "") + (workspacePath.includes("\\") ? "\\" : "/")
          : "";
        const normalizePath = value => window.navigator.platform.startsWith("Win") ? value.toLocaleLowerCase() : value;
        const cacheable = Boolean(workspacePath && doc.path &&
          normalizePath(doc.path).startsWith(normalizePath(workspacePrefix)));
        const localAnalysis = analysisByDocument.get(doc.id);
        if (localAnalysis?.content === content) {
          renderAnalysis(doc, localAnalysis.analysis);
          return;
        }
        const generation = ++nextAnalysisGeneration;
        analysisGenerations.set(doc.id, generation);
        if (cacheable && !doc.dirty) {
          panel.textContent = "Loading cached analysis…";
          window.miaSquid.readAnalysisCache(workspacePath, doc.path, content).then(cached => {
            if (analysisGenerations.get(doc.id) !== generation || doc.content !== content) return;
            const analysis = cached || analyzeDocument(content, extension);
            analysisByDocument.set(doc.id, { content, analysis });
            renderAnalysis(doc, analysis);
            if (!cached) queueAnalysisPersistence(workspacePath, doc, content, analysis);
          }).catch(error => {
            console.error("Unable to read IntelliSense cache", error);
            notify("Analysis cache unavailable", error.message, "warning");
            if (analysisGenerations.get(doc.id) !== generation || doc.content !== content) return;
            const analysis = analyzeDocument(content, extension);
            analysisByDocument.set(doc.id, { content, analysis });
            renderAnalysis(doc, analysis);
            queueAnalysisPersistence(workspacePath, doc, content, analysis);
          });
          return;
        }
        const analysis = analyzeDocument(content, extension);
        analysisByDocument.set(doc.id, { content, analysis });
        renderAnalysis(doc, analysis);
        if (cacheable) queueAnalysisPersistence(workspacePath, doc, content, analysis);
      }

      function renderAnalysis(doc, analysis) {
        const panel = document.getElementById("outline-content");
        const { symbols, diagnostics, completionTokens } = analysis;
        doc.analysis = analysis;
        doc.diagnostics = diagnostics;
        symbolsByDocument.set(doc.id, symbols);
        if (docking.getActiveDocument()?.id !== doc.id) return;
        panel.replaceChildren();
        if (!symbols.length) panel.textContent = "No symbols detected in this file.";
        for (const symbol of symbols) {
          const button = document.createElement("button");
          button.className = "outline-symbol";
          button.textContent = `${symbol.kind}  ${symbol.name}`;
          button.title = `Line ${symbol.line}`;
          button.addEventListener("click", () => {
            const area = activeEditor();
            if (!area) return;
            const index = area.value.split("\n").slice(0, symbol.line - 1).join("\n").length + (symbol.line > 1 ? 1 : 0);
            area.focus();
            area.setSelectionRange(index, index);
            area.scrollTop = (symbol.line - 1) * 20.8;
            area.dispatchEvent(new Event("scroll"));
          });
          panel.append(button);
        }
        renderProblems(doc);
        activeEditor()?.dispatchEvent(new Event("miasquid-analysis"));
      }

      function queueAnalysisPersistence(workspacePath, doc, content, analysis) {
        clearTimeout(analysisTimers.get(doc.id));
        analysisTimers.set(doc.id, setTimeout(() => {
          Promise.all([
            window.miaSquid.analyzeFile(workspacePath, doc.path, {
              symbols: analysis.symbols,
              completionTokens: analysis.completionTokens
            }),
            window.miaSquid.writeAnalysisCache(workspacePath, doc.path, content, analysis)
          ]).catch(error => {
            console.error("Unable to persist IntelliSense analysis", error);
            notify("Analysis could not be cached", error.message, "warning");
          });
        }, 500));
      }

      function renderProblems(doc) {
        const diagnostics = doc?.diagnostics || [];
        document.getElementById("status-problems").textContent = diagnostics.length
          ? `　⚠ ${diagnostics.length} issue${diagnostics.length === 1 ? "" : "s"}`
          : "　✓ No problems";
        document.querySelector('[data-bottom-tab="problems"] small').textContent = String(diagnostics.length);
        if (document.querySelector('[data-bottom-tab].active')?.dataset.bottomTab !== "problems") return;
        const host = document.getElementById("terminal-content");
        host.replaceChildren();
        if (!diagnostics.length) {
          const empty = document.createElement("p");
          empty.className = "terminal-muted";
          empty.textContent = "No syntax balance issues detected.";
          host.append(empty);
          return;
        }
        for (const diagnostic of diagnostics) {
          const item = document.createElement("button");
          item.className = `diagnostic-item ${diagnostic.severity}`;
          item.textContent = `${doc.name} (${diagnostic.line},${diagnostic.column}) · ${diagnostic.message}`;
          item.addEventListener("click", () => {
            const area = activeEditor();
            if (!area) return;
            const start = area.value.split(/\r?\n/).slice(0, diagnostic.line - 1).join("\n").length +
              (diagnostic.line > 1 ? 1 : 0) + diagnostic.column - 1;
            area.focus();
            area.setSelectionRange(start, start);
            area.dispatchEvent(new Event("miasquid-analysis"));
          });
          host.append(item);
        }
      }

      function updateStatus(area = activeEditor()) {
        const doc = docking.getActiveDocument();
        if (!area || !doc) {
          document.getElementById("status-position").textContent = "Ln 1, Col 1";
          document.getElementById("status-indent").textContent =
            `${getSettings().editor.insertSpaces ? "Spaces" : "Tab Size"}: ${getSettings().editor.tabSize}`;
          document.getElementById("status-encoding").textContent = "UTF-8";
          document.getElementById("status-language").textContent = "Plain Text";
          return;
        }
        const before = area.value.slice(0, area.selectionStart).split("\n");
        const extension = doc.name.split(".").pop()?.toLowerCase();
        const languageNames = { js: "JavaScript", mjs: "JavaScript", ts: "TypeScript", tsx: "TypeScript React", jsx: "JavaScript React", py: "Python", html: "HTML", htm: "HTML", css: "CSS", json: "JSON", md: "Markdown", txt: "Plain Text", rs: "Rust", cs: "C#", java: "Java", cpp: "C++", c: "C", go: "Go", sql: "SQL", xml: "XML", ps1: "PowerShell" };
        document.getElementById("status-position").textContent = `Ln ${before.length}, Col ${before.at(-1).length + 1}`;
        document.getElementById("status-language").textContent = languageNames[extension] || extension?.toUpperCase() || "Plain Text";
        const indentation = doc.content.match(/^( +)\S/m)?.[1].length || getSettings().editor.tabSize;
        document.getElementById("status-indent").textContent = `${getSettings().editor.insertSpaces ? "Spaces" : "Tab Size"}: ${indentation}`;
        document.getElementById("status-encoding").textContent = "UTF-8";
      }

      function showCompletions(area) {
        const previous = document.querySelector(".editor-completions");
        previous?.remove();
        completionState = null;
        const start = area.selectionStart;
        const prefixMatch = area.value.slice(0, start).match(/[A-Za-z_$][\w$]*$/);
        const prefix = prefixMatch?.[0] || "";
        if (prefix.length < 2 && !area.dataset.completionRequested) return;
        if (!prefix && !area.dataset.completionRequested) return;
        delete area.dataset.completionRequested;
        const doc = docking.getActiveDocument();
        const ext = doc?.name.split(".").pop()?.toLowerCase();
        const language = languageForExtension(ext);
        const symbols = [...symbolsByDocument.values()].flat();
        const completionTokens = doc?.analysis?.completionTokens;
        const context = area.value.slice(0, start - prefix.length);
        const candidates = getCompletions(area.value, prefix, language, symbols, 16, context, completionTokens);
        if (!candidates.length) return;
        const popup = document.createElement("div");
        popup.className = "editor-completions";
        completionState = { popup, area, start: start - prefix.length, end: start, values: candidates, selected: 0 };
        candidates.forEach((candidate, index) => {
          const button = document.createElement("button");
          button.className = `completion-item${index === 0 ? " active" : ""}`;
          button.innerHTML = `${candidate.replace(/&/g, "&amp;").replace(/</g, "&lt;")}<span class="completion-kind">suggestion</span>`;
          button.addEventListener("mousedown", event => { event.preventDefault(); acceptCompletion(index); });
          popup.append(button);
        });
        document.body.append(popup);
        const rect = area.getBoundingClientRect();
        popup.style.left = `${Math.min(rect.left + 52, innerWidth - 260)}px`;
        popup.style.top = `${Math.min(rect.top + 40, innerHeight - 240)}px`;
      }

      function acceptCompletion(index = completionState?.selected || 0) {
        if (!completionState) return;
        const { area, start, end, values, popup } = completionState;
        const value = values[index];
        area.setRangeText(value, start, end, "end");
        area.dispatchEvent(new Event("input", { bubbles: true }));
        area.focus();
        popup.remove();
        completionState = null;
      }
  function bindEvents({ findNode, notify, showDialog, getSettings }) {
    document.addEventListener("input", event => {
      if (!(event.target instanceof HTMLTextAreaElement) || !event.target.classList.contains("editor-textarea")) return;
      const doc = docking.getActiveDocument();
      if (doc) {
        doc.content = event.target.value;
        docking.setDocumentDirty(doc.id, true);
        document.querySelectorAll(".editor-textarea").forEach(area => {
          if (area !== event.target && area.dataset.docId === doc.id) {
            area.value = event.target.value;
            area.dispatchEvent(new Event("input"));
          }
        });
        const node = findNode(doc.id);
        if (node) node.content = doc.content;
        updateOutline(doc);
        if (getSettings().files.autoSave && doc.path) {
          clearTimeout(autoSaveTimers.get(doc.id));
          autoSaveTimers.set(doc.id, setTimeout(() => {
            window.miaSquid.writeFile(doc.path, doc.content).then(() => {
              docking.setDocumentDirty(doc.id, false);
            }).catch(error => {
              console.error("Auto Save failed", error);
              notify(`Auto Save failed: ${doc.name}`, error.message, "error");
            });
          }, 800));
        }
      }
      updateStatus(event.target);
      showCompletions(event.target);
    });
    document.addEventListener("keyup", () => updateStatus());
    document.addEventListener("click", event => {
      if (event.target instanceof HTMLTextAreaElement && event.target.classList.contains("editor-textarea")) updateStatus();
    });
    window.addEventListener("miasquid:active-document", () => {
      completionState?.popup.remove();
      completionState = null;
      updateOutline(docking.getActiveDocument());
      updateStatus();
    });
    window.addEventListener("miasquid:confirm-close", async event => {
      event.detail.resolve(await showDialog({
        title: "Close Unsaved File",
        message: `Discard unsaved changes to "${event.detail.name}"?`,
        actions: ["Cancel", "Discard"]
      }));
    });
  }

  function handleCompletionKey(event, area) {
    if (!completionState || area !== completionState.area) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      completionState.selected = (completionState.selected + delta + completionState.values.length) % completionState.values.length;
      completionState.popup.querySelectorAll(".completion-item").forEach((item, index) =>
        item.classList.toggle("active", index === completionState.selected));
      return true;
    }
    if (event.key === "Tab" || event.key === "Enter") {
      event.preventDefault();
      acceptCompletion();
      return true;
    }
    if (event.key === "Escape") {
      completionState.popup.remove();
      completionState = null;
      return true;
    }
    return false;
  }

  function setLastFocused(editor) {
    lastFocusedEditor = editor;
  }

  return {
    activeEditor, replaceEditorSelection, findInEditor, toggleLineComment, moveEditorLine,
    clearWorkspaceDocumentState, updateOutline, renderProblems, updateStatus,
    showCompletions, handleCompletionKey, setLastFocused, symbolsByDocument, bindEvents
  };
}
