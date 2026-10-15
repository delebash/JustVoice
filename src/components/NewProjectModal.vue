<!-- SPDX-License-Identifier: MIT -->
<script setup>
// "What are you making?" — the kind picker (CONCEPTS.md §6, mock #audiobook/1).
//
// Picking a kind sets the sidebar vocabulary, Studio steps, mastering
// target, and export surface for the project. Replaces the old native
// prompt() pair in ProjectsView (native dialogs are banned — project_gotchas).
//
// A file is optional (the user's word, 2026-10-09 — the dialog stays, the mock's "Bring the words
// in" joins it): dropped in, it is read at once (the import's dry run), its title and kind fill
// the name and the kind unless you chose your own, and Create continues on the import review
// page (#importreview), where you pick the chapters and import — the project is made with the
// name, kind and language chosen here. Re-importing into an existing project stays ImportModal's.
//
// Emits:
//   close   — cancel / Esc, or after handing a file to the review page
//   create  — { name, project_type, language } with no file (caller owns the API call)

import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { UiButton, UiInput, UiSelect, UiTable, UiTag, AppModal, fmtBytes, openHelp, pushToast } from "@delebash/llm-ui";
import { bookLanguageOptions } from "../services/personaFacts.js";
import { projectKind } from "../services/projectKinds.js";
import { projectsService } from "../services/projects.js";
import { pickAdapter } from "../services/importPicker.js";
import { setImportDraft } from "../stores/importDraft.js";
import { useVoicesStore } from "../stores/voices.js";

const props = defineProps({
  // Preselect a kind (Home's Start-something pills hand this over).
  initialKind: { type: String, default: "" },
});
const emit = defineEmits(["close", "create", "demo", "focus-only"]);

const KINDS = [
  {
    id: "audiobook",
    icon: projectKind("audiobook").icon,
    label: projectKind("audiobook").name,
    bullets: ["Chapters & paragraphs", "Script → Cast → Render", "Lexicons enforce pronunciation"],
    foot: "Exports: chapter WAVs · M4B · ACX −20 LUFS",
  },
  {
    id: "game_voicelines",
    icon: projectKind("game_voicelines").icon,
    label: projectKind("game_voicelines").name,
    // "string-table import" was here until 2026-08-08 and no adapter ever read
    // one — the idea is in docs/dev/IDEAS.md. The card names only what imports.
    bullets: ["Lines with stable IDs, grouped", "CSV / JSON import", "Re-render only changed lines"],
    foot: "Exports: per-line WAVs by ID + manifest.json",
  },
  {
    id: "podcast",
    icon: projectKind("podcast").icon,
    label: projectKind("podcast").name,
    // "Timeline assembly, music & SFX" went 2026-10-06: no timeline is built (the Stories
    // placeholder was removed the same day; the design waits in IDEAS).
    bullets: ["Episodes & segments, multi-host", "Script import or write in-app"],
    foot: "Exports: episode WAV/MP3 · −16 LUFS stereo",
  },
  {
    id: "custom",
    icon: projectKind("custom").icon,
    label: projectKind("custom").name,
    bullets: ["Paste or drop any text", "Split into sections, or don't", "A voice per section, or one for all"],
    foot: "Exports: WAV / MP3 — no spec checklist",
  },
];

const selected = ref(props.initialKind && KINDS.some((k) => k.id === props.initialKind) ? props.initialKind : "audiobook");
const name = ref("");
const nameInput = ref(null);
// The book's language (2026-10-03) — what it's written in; Cast warns when a
// persona speaks another. Optional: set it later on Studio · Overview.
const voicesStore = useVoicesStore();
voicesStore.ensureLoaded();
const language = ref("");
// Beside the name with no label of its own, so the unset choice says what it is.
const languageOptions = computed(() => bookLanguageOptions(voicesStore.items)
  .map((o) => (o.value ? o : { ...o, label: "Language — not set" })));

// ── the optional file ──
// The importers the server has (GET /v1/projects/import/adapters): the table of what each source
// brings, in the server's own words, and the format a dropped file is read as. Its columns are the
// mock's (`_s1`, decided 2026-10-15): Source (its file endings under it), What lands, and whether
// the file says who speaks each line — the server's `says_who_speaks`, a yes / no tag.
const adapters = ref([]);
const sourceRows = computed(() => adapters.value.filter((a) => a.implemented)
  .map((a) => ({ id: a.id, label: a.label, files: a.file_extensions.join(" · "), lands: a.description, speaks: !!a.says_who_speaks })));
const SOURCE_COLUMNS = [
  { id: "label", header: "Source", accessorKey: "label" },
  { id: "lands", header: "What lands", accessorKey: "lands" },
  { id: "speaks", header: "Says who speaks?", cellStyle: { whiteSpace: "nowrap" } },
];
const file = ref(null);
const source = ref("");
const reading = ref(false);
const standard = ref(null); // the dry run — what the review page opens on
const dropActive = ref(false);
const fileInput = ref(null);
// Your own name or kind beats the file's; a suggested one ("My audiobook") does not.
const nameChosen = ref(false);
const kindChosen = ref(!!props.initialKind);
const formatOptions = computed(() => {
  const ext = file.value ? file.value.name.slice(file.value.name.lastIndexOf(".")).toLowerCase() : "";
  return adapters.value.filter((a) => a.implemented && a.file_extensions.includes(ext)).map((a) => ({ label: a.label, value: a.id }));
});

// The chosen source's section in the docs (its `docs_anchor`) — the old Import dialog's
// "What is this format?" link (0761c86^ ImportModal.vue), same words and target. It opens in the
// Help drawer (the kit's openHelp): the desktop window opens no app:// link in a new window, and
// the headless server serves no /docs.
const helpKey = computed(() => adapters.value.find((a) => a.id === source.value)?.docs_anchor || null);
const helpHref = computed(() => (helpKey.value ? `docs/import-and-export.md#${helpKey.value}` : "docs/import-and-export.md"));

const canCreate = computed(() => !!name.value.trim() && !reading.value && (!file.value || !!standard.value));

function pick(id) {
  selected.value = id;
  kindChosen.value = true;
  // Dead-click fix: choosing a kind suggests a name immediately so
  // Create lights up — typing replaces the suggestion (text selected).
  if (!name.value.trim()) {
    name.value = `My ${KINDS.find((k) => k.id === id)?.label.toLowerCase() || "project"}`;
  }
  nameInput.value?.focus();
  nameInput.value?.select();
}

async function read() {
  reading.value = true;
  standard.value = null;
  try {
    const res = await projectsService.runImport({ source: source.value, file: file.value, dryRun: true });
    standard.value = res.standard;
    const p = res.standard?.project || {};
    if (!nameChosen.value && p.name) name.value = p.name;
    if (!kindChosen.value && KINDS.some((k) => k.id === p.kind)) selected.value = p.kind;
    if (!language.value && p.language) language.value = p.language;
  } catch (e) {
    pushToast({ kind: "error", message: `Couldn't read ${file.value?.name}: ${e?.message || e}` });
  } finally {
    reading.value = false;
  }
}

async function acceptFile(f) {
  if (!f) return;
  file.value = f;
  const dot = f.name.lastIndexOf(".");
  let head = "";
  try {
    head = await f.slice(0, 4096).text();
  } catch {
    /* a zip or a DOCX — the extension decides */
  }
  const match = dot < 0 ? null : pickAdapter({ ext: f.name.slice(dot).toLowerCase(), head, adapters: adapters.value });
  if (!match) {
    pushToast({ kind: "error", message: `${f.name} isn't a file JustVoice imports — the table lists what it reads.` });
    clearFile();
    return;
  }
  source.value = match.id;
  await read();
}

function onDrop(e) {
  dropActive.value = false;
  acceptFile(e.dataTransfer?.files?.[0]);
}

function changeFormat(id) {
  source.value = id;
  read();
}

function clearFile() {
  file.value = null;
  source.value = "";
  standard.value = null;
  if (fileInput.value) fileInput.value.value = "";
}

function create() {
  if (!canCreate.value) return;
  const choice = { name: name.value.trim(), project_type: selected.value, language: language.value || null };
  if (!file.value) {
    emit("create", choice);
    return;
  }
  // With a file: the review page picks the chapters and imports, as Import always has.
  setImportDraft({ file: file.value, source: source.value, standard: standard.value, create: choice });
  emit("close");
  window.location.hash = "#importreview";
}

function onKey(e) {
  if (e.key === "Escape") emit("close");
  if (e.key === "Enter" && canCreate.value) create();
}

onMounted(async () => {
  window.addEventListener("keydown", onKey);
  nameInput.value?.focus();
  try {
    adapters.value = (await projectsService.listImportAdapters()).adapters || [];
  } catch (e) {
    pushToast({ kind: "error", message: `Couldn't load what JustVoice imports: ${e?.message || e}` });
  }
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <AppModal eyebrow="New project" title="What are you making?" :max-width="'980px'" dismissable @close="emit('close')">
      <p class="np-lede">
        Everything downstream adapts — the words in the sidebar, the default mastering
        target, which Studio steps appear, and what Export produces. Same voices,
        personas, and lexicons either way.
      </p>

      <div class="np-grid">
        <button
          v-for="k in KINDS"
          :key="k.id"
          type="button"
          class="np-card"
          :class="{ sel: selected === k.id }"
          @click="pick(k.id)"
        >
          <span class="np-icon">{{ k.icon }}</span>
          <span class="np-name">{{ k.label }}</span>
          <ul class="np-bullets">
            <li v-for="b in k.bullets" :key="b">{{ b }}</li>
          </ul>
          <span class="np-foot">{{ k.foot }}</span>
        </button>
      </div>

      <section class="np-words">
        <h3 class="np-words__title">Bring the words in <span class="jv-hint">— optional</span></h3>
        <div class="jv-drop" :class="{ 'jv-drop--active': dropActive, 'jv-drop--filled': file }"
          @dragover.prevent="dropActive = true" @dragleave="dropActive = false" @drop.prevent="onDrop">
          <div v-if="file" class="jv-drop__row">
            <span>📄 {{ file.name }} · {{ fmtBytes(file.size) }}</span>
            <UiSelect v-if="formatOptions.length > 1" :model-value="source" :options="formatOptions" width="name"
              aria-label="Read it as" title="Read it as — the file's ending fits more than one source"
              @update:model-value="changeFormat" />
            <a v-if="helpKey" :href="helpHref" :data-help-key="helpKey" @click.prevent="openHelp('import-and-export', helpKey)">What is this format?</a>
            <span v-if="reading" class="jv-hint">Reading the file…</span>
            <span class="jv-spacer" />
            <UiButton intent="ghost" size="small" label="✕" title="Start without a file" @click="clearFile" />
          </div>
          <div v-else class="jv-drop__row">
            <UiButton intent="secondary" size="small" label="Browse…" title="Pick the file to bring in" @click="fileInput?.click()" />
            <span class="jv-hint">or drop it here. Create then opens its review, where you pick the chapters to import.</span>
          </div>
          <input ref="fileInput" type="file" hidden @change="acceptFile($event.target.files?.[0])" />
        </div>
        <UiTable v-if="!file && sourceRows.length" class="jv-table-look np-sources" :data="sourceRows" :columns="SOURCE_COLUMNS">
          <template #label="{ row }">
            <strong>{{ row.label }}</strong>
            <div class="jv-hint">{{ row.files }}</div>
          </template>
          <template #speaks="{ row }"><UiTag :intent="row.speaks ? 'success' : 'ghost'">{{ row.speaks ? "yes" : "no" }}</UiTag></template>
        </UiTable>
      </section>

      <div class="np-alts">
        <span class="np-alts__lead">Or start from —</span>
        <UiButton
          v-if="selected !== 'custom'"
          intent="ghost"
          size="small"
          :title="`Seed a small ${KINDS.find(k => k.id === selected)?.label} project you can safely explore`"
          @click="emit('demo', selected)"
        >
          <template #icon>✨</template>a demo project
        </UiButton>
      </div>

      <p class="np-focus-only">
        Not making projects?
        <a href="#" title="Real-time TTS + global hotkey workflows — no project needed" @click.prevent="emit('focus-only', 'dictation')">Set up dictation ➜</a>
        ·
        <a href="#" title="Reader-friendly playback + screen-reader-aware controls" @click.prevent="emit('focus-only', 'accessibility')">Accessibility ➜</a>
      </p>

    <template #footer>
      <UiInput
        ref="nameInput"
        v-model="name"
        width="name"
        class="np-name-input"
        placeholder="Project name…"
        @update:model-value="nameChosen = true"
        @keydown.enter.stop.prevent="create"
      />
      <UiSelect v-model="language" width="id" :options="languageOptions" aria-label="Language"
        title="What it's written in — Cast warns when a persona speaks another language. You can set it later on Overview."
        placeholder="Language" />
      <span class="jv-spacer" />
      <UiButton intent="primary" :disabled="!canCreate" @click="create">Create project ➜</UiButton>
    </template>
  </AppModal>
</template>

<style scoped>
.np-lede { font-size: 13px; color: var(--ink-2, #4a4a4a); margin: 0 0 16px; max-width: 720px; }
.np-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.np-card {
  display: flex; flex-direction: column; gap: 7px; text-align: left;
  background: var(--surface, #fff);
  border: 1px solid var(--line, #e3e1dc);
  border-radius: 12px; padding: 15px; cursor: pointer; font: inherit;
}
.np-card:hover { border-color: var(--line-strong, #cfccc4); }
.np-card.sel {
  border-color: var(--accent, #3a7d63);
  box-shadow: 0 0 0 3px var(--accent-soft, #e8f0eb);
}
.np-icon { font-size: 24px; line-height: 1; }
.np-name { font-size: 15.5px; font-weight: 600; }
.np-bullets { margin: 0; padding-left: 16px; font-size: 11.5px; color: var(--ink-2, #4a4a4a); line-height: 1.6; }
.np-foot {
  font-size: 10.5px; color: var(--muted, #888);
  border-top: 1px solid var(--line, #e3e1dc); padding-top: 7px; margin-top: auto;
}
.np-name-input { flex: 0 1 320px; }
/* Alternatives to picking a kind. Set off from the card grid by a hairline so
   the zone reads as a deliberate "or start another way" rather than two links
   floating under the cards. Ghost buttons (thin-bordered quiet utilities)
   replace the old underlined <a>s, which read as unstyled text and could wrap
   mid-phrase when squeezed. The lead-in + short labels read as one sentence:
   "Or start from — [a file] [a demo project]". */
.np-alts {
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
  margin-top: 16px; padding-top: 14px;
  border-top: 1px solid var(--line, #e3e1dc);
}
.np-alts__lead { font-size: 12px; color: var(--muted, #888); }
.np-words { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
.np-words__title { margin: 0; font-size: 13.5px; font-weight: 600; }
.np-sources { font-size: 12.5px; }
/* compact: a reference list under the drop box, not a data grid to work in */
.np-sources.jv-table-look :deep(.ui-table thead th),
.np-sources.jv-table-look :deep(.ui-table tbody td) { padding: 5px 10px; line-height: 1.35; }

@media (max-width: 860px) {
  .np-grid { grid-template-columns: repeat(2, 1fr); }
}
/* At phone width the footer wraps (the kit's AppModal): the name takes the first row, at the
   start, so it lines up with the language below it rather than sitting at the row's end. */
@media (max-width: 599.98px) {
  .np-name-input { margin-right: auto; }
}
.np-focus-only { margin: 10px 0 0; font-size: 11.5px; color: var(--muted, #888); }
.np-focus-only a { color: var(--accent, #3a7d63); text-decoration: underline; }
</style>
