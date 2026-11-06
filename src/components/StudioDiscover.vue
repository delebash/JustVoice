<!-- SPDX-License-Identifier: MIT -->
<!--
  Studio · Discover — its own step (redesign §8.5, built 2026-09-27).

  Discover is a different verb from Script's Analyze: it attributes nothing.
  It reads the prose for everyone it names and, only when you say so, adds the
  new ones to the book as SPEAKERS. Analyze can only choose from the book's
  speakers, which is why this step runs first.

  A RECORD, NOT A TO-DO LIST (decided 2026-09-29, "your rec go"). Each
  chapter's scan lives on the chapter (`scene.metadata.discover = {scanned_at,
  candidates, named_cast}`), written by the discover endpoint and replaced
  only by the next scan of that chapter: the AI's names that are not speakers
  of this book, and the speakers the text names (found by name, no AI). Add,
  Ignore and Remove change a person's STATUS — In this book · In your library ·
  New · Ignored — and never remove them from the list, so a rescan of a
  finished chapter still shows everyone. This component keeps no results of
  its own: the list and the grid's Found column are DERIVED from the `scenes`
  prop, the speakers, the library and the ignore list
  (`studioStatus.foundSpeakers`). Studio keeps this step alive across step
  switches (KeepAlive), so a scan in flight keeps running while you look at
  Script.

  Scope is an inline grid (§8.7: never a modal) — a select-all checkbox in the
  header and one per chapter. The scan runs on the project's chapter run
  (services/chapterRun.js, 2026-09-29) — the same queue Script's Analyze uses, so
  only one chapter is read at a time and it survives leaving Studio. Each
  chapter is a kit task, shown with the step's banner (StudioRunBanner.vue) and
  its Cancel. This page shows only the scan (decided 2026-10-05): Analyze's
  chapters are not tagged here, and a chapter Script is analyzing can be ticked
  — it is scanned after.

  Speakers and personas are two things (2026-09-29): a name that is EXACTLY a
  persona in your library says so (In your library), and Add makes the speaker
  already cast with that persona — matched here in code; the model is no longer
  sent the library. A quote the server could not find in the chapter is
  flagged; Ignore is remembered for the project and listed below as well.

  THE AI SUGGESTS, YOU LINK (decided 2026-10-16, TASKS "Discover's names: the AI
  suggests, you link"; drawn first in the mock, pages/mock/MockDiscoverPage.vue).
  Every name the scans found is its own row until you link it — nothing joins
  spellings unseen. Find same people asks the AI which names are one person
  (POST /v1/projects/{id}/discover/find, a kit task with its Cancel) and changes
  nothing: its answer is a Same person? list, each with Link and Not the same,
  and Link all (Google Contacts' Merge & fix). A linked row goes by the fullest
  name — the speaker's, when one of them is a speaker, whose Also called the
  others become — and reads "also written …" with Unlink beside each other
  name. Not the same and Unlink both keep the pair apart: Kept apart, a chip
  beside Ignored, each pair with Undo, and Find won't suggest it again. Link
  selected as one person links ticked names the AI missed; two ticked speakers
  can't be linked (lines would move — a different feature). Make the audiobook
  links on its own, and the row says so; Unlink still works there — it takes
  the name out of the speaker's Also called and it shows as new again, while
  the lines already given stay where Script put them. The state is the
  project's `discover_people`, which Studio's project carries; every answer
  replies with it. Add keeps a linked row's other names as "Also called".

  A row In this book has Remove from book, and ticked
  rows a "Remove N selected"; removing deletes the speaker from the book and
  its lines go back to No speaker, so it asks first, naming each one's lines
  ("yes ask first", 2026-09-29). The names the scans gave them go on the
  ignore list, so the row then shows as Ignored and a re-run doesn't add them
  back (2026-10-16). The "The book's speakers" card's ✕ asks the same way; its
  Clear all (which keeps the Narrator) asks too but ignores no one.

  A book with narration needs a narrator (decided 2026-10-05): while it has
  none, the first row of Speakers found is Narrator — reads everything outside
  quote marks — New and ticked, with ＋ Add (Cast's Add Narrator; no Ignore).
-->
<script setup>
import { computed, ref, watch } from "vue";
import {
  UiButton, UiCheckbox, UiChip, UiTable, UiTag, confirmDialog, pushToast, reportError, runAiEndpoint,
} from "@delebash/ui";
import { useApi } from "../stores/api.js";
import { useProjectsStore } from "../stores/projects.js";
import { useCopy } from "../services/copy.js";
import { RECIPE_WORDS, RUN_TITLE } from "../services/bookRun.js";
import { chapterRunFor, failureOf, inRun, queueChapters } from "../services/chapterRun.js";
import { addNarrator, hasNarrator } from "../services/narrator.js";
import {
  examplePair, foundNames, foundSpeakers, isWaiting, sameName, sameSuggestions,
} from "../services/studioStatus.js";
import StudioRunBanner from "./StudioRunBanner.vue";

const props = defineProps({
  project: { type: Object, required: true },
  scenes: { type: Array, default: () => [] },
  // {sceneId: spoken lines} — Studio already counts these for every chapter.
  linesByScene: { type: Object, default: () => ({}) },
  // The book's speakers, [{id, name, aliases, narrator, lines}] — who shows as
    // In this book.
  cast: { type: Array, default: () => [] },
  // The persona library — a name that is exactly one of these shows as In
  // your library.
  personas: { type: Array, default: () => [] },
  // {sceneId: lines of narration} — Script's rows (read, not spoken). With no
  // narrator, any narration makes Narrator the first row found.
  narrationByScene: { type: Object, default: () => ({}) },
  // A chapter to arrive with ticked for Scan — Script's banner sends one when its
  // second look heard someone who isn't in the book (2026-10-06).
  focusScene: { type: String, default: null },
});
// A finished scan reaches Studio through the chapter run, not from here.
// `cast-changed` carries `{ moved }` > 0 when lines lost their speaker.
const emit = defineEmits(["cast-changed", "go"]);

const api = useApi();
const copy = useCopy();
// The ignore list lives on the project row, so the shared store is refreshed
// after a change — every other reader of the project then sees it.
const projectsStore = useProjectsStore();

const selected = ref({});     // {sceneId: true}
const busyName = ref(null);   // a row being added, ignored or removed

watch(() => props.project?.id, () => {
  selected.value = {};
});
watch(() => props.focusScene, (id) => {
  if (id) selected.value = { [id]: true };
}, { immediate: true });

const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

// Where a chapter stands in the scan: "scanning" (this one now), "queued", or
// a failure from this session's scans. Only the scan — Script's Analyze shows
// on Script (2026-10-05).
function rowState(scene) {
  const where = inRun(props.project.id, scene.id, "discover");
  if (where === "current") return "scanning";
  if (where) return "queued";
  return failureOf(props.project.id, scene.id, "discover") ? "failed" : null;
}
const failureText = (scene) => failureOf(props.project.id, scene.id, "discover")?.reason || "";

const chapterWord = computed(() => copy.value.chapter);
const titleOf = (s) => s.title || `${chapterWord.value.singular} ${s.position + 1}`;
const titleById = computed(() => Object.fromEntries(props.scenes.map((s) => [s.id, titleOf(s)])));

const castById = computed(() => Object.fromEntries(props.cast.map((c) => [c.id, c])));

// The project's remembered Ignore list (fix 4). Seeded from the project, then
// kept current from the ignore / unignore replies.
const ignored = ref([]);
watch(() => props.project, (p) => { ignored.value = [...(p?.discover_ignored || [])]; }, { immediate: true });

// The book's narrator, proposed while it has none and has narration: narration
// needs one, and nothing makes it on its own (2026-10-05).
const narration = computed(() => Object.values(props.narrationByScene).reduce((n, v) => n + (v || 0), 0));
const narratorRow = computed(() => {
  if (hasNarrator(props.cast) || !narration.value) return null;
  return {
    key: "narrator", narrator: true, status: "new", name: "Narrator", names: ["Narrator"],
    role_hint: "Reads everything outside quote marks. Told in the first person? Tick that speaker as Narrator on Cast instead.",
    lines: narration.value, mentions: 0, evidence: "", evidence_found: null,
    chapters: props.scenes.filter((s) => props.narrationByScene[s.id] > 0).map((s) => s.id),
  };
});
// The book's same people (decided 2026-10-16): Find's suggestions, your links,
// the pairs kept apart and Find's last check — the project's, seeded from it
// and kept current from each answer's reply.
const NO_PEOPLE = { check: { status: "none" }, suggestions: [], links: [], apart: [] };
const people = ref(NO_PEOPLE);
watch(() => props.project, (p) => { people.value = p?.discover_people || NO_PEOPLE; }, { immediate: true });

// Everyone the saved scans found, each person once, with a status — the
// narrator first when the book needs one. Names join only by your links.
const found = computed(() => {
  const rows = foundSpeakers(props.scenes, props.cast, ignored.value, props.personas, people.value.links);
  return narratorRow.value ? [narratorRow.value, ...rows] : rows;
});
const scannedNames = computed(() => foundNames(props.scenes));
// The pairs kept apart that a row's names are in.
const apartOf = (row) => people.value.apart.filter((p) => p.names.some((n) => row.names.some((m) => sameName(m, n))));
const otherIn = (pair, row) => pair.names.find((n) => !row.names.some((m) => sameName(m, n))) ?? pair.names[1];
const counts = computed(() => ({
  all: found.value.length,
  new: found.value.filter(isWaiting).length,
  cast: found.value.filter((r) => r.status === "cast").length,
  ignored: found.value.filter((r) => r.status === "ignored").length,
  apart: people.value.apart.length,
}));
// The chips: New is everyone still waiting for Add or Ignore — new names and
// names a persona in your library has; Kept apart, the rows with a pair you
// said are different people.
const filter = ref("all");
const shown = computed(() => found.value.filter((r) => filter.value === "all"
  || (filter.value === "new" ? isWaiting(r) : filter.value === "apart" ? apartOf(r).length > 0 : r.status === filter.value)));
// Per chapter: everyone it names, and how many of them are still waiting.
function foundIn(scene) {
  const rows = found.value.filter((r) => r.chapters.includes(scene.id));
  return { total: rows.length, waiting: rows.filter(isWaiting).length };
}
const STATUS = {
  new: { label: "New", intent: "accent2", title: "No speaker or persona has this name. Add makes them a speaker in this book." },
  library: { label: "In your library", intent: "info" },
  cast: { label: "In this book", intent: "success" },
  ignored: { label: "Ignored", intent: "secondary", title: "You ignored this name for this book. Undo shows it as new again." },
};
function statusTitle(r) {
  if (r.narrator) return "This book has narration and no narrator. Add makes a speaker called Narrator — played by your persona called Narrator if you have one — and gives it the narration.";
  if (r.status === "library") return `A persona in your library is called ${r.persona.name}. Add makes ${r.persona.name} a speaker in this book, already cast with that persona.`;
  if (r.status === "cast") return `${r.speaker.name} is a speaker in this book.`;
  return STATUS[r.status].title;
}

const run = computed(() => chapterRunFor(props.project.id));
const scanning = computed(() => run.value?.current?.kind === "discover");
// The narrator row arrives ticked — nearly every book needs one (2026-10-05).
watch(() => !!narratorRow.value, (has) => {
  if (has) picked.value = { ...picked.value, narrator: true };
});
// A chapter already in the scan can't be queued again (Analyze's can).
const pickable = (s) => !inRun(props.project.id, s.id, "discover");
const pickedScenes = computed(() => props.scenes.filter((s) => selected.value[s.id] && pickable(s)));
const pickedLines = computed(() =>
  pickedScenes.value.reduce((n, s) => n + (props.linesByScene[s.id] || 0), 0));
const allPicked = computed(() => {
  const open = props.scenes.filter(pickable);
  return open.length > 0 && open.every((s) => selected.value[s.id]);
});
function toggleAll(on) {
  selected.value = on ? Object.fromEntries(props.scenes.filter(pickable).map((s) => [s.id, true])) : {};
}
function toggleOne(id, on) {
  selected.value = { ...selected.value, [id]: on };
}


const GRID_COLUMNS = computed(() => [
  { id: "sel", header: "", headerStyle: { width: "1%" }, cellStyle: { width: "1%" } },
  { id: "title", header: chapterWord.value.singular },
  { id: "lines", header: "Lines", headerStyle: { textAlign: "right" }, cellStyle: { textAlign: "right" } },
  { id: "scanned", header: "Last scanned" },
  { id: "found", header: "Found" },
]);
const RESULT_COLUMNS = [
  { id: "pick", header: "", headerStyle: { width: "1%" }, cellStyle: { width: "1%" } },
  { id: "name", accessorKey: "name", header: "Name", sortable: true },
  { id: "status", header: "Status" },
  { id: "lines", accessorKey: "lines", header: "Lines", sortable: true,
    headerStyle: { textAlign: "right" }, cellStyle: { textAlign: "right" } },
  { id: "evidence", header: "First appearance" },
  { id: "chapters", header: "Where" },
  { id: "actions", header: "", headerStyle: { width: "1%" }, cellStyle: { whiteSpace: "nowrap", textAlign: "right" } },
];

function ago(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h ago`;
  const d = Math.floor(ms / 86_400_000);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

// ── Find same people: the line, the AI's suggestions, Link and Unlink ─────────
const FIND = "Find same people";
const FIND_TITLE = "Ask the AI which of these names are one person — nothing changes until you link them";
const finding = ref(null);    // {model} while Find same people asks
const check = computed(() => people.value.check || NO_PEOPLE.check);
// Chapters scanned after the check was asked.
const sinceCheck = computed(() => {
  const c = check.value;
  if (c.status !== "done" || !c.at) return 0;
  const at = new Date(c.at).getTime();
  return props.scenes.filter((s) => s.metadata?.discover?.scanned_at && new Date(s.metadata.discover.scanned_at).getTime() > at).length;
});
const checkedBy = (m) => [m.model, RECIPE_WORDS[m.recipe]].filter(Boolean).join(" · ");
const findLine = computed(() => {
  if (finding.value) {
    return { text: `Asking ${finding.value.model} which of these names are one person…`, label: FIND, intent: "secondary", loading: true };
  }
  const m = check.value;
  if (m.status === "failed") return { failed: true, text: `Couldn't check the names. ${m.error}`, label: "Try again", intent: "secondary" };
  if (m.status === "done") {
    const how = m.by === "run" ? `, during ${RUN_TITLE}` : "";
    const n = sinceCheck.value;
    const since = n ? ` · ${n} ${(n === 1 ? chapterWord.value.singular : chapterWord.value.plural).toLowerCase()} scanned since` : "";
    return { text: `Checked ${ago(m.at)} by ${checkedBy(m)}${how}${since}.`, label: "Find again", intent: n ? "secondary" : "ghost" };
  }
  const pair = examplePair(scannedNames.value.map((x) => x.name), people.value.links);
  const example = pair ? ` — “${pair[0]}” and “${pair[1]}”` : "";
  return { text: `Some people are named more than one way${example}. ${FIND} asks the AI which names are one person; you link them.`, label: FIND, intent: "secondary" };
});

const whose = (name) => (name.endsWith("s") ? `${name}'` : `${name}'s`);
// The AI's answer, less what you linked or kept apart — each with what the scans say.
const suggestions = computed(() => sameSuggestions(props.scenes, people.value, props.cast));
const SUGGEST_COLUMNS = [
  { id: "names", header: "Names" },
  { id: "lines", header: "Lines", headerStyle: { textAlign: "right" }, cellStyle: { textAlign: "right" } },
  { id: "chapters", header: "Where" },
  { id: "quotes", header: "How the book names them" },
  { id: "actions", header: "", headerStyle: { width: "1%" }, cellStyle: { whiteSpace: "nowrap", textAlign: "right" } },
];

// Ask the AI. The kit's AI task shows it, and its Cancel stops the model's call
// (the server writes nothing then). A failure is the check's: the line says why.
async function find() {
  if (finding.value) return;
  const id = props.project.id;
  let route = null;
  try {
    route = await api.request(`/v1/projects/${id}/discover/find`);
  } catch {
    // The ask itself says why.
  }
  if (route?.configured) finding.value = { model: route.model };
  try {
    const r = await runAiEndpoint({
      request: (p, o) => api.request(p, o),
      path: `/v1/projects/${id}/discover/find`,
      task: { feature: "speaker_merge", label: `${FIND} · ${props.project.name || "Book"}`, meta: { projectId: id } },
    });
    if (props.project?.id !== id) return;
    people.value = r?.discover_people || people.value;
    if (!suggestions.value.length) pushToast({ kind: "info", message: "Nothing new to link — the AI found no other names that are one person." });
  } catch (e) {
    // Stopped: nothing changed. No model, or the model failed: the line says why.
    if (e?.name !== "AbortError" && e?.status !== 501 && e?.status !== 502) {
      reportError(e, { title: `${FIND} failed` });
    }
  } finally {
    finding.value = null;
    projectsStore.reload();
  }
}

// One of your answers: the server's state comes back; a speaker whose Also
// called it rewrote is read again.
const peopleBusy = ref(false);
async function answer(path, body) {
  const r = await api.request(`/v1/projects/${props.project.id}/discover/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  people.value = r?.discover_people || people.value;
  projectsStore.reload();
  return r;
}
// The name the link holding these names goes by.
const linkedAs = (names) => people.value.links.find((l) => names.some((n) => l.names.some((m) => sameName(m, n))))?.name ?? "";
async function act(run) {
  if (peopleBusy.value) return;
  peopleBusy.value = true;
  try {
    await run();
  } catch (e) {
    reportError(e);
  } finally {
    peopleBusy.value = false;
  }
}
function linkSuggestion(s) {
  return act(async () => {
    const r = await answer("link", { names: s.names });
    if (r?.speaker_id) emit("cast-changed");
    pushToast({ kind: "success", message: `${s.names.join(" and ")} linked as one person, ${linkedAs(s.names)}. Unlink takes it back.` });
  });
}
function linkAll() {
  return act(async () => {
    const list = suggestions.value;
    let rewrote = false;
    for (const s of list) {
      const r = await answer("link", { names: s.names });
      rewrote ||= Boolean(r?.speaker_id);
    }
    if (rewrote) emit("cast-changed");
    pushToast({ kind: "success", message: `${plural(list.length, "suggestion")} linked. Unlink on a row takes one back.` });
  });
}
function notSame(s) {
  return act(async () => {
    await answer("keep-apart", { names: s.names });
    pushToast({ kind: "info", message: `${s.names.join(" and ")} kept apart — ${FIND} won't suggest them again. Undo is under Kept apart.` });
  });
}
// Unlink is offered where it can act: a name in the row's link, or one of its
// speaker's Also called.
const canUnlink = (row, n) => Boolean(row.link?.names.some((m) => sameName(m, n))
  || (row.speaker && (castById.value[row.speaker.id]?.aliases || []).some((a) => sameName(a, n))));
function unlink(row, name) {
  return act(async () => {
    const r = await answer("unlink", { name });
    if (r?.speaker_id) emit("cast-changed");
    pushToast({
      kind: "info",
      message: row.status === "cast"
        ? `${name} is no longer ${whose(row.name)} other name and shows as new. Lines already given to ${row.name} stay. Undo is under Kept apart.`
        : `${name} unlinked from ${row.name} and kept apart. Undo is under Kept apart.`,
    });
  });
}
function undoApart(pair) {
  return act(async () => {
    const r = await answer("undo-apart", { names: pair.names });
    if (r?.speaker_id) emit("cast-changed");
    pushToast(pair.from === "unlink"
      ? { kind: "success", message: `${pair.names.join(" and ")} linked again.` }
      : { kind: "info", message: `${pair.names.join(" and ")} are back under Same person?.` });
  });
}

// Queue the ticked chapters on the project's run. A run already going (an
// Analyze, say) takes them after its own.
function scan() {
  const targets = pickedScenes.value;
  if (!targets.length) return;
  queueChapters({ projectId: props.project.id, kind: "discover", chapters: targets });
  selected.value = {};
}

// One row as promote takes it: a speaker with the other spellings as "Also
// called". A library row takes the persona's exact name, so the server casts
// the new speaker with it (the exact-name rule every new speaker follows).
function toCandidate(c) {
  const name = c.status === "library" ? c.persona.name : c.name;
  return { name, description: c.role_hint || null, aliases: c.names.filter((n) => n !== name) };
}
// The narrator is added through Cast's own door (services/narrator.js), not
// promote: it takes the role, and the narration with no speaker moves to it.
async function promote(rows) {
  rows = rows.filter((r) => !r.narrator);
  if (!rows.length) return null;
  return api.request(`/v1/projects/${props.project.id}/speakers/promote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidates: rows.map(toCandidate) }),
  });
}

// Tick several rows, then act on them together (2026-09-29): waiting rows
// take Add or Ignore, rows In this book take Remove. Keyed by the row's key;
// only rows still in that status count, so a row that changed since it was
// ticked is not acted on.
const picked = ref(narratorRow.value ? { narrator: true } : {});
const tickable = (r) => isWaiting(r) || r.status === "cast";
const pickedWaiting = computed(() => found.value.filter((r) => isWaiting(r) && picked.value[r.key]));
// What Ignore acts on, counts and is enabled by: the ticked waiting rows but the
// narrator's — narration needs a narrator, so it is never ignored (the
// narrowings review C9, 2026-10-13: "Ignore 3 selected" ignored 2).
const pickedIgnorable = computed(() => pickedWaiting.value.filter((r) => !r.narrator));
const pickedCast = computed(() => found.value.filter((r) => r.status === "cast" && picked.value[r.key]));
// Link selected as one person (decided 2026-10-16): the ticked names the AI
// missed — the narrator's row aside — and at most one speaker among them
// (joining two speakers would move lines: a different feature).
const pickedLinkable = computed(() => [...pickedWaiting.value.filter((r) => !r.narrator), ...pickedCast.value]);
const linkBlock = computed(() => {
  if (pickedCast.value.length > 1) return "Two of the ticked names are already speakers in this book — joining speakers isn't done here.";
  if (pickedLinkable.value.length < 2) return "Tick two or more names that are one person.";
  return "";
});
async function linkSelected() {
  const rows = pickedLinkable.value;
  if (linkBlock.value || bulkBusy.value) return;
  bulkBusy.value = true;
  try {
    const names = rows.flatMap((r) => r.names);
    const r = await answer("link", { names });
    if (r?.speaker_id) emit("cast-changed");
    for (const row of rows) delete picked.value[row.key];
    picked.value = { ...picked.value };
    pushToast({ kind: "success", message: `${plural(rows.length, "name")} linked as one person, ${linkedAs(names)}. Unlink takes it back.` });
  } catch (e) {
    reportError(e, { title: "Link failed" });
  } finally {
    bulkBusy.value = false;
  }
}
const tickableShown = computed(() => shown.value.filter(tickable));
const allRowsPicked = computed(() =>
  tickableShown.value.length > 0 && tickableShown.value.every((r) => picked.value[r.key]));
function pickAll(on) {
  picked.value = on ? Object.fromEntries(tickableShown.value.map((r) => [r.key, true])) : {};
}
const bulkBusy = ref(false);

async function addSelected() {
  const rows = pickedWaiting.value;
  if (!rows.length || bulkBusy.value) return;
  bulkBusy.value = true;
  try {
    let moved = 0;
    if (rows.some((r) => r.narrator)) {
      moved = await addNarrator(props.project.id);
      if (moved === null) return;
    }
    const people = rows.filter((r) => !r.narrator);
    await promote(people);
    const lib = people.filter((r) => r.status === "library").length;
    for (const r of rows) delete picked.value[r.key];
    if (people.length) {
      pushToast({
        message: `${people.length} added as speakers${lib ? ` (${lib} already cast with the persona of that name)` : ""} — give them personas in Cast.`,
        kind: "success",
      });
    }
    emit("cast-changed", { moved });
  } catch (e) {
    reportError(e, { title: "Add failed" });
  } finally {
    bulkBusy.value = false;
  }
}

async function ignoreSelected() {
  // Narration needs a narrator — it is never ignored.
  const rows = pickedIgnorable.value;
  if (!rows.length || bulkBusy.value) return;
  bulkBusy.value = true;
  try {
    const names = rows.flatMap((c) => c.names);
    const r = await api.request(`/v1/projects/${props.project.id}/discover/ignore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names }),
    });
    ignored.value = r?.ignored || ignored.value;
    projectsStore.reload();
    for (const row of rows) delete picked.value[row.key];
  } catch (e) {
    reportError(e, { title: "Ignore failed" });
  } finally {
    bulkBusy.value = false;
  }
}

async function removeSelected() {
  const rows = pickedCast.value;
  if (!rows.length || bulkBusy.value) return;
  bulkBusy.value = true;
  try {
    if (await removeSpeakers(rows.map((r) => castById.value[r.speaker.id]).filter(Boolean))) {
      for (const r of rows) delete picked.value[r.key];
    }
  } finally {
    bulkBusy.value = false;
  }
}

async function add(c) {
  busyName.value = c.key;
  if (c.narrator) {
    const moved = await addNarrator(props.project.id);
    busyName.value = null;
    if (moved !== null) emit("cast-changed", { moved });
    return;
  }
  try {
    await promote([c]);
    pushToast({
      message: c.status === "library"
        ? `${c.persona.name} added as a speaker — played by persona ${c.persona.name}, your persona of that name.`
        : `${c.name} added as a speaker — give them a persona in Cast.`,
      kind: "success",
    });
    emit("cast-changed");
  } catch (e) {
    reportError(e, { title: "Add failed" });
  } finally {
    busyName.value = null;
  }
}

// Take names off the ignore list — a row's Undo, an Ignored tag's ✕, or
// "Clear all". No confirmation (decided 2026-09-29): the name only shows as
// new again.
async function unignore(names) {
  if (!names.length) return;
  try {
    const r = await api.request(`/v1/projects/${props.project.id}/discover/unignore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names }),
    });
    ignored.value = r?.ignored || [];
    projectsStore.reload();
    pushToast({
      message: names.length === 1
        ? `${names[0]} is no longer ignored.`
        : `${names.length} names are no longer ignored.`,
      kind: "info",
    });
  } catch (e) {
    reportError(e, { title: "Couldn't take that off the list" });
  }
}

// Remove speakers from the book — a row's Remove from cast, "Remove N
// selected", the cast card's ✕ or its "Clear all" (which keeps the Narrator).
// Their lines go back to No speaker, so it asks first, naming each one's lines
// ("yes ask first", 2026-09-29). `ignore` (all but Clear all): the names the
// scans gave them go on the ignore list, so they aren't suggested again
// (2026-10-16). True when they were removed.
const castBusy = ref(false);
async function removeSpeakers(people, { ignore = true } = {}) {
  if (!people.length || castBusy.value) return false;
  const lines = people.reduce((n, p) => n + (p.lines || 0), 0);
  const one = people[0].name;
  const ok = await confirmDialog(people.length === 1
    ? {
      title: `Remove ${one} from this book?`,
      message: ignore
        ? (lines ? `${plural(lines, "line")} will have no speaker, and ${one} won't be suggested again.` : `${one} won't be suggested again.`)
        : (lines ? `${plural(lines, "line")} will have no speaker.` : ""),
      confirmLabel: "Remove",
      danger: true,
    }
    : {
      title: `Remove ${people.length} speakers from this book?`,
      message: `${people.map((p) => `${p.name} — ${plural(p.lines || 0, "line")}`).join(" · ")}.${lines ? ` ${plural(lines, "line")} will have no speaker.` : ""}${ignore ? " They won't be suggested again." : ""}`,
      confirmLabel: `Remove ${people.length}`,
      danger: true,
    });
  if (!ok) return false;
  castBusy.value = true;
  let failed = 0;
  for (const p of people) {
    try {
      const got = await api.request(`/v1/speakers/${p.id}${ignore ? "?ignore=1" : ""}`, { method: "DELETE" });
      for (const n of got?.ignored || []) if (!ignored.value.includes(n)) ignored.value = [...ignored.value, n];
    } catch { failed += 1; }
  }
  castBusy.value = false;
  emit("cast-changed", { moved: lines, ignored: ignore });
  pushToast({
    message: failed
      ? `${people.length - failed} removed from this book; ${failed} failed.`
      : people.length === 1
        ? `${people[0].name} removed from this book.`
        : `${people.length} removed from this book.`,
    kind: failed ? "warning" : "success",
  });
  return true;
}
async function removeRow(row) {
  const sp = castById.value[row.speaker.id];
  if (!sp) return;
  busyName.value = row.key;
  try {
    await removeSpeakers([sp]);
  } finally {
    busyName.value = null;
  }
}
const clearable = computed(() => props.cast.filter((c) => !c.narrator));
// Where each speaker came from (decided 2026-10-06): the import's characters, and
// everyone added here — ＋ Add (Discover's or Cast's) and the narrator.
const castGroups = computed(() => [
  { key: "book", label: "From the book", hint: "the characters the import brought",
    rows: props.cast.filter((c) => c.imported_from) },
  { key: "added", label: "Added here", hint: "added with ＋ Add, and the narrator",
    rows: props.cast.filter((c) => !c.imported_from) },
].filter((g) => g.rows.length));

async function ignore(c) {
  busyName.value = c.key;
  try {
    const r = await api.request(`/v1/projects/${props.project.id}/discover/ignore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names: c.names }),
    });
    ignored.value = r?.ignored || ignored.value;
    projectsStore.reload();
  } catch (e) {
    reportError(e, { title: "Ignore failed" });
  } finally {
    busyName.value = null;
  }
}
</script>

<template>
  <section class="studio-discover">
    <div class="jv-card">
      <div class="jv-card__header">
        <h3 class="jv-card__title">Who speaks in this {{ copy.book.singular.toLowerCase() }}?</h3>
      </div>
      <div class="jv-card__body">
        <p class="jv-lede">
          Reads the prose for everyone it names: speakers already in this book, names a persona in
          your library has, and new names. Nothing is created until you add someone. Script can only
          give a line to a speaker in this {{ copy.book.singular.toLowerCase() }}, so this step runs first.
        </p>

        <StudioRunBanner :project="project" kind="discover" />

        <div v-if="!scenes.length" class="jv-banner">
          No {{ chapterWord.plural.toLowerCase() }} yet — add or import them in
          <a href="#studio" @click.prevent="emit('go', 'script')">Script</a> first.
        </div>
        <template v-else>
          <UiTable class="jv-table-look studio-discover__grid" :data="scenes" :columns="GRID_COLUMNS" data-key="id">
            <template #head-sel>
              <UiCheckbox :model-value="allPicked" :disabled="!scenes.some(pickable)"
                :title="allPicked ? 'Select none' : 'Select all'"
                @update:model-value="toggleAll" />
            </template>
            <template #sel="{ row }">
              <UiCheckbox :model-value="!!selected[row.id] && pickable(row)" :disabled="!pickable(row)"
                :title="pickable(row) ? '' : 'Already in the scan'"
                @update:model-value="(v) => toggleOne(row.id, v)" />
            </template>
            <template #title="{ row }"><strong>{{ titleOf(row) }}</strong></template>
            <template #lines="{ row }"><span class="jv-mono">{{ (linesByScene[row.id] || 0).toLocaleString() }}</span></template>
            <template #scanned="{ row }">
              <UiTag v-if="rowState(row) === 'scanning'" intent="solid">scanning…</UiTag>
              <UiTag v-else-if="rowState(row) === 'queued'" intent="ghost">queued</UiTag>
              <template v-else-if="rowState(row) === 'failed'">
                <UiTag intent="danger" :title="failureText(row)">failed</UiTag>
                <div v-if="failureText(row)" class="jv-hint studio-discover__why">{{ failureText(row) }}</div>
              </template>
              <span v-else-if="row.metadata?.discover?.scanned_at" class="jv-muted"
                :title="new Date(row.metadata.discover.scanned_at).toLocaleString()">{{ ago(row.metadata.discover.scanned_at) }}</span>
              <span v-else class="jv-muted">never</span>
            </template>
            <template #found="{ row }">
              <template v-if="foundIn(row).total">
                <span class="jv-mono">{{ foundIn(row).total }}</span>
                <UiTag v-if="foundIn(row).waiting" intent="accent2" class="studio-discover__new"
                  :title="`${foundIn(row).waiting} not in this book yet`">{{ foundIn(row).waiting }} new</UiTag>
              </template>
              <span v-else-if="row.metadata?.discover?.scanned_at" class="jv-muted">nobody</span>
              <span v-else class="jv-muted">—</span>
            </template>
          </UiTable>

          <div class="jv-inline-row studio-discover__run">
            <UiButton
              intent="primary"
              :disabled="!pickedScenes.length"
              :loading="scanning"
              :label="pickedScenes.length
                ? `🔍 Scan ${pickedScenes.length} ${(pickedScenes.length === 1 ? chapterWord.singular : chapterWord.plural).toLowerCase()}`
                : '🔍 Scan'"
              @click="scan"
            />
            <span class="jv-hint">
              {{ pickedScenes.length
                ? `${pickedLines.toLocaleString()} lines · ${run?.current ? "starts after the current run" : `one model call per ${chapterWord.singular.toLowerCase()}`}; each row fills in when its ${chapterWord.singular.toLowerCase()} finishes, and a new scan replaces that ${chapterWord.singular.toLowerCase()}'s last one`
                : `Tick the ${chapterWord.plural.toLowerCase()} to read.` }}
            </span>
          </div>
        </template>
      </div>
    </div>

    <div class="jv-card">
      <div class="jv-card__header">
        <h3 class="jv-card__title">Speakers found</h3>
        <span class="jv-hint">nothing is created until you add someone</span>
      </div>
      <div class="jv-card__body">
        <div v-if="scannedNames.length" class="jv-inline-row jv-mb14">
          <UiTag v-if="findLine.failed" intent="danger">failed</UiTag>
          <span class="jv-hint">{{ findLine.text }}</span>
          <UiButton :intent="findLine.intent" size="small" :label="findLine.label" :loading="!!findLine.loading"
            :title="FIND_TITLE" @click="find" />
        </div>
        <template v-if="suggestions.length">
          <div class="jv-eyebrow--row">
            <span class="jv-eyebrow">Same person? · {{ suggestions.length }}</span>
            <span v-if="check.status === 'done'" class="jv-hint">from {{ checkedBy(check) }}</span>
            <UiButton intent="secondary" size="small" label="Link all" :disabled="peopleBusy"
              title="Link every suggestion — Unlink on a row takes one back" @click="linkAll" />
          </div>
          <UiTable class="jv-table-look jv-mb14" :data="suggestions" :columns="SUGGEST_COLUMNS" data-key="key">
            <template #names="{ row }"><strong>{{ row.names.join(" + ") }}</strong></template>
            <template #lines="{ row }">
              <span class="jv-mono" title="Roughly how many lines of dialogue they speak in what was scanned, both names together">≈ {{ row.lines }}</span>
            </template>
            <template #chapters="{ row }">
              <span class="jv-muted">{{ row.chapters.map((id) => titleById[id]).filter(Boolean).join(", ") }}</span>
            </template>
            <template #quotes="{ row }">
              <span v-for="q in row.quotes" :key="q.name" class="studio-discover__quote">“{{ q.evidence }}”</span>
            </template>
            <template #actions="{ row }">
              <UiButton intent="primary" size="small" label="Link" :disabled="peopleBusy"
                :title="`Link ${row.names.join(' and ')} as one person, ${row.name}`" @click="linkSuggestion(row)" />
              <UiButton intent="ghost" size="small" label="Not the same" :disabled="peopleBusy"
                title="Keep them apart — Find same people won't suggest them again; Undo is under Kept apart"
                @click="notSame(row)" />
            </template>
          </UiTable>
        </template>
        <div v-if="found.length" class="jv-inline-row studio-discover__chips">
          <UiChip :selected="filter === 'all'" @click="filter = 'all'">All {{ counts.all }}</UiChip>
          <UiChip :selected="filter === 'new'" title="Not in this book yet: new names, and names a persona in your library has"
            @click="filter = 'new'">New {{ counts.new }}</UiChip>
          <UiChip :selected="filter === 'cast'" @click="filter = 'cast'">In this book {{ counts.cast }}</UiChip>
          <UiChip :selected="filter === 'ignored'" @click="filter = 'ignored'">Ignored {{ counts.ignored }}</UiChip>
          <UiChip :selected="filter === 'apart'" title="Names you said are different people — Find same people won't suggest them again"
            @click="filter = 'apart'">Kept apart {{ counts.apart }}</UiChip>
        </div>
        <UiTable class="jv-table-look" :data="shown" :columns="RESULT_COLUMNS" data-key="key">
          <template #head-pick>
            <UiCheckbox :model-value="allRowsPicked" :disabled="!tickableShown.length || bulkBusy"
              :title="allRowsPicked ? 'Untick every name shown' : 'Tick every name shown'"
              @update:model-value="pickAll" />
          </template>
          <template #pick="{ row }">
            <UiCheckbox v-if="tickable(row)" :model-value="!!picked[row.key]" :disabled="bulkBusy"
              @update:model-value="(v) => (picked = { ...picked, [row.key]: v })" />
          </template>
          <template #name="{ row }">
            <strong>{{ row.name }}</strong>
            <div v-for="n in row.names.filter((x) => x !== row.name)" :key="n" class="jv-aka">
              <span class="jv-hint">also written {{ n }}</span>
              <UiButton v-if="canUnlink(row, n)" intent="ghost" size="small" label="Unlink" :disabled="peopleBusy"
                :title="row.status === 'cast'
                  ? `Take ${n} out of ${whose(row.name)} Also called — it shows as new again; lines already given to ${row.name} stay`
                  : `${n} is someone else — it gets its own row again`"
                @click="unlink(row, n)" />
            </div>
            <div v-if="row.link?.by === 'run'" class="jv-hint">linked by {{ RUN_TITLE }}</div>
            <div v-for="p in apartOf(row)" :key="p.names.join('|')" class="jv-aka">
              <span class="jv-hint">kept apart from {{ otherIn(p, row) }}</span>
              <UiButton intent="ghost" size="small" label="Undo" :disabled="peopleBusy"
                :title="p.from === 'unlink' ? `Link ${otherIn(p, row)} with ${row.name} again` : `Show ${p.names.join(' and ')} under Same person? again`"
                @click="undoApart(p)" />
            </div>
            <div v-if="row.role_hint" class="jv-hint">{{ row.role_hint }}</div>
          </template>
          <template #status="{ row }">
            <UiTag :intent="STATUS[row.status].intent" :title="statusTitle(row)">{{ STATUS[row.status].label }}</UiTag>
          </template>
          <template #lines="{ row }">
            <span v-if="row.narrator" class="jv-mono" title="Lines of narration in the book">≈ {{ row.lines.toLocaleString() }}</span>
            <span v-else-if="row.lines" class="jv-mono" title="Roughly how many lines of dialogue they speak in what was scanned">≈ {{ row.lines }}</span>
            <span v-else-if="row.mentions" class="jv-muted" title="How many times the text names them in what was scanned">named {{ row.mentions }}×</span>
            <span v-else class="jv-mono" title="Named, but not heard speaking in what was scanned">0</span>
          </template>
          <template #evidence="{ row }">
            <span class="studio-discover__quote">{{ row.evidence ? `“${row.evidence}”` : "—" }}</span>
            <UiTag v-if="row.evidence_found === false" intent="danger"
              title="This quote is not in the chapter — the model may have invented it, and the name with it.">quote not in the chapter</UiTag>
          </template>
          <template #chapters="{ row }">
            <span class="jv-muted">{{ row.chapters.map((id) => titleById[id]).filter(Boolean).join(", ") }}</span>
          </template>
          <template #actions="{ row }">
            <template v-if="isWaiting(row)">
              <UiButton intent="primary" size="small" label="＋ Add" :loading="busyName === row.key"
                :disabled="busyName !== null"
                :title="row.narrator ? 'Add the book\'s narrator — it takes the narration'
                  : row.status === 'library' ? `Add ${row.persona.name} to this book, cast with your persona of that name` : `Add ${row.name} to this book as a speaker`"
                @click="add(row)" />
              <UiButton v-if="!row.narrator" intent="ghost" size="small" label="Ignore" :disabled="busyName !== null"
                title="Mark it Ignored for this book. It stays in this list; Undo takes it back."
                @click="ignore(row)" />
            </template>
            <template v-else-if="row.status === 'cast'">
              <span class="jv-muted studio-discover__incast">already a speaker</span>
              <UiButton intent="ghost" size="small" label="Remove from book" :loading="busyName === row.key"
                :disabled="busyName !== null || castBusy"
                :title="`Remove ${row.speaker.name} from this book — asks first; their lines go back to No speaker`"
                @click="removeRow(row)" />
            </template>
            <UiButton v-else-if="row.status === 'ignored'" intent="ghost" size="small" label="Undo"
              title="Take it off the ignore list — it shows as new again" @click="unignore(row.names)" />
          </template>
          <template #empty>
            {{ !scenes.some((s) => s.metadata?.discover?.scanned_at)
              ? "Scan some chapters to see who they name."
              : found.length ? "Nobody here — try All." : "The chapters scanned name nobody." }}
          </template>
        </UiTable>
        <div v-if="counts.new || counts.cast" class="jv-inline-row studio-discover__bulk">
          <UiButton intent="primary" size="small" :disabled="!pickedWaiting.length || bulkBusy || busyName !== null"
            :loading="bulkBusy" :label="pickedWaiting.length ? `＋ Add ${pickedWaiting.length} selected` : '＋ Add selected'"
            title="Add every ticked name to this book — a name a persona in your library has arrives cast with it"
            @click="addSelected" />
          <UiButton intent="ghost" size="small" :disabled="!pickedIgnorable.length || bulkBusy || busyName !== null"
            :label="pickedIgnorable.length ? `Ignore ${pickedIgnorable.length} selected` : 'Ignore selected'"
            title="Mark every ticked name Ignored for this book"
            @click="ignoreSelected" />
          <UiButton intent="ghost" size="small" :disabled="!pickedCast.length || bulkBusy || busyName !== null || castBusy"
            :label="pickedCast.length ? `Remove ${pickedCast.length} selected` : 'Remove selected'"
            title="Remove every ticked speaker from this book — asks first; their lines go back to No speaker"
            @click="removeSelected" />
          <UiButton intent="ghost" size="small" :disabled="!!linkBlock || bulkBusy || busyName !== null || peopleBusy"
            :label="pickedLinkable.length > 1 ? `Link ${pickedLinkable.length} selected as one person` : 'Link selected as one person'"
            :title="linkBlock || 'Link the ticked names as one person — Unlink takes it back'"
            @click="linkSelected" />
          <span class="jv-hint">{{ pickedWaiting.length || pickedCast.length ? `${pickedWaiting.length + pickedCast.length} ticked` : "Tick names to add, ignore, remove or link several at once." }}</span>
        </div>
      </div>
    </div>

    <div v-if="ignored.length" class="jv-card jv-card--soft">
      <div class="jv-card__header">
        <h3 class="jv-card__title">Ignored</h3>
        <span class="jv-hint">{{ ignored.length }} · shown as Ignored in this {{ copy.book.singular.toLowerCase() }}</span>
        <UiButton intent="ghost" size="small" label="Clear all"
          title="Take every name off this list — they show as new again" @click="unignore([...ignored])" />
      </div>
      <div class="jv-card__body studio-discover__cast">
        <UiTag v-for="n in ignored" :key="n" intent="ghost" removable :value="n"
          :title="`✕ takes ${n} off the list — it shows as new again`" @remove="unignore([n])" />
      </div>
    </div>

    <div class="jv-card jv-card--soft">
      <div class="jv-card__header">
        <h3 class="jv-card__title">The book's speakers</h3>
        <span class="jv-hint">{{ cast.length }}</span>
        <UiButton v-if="clearable.length" intent="ghost" size="small" label="Clear all" :disabled="castBusy"
          title="Remove everyone but the Narrator from this book — asks first; their lines go back to No speaker"
          @click="removeSpeakers(clearable, { ignore: false })" />
      </div>
      <div class="jv-card__body">
        <template v-for="g in castGroups" :key="g.key">
          <div class="studio-discover__castgroup">
            <span class="jv-eyebrow">{{ g.label }}</span>
            <span class="jv-hint">{{ g.hint }}</span>
          </div>
          <div class="studio-discover__cast">
            <UiTag v-for="c in g.rows" :key="c.id" intent="ghost" removable :value="c.name"
              :title="`✕ removes ${c.name} from this book — asks first; their lines go back to No speaker`"
              @remove="removeSpeakers([c])">{{ c.name }}</UiTag>
          </div>
        </template>
        <div v-if="!cast.length" class="studio-discover__cast"><span class="jv-muted">Nobody yet.</span></div>
        <p class="jv-hint">
          Script can only choose from these.
          <a href="#studio" @click.prevent="emit('go', 'script')">Go to Script ➜</a>
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.studio-discover { display: flex; flex-direction: column; gap: 14px; }
.studio-discover__grid { margin: 10px 0 12px; }
.studio-discover__run { gap: 10px; align-items: center; }
.studio-discover__cast { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.studio-discover__castgroup { display: flex; align-items: baseline; gap: 8px; margin: 2px 0 6px; }
.studio-discover__why { max-width: 60ch; margin-top: 4px; }
.studio-discover__quote { display: block; max-width: 46ch; color: var(--ink-2); font-style: italic; }
.studio-discover__chips { gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.studio-discover__new { margin-left: 6px; }
.studio-discover__incast { font-size: 12.5px; margin-right: 6px; }
.studio-discover__bulk { gap: 8px; align-items: center; margin-top: 10px; }
</style>
