# MiaSquid Docking System

- Recursive split/leaf layout tree (horizontal and vertical splits).
- Draggable panel tabs and drop targets between leaf groups.
- Resizable splitters.
- Layout persistence through local storage.
- `View → Appearance` toggles optional UI components.
- The topbar is locked and intentionally cannot be hidden.

Renderer startup is handled by `src/main/shell/shell.js`; feature controllers are separated by responsibility under `src/main/`: `workspace/` manages Explorer and workspace files, `editor/` owns editing and analysis, `git/` owns Source Control UI, `terminal/` manages terminal sessions, `settings/` persists preferences, `notifications/` manages app notifications, and `shell/` contains dialogs, menus, and action dispatch. Dock layout remains in `docking/`.

The Electron main entrypoint (`main.js`) only composes IPC and application modules. Workspace/filesystem IPC, workspace saving, Git, terminal, and application/window lifecycle are registered in separate files under `src/main/ipc/`. The isolated preload facade at `src/main/preload.js` joins capability APIs from `src/main/preload/` (IDE/workspace, Git, terminal, and window); `contextIsolation` remains enabled and renderer code does not receive direct Node.js access.

Explorer reads the selected folder from disk. Newly created files and folders remain in memory until saved; `Ctrl+S` writes them into the active workspace without another location prompt, or asks for a workspace location when no folder is open. Switching or closing a workspace closes all editor tabs after confirming any unsaved changes. Opening a workspace creates `.miasquid/analysis/` immediately and remembers that workspace for the next launch.

The terminal uses xterm.js to render a real PowerShell process on Windows and the user's configured shell on macOS/Linux. It opens on demand through `Terminal` menu actions, and its panel closes when the last terminal session is closed; new sessions can be created, split, or opened in another window. Sessions start in the opened workspace folder, or in the IDE's launch directory when no folder is open. The shell uses standard input/output pipes, so full-screen terminal applications that require a native PTY are not supported.

The editor includes line numbers, Highlight.js syntax colors, basic indentation, line/comment selection commands, find/replace, and local word/symbol completion (`Ctrl+Space`) with common JavaScript member suggestions. JavaScript files are parsed into a compact Acorn AST; other supported languages use the local declaration and delimiter analyzer. Completion suggestions reuse cached tokens and symbols from open files in the active workspace. For opened files in a workspace, analysis is cached by workspace, file, and exact content under `%APPDATA%/MiaSquid IDE/cache/analysis/` and reused when the content matches. A per-file symbol/token snapshot is also stored under `.miasquid/analysis/`; that internal folder is hidden from Explorer. This is a local analyzer, not a full compiler-backed language server.

The Source Control view detects Git installation and repository state, and supports repository initialization, status, stage/unstage, commit, remotes, local/global user identity, and confirmed fast-forward pull/push. Network synchronization requires a configured remote and is subject to Git credentials and network access. Git errors appear in the notification panel. The status bar reports the active file's cursor, indentation, UTF-8 encoding, and detected language. The activity-bar Settings button and File → Preferences open the same searchable settings tree. IDE preferences and remappable keyboard shortcuts are persisted in `%APPDATA%/MiaSquid IDE/settings.json`; settings pages are loaded from JSON metadata and Markdown content files. Paste reads the OS clipboard through a narrow preload IPC capability and replaces the current editor selection.

Reusable renderer notifications are available through `window.miaSquidNotifications.show(title, message, { severity, actions })`. Each action has a `label` and an async-capable `run` callback. `window.miaSquidNotifications.request(title, message, actions)` presents request-style action buttons; returned notification IDs can be passed to `dismiss(id)`, or `clear()` removes all. Unsupported commands remain disabled in the menus rather than appearing to work.
