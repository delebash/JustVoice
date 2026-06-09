<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
// Multi-adapter import modal.
//
// Self-contained dialog. Lets the operator:
//   1. Pick a source format from the live adapter list
//      (GET /v1/projects/import/adapters)
//   2. Drop or browse for a file
//   3. Run a dry-run preview (committed=false) — shows project / scenes /
//      lines summary so the operator can sanity-check before committing
//   4. Commit — calls the same endpoint with dry_run=false and emits
//      `created` with the resulting ProjectRecord, then closes.
//
// Emits:
//   close   — closing without committing (cancel / Esc)
//   created — `{ project_id, name, kind }` after a successful commit
//
// We could have wrapped components/AppModal.vue here, but AppModal pulls
// in vue-i18n which the project doesn't currently install — so we render
// a minimal modal shell inline (Reka UI's Dialog primitives are already
// available, but keeping this dependency-free reduces churn). Once
// vue-i18n lands in package.json this can be flipped to `<AppModal>`
// with no API change for callers.
//
// Help link: each adapter exposes a `docs_anchor` (e.g. "import-justwrite").
// We surface it through `data-help-key` on the "What is this format?" link
// so the existing help-bus picks it up when implemented; for now it deep-
// links to docs/import-formats.md#<anchor>.

import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import JvButton from "../components/jv/JvButton.vue";
import JvSelect from "../components/jv/JvSelect.vue";
import { projectsService } from "../services/projects.js";
import { pushToast } from "../services/toastBridge.js";

const emit = defineEmits(["close", "created"]);

const adapters = ref([]);          // [{ id, label, description, file_extensions, implemented, docs_anchor }]
const selectedSource = ref("");
const file = ref(null);
const filename = ref("");
const isDragging = ref(false);
const loadingAdapters = ref(true);
const previewing = ref(false);
const committing = ref(false);
const preview = ref(null);          // last dry_run StandardImport

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
const canCommit = computed(() => canPreview.value && !committing.value);

const helpKey = computed(() => selectedAdapter.value?.docs_anchor || null);
const helpHref = computed(() =>
  helpKey.value ? `docs/import-formats.md#${helpKey.value}` : "docs/import-formats.md"
);

function onKey(e) {
  if (e.key === "Escape" && !committing.value) {
    emit("close");
  }
}

onMounted(async () => {
  window.addEventListener("keydown", onKey);
  try {
    const res = await projectsService.listAdapters();
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

function pickFromInput(e) {
  const f = e.target?.files?.[0];
  if (f) {
    file.value = f;
    filename.value = f.name;
    preview.value = null;
  }
}

function onDrop(e) {
  e.preventDefault();
  isDragging.value = false;
  const f = e.dataTransfer?.files?.[0];
  if (f) {
    file.value = f;
    filename.value = f.name;
    preview.value = null;
  }
}

async function doPreview() {
  if (!canPreview.value) return;
  previewing.value = true;
  preview.value = null;
  try {
    const res = await projectsService.import({
      source: selectedSource.value,
      file: file.value,
      dryRun: true,
    });
    preview.value = res.standard;
    if (res.warnings?.length) {
      pushToast({ message: `Preview warnings: ${res.warnings.join("; ")}`, kind: "warn" });
    }
  } catch (e) {
    pushToast({ message: `Preview failed: ${e.message || e}`, kind: "error" });
  } finally {
    previewing.value = false;
  }
}

async function doCommit() {
  if (!canCommit.value) return;
  committing.value = true;
  try {
    const res = await projectsService.import({
      source: selectedSource.value,
      file: file.value,
      dryRun: false,
    });
    pushToast({
      message: `Imported "${res.standard?.project?.name || "project"}"`,
      kind: "success",
    });
    emit("created", {
      project_id: res.project_id,
      name: res.standard?.project?.name,
      kind: res.standard?.project?.kind,
    });
    emit("close");
  } catch (e) {
    pushToast({ message: `Import failed: ${e.message || e}`, kind: "error" });
  } finally {
    committing.value = false;
  }
}

const summary = computed(() => {
  const s = preview.value;
  if (!s) return null;
  const lineCount = (s.scenes || []).reduce((acc, sc) => acc + (sc.lines?.length || 0), 0);
  return {
    name: s.project?.name,
    kind: s.project?.kind,
    characters: s.characters?.length || 0,
    scenes: s.scenes?.length || 0,
    lines: lineCount,
    lexicon: s.lexicon_entries?.length || 0,
  };
});
</script>

<template>
  <div class="im-overlay" @click.self="emit('close')" role="dialog" aria-modal="true" aria-labelledby="im-title">
    <div class="im-dialog">
      <header class="im-header">
        <div class="im-titleblock">
          <div class="im-eyebrow">Import</div>
          <div id="im-title" class="im-title">Import a project</div>
        </div>
        <button type="button" class="im-close" aria-label="Close" @click="emit('close')">&times;</button>
      </header>
      <div class="im-body">
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

        <section v-if="summary" class="preview">
          <div class="preview-title">Preview</div>
          <dl>
            <dt>Project</dt><dd>{{ summary.name }} <span class="muted">({{ summary.kind }})</span></dd>
            <dt>Characters</dt><dd>{{ summary.characters }}</dd>
            <dt>Scenes</dt><dd>{{ summary.scenes }}</dd>
            <dt>Lines</dt><dd>{{ summary.lines }}</dd>
            <dt>Lexicon entries</dt><dd>{{ summary.lexicon }}</dd>
          </dl>
        </section>
        </div>
      </div>
      <footer class="im-footer">
        <JvButton variant="ghost" @click="emit('close')">Cancel</JvButton>
        <JvButton
          variant="secondary"
          :loading="previewing"
          :disabled="!canPreview"
          @click="doPreview"
        >Dry run</JvButton>
        <JvButton
          variant="primary"
          :loading="committing"
          :disabled="!canCommit"
          @click="doCommit"
        >Import</JvButton>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.im-overlay {
  position: fixed; inset: 0;
  background: rgba(20, 20, 18, 0.45);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
  padding: 24px;
}
.im-dialog {
  background: var(--surface, #fff);
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.18);
  width: min(640px, 100%);
  max-height: 90vh;
  display: flex; flex-direction: column;
  overflow: hidden;
}
.im-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid var(--line, #e3e1dc);
}
.im-titleblock { display: flex; flex-direction: column; gap: 2px; }
.im-eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted, #7c7a72); }
.im-title { font-size: 18px; font-weight: 600; }
.im-close {
  background: transparent; border: 0;
  font-size: 22px; line-height: 1; color: var(--muted, #7c7a72);
  cursor: pointer; padding: 4px 8px;
}
.im-body { padding: 16px 20px; overflow-y: auto; }
.im-footer {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 20px; border-top: 1px solid var(--line, #e3e1dc);
  background: var(--bg, #faf9f5);
}

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

.preview { border: 1px solid var(--line, #e3e1dc); border-radius: 8px; padding: 12px 14px; }
.preview-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 8px; }
.preview dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; margin: 0; }
.preview dt { color: var(--muted); font-size: 12px; }
.preview dd { margin: 0; font-size: 13px; }
</style>
