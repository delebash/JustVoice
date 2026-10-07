<!-- SPDX-License-Identifier: MIT -->
<!--
  Studio · Script — the chapter grid (the mock, dev only: #/mock/script). Slice 4, D7: chapters
  are added, renamed, moved and deleted here — "＋ Add chapter" beside the filter chips, and
  Rename · Move up · Move down · Delete in each row's ⋯ menu. A chapter with no text yet offers
  "＋ Add text": paste it, and each paragraph becomes a line. (The old Chapters page, where these
  lived, is deleted in the same slice.) Everything else is Script's grid as it ships —
  components/StudioScript.vue — on `renderMock.js`.
-->
<script setup>
import { computed, ref } from "vue";
import {
  DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal,
  DropdownMenuRoot, DropdownMenuSeparator, DropdownMenuTrigger,
} from "reka-ui";
import {
  AppModal, EmptyState, UiButton, UiCheckbox, UiChip, UiTable, UiTag, UiTextarea,
  confirmDialog, promptDialog, pushToast,
} from "@delebash/llm-ui";
import { render, renumber } from "./renderMock.js";

const emit = defineEmits(["go"]);

const CHIPS = [
  { id: "all", label: "All", tip: "" },
  { id: "check", label: "To check", tip: "Chapters with flagged lines or lines with no speaker" },
  { id: "never", label: "Not analyzed yet", tip: "" },
  { id: "stale", label: "Re-analyze", tip: "A speaker was added since, and the text names them" },
  { id: "problem", label: "Needs attention", tip: "Failed, can't re-cut, no text, or no dialogue found" },
];
const chip = ref("all");
function statesOf(ch) {
  const s = new Set();
  const none = ch.lines.filter((l) => !l.speaker_id).length;
  if (!ch.lines.length) s.add("problem");
  else if (!ch.script.analyzed) s.add("never");
  else if (ch.script.flagged || none) s.add("check");
  return s;
}
const rows = computed(() => render.chapters.map((ch) => ({ ...ch, ch, none: ch.lines.filter((l) => !l.speaker_id).length, states: statesOf(ch) })));
const shown = computed(() => (chip.value === "all" ? rows.value : rows.value.filter((r) => r.states.has(chip.value))));
const chipCount = (id) => (id === "all" ? rows.value.length : rows.value.filter((r) => r.states.has(id)).length);

const RIGHT = { textAlign: "right", whiteSpace: "nowrap", width: "1%" };
const COLUMNS = [
  { id: "sel", header: "", headerStyle: { width: "1%" }, cellStyle: { width: "1%" } },
  { id: "title", header: "Chapter" },
  { id: "lines", header: "Lines", headerStyle: RIGHT, cellStyle: RIGHT },
  { id: "analyzed", header: "Analyzed", headerStyle: { width: "1%", whiteSpace: "nowrap" }, cellStyle: { whiteSpace: "nowrap" } },
  { id: "anchored", header: "Book says", headerStyle: RIGHT, cellStyle: RIGHT },
  { id: "guessed", header: "AI decided", headerStyle: RIGHT, cellStyle: RIGHT },
  { id: "flagged", header: "Flagged", headerStyle: RIGHT, cellStyle: RIGHT },
  { id: "none", header: "No speaker", headerStyle: RIGHT, cellStyle: RIGHT },
  { id: "acts", header: "", headerStyle: { width: "1%" }, cellStyle: { whiteSpace: "nowrap", textAlign: "right" } },
];
const total = computed(() => render.chapters.reduce((n, c) => n + c.lines.length, 0));

const ticked = ref({});
const picked = computed(() => rows.value.filter((r) => ticked.value[r.id] && r.lines.length));
const shownTickable = computed(() => shown.value.filter((r) => r.lines.length));
const allShownTicked = computed(() => shownTickable.value.length > 0 && shownTickable.value.every((r) => ticked.value[r.id]));
function tickShown(v) {
  const next = { ...ticked.value };
  for (const r of shownTickable.value) next[r.id] = v;
  ticked.value = next;
}

// ── The chapters themselves (D7) ───────────────────────────────────────
async function addChapter() {
  const title = (await promptDialog({
    title: "New chapter", label: "Title", placeholder: `Chapter ${render.chapters.length + 1}`, confirmLabel: "Add",
  }))?.trim();
  if (!title) return;
  render.chapters.push({
    id: `c_${Date.now().toString(36)}`, n: 0, title, lines: [], scanned: false,
    script: { analyzed: "", anchored: 0, guessed: 0, flagged: 0, none: 0 },
  });
  renumber();
  pushToast({ kind: "success", message: `“${title}” added — paste its text with ＋ Add text.` });
}
async function rename(ch) {
  const title = (await promptDialog({
    title: "Rename chapter", label: "Title", defaultValue: ch.title, confirmLabel: "Rename",
  }))?.trim();
  if (title && title !== ch.title) ch.title = title;
}
function move(ch, dir) {
  const i = render.chapters.indexOf(ch);
  const j = i + dir;
  if (j < 0 || j >= render.chapters.length) return;
  render.chapters.splice(i, 1);
  render.chapters.splice(j, 0, ch);
  renumber();
}
async function remove(ch) {
  const takes = ch.lines.reduce((n, l) => n + l.takes.length, 0);
  const ok = await confirmDialog({
    title: `Delete “${ch.title}”?`,
    message: ch.lines.length
      ? `Its ${ch.lines.length} lines${takes ? ` and their ${takes} takes` : ""} go with it — permanently.`
      : "It has no text yet.",
    danger: true, confirmLabel: "Delete chapter",
  });
  if (!ok) return;
  render.chapters.splice(render.chapters.indexOf(ch), 1);
  delete render.qc[ch.id];
  renumber();
}

// ＋ Add text — paste a chapter's text; each paragraph becomes a line with no speaker yet, for
// Analyze to attribute.
const paste = ref(null);   // { ch, text }
function addLines() {
  const { ch, text } = paste.value;
  const paras = text.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean);
  ch.lines = paras.map((t, k) => ({
    id: `${ch.id}_l${k + 1}`, n: k + 1, speaker_id: null, text: t, spoken: false,
    direction: "", override: null, takes: [], madeFrom: null,
  }));
  paste.value = null;
  pushToast({ kind: "success", message: `${paras.length} lines added — ✨ Analyze works out who speaks each one.` });
}
const pasteCount = computed(() => (paste.value?.text || "").split(/\n\s*\n/).filter((t) => t.trim()).length);

function review() {
  pushToast({ kind: "info", message: "Opens the chapter's lines." });
}
function analyze() {
  pushToast({ kind: "info", message: `✨ Analyze · ${picked.value.length} chapter${picked.value.length === 1 ? "" : "s"} — each row fills in as its chapter finishes.` });
  for (const r of picked.value) r.ch.script.analyzed = "just now";
  ticked.value = {};
}
</script>

<template>
  <section class="studio-script">
    <div class="jv-card">
      <div class="jv-card__header">
        <h3 class="jv-card__title">Who says what</h3>
        <span class="jv-hint">{{ total.toLocaleString() }} lines · {{ rows.length }} chapter{{ rows.length === 1 ? "" : "s" }}</span>
      </div>
      <div class="jv-card__body">
        <p class="jv-lede">
          Attribution only — which speaker says each line, and what the line says. How it is
          performed, and rendering it, come later.
        </p>

        <EmptyState v-if="!rows.length" icon="Sparkle" title="No chapters yet"
          message="Import a manuscript — EPUB, DOCX, Markdown or plain text — and it splits into chapters, with a preview before anything is added. Or add a chapter and paste its text."
          compact>
          <template #actions>
            <UiButton intent="primary" label="⬆ Import a manuscript…" @click="pushToast({ kind: 'info', message: 'Opens Import.' })" />
            <UiButton intent="secondary" label="＋ Add chapter" @click="addChapter" />
          </template>
        </EmptyState>
        <template v-else>
          <div class="jv-inline-row studio-script__chips">
            <UiChip v-for="c in CHIPS" :key="c.id" :selected="chip === c.id" :title="c.tip"
              @click="chip = c.id">{{ c.label }} {{ chipCount(c.id) }}</UiChip>
            <span class="jv-hint">Select-all ticks only the chapters shown.</span>
            <span class="jv-spacer" />
            <UiButton intent="secondary" size="small" label="＋ Add chapter" title="A new chapter at the end — paste its text next"
              @click="addChapter" />
          </div>

          <UiTable class="jv-table-look studio-script__grid" :data="shown" :columns="COLUMNS" data-key="id" row-hover
            :row-class="(r) => ({ 'studio-script__row--open': r.script.analyzed })" @row-click="({ data }) => data.script.analyzed && review()">
            <template #head-sel>
              <UiCheckbox :model-value="allShownTicked" :disabled="!shownTickable.length" title="Tick every chapter shown"
                @update:model-value="tickShown" />
            </template>
            <template #sel="{ row }">
              <span @click.stop>
                <UiCheckbox :model-value="!!ticked[row.id] && !!row.lines.length" :disabled="!row.lines.length"
                  :title="!row.lines.length ? 'No text to analyze' : ''"
                  @update:model-value="(v) => (ticked = { ...ticked, [row.id]: v })" />
              </span>
            </template>
            <template #title="{ row }"><strong>{{ row.n }} · {{ row.title }}</strong></template>
            <template #lines="{ row }">
              <span v-if="row.lines.length" class="jv-mono">{{ row.lines.length.toLocaleString() }}</span>
              <span v-else class="jv-muted">—</span>
            </template>
            <template #analyzed="{ row }">
              <span v-if="!row.lines.length" class="jv-muted">no text yet</span>
              <span v-else class="jv-muted">{{ row.script.analyzed || "not analyzed yet" }}</span>
            </template>
            <template #anchored="{ row }">
              <span v-if="row.script.analyzed" class="jv-mono">{{ row.script.anchored }}</span>
              <span v-else class="jv-muted">—</span>
            </template>
            <template #guessed="{ row }">
              <span v-if="row.script.analyzed" class="jv-mono">{{ row.script.guessed }}</span>
              <span v-else class="jv-muted">—</span>
            </template>
            <template #flagged="{ row }">
              <UiTag v-if="row.script.analyzed && row.script.flagged" intent="accent2">{{ row.script.flagged }}</UiTag>
              <span v-else-if="row.script.analyzed" class="jv-muted">0</span>
              <span v-else class="jv-muted">—</span>
            </template>
            <template #none="{ row }">
              <UiTag v-if="row.script.analyzed && row.none" intent="danger">{{ row.none }}</UiTag>
              <span v-else-if="row.script.analyzed" class="jv-muted">0</span>
              <span v-else class="jv-muted">—</span>
            </template>
            <template #acts="{ row }">
              <span class="studio-script__acts" @click.stop>
                <UiButton v-if="!row.lines.length" intent="secondary" size="small" label="＋ Add text"
                  title="Paste its text" @click="paste = { ch: row.ch, text: '' }" />
                <UiButton v-else intent="secondary" size="small" label="Review" :disabled="!row.script.analyzed"
                  :title="row.script.analyzed ? '' : 'Analyze it first'" @click="review" />
                <DropdownMenuRoot>
                  <DropdownMenuTrigger class="ev-kebab" aria-label="Chapter actions" title="Chapter actions">⋯</DropdownMenuTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuContent class="ev-menu" align="end" :side-offset="4" :collision-padding="8">
                      <DropdownMenuItem class="ev-menu-item" @select="rename(row.ch)">✏️ Rename</DropdownMenuItem>
                      <DropdownMenuItem class="ev-menu-item" :disabled="row.n === 1" @select="move(row.ch, -1)">↑ Move up</DropdownMenuItem>
                      <DropdownMenuItem class="ev-menu-item" :disabled="row.n === rows.length" @select="move(row.ch, 1)">↓ Move down</DropdownMenuItem>
                      <DropdownMenuSeparator class="ev-menu-sep" />
                      <DropdownMenuItem class="ev-menu-item danger" @select="remove(row.ch)">🗑 Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </DropdownMenuRoot>
              </span>
            </template>
            <template #empty>No chapters in this view.</template>
          </UiTable>

          <div class="jv-inline-row studio-script__go">
            <UiButton intent="primary" :disabled="!picked.length"
              :label="picked.length ? `✨ Analyze ${picked.length} chapter${picked.length === 1 ? '' : 's'}` : '✨ Analyze'"
              @click="analyze" />
            <span class="jv-hint">{{ picked.length
              ? `${picked.reduce((n, r) => n + r.lines.length, 0).toLocaleString()} lines · one model call per chapter · each row fills in as its chapter finishes`
              : "Pick at least one chapter." }}</span>
          </div>
        </template>
      </div>
    </div>

    <AppModal v-if="paste" eyebrow="＋ Add text" :title="`${paste.ch.n} · ${paste.ch.title}`" max-width="720px" dismissable
      @close="paste = null">
      <p class="jv-lede studio-script__paste-lede">
        Paste the chapter's text. Each paragraph becomes a line; ✨ Analyze then works out who speaks each one.
      </p>
      <UiTextarea v-model="paste.text" :rows="12" placeholder="Paste the chapter text…" />
      <template #footer>
        <span class="jv-hint">{{ pasteCount ? `${pasteCount} paragraph${pasteCount === 1 ? "" : "s"}` : "" }}</span>
        <span class="jv-spacer" />
        <UiButton intent="secondary" label="Cancel" @click="paste = null" />
        <UiButton intent="primary" label="Add as lines" :disabled="!pasteCount" @click="addLines" />
      </template>
    </AppModal>
  </section>
</template>

<style scoped>
.studio-script { display: flex; flex-direction: column; gap: 14px; }
.studio-script__chips { gap: 6px; flex-wrap: wrap; margin: 0 0 10px; align-items: center; }
.studio-script__grid { margin: 0 0 12px; }
.studio-script__grid :deep(.studio-script__row--open) { cursor: pointer; }
.studio-script__acts { display: inline-flex; gap: 6px; align-items: center; }
.studio-script__go { gap: 10px; align-items: center; flex-wrap: wrap; }
.studio-script__paste-lede { margin: 0 0 10px; }
</style>
