import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import DictateWindow from "./components/DictateWindow.vue";
import { tooltipDirective } from "./services/tooltip.js";
import { bootStorage } from "./services/storage.js";
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

  // Main shell — hydrate persistent UI state from IDB BEFORE Pinia stores
  // read from it. bootStorage() is idempotent — safe to call multiple times.
  await bootStorage();

  const app = createApp(App);
  app.use(createPinia());
  app.use(i18n);
  app.directive("tooltip", tooltipDirective);
  app.mount("#app");
}

boot();
