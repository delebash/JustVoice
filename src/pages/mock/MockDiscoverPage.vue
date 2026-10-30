<!-- SPDX-License-Identifier: MIT -->
<!--
  Discover's Speakers found: the AI suggests, you link — the mock (dev only: #/mock/discover).
  Decided 2026-10-16 (TASKS "Discover's names: the AI suggests, you link"), drawn in the app before
  the real page changes (the 2026-10-04 mock rule):
    * every name the scans found is its own row until you link it — nothing is joined unseen;
    * Find same people asks the AI which names are one person (the run's own step — one short
      question per group of similar names on this computer's model, one call for every name on a
      cloud one) and changes nothing: its answer is a Same person? list, each with Link and Not the
      same, and Link all (Google Contacts' Merge & fix: suggestions, Merge or Merge all);
    * a linked row reads "also written …" with Unlink beside each other name; Not the same and
      Unlink both keep the pair apart — Kept apart, beside Ignored, each with Undo, and Find won't
      suggest the pair again (Discover's own Ignore / Undo);
    * Link selected as one person links ticked names the AI missed; two ticked speakers can't be
      linked (lines would move);
    * Make the audiobook links on its own and the row says so; Unlink still works there — it takes
      the name out of the speaker's Also called and the name shows as new again.
  The rest of the page is Discover's own template (components/StudioDiscover.vue) — the chapter grid
  and Scan, the chips, columns, statuses, row actions, the bulk row, Ignored and The book's speakers
  — on services/mock/discoverMock.js in place of the server.

  States (?state=): unchecked (the default — the AI hasn't been asked) · finding (Find same people
  asking the model) · suggested (its answer, to review) · linked (you linked the Queen's two names) ·
  apart (you said Not the same) · stale (linked, then chapter VIII scanned again) · failed (no
  language model) · noscans (nothing scanned yet). linked and stale with ?by=run: Make the
  audiobook linked the names — its Add step then added everyone with lines, and the run went on to
  the M4B. Scan, Find same people, Find again, Try again, Link, Not the same, Link all, Unlink,
  Undo, ＋ Add, Ignore, Remove from book, the bulk buttons and the speakers' ✕ act as the real ones
  would.

  Not drawn: the scan's banner and the AI tasks panel's strips (the kit's own), the Narrator row the
  page proposes when the book has no narrator, the role a scan gives each name (not recorded for
  these scans), and the steps the step cards open.
-->
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  UiButton, UiCheckbox, UiChip, UiSelect, UiTable, UiTag, confirmDialog, pageFlow, pushToast,
} from "@delebash/ui";
import { mockOverviewState } from "../../services/mock/bookRunMock.js";
import {
  AI_SAME, EXAMPLE, FIND_MODEL, PERSONAS, PROJECT, SCENES, STATES, UNIT, fullestName, mockFound, mockNames, mockSetup,
} from "../../services/mock/discoverMock.js";
import { isWaiting, stepStatus } from "../../services/studioStatus.js";
import { stepsFor } from "../../services/studioSteps.js";

const route = useRoute();
const state = computed(() => (STATES.includes(String(route.query.state)) ? String(route.query.state) : "unchecked"));
const byRun = computed(() => route.query.by === "run");

const chapterWord = computed(() => UNIT);
const bookWord = "book";
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
const norm = (n) => (n || "").normalize("NFKC").replace(/’/g, "'").toLowerCase()
  .replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim();

// ── What the server would hold, kept here while the page is open ──────────────
const selected = ref({});     // {sceneId: true} — the chapters ticked for Scan
const picked = ref({});       // {rowKey: true} — the names ticked for the bulk row
const busyName = ref(null);
const bulkBusy = ref(false);
const castBusy = ref(false);
const scannedAt = ref({});    // {sceneId: iso}
const check = ref({ status: "none" });   // the AI's last Find same people
const links = ref([]);        // [{names, name, by: "you" | "run"}]
const apart = ref([]);        // [{names: [a, b], from: "suggestion" | "unlink", link?}]
const cast = ref([]);
const ignored = ref([]);
const linesByScene = ref({});
const run = ref(false);
const scanQueue = ref([]);    // chapter ids, the first being scanned
let scanTimer = null;
let findTimer = null;
function stopTimers() {
  clearTimeout(scanTimer);
  clearTimeout(findTimer);
  scanTimer = null;
  findTimer = null;
}
watch([state, byRun], () => {
  stopTimers();
  const s = mockSetup(state.value, { byRun: byRun.value });
  selected.value = {};
  picked.value = {};
  scanQueue.value = [];
  ignored.value = [];
  scannedAt.value = s.scannedAt;
  check.value = s.check;
  links.value = s.links;
  apart.value = s.apart;
  cast.value = s.cast;
  linesByScene.value = s.linesByScene;
  run.value = s.run;
}, { immediate: true });
onBeforeUnmount(stopTimers);

const scenes = computed(() => SCENES.map((s) => ({
  ...s, metadata: scannedAt.value[s.id] ? { discover: { scanned_at: scannedAt.value[s.id] } } : {},
})));
const titleOf = (s) => s.title || `${chapterWord.value.singular} ${s.position + 1}`;
const titleById = computed(() => Object.fromEntries(scenes.value.map((s) => [s.id, titleOf(s)])));
const castById = computed(() => Object.fromEntries(cast.value.map((c) => [c.id, c])));

// ── Speakers found: the server's people, each with a status worked out now ────
const STATUS_ORDER = { new: 0, library: 1, cast: 2, ignored: 3 };
const scannedIds = computed(() => SCENES.filter((s) => scannedAt.value[s.id]).map((s) => s.id));
const found = computed(() => {
  const ign = new Set(ignored.value.map(norm));
  const rows = mockFound(scannedIds.value, links.value).map((p) => {
    const keys = p.names.map(norm);
    const sp = cast.value.find((c) => [c.name, ...(c.aliases || [])].some((n) => keys.includes(norm(n))));
    if (sp) return { ...p, key: `s:${sp.id}`, name: sp.name, status: "cast", speaker: { id: sp.id, name: sp.name }, persona: null };
    if (keys.some((k) => ign.has(k))) return { ...p, status: "ignored", speaker: null, persona: null };
    const persona = PERSONAS.find((x) => keys.includes(norm(x.name)));
    if (persona) return { ...p, status: "library", speaker: null, persona: { id: persona.id, name: persona.name } };
    return { ...p, status: "new", speaker: null, persona: null };
  });
  return rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.lines - a.lines);
});
const counts = computed(() => ({
  all: found.value.length,
  new: found.value.filter(isWaiting).length,
  cast: found.value.filter((r) => r.status === "cast").length,
  ignored: found.value.filter((r) => r.status === "ignored").length,
  apart: apart.value.length,
}));
const filter = ref("all");
const shown = computed(() => found.value.filter((r) => filter.value === "all"
  || (filter.value === "new" ? isWaiting(r) : filter.value === "apart" ? apartOf(r).length > 0 : r.status === filter.value)));
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
  if (r.status === "library") return `A persona in your library is called ${r.persona.name}. Add makes ${r.persona.name} a speaker in this book, already cast with that persona.`;
  if (r.status === "cast") return `${r.speaker.name} is a speaker in this book.`;
  return STATUS[r.status].title;
}

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
const RECIPES = { local: "Local", frontier: "Frontier" };   // BookRunCard's words
const RUN_TITLE = "Make the audiobook";
const FIND_TITLE = "Ask the AI which of these names are one person — nothing changes until you link them";
const sinceCheck = computed(() => (check.value.status === "done"
  ? SCENES.filter((s) => scannedAt.value[s.id] && scannedAt.value[s.id] > check.value.at).length
  : 0));
const checkedBy = (m) => [m.model, RECIPES[m.recipe]].filter(Boolean).join(" · ");
const findLine = computed(() => {
  const m = check.value;
  if (m.status === "running") {
    return { text: `Asking ${m.model} which of these names are one person…`, label: FIND, intent: "secondary", loading: true };
  }
  if (m.status === "failed") return { failed: true, text: `Couldn't check the names. ${m.error}`, label: "Try again", intent: "secondary" };
  if (m.status === "done") {
    const how = m.by === "run" ? `, during ${RUN_TITLE}` : "";
    const n = sinceCheck.value;
    const since = n ? ` · ${n} ${(n === 1 ? chapterWord.value.singular : chapterWord.value.plural).toLowerCase()} scanned since` : "";
    return { text: `Checked ${ago(m.at)} by ${checkedBy(m)}${how}${since}.`, label: "Find again", intent: n ? "secondary" : "ghost" };
  }
  const names = mockNames(scannedIds.value).map((x) => x.name);
  const example = EXAMPLE.every((n) => names.includes(n)) ? ` — “${EXAMPLE[0]}” and “${EXAMPLE[1]}”` : "";
  return { text: `Some people are named more than one way${example}. ${FIND} asks the AI which names are one person; you link them.`, label: FIND, intent: "secondary" };
});

const whose = (name) => (name.endsWith("s") ? `${name}'` : `${name}'s`);
const samePair = (a, b) => a.length === b.length && a.every((n) => b.includes(n));
const apartOf = (row) => apart.value.filter((p) => p.names.some((n) => row.names.includes(n)));
const otherIn = (pair, row) => pair.names.find((n) => !row.names.includes(n)) ?? pair.names[1];
// The AI's answer, less what you already linked or kept apart — each with what the scans say.
const suggestions = computed(() => {
  if (check.value.status !== "done") return [];
  const info = Object.fromEntries(mockNames(scannedIds.value).map((x) => [x.name, x]));
  return AI_SAME
    .filter((g) => g.every((n) => info[n]))
    .filter((g) => !links.value.some((l) => g.every((n) => l.names.includes(n))))
    .filter((g) => !apart.value.some((p) => samePair(p.names, g)))
    .map((g) => ({
      key: g.join("|"), names: g, name: fullestName(g),
      lines: g.reduce((s, n) => s + info[n].lines, 0),
      chapters: [...new Set(g.flatMap((n) => info[n].chapters))],
      quotes: g.map((n) => ({ name: n, evidence: info[n].evidence })),
    }));
});
const SUGGEST_COLUMNS = [
  { id: "names", header: "Names" },
  { id: "lines", header: "Lines", headerStyle: { textAlign: "right" }, cellStyle: { textAlign: "right" } },
  { id: "chapters", header: "Where" },
  { id: "quotes", header: "How the book names them" },
  { id: "actions", header: "", headerStyle: { width: "1%" }, cellStyle: { whiteSpace: "nowrap", textAlign: "right" } },
];

function find() {
  if (check.value.status === "running") return;
  check.value = { status: "running", ...FIND_MODEL };
  // The merge step's one question on Alice took 4 s (bookRunMock's merge step).
  findTimer = setTimeout(() => {
    check.value = { status: "done", at: new Date().toISOString(), by: "button", ...FIND_MODEL };
    if (!suggestions.value.length) pushToast({ kind: "info", message: "Nothing new to link — the AI found no other names that are one person." });
  }, 4000);
}
// The speaker a set of names belongs to, if any is already in this book.
const speakerOf = (names) => cast.value.find((c) => [c.name, ...(c.aliases || [])].some((n) => names.some((x) => norm(x) === norm(n))));
function setAliases(id, aliases) {
  cast.value = cast.value.map((c) => (c.id === id ? { ...c, aliases } : c));
}
// One link for these names, joining any link that already holds one of them; a speaker among them
// keeps its name and takes the others as Also called.
function link(names, by = "you") {
  const joined = links.value.filter((l) => l.names.some((n) => names.includes(n)));
  const all = [...new Set([...joined.flatMap((l) => l.names), ...names])];
  const sp = speakerOf(all);
  const name = sp ? sp.name : fullestName(all);
  links.value = [...links.value.filter((l) => !joined.includes(l)), { names: all, name, by }];
  apart.value = apart.value.filter((p) => !p.names.every((n) => all.includes(n)));
  if (sp) setAliases(sp.id, [...new Set([...(sp.aliases || []), ...all.filter((n) => norm(n) !== norm(sp.name))])]);
  return name;
}
function linkSuggestion(s) {
  const name = link(s.names);
  pushToast({ kind: "success", message: `${s.names.join(" and ")} linked as one person, ${name}. Unlink takes it back.` });
}
function linkAll() {
  const list = suggestions.value;
  for (const s of list) link(s.names);
  pushToast({ kind: "success", message: `${plural(list.length, "suggestion")} linked. Unlink on a row takes one back.` });
}
function notSame(s) {
  apart.value = [...apart.value, { names: [...s.names], from: "suggestion" }];
  pushToast({ kind: "info", message: `${s.names.join(" and ")} kept apart — ${FIND} won't suggest them again. Undo is under Kept apart.` });
}
function unlink(row, name) {
  const l = row.link;
  if (!l) return;
  const rest = l.names.filter((n) => n !== name);
  links.value = links.value.filter((x) => x !== l).concat(rest.length > 1 ? [{ ...l, names: rest, name: rest.includes(l.name) ? l.name : fullestName(rest) }] : []);
  apart.value = [...apart.value, { names: [row.name, name], from: "unlink", link: { name: l.name, by: l.by } }];
  if (row.status === "cast") {
    const sp = castById.value[row.speaker.id];
    if (sp) setAliases(sp.id, (sp.aliases || []).filter((a) => norm(a) !== norm(name)));
    pushToast({ kind: "info", message: `${name} is no longer ${whose(row.name)} other name and shows as new. Lines already given to ${row.name} stay. Undo is under Kept apart.` });
  } else {
    pushToast({ kind: "info", message: `${name} unlinked from ${row.name} and kept apart. Undo is under Kept apart.` });
  }
}
function undoApart(pair) {
  apart.value = apart.value.filter((p) => p !== pair);
  if (pair.from === "unlink") {
    link(pair.names, pair.link?.by ?? "you");
    pushToast({ kind: "success", message: `${pair.names.join(" and ")} linked again.` });
  } else {
    pushToast({ kind: "info", message: `${pair.names.join(" and ")} are back under Same person?.` });
  }
}

// ── The chapter grid and Scan ─────────────────────────────────────────────────
function rowState(scene) {
  const i = scanQueue.value.indexOf(scene.id);
  if (i === 0) return "scanning";
  return i > 0 ? "queued" : null;
}
const scanning = computed(() => scanQueue.value.length > 0);
const pickable = (s) => !scanQueue.value.includes(s.id);
const pickedScenes = computed(() => scenes.value.filter((s) => selected.value[s.id] && pickable(s)));
const pickedLines = computed(() => pickedScenes.value.reduce((n, s) => n + (linesByScene.value[s.id] || 0), 0));
const allPicked = computed(() => {
  const open = scenes.value.filter(pickable);
  return open.length > 0 && open.every((s) => selected.value[s.id]);
});
function toggleAll(on) {
  selected.value = on ? Object.fromEntries(scenes.value.filter(pickable).map((s) => [s.id, true])) : {};
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
// Each chapter's scan took about 17 s on gemma (RESEARCH §10.4); the mock takes 3.
function nextScan() {
  scanTimer = setTimeout(() => {
    const [id, ...rest] = scanQueue.value;
    scannedAt.value = { ...scannedAt.value, [id]: new Date().toISOString() };
    scanQueue.value = rest;
    if (rest.length) nextScan();
    else scanTimer = null;
  }, 3000);
}
function scan() {
  const targets = pickedScenes.value;
  if (!targets.length) return;
  const idle = !scanQueue.value.length;
  scanQueue.value = [...scanQueue.value, ...targets.map((s) => s.id)];
  selected.value = {};
  if (idle) nextScan();
}

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

// ── Add, Ignore, Remove, Undo — on the page's own copy of the book ────────────
const tickable = (r) => isWaiting(r) || r.status === "cast";
const pickedWaiting = computed(() => found.value.filter((r) => isWaiting(r) && picked.value[r.key]));
const pickedIgnorable = computed(() => pickedWaiting.value.filter((r) => !r.narrator));
const pickedCast = computed(() => found.value.filter((r) => r.status === "cast" && picked.value[r.key]));
const pickedLinkable = computed(() => [...pickedWaiting.value, ...pickedCast.value]);
const linkBlock = computed(() => {
  if (pickedCast.value.length > 1) return "Two of the ticked names are already speakers in this book — joining speakers isn't done here.";
  if (pickedLinkable.value.length < 2) return "Tick two or more names that are one person.";
  return "";
});
function linkSelected() {
  const rows = pickedLinkable.value;
  if (linkBlock.value || bulkBusy.value) return;
  const names = rows.flatMap((r) => r.names);
  const name = link(names);
  for (const r of rows) delete picked.value[r.key];
  picked.value = { ...picked.value };
  pushToast({ kind: "success", message: `${plural(rows.length, "name")} linked as one person, ${name}. Unlink takes it back.` });
}
const tickableShown = computed(() => shown.value.filter(tickable));
const allRowsPicked = computed(() =>
  tickableShown.value.length > 0 && tickableShown.value.every((r) => picked.value[r.key]));
function pickAll(on) {
  picked.value = on ? Object.fromEntries(tickableShown.value.map((r) => [r.key, true])) : {};
}

// A row as promote takes it: a library row takes the persona's exact name and arrives cast with it.
function promote(rows) {
  for (const c of rows) {
    const name = c.status === "library" ? c.persona.name : c.name;
    cast.value = [...cast.value, {
      id: `s_${norm(name).replace(/[^\p{L}\p{N}]+/gu, "_")}`, name, aliases: c.names.filter((n) => n !== name),
      narrator: false, lines: 0, ready: c.status === "library", imported_from: null,
    }];
  }
}
function addSelected() {
  const rows = pickedWaiting.value;
  if (!rows.length || bulkBusy.value) return;
  promote(rows);
  const lib = rows.filter((r) => r.status === "library").length;
  for (const r of rows) delete picked.value[r.key];
  pushToast({
    message: `${rows.length} added as speakers${lib ? ` (${lib} already cast with the persona of that name)` : ""} — give them personas in Cast.`,
    kind: "success",
  });
}
function addIgnored(names) {
  const have = new Set(ignored.value.map(norm));
  ignored.value = [...ignored.value, ...names.filter((n) => !have.has(norm(n)))];
}
function ignoreSelected() {
  const rows = pickedIgnorable.value;
  if (!rows.length || bulkBusy.value) return;
  addIgnored(rows.flatMap((c) => c.names));
  for (const row of rows) delete picked.value[row.key];
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
function add(c) {
  promote([c]);
  pushToast({
    message: c.status === "library"
      ? `${c.persona.name} added as a speaker — played by persona ${c.persona.name}, your persona of that name.`
      : `${c.name} added as a speaker — give them a persona in Cast.`,
    kind: "success",
  });
}
function unignore(names) {
  if (!names.length) return;
  const drop = new Set(names.map(norm));
  ignored.value = ignored.value.filter((n) => !drop.has(norm(n)));
  pushToast({
    message: names.length === 1 ? `${names[0]} is no longer ignored.` : `${names.length} names are no longer ignored.`,
    kind: "info",
  });
}
// Removing asks first, naming each one's lines; the names the scans gave them go on the ignore
// list unless it is Clear all.
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
  const gone = new Set(people.map((p) => p.id));
  if (ignore) addIgnored(found.value.filter((r) => r.speaker && gone.has(r.speaker.id)).flatMap((r) => r.names));
  cast.value = cast.value.filter((c) => !gone.has(c.id));
  pushToast({
    message: people.length === 1 ? `${people[0].name} removed from this book.` : `${people.length} removed from this book.`,
    kind: "success",
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
function ignore(c) {
  addIgnored(c.names);
}
const clearable = computed(() => cast.value.filter((c) => !c.narrator));
const castGroups = computed(() => [
  { key: "book", label: "From the book", hint: "the characters the import brought",
    rows: cast.value.filter((c) => c.imported_from) },
  { key: "added", label: "Added here", hint: "added with ＋ Add, and the narrator",
    rows: cast.value.filter((c) => !c.imported_from) },
].filter((g) => g.rows.length));

// ── The Studio frame, on the mock's numbers ───────────────────────────────────
const STEP_TITLES = {
  overview: "Settings, and where each step stands",
  discover: "Find the speakers the text names",
  script: "Who speaks each line",
  cast: "Give each speaker a persona",
  render: "Every line's audio, and each chapter joined and mastered",
  export: "Package + ACX checklist",
};
// Before the run: nothing analyzed, every line waiting for a speaker or a voice. After it:
// the one-click mock's finished book.
const overview = computed(() => ({
  ...(run.value
    ? mockOverviewState("done")
    : {
      chapters: 2, analyzed: 0, fromImport: 0, running: 0, lines: 176, noNarrator: false, noSpeaker: 0, flagged: 0,
      blocked: 0, cantRender: 176, rendered: 0, renderable: 0, ready: 0, stale: 0,
    }),
  scanned: SCENES.filter((s) => scannedAt.value[s.id]).length,
  proposed: counts.value.new,
  castTotal: cast.value.length,
  castReady: cast.value.filter((c) => c.ready).length,
}));
const stepCards = computed(() => stepsFor("audiobook").map((t) => ({
  ...t, sub: t.key === "overview" ? "book" : stepStatus(t.key, overview.value, UNIT).text,
})));
function goStep(k) {
  const t = stepsFor("audiobook").find((s) => s.key === k);
  pushToast({ kind: "info", message: `Opens ${t?.label ?? k}.` });
}
</script>

<template>
  <q-page :style-fn="pageFlow" class="studio jv-fill mock-discover">
    <div class="jv-section studio__project-bar">
      <label class="jv-eyebrow">Book:</label>
      <UiSelect :model-value="PROJECT.id" width="name" :options="[{ value: PROJECT.id, label: PROJECT.name }]" />
    </div>

    <div class="studio__steps">
      <button v-for="t in stepCards" :key="t.key" type="button" class="jv-stepcard"
        :class="{ 'jv-stepcard--active': t.key === 'discover' }" :title="STEP_TITLES[t.key]"
        @click="t.key !== 'discover' && goStep(t.key)">
        <span class="jv-stepcard__title">{{ t.label }}</span>
        <span class="jv-stepcard__sub">{{ t.sub }}</span>
      </button>
    </div>

    <section class="studio-discover">
      <div class="jv-card">
        <div class="jv-card__header">
          <h3 class="jv-card__title">Who speaks in this {{ bookWord }}?</h3>
        </div>
        <div class="jv-card__body">
          <p class="jv-lede">
            Reads the prose for everyone it names: speakers already in this book, names a persona in
            your library has, and new names. Nothing is created until you add someone. Script can only
            give a line to a speaker in this {{ bookWord }}, so this step runs first.
          </p>

          <div v-if="!scenes.length" class="jv-banner">
            No {{ chapterWord.plural.toLowerCase() }} yet — add or import them in
            <a href="#studio" @click.prevent="goStep('script')">Script</a> first.
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
                  ? `${pickedLines.toLocaleString()} lines · ${scanning ? "starts after the current run" : `one model call per ${chapterWord.singular.toLowerCase()}`}; each row fills in when its ${chapterWord.singular.toLowerCase()} finishes, and a new scan replaces that ${chapterWord.singular.toLowerCase()}'s last one`
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
          <div v-if="found.length" class="jv-inline-row jv-mb14">
            <UiTag v-if="findLine.failed" intent="danger">failed</UiTag>
            <span class="jv-hint">{{ findLine.text }}</span>
            <UiButton :intent="findLine.intent" size="small" :label="findLine.label" :loading="!!findLine.loading"
              :title="FIND_TITLE" @click="find" />
          </div>
          <template v-if="suggestions.length">
            <div class="jv-eyebrow--row">
              <span class="jv-eyebrow">Same person? · {{ suggestions.length }}</span>
              <span class="jv-hint">from {{ checkedBy(check) }}</span>
              <UiButton intent="secondary" size="small" label="Link all"
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
                <UiButton intent="primary" size="small" label="Link"
                  :title="`Link ${row.names.join(' and ')} as one person, ${row.name}`" @click="linkSuggestion(row)" />
                <UiButton intent="ghost" size="small" label="Not the same"
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
                <UiButton intent="ghost" size="small" label="Unlink"
                  :title="row.status === 'cast'
                    ? `Take ${n} out of ${whose(row.name)} Also called — it shows as new again; lines already given to ${row.name} stay`
                    : `${n} is someone else — it gets its own row again`"
                  @click="unlink(row, n)" />
              </div>
              <div v-if="row.link?.by === 'run'" class="jv-hint">linked by {{ RUN_TITLE }}</div>
              <div v-for="p in apartOf(row)" :key="p.names.join('|')" class="jv-aka">
                <span class="jv-hint">kept apart from {{ otherIn(p, row) }}</span>
                <UiButton intent="ghost" size="small" label="Undo"
                  :title="p.from === 'unlink' ? `Link ${otherIn(p, row)} with ${row.name} again` : `Show ${p.names.join(' and ')} under Same person? again`"
                  @click="undoApart(p)" />
              </div>
              <div v-if="row.role_hint" class="jv-hint">{{ row.role_hint }}</div>
            </template>
            <template #status="{ row }">
              <UiTag :intent="STATUS[row.status].intent" :title="statusTitle(row)">{{ STATUS[row.status].label }}</UiTag>
            </template>
            <template #lines="{ row }">
              <span v-if="row.lines" class="jv-mono" title="Roughly how many lines of dialogue they speak in what was scanned">≈ {{ row.lines }}</span>
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
                  :title="row.status === 'library' ? `Add ${row.persona.name} to this book, cast with your persona of that name` : `Add ${row.name} to this book as a speaker`"
                  @click="add(row)" />
                <UiButton intent="ghost" size="small" label="Ignore" :disabled="busyName !== null"
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
            <UiButton intent="ghost" size="small" :disabled="!!linkBlock || bulkBusy || busyName !== null"
              :label="pickedLinkable.length > 1 ? `Link ${pickedLinkable.length} selected as one person` : 'Link selected as one person'"
              :title="linkBlock || 'Link the ticked names as one person — Unlink takes it back'"
              @click="linkSelected" />
            <span class="jv-hint">{{ pickedLinkable.length ? `${pickedLinkable.length} ticked` : "Tick names to add, ignore, remove or link several at once." }}</span>
          </div>
        </div>
      </div>

      <div v-if="ignored.length" class="jv-card jv-card--soft">
        <div class="jv-card__header">
          <h3 class="jv-card__title">Ignored</h3>
          <span class="jv-hint">{{ ignored.length }} · shown as Ignored in this {{ bookWord }}</span>
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
            <a href="#studio" @click.prevent="goStep('script')">Go to Script ➜</a>
          </p>
        </div>
      </div>
    </section>
  </q-page>
</template>

<style scoped>
/* The Studio frame's layout (pages/StudioPage.vue, as MockOneClickPage.vue copies it). */
.studio { padding: 0; display: flex; flex-direction: column; gap: 16px; }
.studio__project-bar { display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: var(--surface-2);
  border-radius: 6px; border: 1px solid var(--border-soft); }
.studio__steps { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
/* Discover's own (components/StudioDiscover.vue). */
.studio-discover { display: flex; flex-direction: column; gap: 14px; }
.studio-discover__grid { margin: 10px 0 12px; }
.studio-discover__run { gap: 10px; align-items: center; }
.studio-discover__cast { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.studio-discover__castgroup { display: flex; align-items: baseline; gap: 8px; margin: 2px 0 6px; }
.studio-discover__quote { display: block; max-width: 46ch; color: var(--ink-2); font-style: italic; }
.studio-discover__chips { gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.studio-discover__new { margin-left: 6px; }
.studio-discover__incast { font-size: 12.5px; margin-right: 6px; }
.studio-discover__bulk { gap: 8px; align-items: center; margin-top: 10px; }
</style>
