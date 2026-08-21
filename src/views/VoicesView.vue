<!-- SPDX-License-Identifier: MIT -->
<script setup>
import { ref, onMounted, onActivated, computed, watch, nextTick } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast, serverUrl as apiPath } from "@delebash/llm-ui";
import { confirmDialog } from "@delebash/llm-ui";
import { readPref, writePref } from "../services/prefs.js";
import { capableRows, engineOptionsFor, rowOptions, variantToLoad } from "../services/capabilities.js";
import { voiceRowState } from "../services/voiceGrid.js";
import { UiButton, UiInput, UiTextarea, UiField, UiTag, UiChip, UiSelect, UiCheckbox, UiSegmented, UiSlider, UiTable } from "@delebash/llm-ui";
// Language CODE → the name a person reads ("en-US" → American English).
// Kit-side, because every app in the family shows a language somewhere.
import { languageName, languageOptionsFrom } from "@delebash/llm-ui";
import { EmptyState } from "@delebash/llm-ui";
// The page's tab strip is the kit's, shared with Settings and LoRA. It was a
// hand-rolled `.jv-subnav` whose tabs had drifted to 12px — under this app's
// minimum type size.
import { UiTabStrip } from "@delebash/llm-ui";
// The load bar is the Engines tab's bar — same kit component over the same
// shared task factory. This page used to fire-and-toast, so a 40-second load
// looked like a dead button (the 2026-08-21 audit's "3 hand-rolled progress
// bars"); it then briefly built the task inline, which was a second copy of
// the Engines tab's, so the factory moved into services.
import { DownloadBar } from "@delebash/llm-ui";
import { makeEngineLoadTask } from "../services/ttsJobChannel.js";
import { useVoicesStore } from "../stores/voices.js";
import { runAiEndpoint } from "@delebash/llm-ui";
import { useEnginesStore } from "../stores/engines.js";
// Training is a way to GET a voice, so its surface lives in this page's
// LoRA tab rather than off in Labs (ruling 13, 2026-08-15).
import LoraView from "./lora/LoraView.vue";

const api = useApi();
// voices / engines come from shared stores. Mutations here (clone /
// design / blend / delete / gender) call refresh() → store.reload(), so
// other views update. Store items are deeply reactive, so in-place edits
// (e.g. a gender override) reflect without rebuilding the array.
const voicesStore = useVoicesStore();
const enginesStore = useEnginesStore();
const voices = computed(() => voicesStore.items);
const engines = computed(() => enginesStore.items);

// ── Gender auto-detect + click-cycle override (lift #85). ─────────────
//
// Auto-detect rules:
//   - OpenAI voices: built-in canon (Alloy/Echo/Fable/Onyx/Nova/Shimmer + Ash/Coral/Sage/Verse/Ballad)
//   - Kokoro voices: parse <region><gender>_<name> (af_alloy = American Female, bm_george = British Male)
//   - Cloned / freeform: first-name dictionary; ambiguous names left unset
const OPENAI_VOICE_GENDER = {
  alloy:"N", echo:"M", fable:"M", onyx:"M", nova:"F", shimmer:"F",
  ash:"M", coral:"F", sage:"N", verse:"M", ballad:"M",
};
const FIRST_NAME_GENDER = {
  // Female-leaning
  sarah:"F", emma:"F", lily:"F", maya:"F", anna:"F", mara:"F", lisa:"F", rachel:"F", chloe:"F", hannah:"F", grace:"F", sophia:"F", olivia:"F", emily:"F", isabella:"F", ava:"F", mia:"F", abigail:"F", nicole:"F", katie:"F", laura:"F",
  // Male-leaning
  michael:"M", james:"M", john:"M", robert:"M", david:"M", peter:"M", paul:"M", george:"M", thomas:"M", chris:"M", brian:"M", scott:"M", mark:"M", jack:"M", henry:"M", oliver:"M", tom:"M", andrew:"M", daniel:"M",
  // Ambiguous — deliberately omitted: alex, jamie, sam, riley, charlie, taylor, jordan, robin, casey
};
function autoDetectGender(v) {
  if (v.gender_user_override) return v.gender_user_override;
  if (v.source === "preset") {
    const o = loadPresetGenderOverrides()[v.id];
    if (o) return o;
  }
  if (v.gender) return v.gender;
  if (v.engine === "openai" || v.engine?.startsWith("openai")) {
    const m = OPENAI_VOICE_GENDER[v.name?.toLowerCase()];
    if (m) return m;
  }
  if (v.engine === "kokoro") {
    // af_alloy → American Female; bm_george → British Male. The ID
    // carries the convention — the display name ('Alloy') doesn't.
    const m = /^[a-z]([fm])_/.exec((v.id || v.name || "").toLowerCase());
    if (m) return m[1] === "f" ? "F" : "M";
  }
  // Cloned / freeform voices — match leading first-name token (sarah.wav, michael.wav).
  const first = v.name?.toLowerCase()?.split(/[\s._-]/)[0];
  if (first && FIRST_NAME_GENDER[first]) return FIRST_NAME_GENDER[first];
  return "?";
}

const GENDER_CYCLE = ["?", "F", "M", "N", ""];

// Preset voices ship with the engine — no stored record to PATCH, so
// their overrides persist in the server-backed renderer prefs. Stored
// voices persist via PATCH /v1/voices/{id}.
function loadPresetGenderOverrides() {
  const m = readPref("presetGenderOverrides", {});
  return m && typeof m === "object" ? m : {};
}
function savePresetGenderOverride(id, gender) {
  const map = { ...loadPresetGenderOverrides() };
  if (gender) map[id] = gender; else delete map[id];
  writePref("presetGenderOverrides", map);
}

// ── LLM gender guess (F1 Phase 3, ruling 2: EXPLICIT button, never auto) ──
// Sends only the voices the dictionary left at "?" to the voice_gender
// feature; applies answers through the SAME persistence as a manual cycle
// (pref override for presets, PATCH for stored voices).
const genderGuessBusy = ref(false);
async function guessUnknownGenders() {
  const unknown = voices.value.filter((v) => autoDetectGender(v) === "?").slice(0, 60);
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
  const cur = autoDetectGender(v);
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
// (models.py: preset | cloned | designed | imported | blended | lora).
const typeFilter = ref("all");

const TYPE_FILTERS = [
  { id: "all",      label: "All" },
  { id: "preset",   label: "Preset" },
  { id: "cloned",   label: "Cloned" },
  { id: "designed", label: "Designed" },
  { id: "imported", label: "Imported" },
  { id: "blended",  label: "Blended" },
  { id: "lora",     label: "LoRA" },
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
const engineFilterOptions = computed(() => {
  const counts = {};
  for (const v of voices.value || []) counts[v.engine] = (counts[v.engine] || 0) + 1;
  return [
    { label: `All engines (${(voices.value || []).length})`, value: "all" },
    ...Object.entries(counts).sort().map(([id, n]) => ({ label: `${id} (${n})`, value: id })),
  ];
});

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

// Isolated engines with no venv yet (MOSS) — their static voices
// can't preview until Install runs in Engines. Tag + sort last so they
// never read as "the default voice" (user-hit: an uninstalled engine's
// stock voice listed first).
const engineMeta = computed(() => {
  const m = {};
  for (const e of engines.value || []) m[e.id] = e;
  return m;
});
// The isolation half of this test went 2026-08-22 — every engine builds
// its own environment now, so it was always true and narrowed nothing.
function needsInstall(v) {
  const e = engineMeta.value[v.engine];
  return !!e && e.status === "not_installed";
}

// Language + gender filters (2026-08-21). Both fields already ship on every
// voice from /v1/voices, so the library could always have been narrowed by
// them; only the controls were missing.
const langFilter = ref("all");
const genderFilter = ref("all");

const langFilterOptions = computed(() => {
  const counts = new Map();
  for (const v of voices.value || []) {
    const c = v.language || "";
    if (c) counts.set(c, (counts.get(c) || 0) + 1);
  }
  return languageOptionsFrom(counts.keys(), {
    allLabel: `All languages (${(voices.value || []).length})`,
    counts,
  });
});

const genderFilterOptions = computed(() => {
  const counts = {};
  for (const v of voices.value || []) {
    const g = voiceGenderWord(v) || "unset";
    counts[g] = (counts[g] || 0) + 1;
  }
  return [
    { label: "Any gender", value: "all" },
    ...Object.keys(counts)
      .sort()
      .map((g) => ({ label: `${g[0].toUpperCase()}${g.slice(1)} (${counts[g]})`, value: g })),
  ];
});

const filteredVoices = computed(() => {
  let list = voices.value || [];
  if (engineFilter.value !== "all") list = list.filter((v) => v.engine === engineFilter.value);
  if (typeFilter.value !== "all") list = list.filter((v) => v.source === typeFilter.value);
  if (langFilter.value !== "all") list = list.filter((v) => v.language === langFilter.value);
  if (genderFilter.value !== "all")
    list = list.filter((v) => (voiceGenderWord(v) || "unset") === genderFilter.value);
  if (search.value.trim()) {
    const q = search.value.trim().toLowerCase();
    list = list.filter((v) => (v.name || "").toLowerCase().includes(q) || (v.id || "").toLowerCase().includes(q));
  }
  // Needs-install voices sink to the bottom — never first-in-list.
  return [...list].sort((a, b) => needsInstall(a) - needsInstall(b));
});

/** The rows UiTable renders. The display language rides along as a field so
 *  the column can sort by the NAME people read rather than by the code. */
const voiceRows = computed(() =>
  filteredVoices.value.map((v) => ({
    ...v,
    _lang: languageName(v.language) || v.language || "",
    _gender: autoDetectGender(v) || "",
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
  { id: "source", accessorKey: "source", header: "Type", sortable: true, headerStyle: FIT, cellStyle: FIT },
  { id: "engine", accessorKey: "engine", header: "Engine", sortable: true, headerStyle: FIT, cellStyle: FIT },
  { id: "_lang", accessorKey: "_lang", header: "Language", sortable: true, headerStyle: FIT, cellStyle: FIT },
  { id: "actions", header: "", headerStyle: FIT, cellStyle: FIT },
];

/** Row STATE goes on the <tr>, through the kit's :row-class (added 2026-08-21).
 *  It briefly lived on a div inside the name cell, which dimmed one cell of an
 *  orphan row and tinted one cell of the playing row. The rule itself is pure
 *  and lives in services/voiceGrid.js, where it is unit-tested. */
function voiceRowClass(row) {
  return voiceRowState(row, orphanIds.value, playingVoice.value?.id || "");
}

const typeCounts = computed(() => {
  const list = voices.value || [];
  const cs = { all: list.length, preset: 0, cloned: 0, designed: 0, imported: 0, blended: 0, lora: 0 };
  for (const v of list) if (cs[v.source] !== undefined) cs[v.source]++;
  return cs;
});

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
          title: `Install ${mi[1]} first`,
          message: `"${v.name}" belongs to the ${mi[1]} engine, which isn't installed yet (isolated engines need their own venv built once). Open Engines to install it?`,
          confirmLabel: "Open Engines",
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
    pushToast({ message: `Preview failed: ${e.message || e}`, kind: "error" });
  } finally {
    previewingId.value = null;
  }
}

async function refresh() {
  await Promise.all([
    voicesStore.reload(),
    enginesStore.reload(),
    loadCapabilities(),
  ]);
}

const orphanIds = computed(() => {
  const ids = new Set(engines.value.map((e) => e.id));
  return voices.value.filter((v) => !ids.has(v.engine)).map((v) => v.id);
});

async function deleteVoice(id) {
  const ok = await confirmDialog({
    title: "Delete voice?",
    message: `Voice "${id}" will be permanently removed.`,
    danger: true,
    confirmLabel: "Delete",
  });
  if (!ok) return;
  try {
    await api.request(`/v1/voices/${id}`, { method: "DELETE" });
    await refresh();
    pushToast({ message: `Voice "${id}" deleted.` });
  } catch (e) {
    pushToast({ message: `Delete failed: ${e.message || e}`, kind: "error" });
  }
}

onMounted(refresh);
onMounted(loadSettingsDefault);
// Every app view runs under <KeepAlive> (App.vue), so onMounted fires
// ONCE per session. Without this, coming back to Voices after loading an
// engine elsewhere showed whatever was true the first time you opened it.
onActivated(() => { void refresh(); });
// This view was the one surface that did NOT join the `jv:health-refresh`
// contract — it refetched by hand, from its own load door only, so an engine
// loaded anywhere else left the model picker stale until you left and came
// back. Only the capability surface is fetched here: the voices and engines
// stores subscribe to the same event and reload themselves, so refetching
// them from this listener would double every request.
window.addEventListener("jv:health-refresh", () => { void loadCapabilities(); });
onMounted(() => {
  // #train used to be a Labs tab; it lands here now (ruling 13) and the
  // redirect names the tab it wanted.
  try {
    const want = window.sessionStorage?.getItem("jv.voices.acquireTab");
    if (want) {
      window.sessionStorage.removeItem("jv.voices.acquireTab");
      if (PAGE_TABS.some((t) => t.id === want)) setAcquireTab(want);
    }
  } catch { /* ignore */ }
});

// ── How you get a voice: the page's own tabs ─────────────────────────
//
// The library first, then one tab per way to get a voice. Each is named
// for the ACT (Clone), while the filter chips above the grid are named
// for the TYPE it produces (Cloned) — the same word either way, so the
// tab you used and the chip that finds the result agree. Preset has no
// tab: presets ship with an engine, they are not acquired.
const PAGE_TABS = [
  { id: "voices", label: "Voices", verb: "", capability: null },
  { id: "cloned", label: "Clone", verb: "Clone", capability: "cloning" },
  { id: "designed", label: "Design", verb: "Design", capability: "design" },
  { id: "imported", label: "Import", verb: "Import", capability: null },
  { id: "blended", label: "Blend", verb: "Blend", capability: "blending" },
  // LoRA is the only tab whose label is not a verb: it names the THING
  // (a LoRA adapter), because that is the word the field uses and the
  // word on its filter chip. Renamed from "Train"/"trained" 2026-08-21.
  { id: "lora", label: "LoRA", verb: "Train", capability: "training" },
];
// The page opens on its library, every time: a remembered tab would
// strand you on LoRA weeks later when you wanted the voice list.
const acquireTab = ref("voices");
const activeTab = computed(
  () => PAGE_TABS.find((t) => t.id === acquireTab.value) || PAGE_TABS[0],
);
const onLibraryTab = computed(() => acquireTab.value === "voices");

// GET /v1/engines/capabilities — per engine AND per variant, so a
// checkpoint family that cannot do a thing never offers it (Qwen3
// CustomVoice cannot clone; only its Base family can).
const capabilityRows = ref({});
async function loadCapabilities() {
  const r = await api.safeRequest("/v1/engines/capabilities", { engines: {} });
  capabilityRows.value = r?.engines || {};
}

const CAPABILITY_FIELD = {
  cloning: "supports_voice_cloning",
  design: "supports_voice_design",
  blending: "supports_voice_blending",
  training: "supports_training",
};
function capableFor(capability) {
  return capability
    ? capableRows(capabilityRows.value, engines.value, CAPABILITY_FIELD[capability])
    : [];
}
const activeCapableRows = computed(() => capableFor(activeTab.value.capability));

// The picker's value is a capability-row id (a checkpoint); the API wants
// the engine id, so the two stay in step here rather than at every call.
const selectedRowId = ref("");
const selectedRow = computed(
  () => activeCapableRows.value.find((o) => o.rowId === selectedRowId.value) || null,
);
watch(selectedRow, (o) => { if (o) selectedEngine.value = o.engine.id; });

// Every control the model takes, shown flat. The capability surface marks
// some knobs `advanced`, which the Generate page folds away; here you are
// deciding what a voice IS, so nothing hides behind a toggle.
const engineKnobs = computed(() => selectedRow.value?.row?.knobs || []);
const knobValues = ref({});
function seedKnobs() {
  const next = {};
  for (const k of engineKnobs.value) next[k.key] = k.default;
  knobValues.value = next;
}
function resetKnob(k) {
  knobValues.value = { ...knobValues.value, [k.key]: k.default };
}
/** Only knobs moved off their default ride along — sending a default back
 *  would pin it against a future engine change. */
function knobDelivery() {
  const engineOverrides = {};
  for (const k of engineKnobs.value) {
    const v = Number(knobValues.value[k.key]);
    if (Number.isFinite(v) && v !== Number(k.default)) engineOverrides[k.key] = v;
  }
  return Object.keys(engineOverrides).length ? { engine: engineOverrides } : {};
}
watch(engineKnobs, seedKnobs, { immediate: true });

// ── Model size + language, from the engine's own variant catalog ──────
// A family can ship more than one size (Qwen3 Base is 1.7B and 0.6B), and
// each variant declares the languages it speaks.
const variantsByEngine = ref({});
async function loadVariants(engineId) {
  if (!engineId || variantsByEngine.value[engineId]) return;
  const r = await api.safeRequest(`/v1/engines/${engineId}/models`, { variants: [] });
  variantsByEngine.value = { ...variantsByEngine.value, [engineId]: r?.variants || [] };
}
watch(selectedRow, (o) => { if (o) loadVariants(o.engine.id); });

function shortVariantLabels(list) {
  // The Size dropdown answers ONE question — which build — so its labels
  // are only the part that differs. The full variant name ("Chatterbox
  // Multilingual v2 (500M, 23 langs)") wrapped the closed control across
  // three lines; the details now live in the note under the row. Common
  // prefix off, parentheticals off — unless that collapses two variants
  // into one label, in which case the parentheticals stay.
  const names = list.map((v) => v.name || v.id);
  let prefix = names[0] || "";
  for (const n of names.slice(1)) {
    while (prefix && !n.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  const bare = names.map((n) => n.slice(prefix.length).replace(/\s*\(.*?\)/g, "").trim());
  const unique = new Set(bare).size === bare.length;
  return list.map((v, i) => ({
    label: (unique ? bare[i] : names[i].slice(prefix.length).trim()) || v.id.split("-").pop(),
    value: v.id,
  }));
}

const sizeOptions = computed(() => {
  const row = selectedRow.value;
  if (!row) return [];
  const all = variantsByEngine.value[row.engine.id] || [];
  const family = all.filter((v) => v.id === row.rowId || v.id.startsWith(`${row.rowId}-`));
  const list = family.length ? family : all;
  return list.length > 1 ? shortVariantLabels(list) : [];
});
const selectedSize = ref("");
watch(sizeOptions, (opts) => {
  if (!opts.length) { selectedSize.value = ""; return; }
  if (!opts.some((o) => o.value === selectedSize.value)) selectedSize.value = opts[0].value;
});

// The chosen build, spelled out where there is room for it — full name and
// download size — so the Size dropdown can stay one word wide.
const variantDetail = computed(() => {
  const row = selectedRow.value;
  if (!row) return "";
  const all = variantsByEngine.value[row.engine.id] || [];
  const v = all.find((x) => x.id === selectedSize.value)
    || all.find((x) => x.id === row.rowId || x.id.startsWith(`${row.rowId}-`));
  if (!v) return "";
  const size = v.size_mb >= 1024 ? `${(v.size_mb / 1024).toFixed(1)} GB` : `${v.size_mb} MB`;
  return `${v.name || v.id} — ${size} download`;
});

const languageOptions = computed(() => {
  const row = selectedRow.value;
  const all = row ? (variantsByEngine.value[row.engine.id] || []) : [];
  const chosen = all.find((v) => v.id === selectedSize.value)
    || all.find((v) => v.id === row?.rowId || v.id.startsWith(`${row?.rowId}-`));
  const langs = chosen?.languages || [];
  return [{ label: "Auto", value: "" }, ...langs.map((l) => ({ label: l, value: l }))];
});
const selectedLanguage = ref("");
watch(languageOptions, (opts) => {
  if (!opts.some((o) => o.value === selectedLanguage.value)) selectedLanguage.value = "";
});

// Clone from the speaker vector alone (Qwen3 Base's x_vector_only_mode).
// Declared per model, so the checkbox exists only where the call takes it.
const xvectorOnly = ref(false);
const supportsXvector = computed(() => !!selectedRow.value?.row?.supports_xvector_only);
watch(selectedRow, () => { xvectorOnly.value = false; });

// Controls appear only on models that USE them (user ruling 2026-08-21:
// "hide show controls based on what model uses"). Chatterbox clones from
// the sound alone; Qwen3 Base also reads what was said.
const supportsCloneText = computed(
  () => !!selectedRow.value?.row?.supports_clone_prompt_text,
);

/** What the chosen model needs next — ONE button beside the picker, not a
 *  list of every capable engine each with its own. */
const engineAction = computed(() => {
  const e = selectedRow.value?.engine;
  if (!e) return null;
  if (e.status === "not_installed") return { kind: "install", label: "⤓ Install", fn: () => installEngine(e.id) };
  if (e.status !== "loaded") return { kind: "load", label: "Load", fn: () => loadEngine(e.id) };
  return null;
});
const engineReady = computed(() => selectedRow.value?.engine?.status === "loaded");

const tabBlocker = computed(() => {
  const tab = activeTab.value;
  if (!tab.capability) return null;
  if (!activeCapableRows.value.length) {
    return `No model in this catalog can ${tab.verb.toLowerCase()} a voice yet.`;
  }
  if (!activeCapableRows.value.some((o) => o.engine.status !== "not_installed")) {
    return `Install a model below to ${tab.verb.toLowerCase()} a voice.`;
  }
  return null;
});

/** The checkpoint a tab opens on: loaded if there is one, else installed,
 *  else the first that could be. */
function firstCapableRow(tabId) {
  const tab = PAGE_TABS.find((t) => t.id === tabId);
  if (!tab?.capability) return null;
  const rows = capableFor(tab.capability);
  return rows.find((o) => o.engine.status === "loaded")
    || rows.find((o) => o.engine.status !== "not_installed")
    || rows[0] || null;
}
/** Open a tab with the form cleared. Every door goes through here — the tab
 *  strip, the return to the library after a save, and the #train deep-link —
 *  so nothing half-typed survives a tab change. (Until 2026-08-21 the reset
 *  lived in an `openAcquire()` that nothing called, so it never ran.) */
function setAcquireTab(id) {
  resetAcquireForm();
  acquireTab.value = id;
  if (id === "voices") return;
  clearCandidate();
  const row = firstCapableRow(id);
  selectedRowId.value = row?.rowId || "";
  selectedEngine.value = row?.engine.id || defaultEngine.value;
}
// The rows arrive from the server, so a tab can be open before there is
// anything to pick. Seed the moment they land.
watch(activeCapableRows, (rows) => {
  if (!onLibraryTab.value && rows.length && !selectedRow.value) {
    selectedRowId.value = firstCapableRow(acquireTab.value)?.rowId || "";
  }
});

async function installEngine(engineId) {
  try {
    await api.request(`/v1/engines/${engineId}/install`, { method: "POST" });
    pushToast({ message: `Installing ${engineId} — watch progress on Speech engines.` });
    window.location.hash = "#engines";
  } catch (e) {
    pushToast({ message: `Install failed: ${e.message || e}`, kind: "error" });
  }
}
// The build to load — resolved against the engine's real variant catalog, the
// same list the Size dropdown and the language options read.
const variantForLoad = computed(() => variantToLoad(
  selectedRow.value,
  selectedSize.value,
  variantsByEngine.value[selectedRow.value?.engine.id] || [],
));

/** A variant ROW promises a specific build. Until the engine's catalog has
 *  arrived we cannot name it, and loading anyway would quietly fall back to
 *  the server's default — Chatterbox Multilingual when the row said Turbo.
 *  The fetch is kicked off by the watcher on `selectedRow`, so this is brief. */
const loadBlocked = computed(() => !!selectedRow.value?.isVariant && !variantForLoad.value);

// The load task, rendered by the same kit DownloadBar the Engines tab uses.
// One at a time: this page loads the model the picker is on, and the picker
// holds one row.
const loadTask = ref(null);
const loadTaskTitle = ref("");

/** The build's NAME. Not `variantDetail` — that ends in "— 2.1 GB download",
 *  and a load reads weights that are already on disk. */
const variantNameForLoad = computed(() => {
  const row = selectedRow.value;
  if (!row) return "";
  const all = variantsByEngine.value[row.engine.id] || [];
  const v = all.find((x) => x.id === variantForLoad.value);
  return v?.name || v?.id || row.row?.name || row.engine.name || row.engine.id;
});

// A bar left over from a failed load belongs to the model it failed on, so it
// goes when the picker moves. Without this the error sat there wearing the new
// model's page, and Retry would have re-loaded the OLD one.
watch([selectedRowId, acquireTab], () => {
  if (loadTask.value && loadTask.value.state !== "running") loadTask.value = null;
});

async function loadEngine(engineId) {
  if (loadTask.value?.state === "running") return;
  loadTaskTitle.value = variantNameForLoad.value || engineId;
  // ONE factory, shared with the Speech engines tab: `start()` IS the load, so
  // the bar's Retry retries the real thing. See services/ttsJobChannel.js.
  const task = makeEngineLoadTask(api, engineId, { model_variant: variantForLoad.value });
  loadTask.value = task;
  // The task announces `jv:health-refresh` itself (see the channel), so a
  // Retry from the bar — which never comes back through here — updates every
  // surface too. Door 2 of the tracked "engine loads that nobody announces".
  await task.start();
  if (task.state !== "done") return;   // error/cancelled — the bar says which, and offers Retry
  pushToast({ message: `${engineId} loaded.`, kind: "success", duration: 4500 });
  loadTask.value = null;   // done bars are reaped — the "loaded" tag is the evidence
}

// ── The reference clip: drop it, browse for it, paste a URL, or record
//    it here. All four end at the same place: `cloneFile`. ─────────────
const dropActive = ref(false);
const cloneSourceUrl = ref("");
const recording = ref(false);
let mediaRecorder = null;
let recordedChunks = [];

function acceptDrop(ev) {
  dropActive.value = false;
  const f = ev.dataTransfer?.files?.[0];
  if (f) { cloneFile.value = f; cloneSourceUrl.value = ""; }
}

async function useSourceUrl() {
  const raw = cloneSourceUrl.value.trim();
  if (!raw) return;
  if (!/^https?:\/\//i.test(raw)) {
    pushToast({ message: "A local path can't be read from here — drop the file or browse for it.", kind: "error" });
    return;
  }
  try {
    const resp = await fetch(raw);
    if (!resp.ok) throw new Error(String(resp.status));
    const blob = await resp.blob();
    cloneFile.value = new File([blob], raw.split("/").pop() || "reference.wav",
      { type: blob.type || "audio/wav" });
    lastFetchedUrl = raw;
    pushToast({ message: "Audio fetched.", kind: "success" });
  } catch (e) {
    pushToast({ message: `Couldn't fetch that audio: ${e.message || e}`, kind: "error" });
  }
}

// No Fetch button — a pasted URL is simply taken (fal.ai's pattern): once the
// field holds a complete http(s) URL and the typing pauses, it fetches itself.
let lastFetchedUrl = "";
let urlFetchTimer = null;
watch(cloneSourceUrl, (v) => {
  clearTimeout(urlFetchTimer);
  const raw = (v || "").trim();
  if (!/^https?:\/\/\S+\.\S+/i.test(raw) || raw === lastFetchedUrl) return;
  urlFetchTimer = setTimeout(useSourceUrl, 600);
});

async function toggleRecord() {
  if (recording.value) { mediaRecorder?.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      for (const t of stream.getTracks()) t.stop();
      recording.value = false;
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      cloneFile.value = new File([blob], "recording.webm", { type: blob.type });
    };
    mediaRecorder.start();
    recording.value = true;
  } catch (e) {
    pushToast({ message: `Microphone unavailable: ${e.message || e}`, kind: "error" });
    recording.value = false;
  }
}

function clearClip() {
  cloneFile.value = null;
  cloneSourceUrl.value = "";
}

const clipLabel = computed(() => {
  const f = cloneFile.value;
  if (!f) return "";
  const size = f.size > 1024 * 1024
    ? `${(f.size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(f.size / 1024)} KB`;
  return `${f.name} · ${size}`;
});

// ── Audition a candidate, then keep the take you heard ────────────────
const candidateUrl = ref(null);
const candidateId = ref(null);
const candidateBusy = ref(false);

function clearCandidate() {
  // A streamed candidate's src is a stream URL, not a blob — revoking one
  // of those is meaningless. Same guard the grid's player already uses.
  if (String(candidateUrl.value || "").startsWith("blob:")) {
    URL.revokeObjectURL(candidateUrl.value);
  }
  candidateUrl.value = null;
  candidateId.value = null;
}

/** Import stores a clip as-is — there is nothing to hear that you don't
 *  already have — so it is the one tab with no audition. */
const canAudition = computed(
  () => ["cloned", "designed", "blended"].includes(acquireTab.value),
);

/** Point the result player at the streaming door. Returns false if the
 *  ticket or the stream fails, so the caller can use the POST door — which
 *  is also the one that carries the "install it / load it" dialogs.
 *
 *  A streamed candidate has NO preview_id, so it cannot be promoted with
 *  "Save this voice". That is fine and not a loss: saving a blend recomputes
 *  the vector from the recipe anyway (voice_preview_api's save route does
 *  the same), so the same recipe gives byte-identical audio. The primary
 *  button therefore keys on candidateId, not on candidateUrl. */
async function tryStreamCandidate(body) {
  let ticket;
  try {
    const r = await api.request("/v1/voices/preview/stream-ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    ticket = r?.ticket;
  } catch {
    return false;
  }
  if (!ticket) return false;

  const line = previewText.value.trim();
  const qs = line ? `?${new URLSearchParams({ text: line })}` : "";
  const url = apiPath(`/v1/voices/${ticket}/preview/stream${qs}`);

  return await new Promise((resolve) => {
    const probe = new Audio();
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      probe.removeEventListener("canplay", onOk);
      probe.removeEventListener("error", onErr);
      if (ok) {
        candidateId.value = null; // no preview to promote — see above
        candidateUrl.value = url;
      }
      resolve(ok);
    };
    const onOk = () => done(true);
    const onErr = () => done(false);
    probe.addEventListener("canplay", onOk);
    probe.addEventListener("error", onErr);
    probe.src = url;
    // The first piece's render is real work on a CPU engine; generous on
    // purpose, and a working stream fires long before this.
    setTimeout(() => done(false), 60000);
  });
}

async function auditionCandidate() {
  if (!valid.value || candidateBusy.value) return;
  candidateBusy.value = true;
  clearCandidate();
  try {
    const body = {
      engine: selectedEngine.value,
      source: acquireTab.value,
      preview_text: previewText.value.trim() || undefined,
      delivery: knobDelivery(),
    };
    // A language is sent only when one was CHOSEN. Sending "en-US" as a
    // fallback is what made every blend audition English — the server
    // takes the client's value ahead of the voice's own catalog language
    // (kokoro/engine.py), so a Mandarin mix was phonemized with English
    // rules. Omitted, the server derives it the way the save does.
    if (selectedLanguage.value) body.language = selectedLanguage.value;
    if (acquireTab.value === "cloned") {
      body.ref_wav_b64 = await fileToB64(cloneFile.value);
      body.transcript = cloneTranscript.value.trim() || "—";
      body.xvector_only = xvectorOnly.value;
    } else if (acquireTab.value === "designed") {
      body.prompt = designPrompt.value.trim();
    } else if (acquireTab.value === "blended") {
      const p = blendPayload();
      body.strategy = p.strategy;
      body.source_voice_ids = p.ids;
      body.weights = p.weights;
      if (p.segments) body.segments = p.segments;
    }
    // Blend is where you iterate — weights, listen, adjust, listen — so a
    // whole-render wait lands on every loop. Stream it: a ticket stands in
    // for the id this candidate does not have yet, and playback starts
    // after the first sentence. Any failure falls through to the POST door
    // below, which also carries the install/load dialogs.
    if (acquireTab.value === "blended" && (await tryStreamCandidate(body))) return;

    const r = await api.request("/v1/voices/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    candidateId.value = r.preview_id;
    const bin = Uint8Array.from(atob(r.wav_b64), (c) => c.charCodeAt(0));
    candidateUrl.value = URL.createObjectURL(new Blob([bin], { type: "audio/wav" }));
  } catch (e) {
    pushToast({ message: `Audition failed: ${e.message || e}`, kind: "error" });
  } finally {
    candidateBusy.value = false;
  }
}

/** Keep what you just heard — promotes the audition rather than rendering
 *  a second, different take of the same voice. */
async function saveCandidate() {
  if (!candidateId.value) return;
  busy.value = true;
  try {
    await api.request(`/v1/voices/preview/${candidateId.value}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: voiceName.value.trim() }),
    });
    pushToast({ message: `Voice "${voiceName.value.trim()}" saved.`, kind: "success" });
    clearCandidate();
    voiceName.value = "";
    await refresh();
    setAcquireTab("voices");
  } catch (e) {
    pushToast({ message: `Save failed: ${e.message || e}`, kind: "error" });
  } finally {
    busy.value = false;
  }
}

// ── Form state ───────────────────────────────────────────────────────────────

const busy = ref(false);

// shared
const selectedEngine = ref("");
const voiceName = ref("");

// clone
const cloneFile = ref(null);
const cloneFileEl = ref(null); // hidden <input type=file> — the drop strip clicks it
const cloneTranscript = ref("");

// design
const designPrompt = ref("");

// import
const importFile = ref(null);
const importFileEl = ref(null); // hidden <input type=file> — the drop strip clicks it
const importTranscript = ref("");

// ── The four ways to make a voice out of other voices ────────────────
//
// Rewritten 2026-08-21. The previous set was three strategies that all
// compiled to ONE server call, because that call was the only math the
// server had. Two consequences, both corrected here:
//
//   - the old Extrapolate walked between TWO voices with weights
//     [1−t, t]. That is a two-row Blend wearing a costume — a control,
//     not a capability. It is replaced by the real operation:
//     mean + k·(voice − mean), which pushes ONE voice away from the
//     average voice and is the only way to make a voice MORE itself.
//     (The two-voice walk survives as two Blend rows at 0.4 / 0.6.)
//
//   - Recombine was refused here as "random per-dimension shuffles …
//     an exploration toy". That was simply false, and the false comment
//     is why the feature was dropped. It is contiguous slicing of the
//     style vector, and the halves are not arbitrary: Kokoro is
//     StyleTTS2-based, where ref_s[:, :128] conditions the decoder and
//     ref_s[:, 128:] the prosody predictor. Verified in StyleTTS2's own
//     inference notebook AND measured on our installed pack: splice two
//     voices at the seam and the DURATION follows the second half while
//     the BRIGHTNESS follows the first. So it is offered by what it
//     does — timbre from one voice, prosody from another.
const BLEND_MAX_SOURCES = 5;
// The server resolves this pseudo-id to the pack's centroid
// (engines/blending.py MEAN_SOURCE) — keep the two spellings in step.
const MEAN_SOURCE = "__pack_mean__";

const blendSources = ref([
  { voice_id: "", weight: 1.0 },
  { voice_id: "", weight: 1.0 },
]);

const blendStrategy = ref("blend");
const BLEND_STRATEGIES = [
  { value: "blend", label: "Blend" },
  { value: "extrapolate", label: "Extrapolate" },
  { value: "vector", label: "Vector math" },
  { value: "recombine", label: "Recombine" },
];
const STRATEGY_HINT = {
  blend:
    "A weighted mix of the picked voices. The weights are shares, so what matters is their ratio — the percentages below are what actually gets used.",
  extrapolate:
    "Amplify what makes one voice distinctive, by pushing it away from the average of every voice in the pack. 1 is the voice unchanged.",
  vector:
    "Voice arithmetic: add the voices carrying traits you want, subtract one carrying traits you don't. Try Michael + Heart − Sarah for a male Heart.",
  recombine:
    "Take a voice's timbre — what it sounds like — and have it speak with another voice's prosody: its rhythm, pacing and intonation.",
};

// Extrapolate: one voice, one dial. 1.5 = "past itself", the reason the
// strategy exists; 1 would be a no-op.
const extrapolateVoice = ref("");
const extrapolateK = ref(1.5);
const EXTRAPOLATE_MARKS = [
  { value: 0, label: "0 · average" },
  { value: 1, label: "1 · unchanged" },
  { value: 3, label: "3 · extreme" },
];

// Vector math: the sign comes from WHICH GROUP a row is in, so there is
// no signed slider to decode. Strength stays positive within a group.
const vectorAdd = ref([{ voice_id: "", weight: 1.0 }, { voice_id: "", weight: 1.0 }]);
const vectorSub = ref([{ voice_id: "", weight: 1.0 }]);

// Recombine: named for the two things the seam actually separates. The
// custom-range editor is the same operation with the seam moved, so it
// lives behind a toggle rather than being the default control.
const timbreVoice = ref("");
const prosodyVoice = ref("");
const recombineCustom = ref(false);
const recombineSegments = ref([
  { voice_id: "", start: 0, end: 0.5 },
  { voice_id: "", start: 0.5, end: 1 },
]);

/** Everything the chosen strategy sends: ids + weights, or segments. */
function blendPayload() {
  const s = blendStrategy.value;

  if (s === "extrapolate") {
    const k = Number(extrapolateK.value) || 0;
    // mean + k·(v − mean) = k·v + (1−k)·mean — an ordinary weighted
    // combination, which is why no new server operation was needed.
    return {
      strategy: s,
      ids: extrapolateVoice.value ? [extrapolateVoice.value, MEAN_SOURCE] : [],
      weights: [k, 1 - k],
      segments: null,
    };
  }

  if (s === "vector") {
    const add = vectorAdd.value.filter((r) => r.voice_id);
    const sub = vectorSub.value.filter((r) => r.voice_id);
    return {
      strategy: s,
      ids: [...add, ...sub].map((r) => r.voice_id),
      weights: [
        ...add.map((r) => Math.abs(Number(r.weight) || 0)),
        ...sub.map((r) => -Math.abs(Number(r.weight) || 0)),
      ],
      segments: null,
    };
  }

  if (s === "recombine") {
    const segs = recombineCustom.value
      ? recombineSegments.value.filter((g) => g.voice_id)
      : timbreVoice.value && prosodyVoice.value
        ? [
            { voice_id: timbreVoice.value, start: 0, end: 0.5 },
            { voice_id: prosodyVoice.value, start: 0.5, end: 1 },
          ]
        : [];
    return { strategy: s, ids: segs.map((g) => g.voice_id), weights: [], segments: segs };
  }

  const picked = blendSources.value.filter((r) => r.voice_id);
  return {
    strategy: s,
    ids: picked.map((r) => r.voice_id),
    weights: picked.map((r) => Number(r.weight) || 0),
    segments: null,
  };
}

const blendWeightSum = computed(() =>
  blendPayload().weights.reduce((a, b) => a + b, 0),
);
/** How many voices are actually chosen — the gate for every "you haven't
 *  finished" message, so none of them fire at an untouched form. */
const blendPickedCount = computed(() => blendPayload().ids.filter((id) => id !== MEAN_SOURCE).length);

/** What each Blend row is really worth once the server divides by Σw.
 *  The slider number is NOT the share: 2 beside 1 reads as "double" and
 *  means 67% / 33%, so the percentage is shown and the number is not. */
/** Segment bounds are fractions of the style vector; nobody reads 0.5. */
function pctLabel(n) {
  return `${Math.round((Number(n) || 0) * 100)}%`;
}

function blendShare(idx) {
  const picked = blendSources.value.filter((r) => r.voice_id);
  const total = picked.reduce((a, r) => a + (Number(r.weight) || 0), 0);
  const row = blendSources.value[idx];
  if (!row?.voice_id || total <= 0) return "";
  return `${Math.round(((Number(row.weight) || 0) / total) * 100)}%`;
}

// Import: WHICH model speaks as this clip. Rendering an imported voice
// sends its clip to the stamped engine as a clone reference, so the
// stamp is a real decision — it used to be whatever engine happened to
// be selected (an arbitrary bind, found 2026-08-20). Cloning-capable
// engines only, because clone-reference synthesis is what an imported
// voice does at render.
const importEngine = ref("");
// Until 2026-08-21 this passed the FIELD name into capableFor, which maps
// CAPABILITY names — the lookup missed, the list was always empty, and
// the picker sat dead ("model that speaks the clip drop down not
// working"). The shared builder takes the field directly.
const importEngineOptions = computed(() =>
  engineOptionsFor(capabilityRows.value, engines.value, "supports_voice_cloning"),
);
// No `immediate`: the callback reads settingsDefaultEngine, declared
// below — and at setup time the options are empty anyway (capabilities
// arrive async and re-fire this watch).
watch(importEngineOptions, (opts) => {
  if (!opts.some((o) => o.value === importEngine.value)) {
    importEngine.value =
      opts.find((o) => o.value === settingsDefaultEngine.value)?.value
      || opts[0]?.value || "";
  }
});

// Settings → Generation "Default TTS engine" — preferred for create
// flows; a loaded engine outranks it (no point spinning up a second).
const settingsDefaultEngine = ref("");
async function loadSettingsDefault() {
  try {
    const s = await api.safeRequest("/v1/settings", {});
    settingsDefaultEngine.value = s?.engines?.default_tts_engine || "";
  } catch { /* keep fallback */ }
}
const defaultEngine = computed(() => {
  const loaded = engines.value.find((e) => e.status === "loaded");
  if (loaded) return loaded.id;
  if (settingsDefaultEngine.value && engines.value.some((e) => e.id === settingsDefaultEngine.value)) {
    return settingsDefaultEngine.value;
  }
  return engines.value[0]?.id ?? "";
});

// ── The voices you can mix, and how to find one among 54 ─────────────
//
// Every row in this list belongs to the SAME engine (it is filtered by
// selectedEngine just below), so the old "Bella (kokoro)" label spent its
// one distinguishing slot on the only field that never varies, and dropped
// the two that do. Language and gender ship on /v1/voices already —
// Kokoro's presets carry both from engines/kokoro/voices.py — so they
// were always there to show (2026-08-21).
const blendLangFilter = ref("all");
const blendGenderFilter = ref("all");

const blendableVoices = computed(() =>
  voices.value.filter((v) => v.engine === selectedEngine.value),
);

const blendLangOptions = computed(() => {
  const counts = new Map();
  for (const v of blendableVoices.value) {
    const c = v.language || "";
    if (c) counts.set(c, (counts.get(c) || 0) + 1);
  }
  return languageOptionsFrom(counts.keys(), {
    allLabel: `All languages (${blendableVoices.value.length})`,
    counts,
  });
});

const blendGenderOptions = computed(() => {
  const counts = {};
  for (const v of blendableVoices.value) {
    const g = voiceGenderWord(v);
    if (g) counts[g] = (counts[g] || 0) + 1;
  }
  return [
    { label: "Any gender", value: "all" },
    ...Object.keys(counts)
      .sort()
      .map((g) => ({ label: `${g[0].toUpperCase()}${g.slice(1)} (${counts[g]})`, value: g })),
  ];
});

/** The gender word behind the grid's one-letter chip, so the filter and
 *  the chip can never disagree about what a voice is. */
function voiceGenderWord(v) {
  const g = (autoDetectGender(v) || "").toLowerCase();
  if (g.startsWith("f")) return "female";
  if (g.startsWith("m")) return "male";
  if (g.startsWith("n")) return "neutral";
  return "";
}

const engineVoiceOptions = computed(() =>
  blendableVoices.value
    .filter(
      (v) =>
        (blendLangFilter.value === "all" || v.language === blendLangFilter.value) &&
        (blendGenderFilter.value === "all" ||
          voiceGenderWord(v) === blendGenderFilter.value),
    )
    // Stock ids read like names (`af_bella`), but a cloned voice is minted
    // `voice_<32 hex>` (storage/voices.py:76) — that is not a label, so the
    // NAME leads and the facts that tell two Bellas apart follow it.
    .map((v) => {
      const bits = [languageName(v.language), voiceGenderWord(v)].filter(Boolean);
      return {
        label: bits.length ? `${v.name} · ${bits.join(" · ")}` : v.name,
        value: v.id,
      };
    }),
);

/** Every picker on this tab opens the same way. */
const VOICE_PLACEHOLDER = { label: "— pick a voice —", value: "" };
const voicePickerOptions = computed(() => [VOICE_PLACEHOLDER, ...engineVoiceOptions.value]);

const engineOptions = computed(() =>
  engines.value.map((e) => ({
    label: `${e.name ?? e.id}${e.status === "loaded" ? "" : " (not loaded)"}`,
    value: e.id,
  }))
);

// Models offered in the picker: one entry per CHECKPOINT, not per engine.
// Chatterbox Turbo and Multilingual are one engine id apart and take
// materially different controls, so collapsing them to "Chatterbox" both
// hid one and handed you the other one's knobs.
const tabEngineOptions = computed(() => {
  if (!activeTab.value.capability) return engineOptions.value;
  // The shared builder (services/capabilities.js): load state from the
  // engines store — the same mechanism as the topbar pill — and a-z order.
  return rowOptions(
    capabilityRows.value, engines.value, CAPABILITY_FIELD[activeTab.value.capability],
  );
});

const blendableVoiceCount = computed(
  () => voices.value.filter((v) => v.engine === selectedEngine.value).length,
);

// Card titles for the source card — what the tab actually collects.
const SOURCE_TITLE = {
  cloned: "Reference recording",
  designed: "Voice description",
  imported: "Audio clip",
  blended: "The mix",
};

const valid = computed(() => {
  if (!voiceName.value.trim()) return false;
  if (activeTab.value.capability && !selectedEngine.value) return false;
  if (acquireTab.value === "cloned") return !!cloneFile.value;
  if (acquireTab.value === "designed") return !!designPrompt.value.trim();
  if (acquireTab.value === "imported") return !!importFile.value;
  if (acquireTab.value === "blended") return !blendBlocker.value;
  return false;
});

/** ONE place that decides whether a mix is ready, and says why not. The
 *  gate and the message used to be computed separately and could disagree
 *  (the sum-of-weights warning fired at an untouched form while the button
 *  stayed silent). Empty string = ready. */
const blendBlocker = computed(() => {
  const p = blendPayload();
  if (p.strategy === "extrapolate") {
    return extrapolateVoice.value ? "" : "Pick the voice to amplify.";
  }
  if (p.strategy === "recombine") {
    if (recombineCustom.value) {
      if (p.segments.length < 2) return "Pick a voice for each segment.";
      const covered = [...p.segments].sort((a, b) => a.start - b.start);
      if (covered[0].start > 0 || covered[covered.length - 1].end < 1)
        return "The segments must cover 0% to 100% — a style vector with holes does not render.";
      return "";
    }
    if (!timbreVoice.value) return "Pick the voice to take the timbre from.";
    if (!prosodyVoice.value) return "Pick the voice to take the prosody from.";
    return "";
  }
  if (p.strategy === "vector") {
    if (!vectorAdd.value.some((r) => r.voice_id)) return "Add at least one voice.";
    if (!p.weights.some((w) => w !== 0)) return "Every weight is zero — nothing to combine.";
    return "";
  }
  if (p.ids.length < 2) return "Pick at least two voices to mix.";
  if (blendWeightSum.value <= 0) return "The weights must add up to more than zero.";
  return "";
});

// Why the button is off — never a disabled control with no explanation.
// Not "name it" though: the empty Name box says that itself.
const submitBlocker = computed(() => {
  if (valid.value || busy.value) return "";
  if (!voiceName.value.trim()) return "";
  if (activeTab.value.capability && !selectedEngine.value) return "Pick a model.";
  const map = {
    cloned: "Choose a recording.",
    designed: "Describe the voice you want.",
    imported: "Choose an audio clip.",
    blended: blendBlocker.value,
  };
  return map[acquireTab.value] || "";
});

const busyLabel = computed(() => {
  const map = { cloned: "Cloning…", designed: "Designing…", imported: "Importing…", blended: "Blending…" };
  return map[acquireTab.value] ?? "Working…";
});

const submitLabel = computed(() => {
  const map = {
    cloned: "Clone voice", designed: "Design voice",
    imported: "Import clip", blended: "Blend voices",
  };
  return map[acquireTab.value] ?? "Submit";
});

/** Clear every acquire form. Called by `setAcquireTab`, which is the only
 *  way a tab changes. */
function resetAcquireForm() {
  voiceName.value = "";
  cloneFile.value = null;
  cloneTranscript.value = "";
  cloneSourceUrl.value = "";
  designPrompt.value = "";
  importFile.value = null;
  importTranscript.value = "";
  blendSources.value = [
    { voice_id: "", weight: 1.0 },
    { voice_id: "", weight: 1.0 },
  ];
  // Every strategy's own state clears too — a voice left in the Recombine
  // pickers would silently ride along into the next mix.
  extrapolateVoice.value = "";
  extrapolateK.value = 1.5;
  vectorAdd.value = [{ voice_id: "", weight: 1.0 }, { voice_id: "", weight: 1.0 }];
  vectorSub.value = [{ voice_id: "", weight: 1.0 }];
  timbreVoice.value = "";
  prosodyVoice.value = "";
  recombineCustom.value = false;
  recombineSegments.value = [
    { voice_id: "", start: 0, end: 0.5 },
    { voice_id: "", start: 0.5, end: 1 },
  ];
  blendLangFilter.value = "all";
  blendGenderFilter.value = "all";
}

function addBlendSource() {
  if (blendSources.value.length >= BLEND_MAX_SOURCES) return;
  blendSources.value.push({ voice_id: "", weight: 1.0 });
}

function removeBlendSource(idx) {
  if (blendSources.value.length > 2) blendSources.value.splice(idx, 1);
}

function fileToB64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function submit() {
  if (!valid.value || busy.value) return;
  busy.value = true;
  try {
    const engine = selectedEngine.value;
    const name = voiceName.value.trim();
    let body;

    if (acquireTab.value === "cloned") {
      const ref_wav_b64 = await fileToB64(cloneFile.value);
      body = {
        engine, name, ref_wav_b64, language: selectedLanguage.value || "en-US",
        ...(cloneTranscript.value.trim() ? { transcript: cloneTranscript.value.trim() } : {}),
      };
      await api.request("/v1/voices/clone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      pushToast({ message: `Voice "${name}" cloned.` });
    } else if (acquireTab.value === "designed") {
      body = { engine, name, prompt: designPrompt.value.trim(), language: selectedLanguage.value || "en-US" };
      await api.request("/v1/voices/design", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      pushToast({ message: `Voice "${name}" designed.` });
    } else if (acquireTab.value === "imported") {
      const wav_b64 = await fileToB64(importFile.value);
      body = {
        engine: importEngine.value || engine,
        name, wav_b64, language: selectedLanguage.value || "en-US",
        ...(importTranscript.value.trim() ? { transcript: importTranscript.value.trim() } : {}),
      };
      await api.request("/v1/voices/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      pushToast({ message: `Voice "${name}" imported.` });
    } else if (acquireTab.value === "blended") {
      const p = blendPayload();
      body = {
        engine, name,
        strategy: p.strategy,
        source_voice_ids: p.ids,
        weights: p.weights,
        ...(p.segments ? { segments: p.segments } : {}),
      };
      await api.request("/v1/voices/blend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      pushToast({ message: `Voice "${name}" blended.` });
    }

    await refresh();
    voiceName.value = "";
  } catch (e) {
    pushToast({ message: `${activeTab.value.verb} failed: ${e.message || e}`, kind: "error" });
  } finally {
    busy.value = false;
  }
}

// Voice type → UiTag intent mapping
function voiceTypeVariant(source) {
  // One distinct tint per type (v11): neutral / green / solid-green /
  // gold / blue / violet — so the column reads at a glance.
  // Returns shared UiTag intents.
  if (source === "preset") return "ghost";
  if (source === "cloned") return "success";
  if (source === "designed") return "solid";
  if (source === "blended") return "accent2";
  if (source === "lora") return "info";
  if (source === "imported") return "violet";
  return "ghost";
}


</script>

<template>
  <!-- Single-root .jv-fill so the page itself doesn't scroll — only the
       voice catalog list scrolls within its own container. Toolbar +
       banner + add-more details stay pinned at the top of the pane. -->
  <div class="voices-view jv-fill">
  <!-- ── The page's tabs: the library, then one per way to get a voice.
       Tab names are the ACT (Clone); the filter chips below are the TYPE
       it produces (Cloned). ─────────────────────────────────────────── -->
  <!-- NOT `v-model`: every tab change has to go through `setAcquireTab`, which
       is the only door that clears the acquire form. -->
  <UiTabStrip
    :model-value="acquireTab"
    :tabs="PAGE_TABS"
    aria-label="How to get a voice"
    @update:model-value="setAcquireTab"
  />

  <!-- ── Toolbar: search + engine + type filters (library tab only) ───── -->
  <div v-show="onLibraryTab" class="voices-view__toolbar">
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
  </div>

  <!-- ── One acquisition surface per tab ──────────────────────────────
       Input on the left (what the voice is made of, every control the
       chosen model takes), Result on the right (hear it, then keep it). -->
  <div v-if="!onLibraryTab" class="voices-view__acquire">

      <!-- LoRA is a whole workflow, not a form: Preparer, Dataset and
           Training live inside it as sub-tabs. -->
      <LoraView v-if="acquireTab === 'lora'" />

      <div v-else class="jv-split">
        <div class="jv-split__col">
          <p v-if="tabBlocker" class="jv-banner jv-banner--warn">{{ tabBlocker }}</p>

          <div class="jv-card">
            <div class="jv-card__header"><h3 class="jv-card__title">{{ SOURCE_TITLE[acquireTab] }}</h3></div>
            <div class="jv-card__body jv-col jv-col--start">

            <!-- Clone -->
          <template v-if="acquireTab === 'cloned'">
            <div
              class="voices-view__drop"
              :class="{ 'voices-view__drop--active': dropActive, 'voices-view__drop--filled': !!cloneFile }"
              @dragover.prevent="dropActive = true"
              @dragleave.prevent="dropActive = false"
              @drop.prevent="acceptDrop"
            >
              <input ref="cloneFileEl" type="file" accept="audio/*" @change="cloneFile = $event.target.files[0]" />
              <template v-if="cloneFile">
                <div class="voices-view__drop-row">
                  <span class="voices-view__clip">♫ {{ clipLabel }}</span>
                  <UiButton intent="ghost" size="small" label="✕" title="Remove this clip" @click="clearClip" />
                </div>
              </template>
              <template v-else>
                <div class="voices-view__drop-row">
                  <UiInput
                    v-model="cloneSourceUrl" width="full"
                    placeholder="Paste an audio URL — it fetches itself"
                    @keydown.enter="useSourceUrl"
                  />
                  <UiButton
                    intent="secondary" size="small" label="Browse…"
                    title="Pick a recording from your files"
                    @click="cloneFileEl?.click()"
                  />
                  <UiButton
                    :intent="recording ? 'danger-outline' : 'secondary'"
                    size="small"
                    :label="recording ? '■ Stop recording' : '🎙 Record'"
                    :title="recording ? 'Stop and use what you just recorded' : 'Record a reference clip with your microphone'"
                    @click="toggleRecord"
                  />
                </div>
                <p class="jv-hint">
                  Drag a recording anywhere into this box, paste a URL, browse, or record.
                  10 s to 2 minutes of one person speaking — WAV, MP3, M4A, FLAC or OGG.
                </p>
              </template>
            </div>

            <!-- Only models that READ the words show this field — on the
                 others it would be a control that changes nothing. -->
            <template v-if="supportsCloneText">
              <UiField label="What's said in the recording" layout="block" class="jv-stretch">
                <UiTextarea
                  v-model="cloneTranscript"
                  width="prose"
                  :disabled="xvectorOnly"
                  placeholder="Type the words from the clip, exactly as spoken."
                  :rows="2"
                />
              </UiField>
              <p class="jv-hint">
                This model listens to the clip while reading these words, so a
                word-for-word match gives a truer copy. Skip it and the copy
                still works — just less exact.
              </p>

              <UiCheckbox
                v-if="supportsXvector"
                v-model="xvectorOnly"
                label="Skip the words — clone from the sound alone (faster to set up, less exact)"
              />
            </template>
          </template>

          <!-- Design -->
          <template v-else-if="acquireTab === 'designed'">
            <UiField label="Describe the voice" layout="block" class="jv-stretch">
              <UiTextarea v-model="designPrompt" width="prose" placeholder="a gravel-voiced harbour-master in his seventies, unhurried" :rows="3" />
            </UiField>
            <p class="jv-hint">
              Age, accent, texture, pace, mood — the model reads this the way a director reads a note.
            </p>
          </template>

          <!-- Import -->
          <template v-else-if="acquireTab === 'imported'">
            <div
              class="voices-view__drop"
              :class="{ 'voices-view__drop--active': dropActive, 'voices-view__drop--filled': !!importFile }"
              @dragover.prevent="dropActive = true"
              @dragleave.prevent="dropActive = false"
              @drop.prevent="(e) => { dropActive = false; importFile = e.dataTransfer?.files?.[0] || importFile; }"
            >
              <input ref="importFileEl" type="file" accept="audio/*" @change="importFile = $event.target.files[0]" />
              <template v-if="importFile">
                <div class="voices-view__drop-row">
                  <span class="voices-view__clip">♫ {{ importFile.name }}</span>
                  <UiButton intent="ghost" size="small" label="✕" title="Remove this clip" @click="importFile = null" />
                </div>
              </template>
              <template v-else>
                <div class="voices-view__drop-row">
                  <span class="voices-view__drop-lead">Drop an audio clip here</span>
                  <span class="jv-spacer" />
                  <UiButton
                    intent="secondary" size="small" label="Browse…"
                    title="Pick an audio clip from your files"
                    @click="importFileEl?.click()"
                  />
                </div>
                <p class="jv-hint">Drag a clip anywhere into this box, or browse for one.</p>
              </template>
            </div>
            <UiField label="What the clip says (optional)" layout="block" class="jv-stretch">
              <UiTextarea v-model="importTranscript" width="prose" placeholder="The words spoken in the clip." :rows="2" />
            </UiField>
          </template>

          <!-- Blend -->
          <template v-else-if="acquireTab === 'blended'">
            <UiSegmented
              v-model="blendStrategy"
              :options="BLEND_STRATEGIES"
              size="small"
              aria-label="How the voices combine"
            />
            <p class="jv-hint">{{ STRATEGY_HINT[blendStrategy] }}</p>

            <p v-if="blendableVoiceCount < 2" class="jv-banner jv-banner--warn">
              Blending mixes voices this model already has, and there are
              {{ blendableVoiceCount }}. Load it to see its voices.
            </p>

            <template v-else>
              <!-- 54 voices across 9 languages is a list you navigate, not
                   one you scroll. Both facts are on every voice already. -->
              <div class="jv-field-row">
                <UiField label="Language" layout="block">
                  <UiSelect v-model="blendLangFilter" :options="blendLangOptions" width="name" />
                </UiField>
                <UiField label="Gender" layout="block">
                  <UiSelect v-model="blendGenderFilter" :options="blendGenderOptions" width="id" />
                </UiField>
              </div>

              <!-- Extrapolate: ONE voice, pushed away from the average voice. -->
              <template v-if="blendStrategy === 'extrapolate'">
                <UiField label="Voice to amplify" layout="block">
                  <UiSelect v-model="extrapolateVoice" width="name" :options="voicePickerOptions" />
                </UiField>
                <UiField label="Intensity" layout="block">
                  <UiSlider
                    v-model="extrapolateK"
                    :min="0" :max="3" :step="0.05"
                    width="regular"
                    :marks="EXTRAPOLATE_MARKS"
                    aria-label="How far past itself to push the voice"
                  />
                </UiField>
                <p class="jv-hint">
                  Above 1 exaggerates what makes this voice unlike the others. Far
                  above it, the voice leaves the range the model was trained on and
                  can start to break up.
                </p>
              </template>

              <!-- Vector math: the sign is the GROUP, not a negative number. -->
              <template v-else-if="blendStrategy === 'vector'">
                <p class="voices-view__grouphead">Voices to add — traits you want</p>
                <div v-for="(row, idx) in vectorAdd" :key="`add${idx}`" class="voices-view__wrow">
                  <UiSelect v-model="row.voice_id" width="name" :options="voicePickerOptions" />
                  <UiSlider v-model="row.weight" :min="0" :max="2" :step="0.05" width="short" aria-label="How strongly this voice counts" />
                  <UiButton
                    v-if="vectorAdd.length > 1"
                    intent="ghost" size="small" label="✕"
                    title="Remove this voice" @click="vectorAdd.splice(idx, 1)"
                  />
                </div>
                <UiButton
                  v-if="vectorAdd.length + vectorSub.length < BLEND_MAX_SOURCES"
                  intent="secondary" size="small" label="+ Add a voice"
                  @click="vectorAdd.push({ voice_id: '', weight: 1.0 })"
                />

                <p class="voices-view__grouphead">Voices to subtract — traits you don't</p>
                <div v-for="(row, idx) in vectorSub" :key="`sub${idx}`" class="voices-view__wrow">
                  <UiSelect v-model="row.voice_id" width="name" :options="voicePickerOptions" />
                  <UiSlider v-model="row.weight" :min="0" :max="2" :step="0.05" width="short" aria-label="How strongly this voice is removed" />
                  <UiButton
                    v-if="vectorSub.length > 1"
                    intent="ghost" size="small" label="✕"
                    title="Remove this voice" @click="vectorSub.splice(idx, 1)"
                  />
                </div>
                <UiButton
                  v-if="vectorAdd.length + vectorSub.length < BLEND_MAX_SOURCES"
                  intent="secondary" size="small" label="+ Subtract a voice"
                  @click="vectorSub.push({ voice_id: '', weight: 1.0 })"
                />
                <p class="jv-hint">
                  This one keeps its full strength instead of being averaged down,
                  so the result is the arithmetic you asked for.
                </p>
              </template>

              <!-- Recombine: named for what the seam separates. -->
              <template v-else-if="blendStrategy === 'recombine'">
                <template v-if="!recombineCustom">
                  <div class="jv-field-row">
                    <UiField label="Timbre from" layout="block">
                      <UiSelect v-model="timbreVoice" width="name" :options="voicePickerOptions" />
                    </UiField>
                    <UiField label="Prosody from" layout="block">
                      <UiSelect v-model="prosodyVoice" width="name" :options="voicePickerOptions" />
                    </UiField>
                  </div>
                  <p class="jv-hint">
                    Timbre is what the voice sounds like; prosody is its rhythm,
                    pacing and intonation. They live in separate halves of the
                    voice's style data, which is what makes this possible.
                  </p>
                </template>

                <template v-else>
                  <table class="jv-table voices-view__blend-tbl">
                    <thead><tr><th>Voice</th><th>From</th><th>To</th><th></th></tr></thead>
                    <tbody>
                      <tr v-for="(seg, idx) in recombineSegments" :key="`seg${idx}`">
                        <td><UiSelect v-model="seg.voice_id" width="name" :options="voicePickerOptions" /></td>
                        <td><UiSlider v-model="seg.start" :min="0" :max="1" :step="0.01" width="short" :format="pctLabel" aria-label="Segment start" /></td>
                        <td><UiSlider v-model="seg.end" :min="0" :max="1" :step="0.01" width="short" :format="pctLabel" aria-label="Segment end" /></td>
                        <td>
                          <UiButton
                            v-if="recombineSegments.length > 2"
                            intent="ghost" size="small" label="✕"
                            title="Remove this segment" @click="recombineSegments.splice(idx, 1)"
                          />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <UiButton
                    v-if="recombineSegments.length < BLEND_MAX_SOURCES"
                    intent="secondary" size="small" label="+ Add a segment"
                    @click="recombineSegments.push({ voice_id: '', start: 0, end: 1 })"
                  />
                  <p class="jv-hint">
                    0–50% is timbre, 50–100% is prosody. The segments have to cover
                    the whole range — a style vector with holes in it does not render.
                  </p>
                </template>

                <UiCheckbox
                  v-model="recombineCustom"
                  label="Cut somewhere other than the timbre/prosody seam"
                />
              </template>

              <!-- Blend: shares. -->
              <template v-else>
                <table class="jv-table voices-view__blend-tbl">
                  <thead><tr><th>Voice</th><th>Weight</th><th>Share</th><th></th></tr></thead>
                  <tbody>
                    <tr v-for="(src, idx) in blendSources" :key="idx">
                      <td>
                        <UiSelect v-model="src.voice_id" width="name" :options="voicePickerOptions" />
                      </td>
                      <td>
                        <UiSlider
                          v-model="src.weight"
                          :min="0" :max="1" :step="0.05"
                          width="short"
                          aria-label="This voice's share of the mix"
                        />
                      </td>
                      <!-- The weight is not the share: the mix divides by the
                           weights' sum, so 1 beside 0.5 is 67% / 33%. -->
                      <td class="jv-mono jv-muted">{{ blendShare(idx) }}</td>
                      <td>
                        <UiButton
                          v-if="blendSources.length > 2"
                          intent="ghost" size="small" label="✕"
                          title="Remove this voice from the mix" @click="removeBlendSource(idx)"
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
                <UiButton
                  v-if="blendSources.length < BLEND_MAX_SOURCES"
                  intent="secondary" size="small" label="+ Add a voice"
                  @click="addBlendSource"
                />
              </template>

              <!-- One message, and only once you have done enough for it to
                   mean something. It used to read "Weights sum to 0.00" beside
                   sliders showing 2 and 1, on an untouched form. -->
              <p v-if="blendPickedCount >= 1 && blendBlocker" class="jv-hint">{{ blendBlocker }}</p>
            </template>
          </template>

            </div>
          </div>

          <!-- Everything this model takes, flat — its own card. -->
          <div v-if="engineKnobs.length" class="jv-card">
            <div class="jv-card__header">
              <h3 class="jv-card__title">{{ selectedRow?.row?.display_name || "Model" }} settings</h3>
            </div>
            <div class="jv-card__body voices-view__knobs">
            <div v-for="k in engineKnobs" :key="k.key" class="voices-view__knob">
              <label class="voices-view__knob-label" :title="k.hint">{{ k.label }}</label>
              <!-- One control, not a range wired by hand to a number box:
                   UiSlider owns both halves (the number stays editable, which
                   is how you hit an exact 0.35). -->
              <UiSlider
                :modelValue="Number(knobValues[k.key])"
                :min="k.min" :max="k.max" :step="k.step"
                width="short"
                :aria-label="k.label"
                @update:modelValue="knobValues = { ...knobValues, [k.key]: Number($event) }"
              />
              <span class="voices-view__knob-unit">{{ k.unit }}</span>
              <UiButton
                intent="ghost" size="small" label="↺"
                :disabled="Number(knobValues[k.key]) === Number(k.default)"
                :title="`Back to the model default (${k.default})`"
                @click="resetKnob(k)"
              />
            </div>
            </div>
          </div>
        </div>

        <div class="jv-split__col">
          <div class="jv-card">
            <div class="jv-card__header"><h3 class="jv-card__title">New voice</h3></div>
            <div class="jv-card__body jv-col jv-col--start">
              <div class="jv-field-row">
                <UiField v-if="activeTab.capability" label="Model" layout="block">
                  <UiSelect v-model="selectedRowId" :options="tabEngineOptions" width="name" />
                </UiField>
                <UiField v-if="sizeOptions.length" label="Size" layout="block">
                  <UiSelect v-model="selectedSize" :options="sizeOptions" width="id" />
                </UiField>
                <UiButton
                  v-if="engineAction"
                  intent="secondary"
                  :disabled="engineAction.kind === 'load' && (loadTask?.state === 'running' || loadBlocked)"
                  :label="engineAction.label"
                  :title="engineAction.kind === 'load' && loadBlocked
                    ? 'Reading this model\'s builds…'
                    : `${engineAction.label} ${selectedRow?.engine?.name || selectedEngine}`"
                  @click="engineAction.fn"
                />
                <UiTag v-else-if="engineReady" intent="success" value="loaded" />
              </div>
              <!-- The same kit DownloadBar the Engines tab renders, over the
                   same shared task — progress, cancel, Retry and the error all
                   read identically wherever a model loads. Guarded on `state`,
                   not on the task's existence: Dismiss resets a terminal task
                   to the empty state, and a bar with no state is a titled
                   nothing. (That is the kit's own idiom — QuickSetup and
                   LuBookSearchSetup guard the same way.) -->
              <DownloadBar v-if="loadTask?.state" :title="loadTaskTitle" :task="loadTask" done-label="Loaded" />
              <p v-if="variantDetail" class="jv-hint">{{ variantDetail }}</p>
              <div class="jv-field-row">
                <UiField label="Name" layout="block">
                  <UiInput v-model="voiceName" placeholder="e.g. Sarah" width="name" />
                </UiField>
                <UiField v-if="acquireTab === 'imported'" label="Model that speaks as this clip" layout="block">
                  <UiSelect v-model="importEngine" :options="importEngineOptions" width="name" />
                </UiField>
                <!-- Hidden on Blend: the mix inherits its sources' languages —
                     the endpoint derives them; this control never reached the
                     saved voice there (verified 2026-08-20). -->
                <UiField
                  v-if="languageOptions.length > 1 && acquireTab !== 'blended'"
                  label="Language" layout="block"
                >
                  <UiSelect v-model="selectedLanguage" :options="languageOptions" width="id" />
                </UiField>
              </div>
            </div>
          </div>

          <div class="jv-card">
            <div class="jv-card__header"><h3 class="jv-card__title">Result</h3></div>
            <div class="jv-card__body jv-col jv-col--start">

          <UiField v-if="canAudition" label="Text to synthesize" layout="block" class="jv-stretch">
            <UiTextarea
              :modelValue="previewText"
              :rows="3"
              placeholder="The fog came in over the pier before either of them said a word."
              @update:modelValue="setPreviewText"
            />
          </UiField>

          <!-- The commit button touches the text it acts on (2026-08-21
               ruling: "blend under synthesize text, play where it is at").
               It used to sit below the result box, which pushed it a whole
               empty panel away from the field above it. Play stays with the
               player, where the thing it plays appears. -->
          <div class="jv-btn-group">
            <UiButton
              intent="primary"
              :disabled="!valid || busy"
              :loading="busy"
              :label="busy ? busyLabel : (candidateId ? 'Save this voice' : submitLabel)"
              :title="candidateId ? 'Keep the take you just heard' : ''"
              @click="candidateId ? saveCandidate() : submit()"
            />
          </div>
          <p v-if="submitBlocker" class="jv-muted">{{ submitBlocker }}</p>

          <!-- The result box STAYS, always. The 2026-08-21 ruling moved the
               commit button up ("blend under synthesize text") and left this
               alone ("play where it is at") — so Play keeps its place below
               the result, and the layout does not jump when audio arrives. -->
          <div class="voices-view__result-box">
            <audio v-if="candidateUrl" :src="candidateUrl" controls autoplay class="jv-audio-inline" />
            <p v-else class="jv-muted voices-view__result-idle">
              {{ canAudition
                ? "Nothing rendered yet — press Play to hear it."
                : "An imported clip is stored as-is, so there is nothing to audition." }}
            </p>
          </div>

          <div v-if="canAudition" class="jv-btn-group">
            <UiButton
              intent="secondary"
              :disabled="!valid || candidateBusy || !engineReady"
              :loading="candidateBusy"
              :label="candidateBusy ? 'Rendering…' : '▶ Play'"
              :title="engineReady ? 'Render a sample with these settings' : 'Load the model first'"
              @click="auditionCandidate"
            />
          </div>
            </div>
          </div>
        </div>
      </div>
  </div>

  <!-- ── The test line: one box, above the grid ───────────────────────── -->
  <div v-show="onLibraryTab" class="voices-view__bench">
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
  <div v-show="onLibraryTab" class="voices-view__list">
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
          :data-gender="autoDetectGender(row)"
          :title="`Gender: ${autoDetectGender(row) || 'unset'} — click to cycle ? → F → M → N → unset`"
          @click.stop="cycleGender(row)"
        >{{ (autoDetectGender(row) || "?").charAt(0).toUpperCase() }}</button>
      </template>

      <template #source="{ row }">
        <UiTag :intent="voiceTypeVariant(row.source)" :value="row.source" />
      </template>

      <template #engine="{ row }">
        <span class="jv-mono jv-muted">{{ row.engine }}</span>
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
          :title="`${row.engine} is an isolated engine with no venv yet — Install it in Engines before this voice can play`"
        >NEEDS INSTALL</span>
      </template>

      <!-- The full name, never the code: "American English", not "en-US". -->
      <template #_lang="{ row }">
        <span class="jv-muted">{{ row._lang }}</span>
      </template>

      <template #actions="{ row }">
        <span class="jv-table__actions">
          <UiButton
            v-if="row.source !== 'preset'"
            intent="danger-outline"
            size="small"
            label="✕"
            :title="`Delete ${row.name}`"
            @click="deleteVoice(row.id)"
          />
        </span>
      </template>
    </UiTable>
    <EmptyState
      v-else-if="voices.length === 0"
      icon="Sparkle"
      title="No voices registered"
      message="Load an engine to see its preset voices, or clone a new voice from a reference WAV. JustVoice ships with 54 Kokoro presets out of the box."
      action-label="Open Speech engines"
      compact
      @action="$router && $router.push?.('#engines'); window.location.hash = '#engines'"
    />
    <p v-else class="jv-muted" style="padding: 24px 0; text-align: center; font-style: italic;">
      No voices match "{{ search }}" or filter "{{ typeFilter }}".
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
/* The 20px under the strip was `.jv-subnav`'s own `margin-bottom`. The kit
   component sets no outer spacing — that is the consumer's business — so it
   is restored here. A child component's ROOT element carries the parent's
   scope id, so this scoped rule reaches it without `:deep`. */
.ui-tabstrip { margin-bottom: 20px; }
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
/* ── The new-voice panel ──────────────────────────────────────────────
   Input on the left, Result on the right, on the canonical .jv-split
   grid. Layout classes here are canonical (styles.css); this block keeps
   only what is specific to THIS view's widgets. */
.voices-view__acquire { margin-top: 8px; }
.voices-view__blend-tbl { width: auto; min-width: 380px; }
/* Weight / position sliders (blend strategies). Track width is a chosen
   control size, same as the old knob tracks. */
.voices-view__wrow { display: flex; align-items: center; gap: 10px; }
/* Vector math's two groups: a quiet heading so "add" and "subtract" are
   read as sections, not as decoration on the first row under them. */
.voices-view__grouphead {
  margin: 10px 0 2px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-2);
}
.voices-view__grouphead:first-child { margin-top: 0; }

/* Drop target: the thing you can actually drop on, plus the two other
   ways in (browse, record) and what a good clip looks like. */
/* One reference-audio group, fal.ai's shape: a LONG url box with the
   other ways in beside it, the whole bordered box is the drop target,
   one hint below listing everything it accepts. */
.voices-view__drop {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1.5px dashed var(--line-strong);
  border-radius: var(--r-control);
  background: var(--surface-2);
}
.voices-view__drop--active { border-color: var(--accent); background: var(--accent-soft); }
.voices-view__drop--filled { padding: 10px 14px; }
.voices-view__drop-row { display: flex; align-items: center; gap: 8px; width: 100%; }
.voices-view__drop-row .ui-input { flex: 1; }
.voices-view__drop-row .voices-view__clip { flex: 1; }
.voices-view__drop-lead { font-weight: 600; font-size: 13px; }
.voices-view__clip { font-size: 12.5px; font-weight: 600; }
.voices-view__drop input[type="file"] { display: none; }
/* Per-model controls: label, slider, number, unit, reset — every one the
   model takes, none folded away. The card provides the frame. */
/* One knob per row on a grid: label / track / number / unit / reset.
   The track is the continuous control — it takes the row's spare width
   (a wider track is finer control, the way the mock and the Qwen demo
   draw sliders); everything else is content-sized. */
.voices-view__knobs {
  display: grid;
  /* label · slider (track + its own number box) · unit · reset. Every column
     is content-sized: UiSlider carries its own width, so nothing here stretches
     to the card and the row ends where the reset button ends. Was five columns
     with a `minmax(160px, 1fr)` track, from when the range and the number were
     two separate controls wired together by hand. */
  grid-template-columns: max-content max-content max-content max-content;
  gap: 8px 12px;
  align-items: center;
  justify-content: start;
}
.voices-view__knob { display: contents; }
.voices-view__knob-label { font-size: 12px; color: var(--ink-2); }
.voices-view__knob-unit { font-size: 11.5px; color: var(--ink-3); min-width: 22px; }

.voices-view__result-box {
  width: 100%;
  min-height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-control);
}
.voices-view__result-idle { font-size: 12px; text-align: center; margin: 0; }

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
