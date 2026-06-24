// SPDX-License-Identifier: GPL-3.0-or-later
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import DictateWindow from "./components/DictateWindow.vue";
import { tooltipDirective, configureHelp, ConnectionError } from "@delebash/llm-ui";
import { SERVER_URL } from "./config.js";
import { checkServer } from "./services/connection.js";
import { bootPrefs, ensureActiveProjectDefault } from "./services/prefs.js";
import { loadDoc, hasDoc, titleForSlug } from "./services/helpDocs.js";
import { i18n } from "./i18n/index.js";
import router from "./router/index.js";
import "./tokens.css";
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
    createApp(ConnectionError, {
      appName: "JustVoice",
      serverUrl: SERVER_URL,
      need: "load voices, projects, and settings",
      devHint:
        "Dev: it should start automatically with `npm run tauri dev`, or run it yourself with `npm run server`, then retry.",
    }).mount("#app");
    return;
  }

  // Pull renderer prefs (appearance, hidden voices, …) off the server into a
  // reactive cache BEFORE mount so views read populated data synchronously.
  await bootPrefs();
  // If no project is "open" yet, default the active slot to the most-recent so
  // the kind-driven sidebar is consistent from the first paint (not just after
  // you click into a project). Server-derived; no localStorage.
  await ensureActiveProjectDefault();

  // Wire the shared Help drawer (kit-owned) to JustVoice's docs/*.md corpus —
  // the host supplies the content adapter. No full-pane reader / public docs
  // site yet, so onOpenFull / onOpenWeb are omitted (footer buttons stay hidden).
  configureHelp({ loadDoc, hasDoc, titleForSlug });

  const app = createApp(App);
  app.use(createPinia());
  app.use(router);
  app.use(i18n);
  app.directive("tooltip", tooltipDirective);
  // Resolve the initial (lazy) route before mount so the first paint is the
  // real view, not an empty router-view.
  await router.isReady();
  app.mount("#app");
}

boot();
