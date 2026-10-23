export function createNotificationsController() {
  const panel = document.getElementById("notification-panel");
  const items = [];

  function render() {
    document.getElementById("notification-count").textContent = items.length ? String(items.length) : "";
    panel.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = "Notifications";
    panel.append(heading);
    for (const item of items) {
      const card = document.createElement("article");
      card.className = `notification-card ${item.severity}`;
      const title = document.createElement("strong");
      title.textContent = item.title;
      const message = document.createElement("p");
      message.textContent = item.message;
      card.append(title, message);
      const actions = document.createElement("div");
      actions.className = "notification-actions";
      for (const action of item.actions) {
        const button = document.createElement("button");
        button.textContent = action.label;
        button.addEventListener("click", async () => {
          try {
            await action.run();
            items.splice(items.indexOf(item), 1);
            render();
          } catch (error) {
            console.error("Notification action failed", error);
            notify("Notification action failed", error.message, "error");
          }
        });
        actions.append(button);
      }
      const dismiss = document.createElement("button");
      dismiss.textContent = "Dismiss";
      dismiss.addEventListener("click", () => {
        items.splice(items.indexOf(item), 1);
        render();
      });
      actions.append(dismiss);
      card.append(actions);
      panel.append(card);
    }
    if (!items.length) {
      const empty = document.createElement("p");
      empty.textContent = "No notifications.";
      panel.append(empty);
    }
  }

  function notify(title, message, severity = "info", actions = []) {
    if (typeof title !== "string" || typeof message !== "string" ||
        !["info", "success", "warning", "error"].includes(severity) ||
        !Array.isArray(actions) || actions.some(action =>
          !action || typeof action.label !== "string" || typeof action.run !== "function")) {
      throw new TypeError("Invalid notification");
    }
    const id = crypto.randomUUID();
    items.unshift({ id, title, message, severity, actions });
    if (items.length > 50) items.pop();
    render();
    return id;
  }

  window.miaSquidNotifications = Object.freeze({
    show: (title, message, options = {}) => notify(title, message, options.severity || "info", options.actions || []),
    request: (title, message, actions) => notify(title, message, "warning", actions),
    dismiss: id => {
      const index = items.findIndex(item => item.id === id);
      if (index >= 0) items.splice(index, 1);
      render();
    },
    clear: () => {
      items.length = 0;
      render();
    }
  });

  return { notify, render, panel };
}
