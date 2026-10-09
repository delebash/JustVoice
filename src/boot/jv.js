// SPDX-License-Identifier: MIT
// JustVoice — the renderer's start-up, as a Quasar boot file (app-structure §Q.4). Quasar creates
// the app (root: App.vue), Pinia (stores/index.js) and the router (router/index.js), awaits this
// file, then installs the router and mounts. Until the Quasar move (2026-10-08) this was
// src/main.js, which created and mounted one of three roots itself; App.vue now picks the root
// from services/bootState.js, and the sequence below is unchanged.
import { defineBoot } from "#q-app";
import {
  tooltipDirective,
  configureHelp,
  configureServerApi,
  configureFamilyLabels,
  configureFileSave,
  configureTestData,
  checkServer,
  installLlmUi,
  startWarmOnBoot,
} from "@delebash/llm-ui";
import AttributionAutoPanel from "../components/lab/AttributionAutoPanel.vue";
import RefineSectionToggles from "../components/lab/RefineSectionToggles.vue";
import SmartAssignResult from "../components/lab/SmartAssignResult.vue";
import { attributionLabAdapter } from "../services/attributionLab.js";
import { refineLabAdapter } from "../services/refineLab.js";
import { LAB_TEST_ACTIONS, LAB_TEST_SOURCES } from "../services/labTestData.js";
import { bootPrefs, ensureActiveProjectDefault } from "../services/prefs.js";
import { openPath, openUrl, saveFile } from "../services/native.js";
import { loadDoc, hasDoc, titleForSlug } from "../services/helpDocs.js";
import { bootView } from "../services/bootState.js";
import { useUiStore } from "../stores/ui.js";
import { i18n } from "../i18n/index.js";

function isDictateView() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("view") === "dictate";
}

// The whole shared LLM front end, in ONE call (the UI twin of the server's
// installLlm; docgen's main.js is the donor shape). The KIT resolves the base
// now (2026-08-15) — `src/config.js` is deleted. It was a third shape for one
// job: JustVoice had config.js, JustWrite had services/serverApi.js, docgen had
// nothing and let the installer do it. docgen was right. `serverOverrideKey`
// carries JV's own thin-client feature (`jt:server` beats the origin-aware
// default), which used to be read in TWO places in this app.
// Called in BOTH boot branches: the dictate webview builds server URLs off the
// same transport, and an unconfigured client falls back to
// window.location.origin — app://justvoice in the desktop app, empty views only there.
function wireKit(app) {
  installLlmUi(app, {
    devPorts: ["1430", "1431"],
    fallbackBase: import.meta.env.VITE_SERVER_URL || "http://127.0.0.1:17494",
    serverOverrideKey: "jt:server",
    // The openers, through services/native.js (the shell's one bridge) — the SAME
    // line in all three apps. The kit decides when they can be used (browser vs
    // desktop window); no app repeats that reasoning. `openPath` is what both model
    // catalogs' "Open folder" rides.
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
      // generic run; the raw speakerId → personaId object renders as
      // readable Speaker → Persona names.
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
      // The wizard just loaded the model. Tell the app, so the header's language-model
      // pill (and everything else that listens) re-reads the kit's model list at once —
      // until 2026-10-05 the header said "No language model" after a setup.
      onApplied: () => window.dispatchEvent(new Event("jv:health-refresh")),
    },
  });
  // The Lab's fill-from-app doors (Part 4, 2026-08-06 — the kit's
  // configureTestData seam, off by default; JW's registration is the donor):
  // chapters/cast → attribution + identify, cast/voices → smart-assign,
  // voices → gender guess, script → show notes, personas → compose/rewrite.
  // Every fill emits the SAME block the production caller sends
  // (labTestData.js names each source of truth).
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

async function boot({ app, router, store: pinia }) {
  // The dictate window (never created today — study §7.1) runs in a separate
  // window that must skip the main shell + server bootstrap (the main window owns
  // those) and render only the floating recording pill. URL?view=dictate
  // triggers this branch; App.vue renders the pill instead of the shell.
  if (isDictateView()) {
    wireKit(app);
    bootView.value = "dictate";
    return;
  }

  wireKit(app);

  // Thin-client guard: all data lives in the server. If it's unreachable, App.vue
  // shows a connection-error screen instead of booting the app with empty/default
  // state (which looks broken and silently fails to save). The kit's transport is
  // already configured by wireKit() above, so the screen names the SAME base the
  // app talks to — no second resolver to disagree with.
  if (!(await checkServer())) {
    bootView.value = "server-down";
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

  // The native "save as", wired once as in JustWrite (2026-10-07): every export goes
  // through the kit's `saveBlob`, which opens the shell's Save dialog. Unwired, it fell
  // back to a blob download that WebView2 ignores — the export saved nothing.
  configureFileSave({
    save: (blob, { filename, title, filterName, filterExt, defaultDir }) =>
      saveFile({ blob, suggestedName: filename, title, filterName, filterExt, defaultDir }),
  });

  // (Quasar installs Pinia before this file and the router after it.)
  app.use(i18n);
  app.directive("tooltip", tooltipDirective);
  // Force the ui store to init before mount so the persisted appearance (mode,
  // accent hue, ui scale) is applied via the shared engine on the FIRST paint of
  // every view — not lazily after a component first touches the store.
  useUiStore(pinia);
  // Warm the default local model BEFORE mount (the kit's startWarmOnBoot —
  // family mechanic): AppShell.vue's splash overlay is up on the very first Vue
  // paint, a seamless hand-off from index.html's static plate. JV's warm
  // default is OFF (ruling 2026-08-05: TTS owns the GPU until F4's arbiter),
  // so this normally decides "nothing to warm" and the app just opens; the
  // mechanics ship identically so flipping the toggle on is all it takes.
  await startWarmOnBoot();
  // Resolve the initial (lazy) route before mount so the first paint is the
  // real view, not an empty router-view. (main.js awaited router.isReady(); Quasar
  // installs the router only after this file, and isReady() waits on the navigation
  // that installing starts — so the boot makes that first navigation itself, and
  // the install then finds it done.)
  await router.replace(router.options.history.location);
}

export default defineBoot(async (ctx) => {
  try {
    await boot(ctx);
  } catch (e) {
    // Boot must NEVER strand the static splash plate (docgen's 2026-08-05
    // lesson: a boot throw left the plate on screen forever with nothing
    // mounted — and Quasar mounts nothing after a boot error either). Whatever
    // threw, tear the plate down and say so in place.
    window.__bootErr = e;
    document.getElementById("app-boot")?.remove();
    const el = document.getElementById("q-app");
    if (el && !el.childElementCount) {
      el.textContent = `The app could not start: ${e?.message || e}`;
    }
    throw e;
  }
});
