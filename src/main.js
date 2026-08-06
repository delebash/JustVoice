// SPDX-License-Identifier: MIT
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import DictateWindow from "./components/DictateWindow.vue";
import {
  tooltipDirective,
  configureHelp,
  ConnectionError,
  configureServerApi,
  configureFamilyLabels,
  checkServer,
  installLlmUi,
  startWarmOnBoot,
} from "@delebash/llm-ui";
import { SERVER_URL, resolveBase } from "./config.js";
import { bootPrefs, ensureActiveProjectDefault } from "./services/prefs.js";
import { loadDoc, hasDoc, titleForSlug } from "./services/helpDocs.js";
import { useUIStore } from "./stores/ui.js";
import { i18n } from "./i18n/index.js";
import router from "./router/index.js";
import "./tokens.css";
import "./styles.css";

function isDictateView() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("view") === "dictate";
}

// The whole shared LLM front end, in ONE call (the UI twin of the server's
// install_llm; docgen's main.js is the donor shape). `resolveBase` is JV's OWN
// resolver — it layers the `jt:server` thin-client override over the
// origin-aware default (config.js), so the override keeps winning for the kit
// views too. Called in BOTH boot branches: the dictate webview builds server
// URLs off the same transport, and an unconfigured client falls back to
// window.location.origin — tauri.localhost in production, empty views only there.
function wireKit(app) {
  installLlmUi(app, {
    resolveBase,
    // The opener is the app's (`@tauri-apps/plugin-shell` is JV's existing
    // pattern — SettingsView's log opener); Tauri's webview swallows
    // target=_blank, so without one every external link is silently dead.
    external: async (url) => {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
    },
    // Nothing in JV embeds (chat ruling 2026-08-05).
    capabilities: { embeddings: false },
    // This app's voice on the shared model-catalog surface (defaults are JW's words).
    catalogCopy: {
      chatSectionLabel: "Assistant models",
      chatSectionHint: "pick one as your model — it runs every AI feature",
      generalUse: "Attributes speakers, cleans up dictation, drafts persona text",
      slotsFootnote:
        "One model runs every AI feature — it loads on first use; Load now just skips that first wait.",
    },
    // This app's voice on the shared Quick Setup wizard. The wizard's visible
    // NAME becomes "LLM engine setup" in JV (ruling 2026-08-05: JV has two
    // engine kinds, the pair names them) via the labels feed when the kit
    // wizard mounts — canon words live in the labels store, never here.
    quickSetupCopy: {
      bandSub:
        "A free local text-AI engine in one click — pick the model that fits this PC; speaker attribution, dictation cleanup and note drafting run on it.",
      headSub: "A free local text-AI engine in one click — sized to this PC.",
      confirmTitle: "Local text AI",
      modelHint:
        "Pick a model — best first. One click installs the engine if it's missing, downloads the model, loads it, and makes it the model JustVoice's AI features run on. Per-feature choices live under Routing by feature.",
      chatRole: "attributes speakers + cleans up dictation",
      doneBody:
        "Speaker attribution, dictation cleanup and the other AI features run on this model — change it any time under Routing by feature.",
    },
  });
  // installLlmUi fed `resolveBase` to the shared transport; the bearer token is
  // JV's own layer on top (thin-client `jt:server` mode authenticates).
  // configureServerApi merges — this call leaves the resolver in place.
  configureServerApi({
    authToken: () =>
      (typeof localStorage !== "undefined" && localStorage.getItem("jt:token")) || "",
  });
  // Ruling 6 (2026-08-05): JV alone renames the kit wizard's VISIBLE words —
  // "LLM engine setup" beside the TTS "Voice engine setup" (two engine kinds;
  // the pair names them). Words only, via the existing labels feed; siblings
  // keep "Quick Setup"; code identifiers (?quicksetup=1, seam names) unchanged.
  // The AI console's provider/model tabs relabel the same way (parity batch
  // 2026-08-06): with TTS in the area, bare "Providers & models"/"Models" stops
  // naming one thing — JV says which kind; siblings keep the canon words.
  configureFamilyLabels({
    quickSetup: {
      runButton: "Run LLM engine setup",
      rerunButton: "Re-run LLM engine setup",
    },
    aiOffer: {
      quickSetup: "Run LLM engine setup",
    },
    aiTabs: {
      providers: "LLM providers",
      models: "LLM models",
    },
  });
}

async function boot() {
  // The dictate window runs in a separate Tauri webview that must skip the
  // main shell + server bootstrap (the main window owns those) and render
  // only the floating recording pill. URL?view=dictate triggers this branch.
  if (isDictateView()) {
    const app = createApp(DictateWindow);
    wireKit(app);
    app.use(createPinia());
    app.mount("#app");
    return;
  }

  const app = createApp(App);
  wireKit(app);

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

  const pinia = createPinia();
  app.use(pinia);
  app.use(router);
  app.use(i18n);
  app.directive("tooltip", tooltipDirective);
  // Force the ui store to init before mount so the persisted appearance (mode,
  // accent hue, ui scale) is applied via the shared engine on the FIRST paint of
  // every view — not lazily after a component first touches the store.
  useUIStore(pinia);
  // Warm the default local model BEFORE mount (the kit's startWarmOnBoot —
  // family mechanic): App.vue's splash overlay is up on the very first Vue
  // paint, a seamless hand-off from index.html's static plate. JV's warm
  // default is OFF (ruling 2026-08-05: TTS owns the GPU until F4's arbiter),
  // so this normally decides "nothing to warm" and the app just opens; the
  // mechanics ship identically so flipping the toggle on is all it takes.
  await startWarmOnBoot();
  // Resolve the initial (lazy) route before mount so the first paint is the
  // real view, not an empty router-view.
  await router.isReady();
  app.mount("#app");
}

boot().catch((e) => {
  // Boot must NEVER strand the static splash plate (docgen's 2026-08-05
  // lesson: a boot throw left the plate on screen forever with nothing
  // mounted). Whatever threw, tear the plate down and say so in place.
  window.__bootErr = e;
  document.getElementById("app-boot")?.remove();
  const el = document.getElementById("app");
  if (el && !el.childElementCount) {
    el.textContent = `The app could not start: ${e?.message || e}`;
  }
  throw e;
});
