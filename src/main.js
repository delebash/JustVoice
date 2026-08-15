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
  configureTestData,
  checkServer,
  installLlmUi,
  startWarmOnBoot,
} from "@delebash/llm-ui";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { serverUrl } from "@delebash/llm-ui";
import AttributionAutoPanel from "./components/lab/AttributionAutoPanel.vue";
import RefineSectionToggles from "./components/lab/RefineSectionToggles.vue";
import SmartAssignResult from "./components/lab/SmartAssignResult.vue";
import { attributionLabAdapter } from "./services/attributionLab.js";
import { refineLabAdapter } from "./services/refineLab.js";
import { LAB_TEST_ACTIONS, LAB_TEST_SOURCES } from "./services/labTestData.js";
import { bootPrefs, ensureActiveProjectDefault } from "./services/prefs.js";
import { loadDoc, hasDoc, titleForSlug } from "./services/helpDocs.js";
import { useUiStore } from "./stores/ui.js";
import { i18n } from "./i18n/index.js";
import router from "./router/index.js";
import "./styles/tokens.css";
import "./styles/styles.css";

// NOT installed here yet — deliberately, and this is the note that says why.
// The cross-origin fetch route (kit `installTauriFetch`) exists so a renderer can
// reach a server that ships no CORS headers. JustWrite installs it. JustVoice
// would need its `http:default` capability to carry an explicit URL allow-list
// first (JustWrite's does; JV's is scope-empty, so routing calls through the
// plugin would DENY what plain fetch reaches today) — and which hosts JustVoice
// may reach in `jt:server` thin-client mode is a decision, not a refactor.
// Tracked in ../just-llm-runner/docs/dev/TASKS.md.

function isDictateView() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("view") === "dictate";
}

// The whole shared LLM front end, in ONE call (the UI twin of the server's
// install_llm; docgen's main.js is the donor shape). The KIT resolves the base
// now (2026-08-15) — `src/config.js` is deleted. It was a third shape for one
// job: JustVoice had config.js, JustWrite had services/serverApi.js, docgen had
// nothing and let the installer do it. docgen was right. `serverOverrideKey`
// carries JV's own thin-client feature (`jt:server` beats the origin-aware
// default), which used to be read in TWO places in this app.
// Called in BOTH boot branches: the dictate webview builds server URLs off the
// same transport, and an unconfigured client falls back to
// window.location.origin — tauri.localhost in production, empty views only there.
function wireKit(app) {
  installLlmUi(app, {
    devPorts: ["1430", "1431"],
    fallbackBase: import.meta.env.VITE_SERVER_URL || "http://127.0.0.1:17494",
    serverOverrideKey: "jt:server",
    // The openers, straight from the plugin — the SAME line in all three apps
    // (2026-08-14). The kit decides when they can be used (browser vs webview);
    // no app repeats that reasoning. `openPath` is what both model catalogs'
    // "Open folder" rides.
    external: { open: openUrl, openPath },
    // Nothing in JV embeds (chat ruling 2026-08-05).
    capabilities: { embeddings: false },
    // The Lab runs the REAL attribution pipeline for speaker_attribution
    // columns (parity batch 2026-08-06 — the Speaker Lab reunification):
    // /v1/extraction/analyze-text instead of the generic /v1/ai/run, the
    // speaker table with reassign-teaches as the renderer, reading-style +
    // floor controls on the column. CONCEPTS §16: lab and production cannot
    // drift.
    labAdapters: {
      speaker_attribution: attributionLabAdapter,
      // Render-only (Part 6, 2026-08-06): smart-assign's Lab keeps the
      // generic run; the raw characterId → voiceId object renders as
      // readable Character → Voice names.
      smart_assign: { render: SmartAssignResult },
      // Every refine Lab run takes production's real path (/v1/refine/lab-run:
      // composed system + few-shot history) — the card's Lab over the
      // sectioned composition (2026-08-08; the piece columns died with the
      // pieces concept).
      refine: refineLabAdapter,
    },
    // Dictation cleanup is SECTIONED (the 2026-08-08 redesign — it retired
    // the pieces concept): ONE nav card; the base row's system is a template
    // whose {{smart_cleanup}}/{{self_correction}}/{{preserve_technical}}
    // markers fill from the section rows when their Capture toggle is on.
    // All four texts edit on the card's pane; the Lab runs over the REAL
    // composed preview (refine_lab_api). Attribution's routes stay real
    // routed cards (the restore, 2026-08-06 — either/or routes, not sections).
    sectionedFeatures: ["refine"],
    featurePanels: {
      // The "Auto" row under the SPEAKER ATTRIBUTION heading (the Auto
      // simplification, 2026-08-06): label + note render the nav row; the
      // panel is its whole pane — the plain words for how Auto picks a
      // feature, plus the one editable size line. No pills, no readout.
      speaker_attribution: {
        component: AttributionAutoPanel,
        label: "Auto",
        note: "Picks which of the two features below runs",
      },
      // The cleanup card's LIVE Capture toggles (no label → mounts on the
      // pane, no nav row): they read and write the REAL server settings —
      // no Lab-only state, the Lab mirrors production (the standing premise).
      refine: RefineSectionToggles,
    },
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
  // The Lab's fill-from-app doors (Part 4, 2026-08-06 — the kit's
  // configureTestData seam, off by default; JW's registration is the donor):
  // chapters/cast → attribution + identify, cast/voices → smart-assign,
  // voices → gender guess, presets + chapters → preset-suggest, script →
  // show notes, personas → compose/rewrite. Every fill emits the SAME block
  // the production caller sends (labTestData.js names each source of truth).
  configureTestData({ sources: LAB_TEST_SOURCES, actions: LAB_TEST_ACTIONS });
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
  // The AI console's providers tab relabels the same way: with speech in the
  // area, a bare "Providers & models" stops naming one thing — JV says which
  // kind; siblings keep the canon words. (The separate "LLM models" tab died
  // with the user's 2026-08-06 QC ruling — the catalog lives inside this tab.)
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
      // The kit's transport is already configured by wireKit() above, so this
      // is the SAME base the app talks to — no second resolver to disagree with.
      serverUrl: serverUrl(""),
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
  useUiStore(pinia);
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
