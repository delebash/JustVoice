<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
// Multi-adapter import PICKER.
//
// Small dialog: pick a source format from the live adapter list
// (GET /v1/projects/import/adapters), drop/browse a file, then run a
// dry-run. The dry-run hands off to the full-page ImportReviewView
// (via setImportDraft + #importreview) which shows the detected
// structure and commits — the modal itself never previews or commits
// in place (user decision 2026-06-12: picker stays small, results are a
// regular page).
//
// Emits:
//   close — closing / cancel / Esc / after a successful dry-run handoff
//
// Renders on the canonical jv-overlay/jv-modal shell (RULE #1) — same
// CSS the rest of the app's modals use, so there's no scoped one-off to
// drift. (It could alternatively wrap components/AppModal.vue; that's a
// later call. The earlier "vue-i18n isn't installed" note was wrong —
// it is, and main.js registers it — so nothing blocked using the shell.)
//
// Help link: each adapter exposes a `docs_anchor` (e.g. "import-justwrite").
// We surface it through `data-help-key` on the "What is this format?" link
// so the existing help-bus picks it up when implemented; for now it deep-
// links to docs/import-formats.md#<anchor>.

import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import JvButton from "../components/ui/JvButton.vue";
import JvSelect from "../components/ui/JvSelect.vue";
import { projectsService } from "../services/projects.js";
import { setImportDraft } from "../stores/importDraft.js";
import { pushToast } from "../services/toastBridge.js";

const props = defineProps({
  // When set, the import MERGES into this project by stable line id
  // (game re-import flow) instead of creating a new project.
  projectId: { type: String, default: null },
});

const emit = defineEmits(["close"]);

const adapters = ref([]);          // [{ id, label, description, file_extensions, implemented, docs_anchor }]
const selectedSource = ref("");
const file = ref(null);
const filename = ref("");
const isDragging = ref(false);
const loadingAdapters = ref(true);
const previewing = ref(false);

const selectedAdapter = computed(() =>
  adapters.value.find((a) => a.id === selectedSource.value) || null
);
const adapterOptions = computed(() =>
  adapters.value.map((a) => ({
    label: a.implemented ? a.label : `${a.label}`,
    value: a.id,
  }))
);
const canPreview = computed(
  () => !!file.value && !!selectedSource.value && selectedAdapter.value?.implemented
);

const helpKey = computed(() => selectedAdapter.value?.docs_anchor || null);
const helpHref = computed(() =>
  helpKey.value ? `docs/import-formats.md#${helpKey.value}` : "docs/import-formats.md"
);

function onKey(e) {
  if (e.key === "Escape") emit("close");
}

onMounted(async () => {
  window.addEventListener("keydown", onKey);
  try {
    const res = await projectsService.listImportAdapters();
    adapters.value = res.adapters || [];
    // Default to JustWrite — the primary integration partner.
    const def = adapters.value.find((a) => a.id === "justwrite" && a.implemented);
    selectedSource.value = def?.id || adapters.value.find((a) => a.implemented)?.id || "";
  } catch (e) {
    pushToast({ message: `Failed to load adapters: ${e.message || e}`, kind: "error" });
  } finally {
    loadingAdapters.value = false;
  }
});

onBeforeUnmount(() => window.removeEventListener("keydown", onKey));

// Auto-pick the adapter for this file. Extension narrows the field;
// when several adapters claim it (.md = book_prose AND podcast_markdown)
// the file's CONTENT decides: speaker labels at paragraph start mean a
// podcast script — without this, scripts imported as speakerless books.
const SPEAKER_LABEL_RE = /^\s*(?:\*\*|\[)?[A-Z][A-Za-z0-9 .'-]{0,40}?(?:\]|\*\*)?\s*:/m;

async function adapterForFile(f) {
  const dot = f.name.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = f.name.slice(dot).toLowerCase();
  const candidates = adapters.value.filter(
    (a) => a.implemented && (a.file_extensions || []).includes(ext)
  );
  if (candidates.length <= 1) return candidates[0] || null;
  let head = "";
  try {
    head = await f.slice(0, 4096).text();
  } catch { /* binary or unreadable — fall through to first candidate */ }
  const wantsPodcast = SPEAKER_LABEL_RE.test(head);
  return (
    candidates.find((a) =>
      wantsPodcast ? a.id === "podcast_markdown" : a.id !== "podcast_markdown"
    ) || candidates[0]
  );
}

async function acceptFile(f) {
  file.value = f;
  filename.value = f.name;
  const match = await adapterForFile(f);
  if (match) selectedSource.value = match.id;
  // Dry-run immediately — the preview IS the import experience; the
  // commit button is just the confirmation.
  if (canPreview.value) doPreview();
}

function pickFromInput(e) {
  const f = e.target?.files?.[0];
  if (f) acceptFile(f);
}

function onDrop(e) {
  e.preventDefault();
  isDragging.value = false;
  const f = e.dataTransfer?.files?.[0];
  if (f) acceptFile(f);
}

async function doPreview() {
  if (!canPreview.value) return;
  previewing.value = true;
  try {
    const res = await projectsService.runImport({
      source: selectedSource.value,
      file: file.value,
      dryRun: true,
    });
    // Hand off to the full-page review (user decision 2026-06-12: the
    // picker stays small; the RESULTS are a regular in-app page).
    setImportDraft({
      file: file.value,
      source: selectedSource.value,
      standard: res.standard,
      projectId: props.projectId || null,
    });
    emit("close");
    window.location.hash = "#importreview";
    return;
  } catch (e) {
    pushToast({ message: `Preview failed: ${e.message || e}`, kind: "error" });
  } finally {
    previewing.value = false;
  }
}
</script>

<template>
  <div class="jv-overlay" @click.self="emit('close')" role="dialog" aria-modal="true" aria-labelledby="im-title">
    <div class="jv-modal im-modal">
      <header class="jv-modal__header">
        <div class="jv-modal__titleblock">
          <span class="jv-modal__eyebrow">Import</span>
          <h3 id="im-title" class="jv-modal__title">{{ props.projectId ? "Re-import — update in place" : "Import a project" }}</h3>
        </div>
        <button type="button" class="jv-modal__close" aria-label="Close" @click="emit('close')">✕</button>
      </header>
      <div class="jv-modal__body">
        <div class="import-grid">
      <label class="field">
        <span class="lbl">Source format</span>
        <JvSelect
          v-model="selectedSource"
          :options="adapterOptions"
          placeholder="Pick a format…"
          :disabled="loadingAdapters"
        />
        <p v-if="selectedAdapter" class="muted desc">
          {{ selectedAdapter.description }}
          <a
            v-if="helpKey"
            class="help"
            :href="helpHref"
            :data-help-key="helpKey"
            target="_blank"
            rel="noopener"
          >What is this format?</a>
        </p>
        <p v-if="selectedAdapter && !selectedAdapter.implemented" class="warn">
          This adapter isn't implemented yet — the server will return 501.
        </p>
      </label>

      <div
        class="drop"
        :class="{ dragging: isDragging, has: !!file }"
        @dragenter.prevent="isDragging = true"
        @dragover.prevent="isDragging = true"
        @dragleave.prevent="isDragging = false"
        @drop="onDrop"
      >
        <input
          id="import-file"
          ref="fileInput"
          type="file"
          class="hidden-input"
          :accept="(selectedAdapter?.file_extensions || []).join(',') || '*'"
          @change="pickFromInput"
        />
        <label for="import-file" class="drop-inner">
          <div v-if="!file" class="empty">
            <div class="drop-title">Drop a file here</div>
            <div class="muted">or click to browse</div>
          </div>
          <div v-else class="picked">
            <div class="drop-title">{{ filename }}</div>
            <div class="muted">{{ (file.size / 1024).toFixed(1) }} KB</div>
          </div>
        </label>
      </div>

      <p v-if="previewing" class="muted" style="margin-top:10px">Scanning the file…</p>
        </div>
      </div>
      <footer class="jv-modal__footer">
        <JvButton variant="secondary" @click="emit('close')">Cancel</JvButton>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.im-modal { width: min(560px, calc(100vw - 32px)); }

.import-grid { display: flex; flex-direction: column; gap: 18px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.lbl { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
.muted { color: var(--muted); font-size: 12px; }
.warn { color: var(--warn, #c89a3a); font-size: 12px; margin-top: 2px; }
.desc { margin: 0; }
.help { margin-left: 8px; }

.drop {
  border: 1.5px dashed var(--line, #cfcdc7);
  border-radius: 10px;
  padding: 28px;
  text-align: center;
  transition: background 120ms ease, border-color 120ms ease;
  cursor: pointer;
}
.drop.dragging { background: var(--bg-soft, rgba(58, 125, 99, 0.08)); border-color: var(--accent, #3a7d63); }
.drop.has { border-style: solid; }
.drop-inner { display: block; cursor: pointer; }
.drop-title { font-weight: 600; font-size: 14px; margin-bottom: 4px; }
.hidden-input { display: none; }
</style>
