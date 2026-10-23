export function createSettingsController({ getSettings, setSettings, updateStatus, notify }) {
  const overlay = document.getElementById("settings-overlay");
  const tree = document.getElementById("settings-tree");
  const content = document.getElementById("settings-page-controls");
  const keybindings = document.getElementById("settings-keybindings");
  let catalog = null;
  let currentPageId = "general";
  let currentPage = null;
  const pageCache = new Map();

  function close() {
    overlay.hidden = true;
  }

  function readSetting(settings, key) {
    return key.split(".").reduce((value, part) => value?.[part], settings);
  }

  function writeSetting(settings, key, value) {
    const updated = structuredClone(settings);
    const [section, ...propertyParts] = key.split(".");
    if (!propertyParts.length) {
      updated[section] = value;
      return updated;
    }
    updated[section][propertyParts.join(".")] = value;
    return updated;
  }

  function markdown(container, source) {
    container.replaceChildren();
    let list = null;
    let code = null;
    for (const line of source.split(/\r?\n/)) {
      if (line.startsWith("```")) {
        if (code) {
          container.append(code);
          code = null;
        } else {
          code = document.createElement("pre");
        }
        list = null;
        continue;
      }
      if (code) {
        code.textContent += `${line}\n`;
        continue;
      }
      const heading = line.match(/^(#{1,4})\s+(.+)$/);
      const item = line.match(/^\s*[-*]\s+(.+)$/);
      if (heading) {
        list = null;
        const element = document.createElement(`h${Math.min(heading[1].length + 2, 6)}`);
        element.textContent = heading[2];
        container.append(element);
      } else if (item) {
        if (!list) {
          list = document.createElement("ul");
          container.append(list);
        }
        const element = document.createElement("li");
        element.textContent = item[1];
        list.append(element);
      } else if (line.trim()) {
        list = null;
        const element = document.createElement("p");
        element.textContent = line;
        container.append(element);
      } else {
        list = null;
      }
    }
    if (code) container.append(code);
  }

  function displayShortcut(event) {
    const modifiers = [];
    if (event.ctrlKey || event.metaKey) modifiers.push("Ctrl");
    if (event.altKey) modifiers.push("Alt");
    if (event.shiftKey) modifiers.push("Shift");
    let key = event.key;
    if (key === " ") key = "Space";
    else if (key === "Escape") return "";
    else if (key.length === 1) key = key.toUpperCase();
    if (["Control", "Alt", "Shift", "Meta"].includes(key)) return null;
    return [...modifiers, key].join("+");
  }

  async function persist(next) {
    await window.miaSquid.writeIdeSettings(next);
    setSettings(next);
    document.body.dataset.theme = next.theme;
    updateStatus();
  }

  async function changeSetting(key, value) {
    try {
      await persist(writeSetting(getSettings(), key, value));
    } catch (error) {
      console.error("Unable to save IDE settings", error);
      notify("Settings could not be saved", error.message, "error");
      await renderPage(currentPageId);
    }
  }

  function renderControls(page) {
    content.replaceChildren();
    keybindings.replaceChildren();
    keybindings.hidden = page.id !== "keybindings";
    for (const setting of page.settings) {
      const row = document.createElement("label");
      row.className = "settings-setting";
      const text = document.createElement("span");
      text.className = "settings-setting-copy";
      const title = document.createElement("strong");
      title.textContent = setting.title;
      const description = document.createElement("small");
      description.textContent = setting.description || "";
      text.append(title, description);
      let input;
      if (setting.type === "boolean") {
        input = document.createElement("input");
        input.type = "checkbox";
        input.checked = Boolean(readSetting(getSettings(), setting.key));
        input.addEventListener("change", () => changeSetting(setting.key, input.checked));
      } else if (setting.type === "select" && Array.isArray(setting.options)) {
        input = document.createElement("select");
        for (const option of setting.options) {
          const item = document.createElement("option");
          item.value = String(option.value);
          item.textContent = option.label;
          input.append(item);
        }
        input.value = String(readSetting(getSettings(), setting.key));
        input.addEventListener("change", () => {
          const selected = setting.options.find(option => String(option.value) === input.value);
          if (selected) changeSetting(setting.key, selected.value);
        });
      } else {
        continue;
      }
      row.append(text, input);
      content.append(row);
    }

    if (page.id === "keybindings") {
      for (const [command, shortcut] of Object.entries(getSettings().keybindings)) {
        const row = document.createElement("label");
        row.className = "settings-setting settings-keybinding";
        const text = document.createElement("span");
        text.className = "settings-setting-copy";
        const title = document.createElement("strong");
        title.textContent = command.split(".").pop().replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, char => char.toUpperCase());
        const description = document.createElement("small");
        description.textContent = command;
        text.append(title, description);
        const input = document.createElement("input");
        input.type = "text";
        input.readOnly = true;
        input.value = shortcut;
        input.title = "Click, then press a shortcut. Escape clears it.";
        input.addEventListener("keydown", event => {
          event.preventDefault();
          event.stopPropagation();
          const value = displayShortcut(event);
          if (value === null) return;
          input.value = value;
          changeSetting(`keybindings.${command}`, value);
        });
        input.addEventListener("focus", () => { input.placeholder = "Press shortcut..."; });
        input.addEventListener("blur", () => { input.placeholder = ""; });
        row.append(text, input);
        keybindings.append(row);
      }
    }
  }

  async function renderPage(pageId) {
    const category = catalog?.categories.find(group => group.pages.includes(pageId));
    if (!category) return;
    const page = pageCache.get(pageId) || await window.miaSquid.loadSettingsPage(pageId);
    pageCache.set(pageId, page);
    currentPageId = pageId;
    currentPage = page;
    document.getElementById("settings-breadcrumb").textContent = `${category.title}  ›  ${page.title}`;
    document.getElementById("settings-page-title").textContent = page.title;
    markdown(document.getElementById("settings-page-description"), page.markdown);
    renderControls(page);
    if (page.id === "cache") {
      const stats = await window.miaSquid.analysisCacheStats();
      const summary = document.createElement("p");
      summary.className = "settings-cache-stats";
      summary.textContent = `Cache hits: ${stats.hits}   Misses: ${stats.misses}   Saved analyses: ${stats.writes}`;
      content.append(summary);
    }
    renderTree(document.getElementById("settings-search").value);
  }

  function renderTree(filter = "") {
    if (!catalog) return;
    tree.replaceChildren();
    const query = filter.trim().toLocaleLowerCase();
    for (const category of catalog.categories) {
      const pages = category.pages.filter(pageId => {
        const page = pageCache.get(pageId);
        const searchable = `${page?.title || pageId} ${page?.settings?.map(setting =>
          `${setting.title} ${setting.description} ${setting.key}`).join(" ") || ""}`.toLocaleLowerCase();
        return !query || category.title.toLocaleLowerCase().includes(query) || searchable.includes(query);
      });
      if (!pages.length) continue;
      const heading = document.createElement("div");
      heading.className = "settings-tree-category";
      heading.textContent = category.title;
      tree.append(heading);
      for (const pageId of pages) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "settings-tree-item";
        const page = pageCache.get(pageId);
        button.textContent = page?.title || (pageId === "keybindings" ? "Keyboard Shortcuts" : pageId[0].toUpperCase() + pageId.slice(1));
        button.classList.toggle("active", pageId === currentPageId);
        button.addEventListener("click", () => renderPage(pageId).catch(error => {
          console.error("Unable to load settings page", error);
          notify("Settings page unavailable", error.message, "error");
        }));
        tree.append(button);
      }
    }
  }

  async function open() {
    try {
      catalog = await window.miaSquid.loadSettingsCatalog();
      const pageIds = catalog.categories.flatMap(category => category.pages);
      await Promise.all(pageIds.map(async pageId => {
        if (!pageCache.has(pageId)) pageCache.set(pageId, await window.miaSquid.loadSettingsPage(pageId));
      }));
      overlay.hidden = false;
      await renderPage(currentPageId);
      document.getElementById("settings-search").focus();
      const paths = await window.miaSquid.ideDataPaths();
      document.getElementById("settings-storage-path").textContent =
        `Settings: ${paths.settings}\nCache: ${paths.cacheDirectories.join(", ")}`;
    } catch (error) {
      console.error("Unable to open IDE settings", error);
      notify("Settings unavailable", error.message, "error");
    }
  }

  document.getElementById("settings-close").addEventListener("click", close);
  document.getElementById("settings-done").addEventListener("click", close);
  document.getElementById("settings-search").addEventListener("input", event => renderTree(event.target.value));
  overlay.addEventListener("click", event => {
    if (event.target === overlay) close();
  });

  return { open, close, persist };
}
