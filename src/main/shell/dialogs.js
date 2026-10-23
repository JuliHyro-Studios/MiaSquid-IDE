export function createDialogController({ onEditorFocus }) {
  const overlay = document.getElementById("dialog-overlay");
  const form = document.getElementById("dialog-form");
  let resolveDialog = null;

  function finish(result) {
    overlay.hidden = true;
    const resolve = resolveDialog;
    resolveDialog = null;
    resolve?.(result);
  }

  function show({ title, message = "", label = "", value = "", actions = ["Cancel", "OK"] }) {
    document.getElementById("dialog-title").textContent = title;
    document.getElementById("dialog-message").textContent = message;
    const inputLabel = document.getElementById("dialog-label");
    const input = document.getElementById("dialog-input");
    inputLabel.hidden = !label;
    inputLabel.querySelector("span").textContent = label;
    input.value = value;
    const actionHost = document.getElementById("dialog-actions");
    actionHost.replaceChildren();
    overlay.hidden = false;
    return new Promise(resolve => {
      resolveDialog = resolve;
      actions.forEach((action, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = action;
        if (index === actions.length - 1) button.classList.add("primary");
        button.addEventListener("click", () => finish(index === 0 ? null : (label ? input.value : action)));
        actionHost.append(button);
      });
      requestAnimationFrame(() => label ? input.focus() : actionHost.lastElementChild?.focus());
    });
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    finish(document.getElementById("dialog-input").value);
  });
  overlay.addEventListener("click", event => {
    if (event.target === overlay) finish(null);
  });
  document.addEventListener("keydown", event => {
    if (!overlay.hidden && event.key === "Escape") finish(null);
  });
  document.addEventListener("focusin", event => {
    if (event.target instanceof HTMLTextAreaElement && event.target.classList.contains("editor-textarea")) {
      onEditorFocus(event.target);
    }
  });

  return { show, finish, overlay, get isOpen() { return !overlay.hidden; } };
}
