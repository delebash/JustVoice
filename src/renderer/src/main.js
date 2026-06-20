// SPDX-License-Identifier: GPL-3.0-or-later
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import ConnectionError from "./components/ConnectionError.vue";
import DictateWindow from "./components/DictateWindow.vue";
import { tooltipDirective } from "./services/tooltip.js";
import { checkServer } from "./services/connection.js";
import { bootPrefs, ensureActiveProjectDefault } from "./services/prefs.js";
import { i18n } from "./i18n/index.js";
import "./styles.css";

function isDictateView() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("view") === "dictate";
}

async function boot() {
  // The dictate window runs in a separate Tauri webview that must skip the
  // main shell + server bootstrap (the main window owns those) and render
  // only the floating recording pill. URL?view=dictate triggers this branch.
  if (isDictateView()) {
    const app = createApp(DictateWindow);
    app.use(createPinia());
    app.mount("#app");
    return;
  }

  // Thin-client guard: all data lives in the server. If it's unreachable, mount
  // a connection-error screen instead of booting the app with empty/default
  // state (which looks broken and silently fails to save).
  if (!(await checkServer())) {
    createApp(ConnectionError).mount("#app");
    return;
  }

  // Pull renderer prefs (appearance, hidden voices, …) off the server into a
  // reactive cache BEFORE mount so views read populated data synchronously.
  await bootPrefs();
  // If no project is "open" yet, default the active slot to the most-recent so
  // the kind-driven sidebar is consistent from the first paint (not just after
  // you click into a project). Server-derived; no localStorage.
  await ensureActiveProjectDefault();

  const app = createApp(App);
  app.use(createPinia());
  app.use(i18n);
  app.directive("tooltip", tooltipDirective);
  app.mount("#app");
}

boot();
