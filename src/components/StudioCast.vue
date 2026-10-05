<!-- SPDX-License-Identifier: MIT -->
<!--
  Studio · Cast — give each speaker a persona (decided 2026-09-29).

  A SPEAKER is a person in this book: a name, the other names the text uses
  ("Also called") and who they are — what Discover finds and Script gives
  lines to. A PERSONA is a finished spoken voice from the library: a voice
  (which carries its model) plus pace, pitch, gain, direction and effects. Cast gives each
  speaker a persona, and one persona can play many speakers — change it once and
  all of them change. This is the mock's Cast (docs/plans/mock/_s3.html):
  speakers on the left, personas on the right.

  Until 2026-09-29 one persona row was both the person and the sound, so this
  screen assigned VOICES to personas. That is gone: a persona's voice and
  settings are edited on its own page ("Edit their persona →").

  Each persona row reads the server's persona answer (2026-10-03, persona
  build P7): its model, how it can be directed and the language it speaks —
  the same words as the Personas page. ▶ plays the persona itself. A card
  warns when its persona speaks another language than the book.

  Removing a speaker deletes it from the book and its lines go back to No
  speaker, so it asks first, naming the lines (decided 2026-09-29).
  Smart-assign applies its matches straight away, as it always has.
-->
<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  EmptyState, UiButton, UiCheckbox, UiInput, UiSelect, UiTable, UiTag, UiTextarea,
  confirmDialog, languageName, promptDialog, pushToast, withAiTask,
} from "@delebash/llm-ui";
import { useApi } from "../stores/api.js";
import PageTaskStrips from "./PageTaskStrips.vue";
import CastNewPersonas from "./CastNewPersonas.vue";
import { splitByName, voicesForBook } from "../services/newPersonas.js";
import { usePersonasStore } from "../stores/personas.js";
import { projectsService } from "../services/projects.js";
import { readPref, writePref } from "../services/prefs.js";
import { handleTermsRefusal } from "../services/engineTerms.js";
import { DIRECTION_OPTIONS, directionCell, sameLanguage, tagCount } from "../services/personaFacts.js";
import { facetChoices, facetOptions, narrowed } from "../services/facets.js";
import { auditionPersona } from "../services/voiceAudition.js";
import { voiceGenderWord } from "../services/voiceGender.js";

const props = defineProps({
  project: { type: Object, required: true },
  // The book's speakers — GET /v1/projects/{id}/speakers:
  // [{id, name, aliases, description, persona_id, persona_name, role_label, lines}].
  speakers: { type: Array, default: () => [] },
  // The library of finished voices.
  personas: { type: Array, default: () => [] },
  voices: { type: Array, default: () => [] },
  engines: { type: Array, default: () => [] },
});
// `changed` — the speakers changed; `{ moved }` > 0 when lines changed speaker
// with it (Studio re-reads the chapters' counts then). `go` — open a step.
const emit = defineEmits(["changed", "go"]);

const api = useApi();
const router = useRouter();

const isGame = computed(() => props.project?.project_type === "game_voicelines");
const personaById = computed(() => Object.fromEntries(props.personas.map((p) => [p.id, p])));
const voiceById = computed(() => Object.fromEntries(props.voices.map((v) => [v.id, v])));
const engineById = computed(() => Object.fromEntries(props.engines.map((e) => [e.id, e])));

const narrator = computed(() => props.speakers.find((s) => s.role_label === "narrator") || null);
// The grid: everyone but the narrator, who has the card above it. A game
// sheet has no narrator section, so all of them.
const listed = computed(() => (isGame.value
  ? props.speakers
  : props.speakers.filter((s) => s.id !== narrator.value?.id)));

const selectedId = ref(null);
watch(() => props.project?.id, () => { selectedId.value = null; });
const selected = computed(() => props.speakers.find((s) => s.id === selectedId.value) || null);

// ── What a speaker's cast says ───────────────────────────────────────────
const personaOf = (s) => (s?.persona_id ? personaById.value[s.persona_id] || null : null);
// The model that speaks a persona is its voice's — the server's persona answer
// carries its name (2026-10-03).
const personaEngine = (p) => p?.model_name || "";
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
// The mock's line under each card: "June · qwen3 · 61 lines", or what blocks it.
function castLine(s) {
  const p = personaOf(s);
  if (p?.voice_id) {
    return { ok: true, text: [p.name, personaEngine(p), s.lines ? plural(s.lines, "line") : ""].filter(Boolean).join(" · ") };
  }
  const why = p ? `⚠ ${p.name} has no voice` : "⚠ no persona";
  return { ok: false, text: s.lines ? `${why} · ${plural(s.lines, "line")} blocked` : why };
}
// "⚠ speaks Korean — the book is English" (decided 2026-10-03: "so Cast can
// warn on a mismatch"). Nothing when the book's language isn't set.
function languageWarning(s) {
  const p = personaOf(s);
  const book = props.project?.language;
  if (!p?.speaks || !book || sameLanguage(p.speaks, book)) return "";
  return `⚠ speaks ${languageName(p.speaks) || p.speaks} — the book is ${languageName(book) || book}`;
}
const unassigned = computed(() => listed.value.filter((s) => !s.persona_id).length);
// "40 lines can't render until Harbek and Renn have a persona."
const uncast = computed(() => props.speakers.filter((s) => s.lines > 0 && !s.persona_id));
const uncastLines = computed(() => uncast.value.reduce((n, s) => n + s.lines, 0));
function andList(names) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// Cast-level engine notice (kept from the old Cast, item 6): says when the
// cast spans engines (render-time swapping) or uses metered online voices.
function voiceLocality(v) {
  const e = engineById.value[v.engine];
  if (!e) return null;
  if (e.self_hosted) return "self-hosted";
  return e.backend === "managed" ? "local" : "online";
}
const castEngineNotice = computed(() => {
  const voiced = props.speakers
    .map((s) => voiceById.value[personaOf(s)?.voice_id])
    .filter(Boolean);
  if (!voiced.length) return "";
  const engineIds = [...new Set(voiced.map((v) => v.engine))];
  const metered = new Set(voiced.filter((v) => voiceLocality(v) === "online").map((v) => v.id)).size;
  const bits = [];
  if (engineIds.length > 1) {
    bits.push(`this cast spans ${engineIds.length} engines (${engineIds.join(", ")}) — chapters will swap engines while rendering`);
  }
  if (metered) {
    bits.push(`${metered} voice${metered === 1 ? "" : "s"} use${metered === 1 ? "s" : ""} an online provider — billed per use, text leaves this machine`);
  }
  return bits.join(" · ");
});

// Deterministic avatar colours — the mock gives every speaker its own hue.
const AVATAR_COLORS = ["#3a7d63", "#7c5cbf", "#b3552e", "#2e7d8a", "#a8763e", "#947b2f", "#c98aa7", "#5b7a99", "#b04a3e"];
function colorFor(name) {
  let h = 0;
  for (const c of String(name || "?")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
// The first meaningful line of "Who they are" doubles as the card's role
// line. Imported sheets often carry a "Voice hint:" block — skip it.
function roleLine(s) {
  for (const line of (s?.description || "").split("\n")) {
    const t = line.trim();
    if (t && !/^voice hint:?$/i.test(t)) return t;
  }
  return "";
}

// ── The persona library (right) ──────────────────────────────────────────
const personaQuery = ref("");
// Model, can be directed, language — the Personas page's filters. The model
// choice is remembered (the engine choice it replaced stays unread in prefs).
const personaModelFilter = ref(readPref("studioPersonaModelFilter", ""));
watch(personaModelFilter, (v) => { writePref("studioPersonaModelFilter", v || ""); });
const personaDirectionFilter = ref("");
const personaLanguageFilter = ref("");
// Each filter lists only what the others leave (decided 2026-10-05,
// services/facets.js) — Kokoro + Written direction was "No personas match this
// filter." A remembered model with no personas left stays in the list with (0).
const personaFilters = computed(() => [
  { key: "model", value: personaModelFilter.value, test: (p, m) => p.model === m },
  { key: "direction", value: personaDirectionFilter.value, test: (p, d) => p.directed_by === d },
  { key: "language", value: personaLanguageFilter.value, test: (p, c) => p.speaks === c },
  { key: "search", value: personaQuery.value.trim().toLowerCase(),
    test: (p, q) => (p.name || "").toLowerCase().includes(q) || (p.note || "").toLowerCase().includes(q) },
]);
const modelOptions = computed(() => {
  const names = Object.fromEntries(props.personas.map((p) => [p.model, p.model_name || p.model]));
  return [{ value: "", label: "All models" },
    ...facetOptions(props.personas, personaFilters.value, "model", (p) => p.model, (m, n) => `${names[m] || m} (${n})`)];
});
const directionOptions = computed(() =>
  facetChoices(props.personas, personaFilters.value, "direction", DIRECTION_OPTIONS, (p, d) => p.directed_by === d));
const languageOptions = computed(() => [
  { value: "", label: "All languages" },
  ...facetOptions(props.personas, personaFilters.value, "language", (p) => p.speaks, (c, n) => `${languageName(c) || c} (${n})`),
]);
const shownPersonas = computed(() => narrowed(props.personas, personaFilters.value));
// Who in this book each persona plays — "✓ June, Marius".
const playsHere = computed(() => {
  const out = {};
  for (const s of props.speakers) {
    if (s.persona_id) out[s.persona_id] = out[s.persona_id] ? `${out[s.persona_id]}, ${s.name}` : s.name;
  }
  return out;
});
// Can it be directed? The server's answer for the persona's voice and model
// (`directed_by`), in the Personas page's words.
const caps = ref({});
onMounted(async () => {
  const r = await api.safeRequest("/v1/engines/capabilities", { engines: {} });
  caps.value = r?.engines || {};
});
function directed(p) {
  if (!p.voice_id) return { intent: "secondary", label: "no voice", title: "This persona has no voice yet — pick one on its page." };
  return directionCell(p.directed_by, tagCount(caps.value[p.model]));
}

// ＋ New persona — opens a blank persona; Save brings you back here with it
// given to the selected speaker (decided 2026-10-03).
function newPersona() {
  const query = { project: props.project.id };
  if (selected.value) query.for = selected.value.id;
  router.push({ name: "persona", params: { id: "new" }, query });
}

// ── Actions ─────────────────────────────────────────────────────────────
const busy = ref(false);

// Click a persona: casts the selected speaker; click the one that plays them
// again to un-cast.
async function assign(persona) {
  const s = selected.value;
  if (!s || busy.value) return;
  const same = s.persona_id === persona.id;
  busy.value = true;
  try {
    await projectsService.updateSpeaker(s.id, { persona_id: same ? null : persona.id });
    emit("changed");
    pushToast({
      kind: "success",
      duration: 3000,
      message: same ? `Unassigned ${persona.name} from ${s.name}.` : `Assigned ${persona.name} to ${s.name}.`,
    });
  } catch (e) {
    pushToast({ kind: "error", message: `Assign failed: ${e?.message || e}` });
  } finally {
    busy.value = false;
  }
}

// The selected speaker's card saves each field when you leave it. The draft
// resets only when a DIFFERENT speaker is selected: a save reloads the
// speakers, and resetting on that reload wiped whatever was being typed in the
// next field (found 2026-09-29 — tab from Also called into Who they are, type,
// and the text vanished).
const draft = ref({ name: "", aliases: "", description: "" });
const FIELD_OF = {
  name: (s) => s.name,
  aliases: (s) => (s.aliases || []).join(", "),
  description: (s) => s.description || "",
};
function resetDraft(s, only = null) {
  if (!s) {
    draft.value = { name: "", aliases: "", description: "" };
    return;
  }
  for (const k of only ? [only] : Object.keys(FIELD_OF)) draft.value[k] = FIELD_OF[k](s);
}
watch(() => selected.value?.id, () => resetDraft(selected.value), { immediate: true });
async function saveField(field) {
  const s = selected.value;
  if (!s) return;
  let body;
  if (field === "name") {
    const name = draft.value.name.trim();
    if (!name || name === s.name) { draft.value.name = s.name; return; }
    body = { name };
  } else if (field === "aliases") {
    const list = draft.value.aliases.split(",").map((a) => a.trim()).filter(Boolean);
    if (list.join("|") === (s.aliases || []).join("|")) return;
    body = { aliases: list };
  } else {
    if (draft.value.description === (s.description || "")) return;
    body = { description: draft.value.description };
  }
  try {
    const saved = await projectsService.updateSpeaker(s.id, body);
    if (saved) resetDraft(saved, field);
    emit("changed");
  } catch (e) {
    pushToast({ kind: "error", message: `Save failed: ${e?.message || e}` });
    resetDraft(s, field);
  }
}
// Pronouns (persona build P9): read by Script's Analyze and Smart-assign, never heard.
const PRONOUN_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "he/him", label: "he/him" },
  { value: "she/her", label: "she/her" },
  { value: "they/them", label: "they/them" },
  { value: "it/its", label: "it/its" },
];
async function savePronouns(value) {
  const s = selected.value;
  if (!s || (value || null) === (s.pronouns || null)) return;
  try {
    await projectsService.updateSpeaker(s.id, { pronouns: value || null });
    emit("changed");
  } catch (e) {
    pushToast({ kind: "error", message: `Save failed: ${e?.message || e}` });
  }
}
function blurOnEnter(e) {
  if (e.key === "Enter") e.target.blur();
}

async function addSpeaker() {
  const name = await promptDialog({ title: "Add a speaker", label: "Name", confirmLabel: "Add" });
  if (!name || !String(name).trim()) return;
  try {
    const sp = await projectsService.addSpeaker(props.project.id, { name: String(name).trim() });
    selectedId.value = sp.id;
    emit("changed");
    pushToast({
      kind: "success",
      message: sp.persona_id
        ? `Added ${sp.name} — played by ${sp.persona_name}, the persona of that name.`
        : `Added ${sp.name} — now pick a persona.`,
    });
  } catch (e) {
    pushToast({ kind: "error", message: `Add failed: ${e?.message || e}` });
  }
}

// Removing deletes the speaker from the book, so it asks first, naming the
// lines: "Remove Nettle from the cast? 22 lines will have no speaker."
async function removeSpeaker(s) {
  const ok = await confirmDialog({
    title: `Remove ${s.name} from the cast?`,
    message: s.lines ? `${plural(s.lines, "line")} will have no speaker.` : "",
    confirmLabel: "Remove",
    danger: true,
  });
  if (!ok) return;
  try {
    await projectsService.removeSpeaker(s.id);
    if (selectedId.value === s.id) selectedId.value = null;
    emit("changed", { moved: s.lines });
    pushToast({ kind: "success", message: `${s.name} removed from the cast.` });
  } catch (e) {
    pushToast({ kind: "error", message: `Remove failed: ${e?.message || e}` });
  }
}

async function clearCast() {
  const cast = props.speakers.filter((s) => s.persona_id);
  if (!cast.length) return;
  const ok = await confirmDialog({
    title: "Clear cast?",
    message: `Unassign personas from all ${plural(cast.length, "speaker")}. The speakers stay — only the persona links go.`,
    confirmLabel: "Clear cast",
    danger: true,
  });
  if (!ok) return;
  busy.value = true;
  try {
    await projectsService.uncastAll(props.project.id);
    emit("changed");
    pushToast({ kind: "warning", message: "Cleared every assignment. The speakers stay." });
  } catch (e) {
    pushToast({ kind: "error", message: `Clear cast failed: ${e?.message || e}` });
  } finally {
    busy.value = false;
  }
}

// Any speaker can be the narrator — a first-person narrator reads the prose
// and speaks their own lines in one persona. Ticking Narrator on a card moves
// the role there (one per book), and the server moves the narration Analyze
// decided with it; lines you set stay where you put them.
async function setNarrator(s) {
  if (!s || s.id === narrator.value?.id || busy.value) return;
  busy.value = true;
  try {
    const r = await projectsService.setNarrator(props.project.id, s.id);
    const moved = r?.moved_lines || 0;
    emit("changed", { moved });
    pushToast({
      kind: "success",
      message: `${s.name} narrates now${moved ? ` — ${plural(moved, "line")} of narration moved to them` : ""}.`,
    });
  } catch (e) {
    pushToast({ kind: "error", message: `Couldn't change the narrator: ${e?.message || e}` });
  } finally {
    busy.value = false;
  }
}

// No book gets a narrator on its own (2026-09-29): this, or a card's Narrator
// tick, is how one comes. The server makes a speaker called Narrator — or
// adopts the book's own — cast with a persona called Narrator if the library
// has one (the exact-name rule every new speaker follows).
async function addNarrator() {
  if (busy.value) return;
  busy.value = true;
  try {
    const r = await projectsService.addNarrator(props.project.id);
    const moved = r?.moved_lines || 0;
    emit("changed", { moved });
    pushToast({
      kind: "success",
      message: `Narrator added to the cast${moved ? ` — ${plural(moved, "narration line")} now read by it` : ""}.`,
    });
  } catch (e) {
    pushToast({ kind: "error", message: `Add Narrator failed: ${e?.message || e}` });
  } finally {
    busy.value = false;
  }
}

// A speaker as the language model reads them — Smart-assign and New personas.
const speakerForAi = (s) => ({
  id: s.id, name: s.name, description: s.description, aliases: s.aliases || [], pronouns: s.pronouns || null,
});
// The one gender answer (your override, the voice's own, its id or first
// name — services/voiceGender.js), lower-case; none when it isn't known.
function genderForAi(v) {
  const word = voiceGenderWord(v);
  return word && word !== "?" ? word.toLowerCase() : null;
}

// Smart-assign: the language model matches each speaker (name and who they
// are) to a persona (name, its voice's gender and language, its note on how
// it sounds), and the matches apply straight away.
const smartBusy = ref(false);
async function smartAssign() {
  const people = listed.value;
  if (!people.length) {
    pushToast({ kind: "info", message: "No speakers in this project to assign." });
    return;
  }
  if (!props.personas.length) {
    pushToast({ kind: "info", message: "No personas to assign from." });
    return;
  }
  smartBusy.value = true;
  const stats = [plural(people.length, "speaker"), plural(props.personas.length, "persona")];
  try {
    const applied = await withAiTask({
      feature: "smart_assign",
      label: `Smart-assign · ${plural(people.length, "speaker")}`,
      meta: { projectId: props.project.id },
      stats,
      onRetry: () => smartAssign(),
    }, async (task) => {
      const r = await api.request("/v1/llm/smart-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: task.signal,
        body: JSON.stringify({
          characters: people.map(speakerForAi),
          // The persona's voice's gender and the language the persona really
          // speaks (the server's `speaks`), as every page shows them.
          voices: props.personas.map((p) => ({
            id: p.id,
            name: p.name,
            gender: genderForAi(voiceById.value[p.voice_id]),
            language: p.speaks || p.language || null,
            tone: p.note || null,
          })),
        }),
      });
      let count = 0;
      for (const [speakerId, personaId] of Object.entries(r?.assignments || {})) {
        if (!people.some((s) => s.id === speakerId) || !personaById.value[personaId]) continue;
        await projectsService.updateSpeaker(speakerId, { persona_id: personaId });
        count += 1;
      }
      task.setStats([...stats, `${count} applied`]);
      return { result: count, usage: r?.usage };
    });
    emit("changed");
    pushToast({
      kind: applied ? "success" : "warning",
      duration: 4500,
      message: applied
        ? `Smart-assign applied ${plural(applied, "assignment")}.`
        : "Smart-assign returned no matches.",
    });
  } catch (e) {
    pushToast({
      kind: "warning",
      duration: 6000,
      message: e?.message?.includes("501") || e?.status === 501
        ? "Smart-assign unavailable — wire an LLM provider in Engines → LLM tab."
        : `Smart-assign failed: ${e?.message || e}`,
    });
  } finally {
    smartBusy.value = false;
  }
}

// ▶ plays the persona — its stock line through the path a chapter renders
// with — in the compact audition player above the card. Same ask-before-load
// contract as every ▶ (a play never loads a model behind your back); shares
// the "Always auto-load" pref.
const previewing = ref(null);
const audition = ref(null); // { url, name, engine }
async function play(p) {
  if (!p.voice_id || previewing.value) return;
  previewing.value = p.id;
  try {
    // The shared door: asks before loading a model, as everywhere else.
    const blob = await auditionPersona(api, p);
    if (blob instanceof Blob) {
      if (audition.value?.url) URL.revokeObjectURL(audition.value.url);
      audition.value = { url: URL.createObjectURL(blob), name: p.name, engine: p.model_name || "" };
    }
  } catch (e) {
    if (handleTermsRefusal(e)) return;
    pushToast({ message: `Preview failed: ${e?.message || e}`, kind: "error", duration: 6000 });
  } finally {
    previewing.value = null;
  }
}

// ＋ New persona for the N with none (decided 2026-10-05). Everyone with no
// persona, the narrator too. A name that is already a persona in your library
// is cast with it — no new one. The rest go to the language model with the
// installed voices that speak the book's language (all of them when it isn't
// set) — the same Smart-assign call, matched to VOICES — and the proposals are
// shown before anything is made (CastNewPersonas.vue). A new persona is named
// after its speaker, with that voice and an empty note.
const personasStore = usePersonasStore();
const withoutPersona = computed(() => props.speakers.filter((s) => !s.persona_id));
const newAsk = ref(null);     // { byName, proposals } while the list is open
const newBusy = ref(false);
async function proposeNewPersonas() {
  const people = withoutPersona.value;
  if (!people.length || newBusy.value) return;
  const { byName, rest } = splitByName(people, props.personas);
  const book = props.project?.language;
  const voices = voicesForBook(props.voices, book);
  if (rest.length && !voices.length) {
    pushToast({ kind: "warning", duration: 6000,
      message: `No installed voice speaks ${languageName(book) || book} — install a speech model on AI Settings → Speech engines.` });
    if (!byName.length) return;
  }
  let proposals = [];
  if (rest.length && voices.length) {
    newBusy.value = true;
    try {
      const assignments = await withAiTask({
        feature: "smart_assign",
        label: `New personas · ${plural(rest.length, "speaker")}`,
        meta: { projectId: props.project.id },
        stats: [plural(rest.length, "speaker"), plural(voices.length, "voice")],
      }, async (task) => {
        const r = await api.request("/v1/llm/smart-assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: task.signal,
          body: JSON.stringify({
            characters: rest.map(speakerForAi),
            voices: voices.map((v) => ({
              id: v.id, name: v.name, gender: genderForAi(v), language: v.language || null, tone: v.design_prompt || null,
            })),
          }),
        });
        return { result: r?.assignments || {}, usage: r?.usage };
      });
      proposals = rest.map((sp) => ({ speaker: sp, voice: voiceById.value[assignments[sp.id]] || null }));
    } catch (e) {
      pushToast({
        kind: "warning",
        duration: 6000,
        message: e?.message?.includes("501") || e?.status === 501
          ? "New personas need a language model — set one in AI Settings."
          : `New personas failed: ${e?.message || e}`,
      });
      return;
    } finally {
      newBusy.value = false;
    }
  }
  newAsk.value = { byName, proposals };
}
async function createNewPersonas(picked) {
  const ask = newAsk.value;
  if (!ask || newBusy.value) return;
  newBusy.value = true;
  let made = 0;
  let cast = 0;
  try {
    for (const x of ask.byName) {
      await projectsService.updateSpeaker(x.speaker.id, { persona_id: x.persona.id });
      cast += 1;
    }
    for (const p of picked) {
      const persona = await api.request("/v1/personas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: p.speaker.name, voice_id: p.voice.id }),
      });
      await projectsService.updateSpeaker(p.speaker.id, { persona_id: persona.id });
      made += 1;
    }
    const said = [made ? `${plural(made, "new persona")} made and cast` : "",
      cast ? `${plural(cast, "speaker")} cast with your persona of that name` : ""].filter(Boolean);
    pushToast({ kind: "success", duration: 5000, message: `${said.join(" · ")}.` });
    newAsk.value = null;
  } catch (e) {
    pushToast({ kind: "error", duration: 7000,
      message: `Stopped after ${plural(made, "new persona")}: ${e?.message || e}` });
  } finally {
    newBusy.value = false;
    await personasStore.reload();
    emit("changed");
  }
}

function editPersona(personaId) {
  router.push({ name: "persona", params: { id: personaId } });
}

// A game sheet keeps its table (hundreds of speakers); prose kinds get cards.
const RIGHT = { textAlign: "right", width: "1%", whiteSpace: "nowrap" };
const GAME_COLUMNS = [
  { id: "portrait", header: "", headerStyle: { width: "1%" }, cellStyle: { width: "1%" } },
  { id: "name", accessorKey: "name", header: "Speaker", sortable: true },
  { id: "role", header: "Role" },
  { id: "persona", header: "Persona" },
  { id: "actions", header: "", headerStyle: RIGHT, cellStyle: RIGHT },
];
</script>

<template>
  <section class="studio-cast">
    <div class="studio-cast__cols jv-card">
      <div class="studio-cast__left">
        <!-- Compact audition player — one in-flow player atop the card serves
             every ▶ (the ruling 2026-08-15: playback is compact and in place). -->
        <div v-if="audition" class="studio-cast__audition">
          <span class="jv-muted">Audition · <strong>{{ audition.name }}</strong><template v-if="audition.engine"> · {{ audition.engine }}</template></span>
          <audio :src="audition.url" controls autoplay class="jv-audio-inline" />
        </div>

        <!-- The narrator: its own full-width card above the rest, as the mock. -->
        <template v-if="!isGame">
          <article v-if="narrator" class="jv-card studio-cast__card studio-cast__card--narrator"
            :class="{ 'studio-cast__card--selected': selectedId === narrator.id, 'studio-cast__card--unassigned': !narrator.persona_id }"
            title="The narrator carries the prose between quotes"
            @click="selectedId = narrator.id">
            <button type="button" class="studio-cast__x" title="Remove from the cast — asks first"
              @click.stop="removeSpeaker(narrator)">✕</button>
            <span class="studio-cast__portrait" :style="{ background: colorFor(narrator.name) }">{{ (narrator.name || "?").charAt(0).toUpperCase() }}</span>
            <div class="studio-cast__main">
              <strong class="studio-cast__name">{{ narrator.name }}</strong>
              <div v-if="narrator.aliases?.length" class="studio-cast__aka jv-muted">also called {{ narrator.aliases.join(", ") }}</div>
              <div class="studio-cast__role jv-muted">{{ roleLine(narrator) || "carries the narration" }}</div>
              <span class="studio-cast__tick" title="The narrator reads everything outside quote marks. To hand it over, tick Narrator on another speaker." @click.stop>
                <UiCheckbox :model-value="true" disabled label="Narrator" />
              </span>
              <div class="studio-cast__as" :class="castLine(narrator).ok ? 'studio-cast__as--ok' : 'studio-cast__as--none'">{{ castLine(narrator).text }}</div>
              <div v-if="languageWarning(narrator)" class="studio-cast__as studio-cast__as--none">{{ languageWarning(narrator) }}</div>
            </div>
          </article>
          <button v-else type="button" class="studio-cast__narrator-empty" :disabled="busy"
            title="Make a speaker called Narrator — played by your persona called Narrator if you have one"
            @click="addNarrator">
            <span class="studio-cast__portrait" :style="{ background: 'var(--surface-3)' }">N</span>
            <span class="studio-cast__narrator-empty-text">
              <strong>Add Narrator</strong>
              <span class="jv-muted">Makes a speaker called Narrator, played by your persona called Narrator if you have one. Or tick Narrator on any speaker.</span>
            </span>
          </button>
        </template>

        <div class="studio-cast__head">
          <strong>Speakers</strong>
          <span v-if="listed.length" class="jv-muted">{{ listed.length }} · {{ unassigned }} unassigned</span>
          <span class="jv-spacer" />
          <UiButton intent="secondary" size="small" label="＋ Add"
            title="Someone Discover missed: add them, then Re-analyze or set their lines on Script." @click="addSpeaker" />
          <UiButton intent="secondary" size="small" label="✕ Clear cast" :disabled="busy || !speakers.some((s) => s.persona_id)"
            title="Unassign every persona — the speakers stay" @click="clearCast" />
          <UiButton intent="primary" size="small" label="✨ Smart-assign" :loading="smartBusy" :disabled="smartBusy"
            title="Your language model proposes a persona for each speaker from who they are" @click="smartAssign" />
          <UiButton v-if="withoutPersona.length" intent="secondary" size="small"
            :label="`＋ New persona for the ${withoutPersona.length} with none`" :loading="newBusy && !newAsk"
            :disabled="newBusy"
            title="A persona for each speaker with none — named after them, with a voice your language model matches to who they are. You see the list first."
            @click="proposeNewPersonas" />
        </div>
        <PageTaskStrips :features="['smart_assign']" :meta="{ projectId: project.id }" />
        <CastNewPersonas v-if="newAsk" :by-name="newAsk.byName" :proposals="newAsk.proposals" :busy="newBusy"
          @close="newAsk = null" @create="createNewPersonas" />
        <div v-if="castEngineNotice" class="jv-banner jv-banner--warn studio-cast__notice">{{ castEngineNotice }}</div>

        <div class="studio-cast__scroll">
          <div v-if="!listed.length" class="studio-cast__empty">
            <h4>No speakers yet</h4>
            <p v-if="isGame" class="jv-muted">Re-import the sheet — its speakers arrive here — or ＋ Add one.</p>
            <p v-else class="jv-muted">
              Run <a href="#studio" @click.prevent="emit('go', 'discover')">Discover</a> — the speakers you
              add there arrive here — or ＋ Add one.
            </p>
          </div>
          <UiTable v-else-if="isGame" class="jv-table-look" :data="listed" :columns="GAME_COLUMNS" data-key="id" row-hover
            :row-class="(row) => (selectedId === row.id ? 'studio-cast__row--selected' : '')"
            @row-click="({ data }) => (selectedId = data.id)">
            <template #portrait="{ row }">
              <span class="studio-cast__portrait studio-cast__portrait--sm" :style="{ background: colorFor(row.name) }">{{ (row.name || "?").charAt(0).toUpperCase() }}</span>
            </template>
            <template #name="{ row }"><strong>{{ row.name }}</strong></template>
            <template #role="{ row }"><span class="jv-muted studio-cast__table-role">{{ roleLine(row) }}</span></template>
            <template #persona="{ row }">
              <span :class="castLine(row).ok ? 'studio-cast__as--ok' : 'studio-cast__as--none'">{{ castLine(row).text }}</span>
              <div v-if="languageWarning(row)" class="studio-cast__as--none">{{ languageWarning(row) }}</div>
            </template>
            <template #actions="{ row }">
              <button type="button" class="jv-rowact jv-rowact--danger" title="Remove from the cast — asks first" @click.stop="removeSpeaker(row)">✕</button>
            </template>
          </UiTable>
          <div v-else class="studio-cast__grid">
            <article v-for="s in listed" :key="s.id" class="jv-card studio-cast__card"
              :class="{ 'studio-cast__card--selected': selectedId === s.id, 'studio-cast__card--unassigned': !s.persona_id }"
              :title="`Select, then click a persona to cast ${s.name}`" @click="selectedId = s.id">
              <button type="button" class="studio-cast__x" title="Remove from the cast — asks first" @click.stop="removeSpeaker(s)">✕</button>
              <span class="studio-cast__portrait" :style="{ background: colorFor(s.name) }">{{ (s.name || "?").charAt(0).toUpperCase() }}</span>
              <div class="studio-cast__main">
                <strong class="studio-cast__name">{{ s.name }}</strong>
                <div v-if="s.aliases?.length" class="studio-cast__aka jv-muted">also called {{ s.aliases.join(", ") }}</div>
                <div class="studio-cast__role jv-muted">{{ roleLine(s) }}</div>
                <span class="studio-cast__tick" @click.stop
                  :title="`Make ${s.name} the narrator — they read everything outside quote marks, and the narration Analyze decided moves to them`">
                  <UiCheckbox :model-value="false" :disabled="busy" label="Narrator"
                    @update:model-value="(v) => v && setNarrator(s)" />
                </span>
                <div class="studio-cast__as" :class="castLine(s).ok ? 'studio-cast__as--ok' : 'studio-cast__as--none'">{{ castLine(s).text }}</div>
                <div v-if="languageWarning(s)" class="studio-cast__as studio-cast__as--none">{{ languageWarning(s) }}</div>
              </div>
            </article>
          </div>

          <!-- The selected speaker (mock: the card under the grid). -->
          <div v-if="selected" class="jv-card studio-cast__detail">
            <div class="studio-cast__detail-head">
              <strong>{{ selected.name }}</strong>
              <span class="jv-muted">selected</span>
            </div>
            <div class="studio-cast__field">
              <span class="jv-eyebrow">Name</span>
              <UiInput v-model="draft.name" width="name" @blur="saveField('name')" @keydown="blurOnEnter" />
            </div>
            <div class="studio-cast__field">
              <span class="jv-eyebrow">Also called</span>
              <UiInput v-model="draft.aliases" width="path" @blur="saveField('aliases')" @keydown="blurOnEnter" />
              <span class="jv-hint">The other names the text uses, separated by commas.</span>
            </div>
            <div class="studio-cast__field">
              <span class="jv-eyebrow">Pronouns</span>
              <UiSelect :modelValue="selected.pronouns || ''" width="token" :options="PRONOUN_OPTIONS"
                @update:modelValue="savePronouns" />
              <span class="jv-hint">Read by Script's Analyze — who "she said" can be — and by Smart-assign. Never heard.</span>
            </div>
            <div class="studio-cast__field">
              <span class="jv-eyebrow">Who they are</span>
              <UiTextarea v-model="draft.description" class="studio-cast__prose" :rows="3" @blur="saveField('description')" />
              <span class="jv-hint">Read by Discover, Smart-assign and Rewrite in character. Never heard.</span>
            </div>
            <div class="studio-cast__detail-foot">
              <UiButton intent="secondary" label="Edit their persona →" :disabled="!selected.persona_id"
                :title="selected.persona_id ? '' : 'Assign a persona first'" @click="editPersona(selected.persona_id)" />
              <span class="jv-hint">Pace, pitch, gain, delivery, effects — all of it lives there.</span>
            </div>
          </div>
        </div>

        <p v-if="uncast.length" class="studio-cast__blocked jv-hint">
          {{ plural(uncastLines, "line") }} can't render until {{ andList(uncast.map((s) => s.name)) }}
          {{ uncast.length === 1 ? "has" : "have" }} a persona.
        </p>
      </div>

      <aside class="studio-cast__library">
        <div class="studio-cast__library-head">
          <strong>Personas</strong>
          <span class="jv-hint">{{ personas.length }}</span>
          <span class="jv-spacer" />
          <UiButton intent="secondary" size="small" label="＋ New persona"
            :title="selected ? `Make a persona — Save gives it to ${selected.name} and brings you back` : 'Make a persona — Save brings you back here'"
            @click="newPersona" />
        </div>
        <EmptyState v-if="!personas.length" icon="Sparkle" title="No personas yet" compact
          message="A persona is a finished voice — a voice and how it's spoken. Make one, then assign it here."
          action-label="＋ New persona" @action="newPersona" />
        <template v-else>
          <div class="studio-cast__picking">Select a speaker, then click a persona to assign it.</div>
          <div class="studio-cast__filter">
            <UiInput v-model="personaQuery" type="search" size="small" width="name" placeholder="Search by name or tone…" />
            <UiSelect v-model="personaModelFilter" width="id" title="Show only personas on one model" aria-label="Model" :options="modelOptions" />
            <UiSelect v-model="personaDirectionFilter" width="id" title="Show only personas that can be directed one way"
              aria-label="Can be directed" :options="directionOptions" />
            <UiSelect v-model="personaLanguageFilter" width="id" title="Show only personas that speak one language"
              aria-label="Speaks" :options="languageOptions" />
          </div>
          <div class="studio-cast__rows">
            <div v-if="!shownPersonas.length" class="jv-muted studio-cast__rows-empty">No personas match this filter.</div>
            <div v-for="p in shownPersonas" :key="p.id" class="studio-cast__prow"
              :class="{ 'studio-cast__prow--on': selected?.persona_id === p.id }">
              <button type="button" class="studio-cast__prow-main" :disabled="!selected || busy"
                :title="!selected ? 'Select a speaker first' : selected.persona_id === p.id ? `Unassign ${p.name} from ${selected.name}` : `Assign ${p.name} to ${selected.name}`"
                @click="assign(p)">
                <span class="studio-cast__prow-avatar" :style="{ background: colorFor(p.name) }">{{ (p.name || "?").charAt(0).toUpperCase() }}</span>
                <span class="studio-cast__prow-text">
                  <strong class="studio-cast__prow-name">{{ p.name }}</strong>
                  <span class="studio-cast__prow-meta">{{ [voiceById[p.voice_id]?.name, personaEngine(p), languageName(p.speaks)].filter(Boolean).join(" · ") || "no voice" }}</span>
                  <span v-if="playsHere[p.id]" class="studio-cast__prow-plays">✓ {{ playsHere[p.id] }}</span>
                </span>
              </button>
              <UiTag :intent="directed(p).intent" :title="directed(p).title">{{ directed(p).label }}</UiTag>
              <button type="button" class="jv-rowact" :disabled="!p.voice_id || !!previewing"
                :title="p.voice_id ? `Hear ${p.name} speak` : 'No voice yet'" @click="play(p)">{{ previewing === p.id ? "⏳" : "▶" }}</button>
              <button type="button" class="jv-rowact" title="Edit this persona" @click="editPersona(p.id)">✎</button>
            </div>
          </div>
          <p class="jv-hint studio-cast__foot">
            Two speakers can share one persona — change it once and both change.
            {{ plural(personas.length, "persona") }} here; nothing stops one covering thirty speakers.
          </p>
        </template>
      </aside>
    </div>
  </section>
</template>

<style scoped>
/* Ported from StudioView's Cast (2026-09-29): the shared outer card with two
   panes, only the inner lists scroll, the library pane tinted surface-2. */
.studio-cast { display: flex; flex-direction: column; gap: 12px; flex: 1 1 0; min-height: 0; }
.studio-cast__cols {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(300px, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: 0; padding: 0; flex: 1 1 0; min-height: 0; overflow: hidden;
}
@media (max-width: 900px) {
  .studio-cast__cols { grid-template-columns: 1fr; grid-template-rows: auto auto; }
}
.studio-cast__left {
  padding: 14px 16px; display: flex; flex-direction: column; gap: 12px;
  min-height: 0; height: 100%; overflow: hidden;
}
.studio-cast__audition { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.studio-cast__narrator-empty {
  display: flex; align-items: center; gap: 11px; padding: 12px 14px; width: 100%;
  border: 1px dashed var(--line-strong); border-radius: 10px; background: var(--surface);
  cursor: pointer; font: inherit; text-align: left;
}
.studio-cast__narrator-empty:hover { border-color: var(--accent); background: var(--accent-soft); }
.studio-cast__narrator-empty-text { display: flex; flex-direction: column; gap: 2px; }
.studio-cast__narrator-empty-text strong { font-size: 13.5px; font-weight: 600; }
.studio-cast__narrator-empty-text .jv-muted { font-size: 12px; }
.studio-cast__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.studio-cast__head strong { font-size: 12px; }
.studio-cast__head .jv-muted { font-size: 12px; }
.studio-cast__notice { font-size: 12px; }
.studio-cast__scroll { overflow-y: auto; min-height: 0; flex: 1 1 0; scrollbar-width: none; }
.studio-cast__scroll::-webkit-scrollbar { width: 0; height: 0; }
.studio-cast__empty { border: 1px dashed var(--line-strong); border-radius: 10px; padding: 22px 24px; background: var(--surface); }
.studio-cast__empty h4 { margin: 0 0 6px; font-size: 14px; }
.studio-cast__empty p { margin: 0; font-size: 12.5px; line-height: 1.6; }
.studio-cast__empty a { color: var(--accent-ink); text-decoration: underline; }
.studio-cast__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; align-content: start; }
/* Compact horizontal card: portrait left, name / also called / role / cast
   line right. Selected = accent ring; unassigned = dashed edge. */
.studio-cast__card {
  position: relative; display: flex; align-items: flex-start; gap: 11px;
  padding: 12px 14px; margin: 0; cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s;
}
.studio-cast__card:hover { border-color: var(--accent-line, var(--accent)); }
.studio-cast__card--narrator { background: var(--accent-soft); }
.studio-cast__card--selected { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.studio-cast__card--unassigned { border-style: dashed; }
:deep(.studio-cast__row--selected) td { background: var(--accent-soft); }
.studio-cast__x {
  position: absolute; top: 8px; right: 8px; border: 0; background: transparent;
  color: var(--ink-3); cursor: pointer; font-size: 11px; padding: 2px 4px; opacity: 0;
}
.studio-cast__card:hover .studio-cast__x { opacity: 1; }
.studio-cast__x:hover { color: var(--danger, #b04a3e); }
.studio-cast__portrait {
  width: 38px; height: 38px; border-radius: 50%; color: #fff; flex: none;
  display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px;
}
.studio-cast__portrait--sm { width: 26px; height: 26px; font-size: 11px; }
.studio-cast__main { min-width: 0; flex: 1; }
.studio-cast__name { font-weight: 600; font-size: 13.5px; }
.studio-cast__aka { font-size: 11.5px; font-style: italic; }
.studio-cast__role { font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.studio-cast__table-role { font-size: 12px; }
.studio-cast__tick { display: inline-flex; margin-top: 6px; }
.studio-cast__as { font-size: 11.5px; font-weight: 600; margin-top: 6px; }
.studio-cast__as--ok { color: var(--accent-ink); }
.studio-cast__as--none { color: var(--warn-ink); }
.studio-cast__detail { margin-top: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
.studio-cast__detail-head { display: flex; align-items: baseline; gap: 8px; }
.studio-cast__detail-head .jv-muted { font-size: 12px; }
.studio-cast__field { display: flex; flex-direction: column; gap: 4px; }
.studio-cast__prose { max-width: 60ch; }
.studio-cast__detail-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.studio-cast__blocked { margin: 0; }
.studio-cast__library {
  padding: 14px; background: var(--surface-2); border-left: 1px solid var(--line);
  height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 10px; overflow: hidden;
}
.studio-cast__library-head { display: flex; align-items: baseline; gap: 6px; }
.studio-cast__library-head strong { font-size: 12px; }
.studio-cast__picking {
  background: var(--warn-bg); border: 1px solid var(--warn-line); color: var(--warn-ink);
  border-radius: 7px; padding: 8px 11px; font-size: 12px;
}
.studio-cast__filter { display: flex; gap: 6px; flex-wrap: wrap; }
.studio-cast__rows { flex: 1 1 0; min-height: 0; overflow-y: auto; scrollbar-width: none; }
.studio-cast__rows::-webkit-scrollbar { width: 0; height: 0; }
.studio-cast__rows-empty { font-size: 12px; padding: 8px 0; text-align: center; }
/* Persona row: avatar · name + voice · engine + who it plays · direction ·
   ▶ ✎. The row that plays the selected speaker tints green. */
.studio-cast__prow {
  display: flex; align-items: center; gap: 8px; border: 1px solid var(--line); border-radius: 8px;
  padding: 7px 10px; margin-bottom: 6px; background: var(--surface);
}
.studio-cast__prow--on { background: var(--accent-soft); border-color: var(--accent-line, #b8d2c3); }
.studio-cast__prow-main {
  appearance: none; border: 0; background: transparent; display: flex; align-items: center; gap: 10px;
  flex: 1; min-width: 0; font: inherit; text-align: left; cursor: pointer; padding: 0;
}
.studio-cast__prow-main:disabled { cursor: not-allowed; }
.studio-cast__prow-avatar {
  width: 26px; height: 26px; border-radius: 50%; color: #fff; font-size: 11px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center; flex: none;
}
.studio-cast__prow-text { min-width: 0; display: flex; flex-direction: column; }
.studio-cast__prow-name { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.studio-cast__prow-meta { font-size: 11px; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.studio-cast__prow-plays { font-size: 11.5px; font-weight: 600; color: var(--accent-ink); }
.studio-cast__foot { margin: 0; }
</style>
