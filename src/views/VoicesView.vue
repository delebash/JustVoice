<!-- SPDX-License-Identifier: MIT -->
<script setup>
import { ref, onMounted, onActivated, computed, nextTick } from "vue";
import { useRouter } from "vue-router";
import { useApi } from "../stores/api.js";
import PageTaskStrips from "../components/PageTaskStrips.vue";
import { pushToast, saveBlob, serverUrl as apiPath } from "@delebash/llm-ui";
import { confirmDialog, promptDialog } from "@delebash/llm-ui";
import {
  DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal,
  DropdownMenuRoot, DropdownMenuSeparator, DropdownMenuTrigger,
} from "reka-ui";
import { DIRECTION_OPTIONS, VOICE_KINDS, directionCell, tagCount, voiceKind, voiceKindLabel } from "../services/personaFacts.js";
import { readPref, writePref } from "../services/prefs.js";
import { rowOptions } from "../services/capabilities.js";
import { voiceRowState } from "../services/voiceGrid.js";
import { savePresetGenderOverride, voiceGender } from "../services/voiceGender.js";
import { UiButton, UiInput, UiTextarea, UiField, UiTag, UiChip, UiSelect, UiSlider, UiTable } from "@delebash/llm-ui";
// Language CODE → the name a person reads ("en-US" → American English).
// Kit-side, because every app in the family shows a language somewhere.
import { languageName, languageOptionsFrom } from "@delebash/llm-ui";
import { facetChoices, facetCounts, facetOptions, facetTotal, narrowed } from "../services/facets.js";
import { EmptyState } from "@delebash/llm-ui";
// An engine's own terms (Pocket TTS — Kyutai's) refuse a clone until accepted.
import { handleTermsRefusal } from "../services/engineTerms.js";
import { useVoicesStore } from "../stores/voices.js";
import { usePersonasStore } from "../stores/personas.js";
import { runAiEndpoint } from "@delebash/llm-ui";
import { useEnginesStore } from "../stores/engines.js";

const api = useApi();
// voices / engines come from shared stores. Mutations here (copy to
// another model / delete / gender) call refresh() → store.reload(), so
// other views update. Store items are deeply reactive, so in-place edits
// (e.g. a gender override) reflect without rebuilding the array.
const voicesStore = useVoicesStore();
const enginesStore = useEnginesStore();
const voices = computed(() => voicesStore.items);
// The personas built on each voice — Voices' "Used by" (the persona redesign,
// 2026-10-03: a voice is raw; a persona is how it speaks).
const personasStore = usePersonasStore();
const personasByVoice = computed(() => {
  const m = {};
  for (const p of personasStore.items) {
    if (!p.voice_id) continue;
    if (!m[p.voice_id]) m[p.voice_id] = [];
    m[p.voice_id].push(p);
  }
  return m;
});
const engines = computed(() => enginesStore.items);

// ── Gender: the shared service (services/voiceGender.js — one answer for
// every screen, 2026-10-03) + this page's click-cycle override (lift #85).
const GENDER_CYCLE = ["?", "F", "M", "N", ""];

// Preset voices ship with the engine — no stored record to PATCH, so their
// overrides persist in the renderer prefs (the service's save door). Stored
// voices persist via PATCH /v1/voices/{id}.

// ── LLM gender guess (F1 Phase 3, ruling 2: EXPLICIT button, never auto) ──
// Sends only the voices the dictionary left at "?" to the voice_gender
// feature; applies answers through the SAME persistence as a manual cycle
// (pref override for presets, PATCH for stored voices).
const genderGuessBusy = ref(false);
async function guessUnknownGenders() {
  const unknown = voices.value.filter((v) => voiceGender(v) === "?").slice(0, 60);
  if (!unknown.length) {
    pushToast({ message: "Nothing to guess — every voice already has a gender.", duration: 3500 });
    return;
  }
  genderGuessBusy.value = true;
  try {
    // The kit runner owns the task (row + seconds + tokens + cancel).
    const r = await runAiEndpoint({
      request: (p, o) => api.request(p, o),
      path: "/v1/voices/gender-guess",
      body: { voices: unknown.map((v) => ({
        name: v.name || v.id, description: v.design_prompt || "",
      })) },
      task: {
        feature: "voice-gender",
        label: `Gender guess · ${unknown.length} voice${unknown.length === 1 ? "" : "s"}`,
        onRetry: () => guessUnknownGenders(),
      },
    });
    const guesses = r?.guesses || {};
    let applied = 0;
    for (const v of unknown) {
      const g = guesses[v.name || v.id];
      if (!g) continue;
      v.gender_user_override = g;
      if (v.source === "preset") {
        savePresetGenderOverride(v.id, g);
      } else {
        await api.request(`/v1/voices/${v.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gender: g }),
        });
      }
      applied += 1;
    }
    pushToast({
      message: `${applied} voice${applied === 1 ? "" : "s"} labeled · ${unknown.length - applied} left unknown.`,
      kind: "success",
    });
  } catch (e) {
    const msg = String(e?.message || e);
    if (!/abort/i.test(msg)) pushToast({
      message: msg.includes("501")
        ? "No AI model set up — run the LLM engine setup under AI Settings first."
        : `Gender guess failed: ${msg}`,
      kind: "error", duration: 6000,
    });
  } finally {
    genderGuessBusy.value = false;
  }
}

async function cycleGender(v) {
  const cur = voiceGender(v);
  const idx = GENDER_CYCLE.indexOf(cur);
  const next = GENDER_CYCLE[(idx + 1) % GENDER_CYCLE.length];
  v.gender_user_override = next || null;
  if (v.source === "preset") {
    savePresetGenderOverride(v.id, v.gender_user_override);
    return;
  }
  try {
    await api.request(`/v1/voices/${v.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gender: v.gender_user_override || "" }),
    });
  } catch (e) {
    pushToast({ message: `Couldn't save gender: ${e.message || e}`, kind: "error" });
  }
}

// ── Catalog filtering + search. ──────────────────────────────────────
const search = ref("");
// Filter ids match the server's VoiceSource literals exactly
// (models.py: preset | cloned | designed | imported | blended).
const typeFilter = ref("all");

const TYPE_FILTERS = [
  { id: "all",      label: "All" },
  // The one set of type words (personaFacts.VOICE_KINDS, 2026-10-05) — Imported is Cloned.
  ...VOICE_KINDS.filter((k) => !k.disabled).map((k) => ({ id: k.value, label: k.label })),
];

// Voice hiding DIED 2026-08-21 ("remove hidden on voices grid that
// function shouldnt exist"). It was already half-dead: nothing in the
// template called toggleHidden any more, so the only way a voice could be
// hidden was a leftover "hiddenVoices" pref from before — a stale ghost
// row filter. Stale pref rows stay on disk unread (no-migrations rule).

const engineFilter = ref(readPref("voicesEngineFilter", "all"));
function setEngineFilter(id) {
  engineFilter.value = id;
  writePref("voicesEngineFilter", id);
}
// Every filter here lists only what the others leave, with counts that match
// the grid (decided 2026-10-05, services/facets.js): kokoro (54) + Written
// direction used to be an empty grid. A remembered engine whose voices are
// gone stays in the list with (0).
const engineFilterOptions = computed(() => [
  { label: `All engines (${facetTotal(voices.value || [], voiceFilters.value, "engine")})`, value: "all" },
  ...facetOptions(voices.value || [], voiceFilters.value, "engine", (v) => v.engine, (id, n) => `${id} (${n})`),
]);

// Currently loaded TTS engine — surfaced in the toolbar (user ask: the
// Voices page should say which engine previews will hit).
const loadedTtsEngine = computed(() =>
  (engines.value || []).find((e) => e.status === "loaded" && (e.kind === "tts" || !e.kind)) || null
);

// LOCAL vs ONLINE badge per voice (user concern: picking voices without
// realizing some load big local engines and some bill an online API).
const engineBackends = computed(() => {
  const m = {};
  for (const e of engines.value || []) m[e.id] = e.backend || "";
  return m;
});
function voiceLocality(v) {
  const e = engineMeta.value[v.engine];
  if (e?.self_hosted) return "self-hosted";
  const backend = engineBackends.value[v.engine];
  if (backend === undefined) return null; // orphan — already tagged
  return backend === "managed" ? "local" : "online";
}

// Engines whose speech runtime isn't installed yet — their static voices
// can't preview until Install runs on Speech engines. Tag + sort last so they
// never read as "the default voice" (user-hit: an uninstalled engine's
// stock voice listed first).
const engineMeta = computed(() => {
  const m = {};
  for (const e of engines.value || []) m[e.id] = e;
  return m;
});
// "not installed" = the shared speech runtime is missing (the 2026-10-01
// switch) — one install covers every engine.
function needsInstall(v) {
  const e = engineMeta.value[v.engine];
  return !!e && e.status === "not_installed";
}

// Language + gender filters (2026-08-21). Both fields already ship on every
// voice from /v1/voices, so the library could always have been narrowed by
// them; only the controls were missing.
const langFilter = ref("all");
const genderFilter = ref("all");
// How a voice's model can be directed (decided 2026-10-03: "some way for the
// user to filter out what types of voices they want to use").
const directionFilter = ref("");

const genderOf = (v) => voiceGenderWord(v) || "unset";
const voiceFilters = computed(() => [
  { key: "engine", value: engineFilter.value, empty: "all", test: (v, x) => v.engine === x },
  { key: "type", value: typeFilter.value, empty: "all", test: (v, x) => voiceKind(v) === x },
  { key: "lang", value: langFilter.value, empty: "all", test: (v, x) => v.language === x },
  { key: "gender", value: genderFilter.value, empty: "all", test: (v, x) => genderOf(v) === x },
  { key: "direction", value: directionFilter.value, test: (v, x) => v.directed_by === x },
  { key: "search", value: search.value.trim().toLowerCase(),
    test: (v, q) => (v.name || "").toLowerCase().includes(q) || (v.id || "").toLowerCase().includes(q) },
]);

const langFilterOptions = computed(() => {
  const opts = facetOptions(voices.value || [], voiceFilters.value, "lang", (v) => v.language, (c) => c);
  return languageOptionsFrom(opts.map((o) => o.value), {
    allLabel: `Any language (${facetTotal(voices.value || [], voiceFilters.value, "lang")})`,
    counts: new Map(opts.map((o) => [o.value, o.n])),
  });
});

const genderFilterOptions = computed(() => [
  { label: "Any gender", value: "all" },
  ...facetOptions(voices.value || [], voiceFilters.value, "gender", genderOf,
    (g, n) => `${g[0].toUpperCase()}${g.slice(1)} (${n})`),
]);

const directionFilterOptions = computed(() =>
  facetChoices(voices.value || [], voiceFilters.value, "direction", DIRECTION_OPTIONS, (v, x) => v.directed_by === x));

const filteredVoices = computed(() =>
  // Needs-install voices sink to the bottom — never first-in-list.
  [...narrowed(voices.value || [], voiceFilters.value)].sort((a, b) => needsInstall(a) - needsInstall(b)));

/** The rows UiTable renders. The display language rides along as a field so
 *  the column can sort by the NAME people read rather than by the code. */
const voiceRows = computed(() =>
  filteredVoices.value.map((v) => ({
    ...v,
    _lang: languageName(v.language) || v.language || "",
    _gender: voiceGender(v) || "",
    _model: v.model_name || v.engine || "",
    _type: voiceKindLabel(v),
  })),
);

// Column widths ride on the columns, through UiTable's own headerStyle/cellStyle,
// because a scoped `.voices-view__table td` rule cannot reach a <td> that lives
// inside the component — Vue puts the scope id on the LAST compound selector, so
// the rule compiled to `td[data-v-…]` and silently stopped matching when the grid
// moved off its hand-rolled <table>. Every column is shrink-to-fit; Name takes
// what is left, which is the layout law's "a row ends where its content ends".
const FIT = { width: "1%", whiteSpace: "nowrap" };
const VOICE_COLUMNS = [
  { id: "name", accessorKey: "name", header: "Name", sortable: true,
    headerStyle: { width: "auto", minWidth: "240px" } },
  { id: "_gender", accessorKey: "_gender", header: "Gender", sortable: true, headerStyle: FIT, cellStyle: FIT },
  { id: "source", accessorKey: "_type", header: "Type", sortable: true, headerStyle: FIT, cellStyle: FIT },
  { id: "engine", accessorKey: "_model", header: "Model", sortable: true, headerStyle: FIT, cellStyle: FIT },
  { id: "_lang", accessorKey: "_lang", header: "Speaks", sortable: true, headerStyle: FIT, cellStyle: FIT },
  { id: "directed", accessorKey: "directed_by", header: "Can be directed", sortable: true, headerStyle: FIT, cellStyle: FIT },
  { id: "used", header: "Used by" },
  { id: "actions", header: "", headerStyle: FIT, cellStyle: FIT },
];

/** Row STATE goes on the <tr>, through the kit's :row-class (added 2026-08-21).
 *  It briefly lived on a div inside the name cell, which dimmed one cell of an
 *  orphan row and tinted one cell of the playing row. The rule itself is pure
 *  and lives in services/voiceGrid.js, where it is unit-tested. */
function voiceRowClass(row) {
  return voiceRowState(row, orphanIds.value, playingVoice.value?.id || "");
}

// The type chips count what the other filters leave, like every filter here.
const typeCounts = computed(() => ({
  all: facetTotal(voices.value || [], voiceFilters.value, "type"),
  ...facetCounts(voices.value || [], voiceFilters.value, "type",
    TYPE_FILTERS.filter((f) => f.id !== "all").map((f) => f.id), (v, t) => voiceKind(v) === t),
}));

// ── Voice preview (LRU-cached on backend). ──────────────────────────
// ONE player for the page, and its transport renders inside the row you
// pressed — so the control and the voice it plays are the same object.
// (2026-08-19: the expanding preview row, the in-row audition panel and
// the inspector all came out; a library reads as a list.)
const previewAudio = ref(null);
const previewingId = ref(null);
const playingVoice = ref(null);

// The line every ▶ in the grid speaks. One box above the grid, because
// comparing voices means hearing them say the SAME thing — a per-row
// editor made that impossible (retype it 63 times).
const previewText = ref(readPref("voicesTestLine", ""));
function setPreviewText(v) {
  previewText.value = v;
  writePref("voicesTestLine", v);
}

// The transport itself. One hidden <audio> for the page, driven by
// whichever row started it.
const playerEl = ref(null);
const playerPaused = ref(true);
const playTime = ref(0);
const playDuration = ref(0);

function onPlayTime() {
  const el = playerEl.value;
  if (!el) return;
  playTime.value = el.currentTime || 0;
  // A streamed audition's WAV header carries the streaming convention's
  // 0xFFFFFFFF sizes, which browsers read as an hours-long duration —
  // treat anything absurd as unknown so the transport shows elapsed time
  // only until the stream (or a cached replay) has a real length.
  const d = el.duration;
  playDuration.value = Number.isFinite(d) && d < 21600 ? d : 0;
}
function onPlayEnded() {
  playerPaused.value = true;
  playTime.value = 0;
}
function togglePlay() {
  const el = playerEl.value;
  if (!el) return;
  if (el.paused) el.play().catch(() => {});
  else el.pause();
}
function seekTo(v) {
  const el = playerEl.value;
  if (el) el.currentTime = Number(v) || 0;
}
function fmtTime(sec) {
  const t = Math.max(0, Math.floor(Number(sec) || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

function previewBody() {
  const line = previewText.value.trim();
  return line
    ? {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: line }),
      }
    : { method: "POST" };
}

function tryStreamPreview(v) {
  // Streaming-first audition (phase 1, 2026-08-19): point the page's audio
  // element straight at GET /preview/stream — the server renders sentence-
  // sized pieces and sends each as it finishes, so playback starts after
  // the FIRST piece instead of the whole render. The attempt never
  // auto-loads (aborting mid-load to fall back would double-render); any
  // failure — engine not loaded (409), a tokened remote setup (<audio src>
  // cannot send Authorization), dead server — resolves false and the POST
  // door below takes over with its install/load dialogs.
  return new Promise((resolve) => {
    const el = playerEl.value;
    if (!el) return resolve(false);
    const line = previewText.value.trim();
    const qs = line ? `?${new URLSearchParams({ text: line })}` : "";
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      el.removeEventListener("playing", onOk);
      el.removeEventListener("error", onErr);
      resolve(ok);
    };
    const onOk = () => done(true);
    const onErr = () => done(false);
    el.addEventListener("playing", onOk);
    el.addEventListener("error", onErr);
    playingVoice.value = v;
    playTime.value = 0;
    playDuration.value = 0;
    previewAudio.value = apiPath(`/v1/voices/${v.id}/preview/stream${qs}`);
    nextTick().then(() => playerEl.value?.play().catch(() => done(false)));
    // Backstop for a silently hung connection. Generous on purpose: the
    // first piece's render time is real on CPU engines, and a working
    // stream fires "playing" long before this.
    setTimeout(() => done(false), 60000);
  });
}

async function previewVoice(v) {
  previewingId.value = v.id;
  if (previewAudio.value) {
    // The src may be a stream URL rather than a blob — revoking those is
    // meaningless, so only blobs get revoked.
    if (String(previewAudio.value).startsWith("blob:")) URL.revokeObjectURL(previewAudio.value);
    previewAudio.value = null;
  }
  try {
    if (await tryStreamPreview(v)) return;
    const always = readPref("autoLoadEngine") === "always";
    let blob;
    try {
      blob = await api.request(`/v1/voices/${v.id}/preview?auto_load=${always}`, previewBody());
      // Door 1 of the tracked finding: with "always auto-load" on, pressing ▶
      // loads the engine as a SIDE EFFECT and announced nothing — which is
      // why the toolbar could read "no engine loaded" while a voice played.
      // The client cannot see whether the server actually loaded, so it
      // announces whenever it authorised one; a redundant refresh is cheap
      // and a missed one is the bug.
      if (always) window.dispatchEvent(new Event("jv:health-refresh"));
    } catch (e) {
      const mi = String(e?.message || "").match(/engine_not_installed:([\w.-]+)/);
      if (mi) {
        const ok = await confirmDialog({
          title: "Install the speech runtime first",
          message: `"${v.name}" plays on the ${mi[1]} engine, and the speech runtime every engine runs on isn't installed yet. Open Speech engines to install it?`,
          confirmLabel: "Open Speech engines",
        });
        if (ok) window.location.hash = "#engines";
        return;
      }
      const m = String(e?.message || "").match(/engine_not_loaded:([\w.-]+)/);
      if (!m) throw e;
      const engineId = m[1];
      const ok = await confirmDialog({
        title: `Load ${engineId}?`,
        message: `"${v.name}" needs the ${engineId} engine, which isn't loaded. Load it now to preview? The first load can take ~25–55 s; after that previews are instant.`,
        confirmLabel: "Load & preview",
      });
      if (!ok) return;
      pushToast({ message: `Loading ${engineId}… this can take up to a minute.`, kind: "info" });
      blob = await api.request(`/v1/voices/${v.id}/preview?auto_load=true`, { ...previewBody(), method: "POST" });
      pushToast({
        message: `${engineId} loaded.`,
        kind: "success",
        action: { label: "Always auto-load", fn: () => writePref("autoLoadEngine", "always") },
      });
      // Topbar pill + Engines page track loads from anywhere.
      window.dispatchEvent(new Event("jv:health-refresh"));
    }
    previewAudio.value = URL.createObjectURL(blob);
    playingVoice.value = v;
    playTime.value = 0;
    playDuration.value = 0;
    await nextTick();
    playerEl.value?.play().catch(() => {});
  } catch (e) {
    if (handleTermsRefusal(e)) return;
    pushToast({ message: `Preview failed: ${e.message || e}`, kind: "error" });
  } finally {
    previewingId.value = null;
  }
}

async function refresh() {
  await Promise.all([
    voicesStore.reload(),
    enginesStore.reload(),
    personasStore.reload(),
    loadCapabilities(),
  ]);
}

// ── A voice as one file (decided 2026-10-05) — the server's bundle
// (voice_bundle.py), which carries the voice's model since then: ⋯ → Export
// on a voice you made, ⤒ Import voice… in the toolbar. A built-in ships with
// its model, so it has no Export.
const bundleInput = ref(null);
async function exportVoice(row) {
  try {
    const blob = await api.requestBlob(`/v1/voices/${encodeURIComponent(row.id)}/bundle.zip`);
    const safe = (row.name || "voice").replace(/[^\w\- ]+/g, "_").trim() || "voice";
    await saveBlob(blob, `${safe}.jvvoice.zip`, { title: "Save voice", filterName: "JustVoice voice", filterExt: "zip" });
    pushToast({ kind: "success", title: "Voice exported" });
  } catch (e) {
    pushToast({ kind: "error", title: "Export failed", description: String(e?.message ?? e) });
  }
}
function chooseVoiceFile() {
  bundleInput.value?.click();
}
async function importVoiceFile(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = "";
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  try {
    const v = await api.postForm("/v1/voices/bundle", form);
    await refresh();
    pushToast({ kind: "success", message: `${v.name} imported.` });
  } catch (e) {
    pushToast({ kind: "error", message: `Couldn't import that file: ${e?.message || e}` });
  }
}

// ── ⋯ New persona from this voice · Copy to another model… ─────────────
function newPersonaFrom(voice) {
  router.push({ name: "persona", params: { id: "new" }, query: { voice: voice.id } });
}

/** A clip can be spoken by another model as a second voice (decided
 *  2026-10-03: a clone belongs to the model it was made for). */
function hasClip(voice) {
  return voice.source === "cloned" || voice.source === "imported" || voice.source === "designed";
}
async function copyToModel(voice) {
  const targets = rowOptions(capabilityRows.value, engines.value, "supports_voice_cloning")
    .filter((o) => o.value !== voice.model);
  if (!targets.length) {
    pushToast({ kind: "info", message: "No other model here can clone a voice." });
    return;
  }
  const picked = await promptDialog({
    title: `Copy ${voice.name} to another model`,
    message: `The same clip becomes a second voice, spoken by the model you pick — `
      + `"${voice.name}" stays as it is on ${voice.model_name || voice.engine}.`,
    fields: [
      { key: "model", label: "Model", type: "select", defaultValue: targets[0].value, options: targets },
      { key: "name", label: "Name", optional: true, placeholder: `${voice.name} (the model's name)` },
    ],
    confirmLabel: "Copy",
  });
  if (!picked?.model) return;
  const body = { model: picked.model, name: (picked.name || "").trim() || null };
  try {
    const made = await postCopy(voice, body);
    if (made) {
      await refresh();
      pushToast({ kind: "success", message: `${made.name} added — ${made.model_name || made.engine}.` });
    }
  } catch (e) {
    if (!handleTermsRefusal(e)) pushToast({ kind: "error", message: `Copy failed: ${e?.message || e}` });
  }
}
/** POST the copy; when the model needs the clip's words and the voice has
 *  none (Qwen3 Base), ask for them — or Skip the words — and try once more. */
async function postCopy(voice, body) {
  const send = (b) => api.request(`/v1/voices/${voice.id}/copy`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b),
  });
  try {
    return await send(body);
  } catch (e) {
    if (!/needs the words the clip says/.test(String(e?.message || ""))) throw e;
    const words = await promptDialog({
      title: "What does the clip say?",
      message: `${voice.name} has no words saved with its clip, and the model you picked clones `
        + "from them. Type what the clip says, or skip the words and clone from the sound alone.",
      fields: [
        { key: "how", label: "Clone from", type: "select", defaultValue: "words", options: [
          { value: "words", label: "The clip's words — type them below" },
          { value: "skip", label: "Skip the words — the sound alone" },
        ] },
        { key: "transcript", label: "What the clip says", type: "textarea", rows: 3, optional: true },
      ],
      confirmLabel: "Copy",
    });
    if (!words) return null;
    if (words.how === "skip") return send({ ...body, xvector_only: true });
    if (!(words.transcript || "").trim()) {
      pushToast({ kind: "info", message: "Type what the clip says, or pick Skip the words." });
      return null;
    }
    return send({ ...body, transcript: words.transcript.trim() });
  }
}

const orphanIds = computed(() => {
  const ids = new Set(engines.value.map((e) => e.id));
  return voices.value.filter((v) => !ids.has(v.engine)).map((v) => v.id);
});

async function deleteVoice(voice) {
  const used = (personasByVoice.value[voice.id] || []).map((p) => p.name);
  const ok = await confirmDialog({
    title: "Delete voice?",
    message: `"${voice.name}" will be permanently removed.`
      + (used.length
        ? ` It's the voice of ${used.join(", ")} — ${used.length === 1 ? "that persona needs" : "those personas need"} another voice before ${used.length === 1 ? "it" : "they"} can speak.`
        : ""),
    danger: true,
    confirmLabel: "Delete",
  });
  if (!ok) return;
  const id = voice.id;
  try {
    await api.request(`/v1/voices/${id}`, { method: "DELETE" });
    await refresh();
    pushToast({ message: `"${voice.name}" deleted.` });
  } catch (e) {
    pushToast({ message: `Delete failed: ${e.message || e}`, kind: "error" });
  }
}

onMounted(refresh);
// Every app view runs under <KeepAlive> (App.vue), so onMounted fires
// ONCE per session. Without this, coming back to Voices after loading an
// engine elsewhere showed whatever was true the first time you opened it.
onActivated(() => { void refresh(); takeTestLine(); });
// Captures' "Speak again" leaves its transcript here for the test line.
function takeTestLine() {
  try {
    const line = window.sessionStorage?.getItem("jv.voices.testLine");
    if (line == null) return;
    window.sessionStorage.removeItem("jv.voices.testLine");
    setPreviewText(line);
  } catch { /* private mode */ }
}
onMounted(takeTestLine);
// This view was the one surface that did NOT join the `jv:health-refresh`
// contract — it refetched by hand, from its own load door only, so an engine
// loaded anywhere else left the model picker stale until you left and came
// back. Only the capability surface is fetched here: the voices and engines
// stores subscribe to the same event and reload themselves, so refetching
// them from this listener would double every request.
window.addEventListener("jv:health-refresh", () => { void loadCapabilities(); });


// ── The voice library (2026-10-04: Voices is the library only — a voice is
// made on a persona's page: Clone, Design and Blend open there, and Import
// folded into Clone; plan docs/plans/2026-10-04-persona-voice-making.md §3).
const router = useRouter();

// GET /v1/engines/capabilities — per engine AND per variant, so a
// checkpoint family that cannot do a thing never offers it (Qwen3
// CustomVoice cannot clone; only its Base family can).
const capabilityRows = ref({});
async function loadCapabilities() {
  const r = await api.safeRequest("/v1/engines/capabilities", { engines: {} });
  capabilityRows.value = r?.engines || {};
}

/** The gender key behind the grid's one-letter chip, so the filter and
 *  the chip can never disagree about what a voice is. */
function voiceGenderWord(v) {
  return { F: "female", M: "male", N: "neutral" }[voiceGender(v)] || "";
}

// Voice type → UiTag intent mapping
function voiceTypeVariant(kind) {
  // One distinct tint per type (v11): neutral / green / solid-green / gold —
  // so the column reads at a glance. Imported is Cloned since 2026-10-05.
  // Returns shared UiTag intents.
  if (kind === "builtin") return "ghost";
  if (kind === "clone") return "success";
  if (kind === "design") return "solid";
  if (kind === "blend") return "accent2";
  return "ghost";
}

</script>

<template>
  <!-- Single-root .jv-fill so the page itself doesn't scroll — only the
       voice catalog list scrolls within its own container. Toolbar +
       banner + add-more details stay pinned at the top of the pane. -->
  <div class="voices-view jv-fill">

  <!-- ── Toolbar: search + engine + type filters ───── -->
  <div class="voices-view__toolbar">
    <UiInput v-model="search" placeholder="Search voices…" width="name" title="Filter by name or id" />
    <UiSelect
      :model-value="engineFilter"
      :options="engineFilterOptions"
      title="Show only voices from one engine"
      width="id"
      @update:model-value="setEngineFilter"
    />
    <UiSelect
      v-model="langFilter"
      :options="langFilterOptions"
      title="Show only voices that speak one language"
      width="name"
    />
    <UiSelect
      v-model="genderFilter"
      :options="genderFilterOptions"
      title="Show only voices of one gender"
      width="id"
    />
    <UiSelect
      v-model="directionFilter"
      :options="directionFilterOptions"
      title="Show only voices whose model can be directed one way"
      aria-label="Can be directed"
      width="id"
    />
    <UiChip
      as="a"
      :selected="!!loadedTtsEngine"
      href="#engines"
      :title="loadedTtsEngine
        ? `${loadedTtsEngine.name || loadedTtsEngine.id} is loaded — previews play instantly. Click to manage engines.`
        : 'No TTS engine loaded — the first preview will offer to load one. Click to manage engines.'"
    >{{ loadedTtsEngine ? `● ${loadedTtsEngine.name || loadedTtsEngine.id} loaded` : "○ no engine loaded" }}</UiChip>
    <div class="voices-view__chips">
      <UiChip
        v-for="f in TYPE_FILTERS"
        :key="f.id"
        :selected="typeFilter === f.id"
        :title="f.id === 'all' ? 'Show every voice' : `Show only ${f.label.toLowerCase()} voices`"
        @click="typeFilter = f.id"
      >{{ f.label }} ({{ typeCounts[f.id] || 0 }})</UiChip>
    </div>
    <span class="jv-spacer" />
    <UiButton intent="secondary" size="small" :loading="genderGuessBusy"
      :disabled="genderGuessBusy"
      label="✨ Guess unknown genders"
      title="Ask the AI to label the voices the built-in dictionary doesn't know (the voice_gender feature — runs only when you click)"
      @click="guessUnknownGenders" />
    <UiButton intent="secondary" size="small" label="⤒ Import voice…"
      title="A voice exported from JustVoice (.jvvoice.zip): its clip, description or blend, and its model"
      @click="chooseVoiceFile" />
    <input ref="bundleInput" type="file" accept=".zip,application/zip" hidden @change="importVoiceFile" />
  </div>
  <PageTaskStrips :features="['voice-gender']" />

  <!-- ── The test line: one box, above the grid ───────────────────────── -->
  <div class="voices-view__bench">
    <UiField label="Text to synthesize" layout="block" class="voices-view__bench-field">
      <UiTextarea
        :modelValue="previewText"
        :rows="2"
        placeholder="The fog came in over the pier before either of them said a word."
        @update:modelValue="setPreviewText"
      />
    </UiField>
    <p class="jv-muted voices-view__bench-hint">
      Type a line, then press <strong>▶</strong> on the voice you want to hear say it.
      Every voice speaks this same line, which is what makes them comparable —
      leave it empty and they each read the standard sample instead.
    </p>
  </div>

  <!-- One audio element for the page, driven by whichever row you pressed.
       Hidden on purpose: the transport lives in that row. -->
  <audio
    ref="playerEl"
    :src="previewAudio || undefined"
    class="voices-view__audio-el"
    @timeupdate="onPlayTime"
    @loadedmetadata="onPlayTime"
    @play="playerPaused = false"
    @pause="playerPaused = true"
    @ended="onPlayEnded"
  />

  <!-- ── Voice catalog table — owns its own scroll lane ───────────────── -->
  <div class="voices-view__list">
    <!-- The kit's table, not a hand-rolled one (2026-08-21 rule: reuse the
         common component; build one in the kit when it's missing). Sorting
         and column widths come with it — this view used to own a private
         copy of both. `manual-sorting` is off: the rows here are a plain
         column sort, and needs-install rows sink via the prepared order. -->
    <UiTable
      v-if="voiceRows.length"
      class="ui-table-sticky voices-view__table"
      :data="voiceRows"
      :columns="VOICE_COLUMNS"
      data-key="id"
      :pagination="false"
      row-hover
      :row-class="voiceRowClass"
    >
      <template #name="{ row }">
        <div class="voices-view__name-cell">
          <UiButton
            intent="ghost"
            size="small"
            :loading="previewingId === row.id"
            :label="playingVoice?.id === row.id && !playerPaused ? '⏸' : '▶'"
            :title="playingVoice?.id === row.id && !playerPaused ? `Pause ${row.name}` : `Hear ${row.name} say the test line`"
            @click="playingVoice?.id === row.id ? togglePlay() : previewVoice(row)"
          />
          <strong>{{ row.name }}</strong>
          <UiTag v-if="orphanIds.includes(row.id)" intent="danger" value="orphan" style="margin-left: 6px" />
          <span v-if="playingVoice?.id === row.id" class="voices-view__transport">
            <UiSlider
              :modelValue="playTime"
              :min="0" :max="playDuration || 0" :step="0.01"
              width="short"
              :show-number="false"
              aria-label="Seek"
              @update:modelValue="seekTo($event)"
            />
            <span class="jv-mono voices-view__time">{{ playDuration ? `${fmtTime(playTime)} / ${fmtTime(playDuration)}` : fmtTime(playTime) }}</span>
          </span>
        </div>
      </template>

      <template #_gender="{ row }">
        <!-- Click-cycle gender chip per #85. -->
        <button
          type="button"
          class="voices-view__gender-chip"
          :data-gender="voiceGender(row)"
          :title="`Gender: ${voiceGender(row) || 'unset'} — click to cycle ? → F → M → N → unset`"
          @click.stop="cycleGender(row)"
        >{{ (voiceGender(row) || "?").charAt(0).toUpperCase() }}</button>
      </template>

      <template #source="{ row }">
        <UiTag :intent="voiceTypeVariant(voiceKind(row))" :value="voiceKindLabel(row)" />
      </template>

      <template #engine="{ row }">
        <span class="jv-muted" :title="`Engine: ${row.engine}`">{{ row._model }}</span>
        <span
          v-if="voiceLocality(row) === 'local'"
          class="jv-locality jv-locality--local"
          title="Runs on this machine — no usage cost; loads the engine into RAM/VRAM on first use"
        >LOCAL</span>
        <span
          v-else-if="voiceLocality(row) === 'self-hosted'"
          class="jv-locality jv-locality--local"
          title="An OpenAI-compatible server you run yourself — free and private"
        >SELF-HOSTED</span>
        <span
          v-else-if="voiceLocality(row) === 'online'"
          class="jv-locality jv-locality--online"
          title="External provider — needs network and may bill per character/minute"
        >ONLINE · METERED</span>
        <span
          v-if="needsInstall(row)"
          class="jv-locality jv-locality--online"
          :title="`${row.engine} runs on the speech runtime, which isn't installed yet — install it on AI Settings → Speech engines before this voice can play`"
        >NEEDS INSTALL</span>
      </template>

      <!-- The full name, never the code: "American English", not "en-US". -->
      <template #_lang="{ row }">
        <span class="jv-muted">{{ row._lang }}</span>
        <span v-if="(row.speaks || []).length > 1" class="jv-hint voices-view__more"
          :title="`On ${row._model} this voice can also speak: ${row.speaks.map((c) => languageName(c) || c).join(', ')}`"
        > +{{ row.speaks.length - 1 }}</span>
      </template>

      <template #directed="{ row }">
        <UiTag v-if="row.directed_by" :intent="directionCell(row.directed_by, tagCount(capabilityRows[row.model])).intent"
          :title="directionCell(row.directed_by).title">{{ directionCell(row.directed_by, tagCount(capabilityRows[row.model])).label }}</UiTag>
      </template>

      <template #used="{ row }">
        <span v-if="personasByVoice[row.id]?.length" class="jv-muted"
          :title="personasByVoice[row.id].map((p) => p.name).join(', ')">
          🎭 {{ personasByVoice[row.id].slice(0, 2).map((p) => p.name).join(", ") }}<template v-if="personasByVoice[row.id].length > 2"> +{{ personasByVoice[row.id].length - 2 }}</template>
        </span>
        <span v-else class="jv-hint">— unused —</span>
      </template>

      <template #actions="{ row }">
        <span class="jv-table__actions">
          <!-- The row menu — the Speech engines rows' pattern (`.ev-kebab`). -->
          <DropdownMenuRoot>
            <DropdownMenuTrigger class="ev-kebab" aria-label="Voice actions" :title="`${row.name} — actions`">⋯</DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent class="ev-menu" align="end" :side-offset="4" :collision-padding="8">
                <DropdownMenuItem class="ev-menu-item" @select="newPersonaFrom(row)">🎭 New persona from this voice</DropdownMenuItem>
                <DropdownMenuItem v-if="hasClip(row)" class="ev-menu-item" @select="copyToModel(row)">⧉ Copy to another model…</DropdownMenuItem>
                <DropdownMenuItem v-if="row.source !== 'preset'" class="ev-menu-item" @select="exportVoice(row)">⤓ Export…</DropdownMenuItem>
                <template v-if="row.source !== 'preset'">
                  <DropdownMenuSeparator class="ev-menu-sep" />
                  <DropdownMenuItem class="ev-menu-item danger" @select="deleteVoice(row)">🗑 Delete</DropdownMenuItem>
                </template>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>
        </span>
      </template>
    </UiTable>
    <EmptyState
      v-else-if="voices.length === 0"
      icon="Sparkle"
      title="No voices registered"
      message="Load an engine to see its preset voices, or make one — clone, design or blend — on a persona's page."
      action-label="Open Speech engines"
      compact
      @action="$router && $router.push?.('#engines'); window.location.hash = '#engines'"
    />
    <p v-else class="jv-muted" style="padding: 24px 0; text-align: center; font-style: italic;">
      No voices match "{{ search }}" or filter "{{ TYPE_FILTERS.find((f) => f.id === typeFilter)?.label || typeFilter }}".
    </p>
  </div>

  <!-- ── Inline inspector (preview parity §Voices voice-inspector card) ── -->
  </div><!-- /.voices-view.jv-fill — page-scroll-free pane ends here -->


</template>

<style scoped>
/* Row state paints the whole <tr>. The row lives inside UiTable, so scoped CSS
   reaches it through :deep, and the selector has to out-specify the kit's
   `.ui-table-hover .ui-table-row:hover` or hovering would erase the tint. */
.voices-view__table :deep(.ui-table-row.row-orphan) { opacity: 0.7; }
.voices-view__table :deep(.ui-table-row.voices-view__row--playing),
.voices-view__table :deep(.ui-table-row.voices-view__row--playing:hover) {
  background: var(--accent-soft);
}

/* File input inherits basic styling */
.jv-file-input {
  display: block;
  font-size: 13px;
  color: var(--ink-2);
  margin-top: 4px;
}

/* Root pane — flex column. Toolbar/banner/details stay pinned, the
   catalog list scroller (.voices-view__list) takes the leftover height
   so the OUTER .jv-content never scrolls when the catalog is long. */
.voices-view {
  display: flex;
  flex-direction: column;
}
.voices-view__list {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  margin-top: 14px;
}

/* Toolbar — search + type filter chips + + Clone primary action. */
.voices-view__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.voices-view__expand > td { background: var(--surface-2); padding: 14px 18px; }
.voices-view__expand .voices-view__inspector { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
.voices-view__fact { font-size: 13px; font-weight: 600; }
.voices-view__readonly-note { font-size: 12px; margin: 0 0 10px; }

.voices-view__chips {
  display: inline-flex;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-control);
  padding: 2px;
  gap: 2px;
}
.voices-view__chips .ui-chip {
  border: 0;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-weight: 500;
}
/* Same specificity as the rule above, declared after — without this the
   transparent background wins and the ACTIVE chip renders white-on-nothing. */
.voices-view__chips .ui-chip.is-selected {
  background: var(--accent);
  color: #fff;
}

/* ── The library bench: one test line, one explanation. ─────────────── */
.voices-view__bench {
  display: flex;
  align-items: flex-end;
  gap: 20px;
  margin: 10px 0 8px;
  flex-wrap: wrap;
}
.voices-view__bench-field { flex: 0 1 62ch; min-width: 340px; }
.voices-view__bench-field :deep(textarea) { width: 100%; }
.voices-view__bench-hint { flex: 1 1 40ch; max-width: 64ch; font-size: 12px; line-height: 1.5; margin: 0 0 2px; }
.voices-view__audio-el { display: none; }

/* The play control belongs WITH the name, and the transport appears in
   the same cell while that voice plays — one object, not a button in one
   column and a player elsewhere on the page. */
.voices-view__name-cell { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.voices-view__transport { display: inline-flex; align-items: center; gap: 8px; margin-left: 4px; }
.voices-view__time { font-size: 11px; color: var(--ink-3); }

/* Columns sized to what they hold — otherwise six columns share the whole
   window and Name becomes a near-empty 470px cell.

   This rule was keyed on `.jv-table`, which the kit's UiTable does not carry,
   so it stopped matching the moment the grid moved (2026-08-21) and the defect
   it was written to prevent came back. It now reaches the kit's own
   `.ui-table` through `:deep`. The PER-COLUMN widths went with it: a scoped
   `td` rule cannot reach a cell inside the component at all — those live on
   VOICE_COLUMNS now. `font-size` is gone too; `.ui-table` already sets 13px. */
.voices-view__table :deep(.ui-table) { width: auto; min-width: 720px; }

/* Gender chip: click-cycle ❓ → F → M → N → unset.
   ONE vocabulary: this attribute carries the LETTER `autoDetectGender` returns
   (F · M · N · ?). The word form — female/male/neutral, from `voiceGenderWord`
   — belongs to the FILTER and never reaches here. Two rules keyed on
   "female"/"male" used to sit at this spot matching nothing, and were
   overridden by the base block below in any case. */
.voices-view__gender-chip {
  appearance: none;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  color: var(--ink-2);
  width: 28px;
  height: 22px;
  border-radius: var(--r-pill);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  display: inline-grid;
  place-items: center;
  transition: background 0.1s, color 0.1s;
}
.voices-view__gender-chip:hover { background: var(--surface-2); color: var(--ink); }
.voices-view__gender-chip[data-gender="F"] { color: var(--accent); border-color: var(--accent-line); background: var(--accent-soft); }
.voices-view__gender-chip[data-gender="M"] { color: var(--info-blue, #2f74b5); border-color: rgba(47, 116, 181, 0.4); background: #eef4fb; }
.voices-view__gender-chip[data-gender="N"] { color: var(--warn-ink); border-color: var(--warn-line); background: var(--warn-bg); }
.voices-view__gender-chip[data-gender="?"] { color: var(--ink-3); border-color: var(--line); }

</style>
