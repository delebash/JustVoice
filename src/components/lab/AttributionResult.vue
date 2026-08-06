<!-- SPDX-License-Identifier: MIT -->
<!--
  AttributionResult — the attribution Lab adapter's result renderer (the kit
  ConfigColumn mounts it per column via the labAdapters seam; parity batch
  2026-08-06 — the Speaker Lab reunification).

  Carries, from the retired SpeakerLabView (the 12-point inventory):
  (6) the results table — speaker · the line · confidence % · a REASSIGN
      dropdown whose pick writes correction memory exactly as Studio's block
      reassign does (the shared record_correction door). The dropdown offers
      the ACTIVE project's REAL cast (SpeakerCorrection.character_id is an FK
      to personas — the lab's typed cast is prompt-side labels with synthetic
      ids and can never be recorded), plus the non-teaching Narrator/unknown;
  (7) cross-column disagreement highlighting (this component receives EVERY
      column's results — a wavy underline marks where this column disagrees
      with the first);
  (8) the floored-from display (the source chips: tag · propagated · llm ·
      floored · narration);
  (10) the corrections card beside the results — the per-project memory count
      + Clear, with the write-target project named.
  (11) the raw model output stays viewable via the kit column's own
      "Raw model output" fold below this table.
-->
<script setup>
import { computed, onMounted, ref } from "vue";
import { UiButton, UiSelect, UiTag, confirmDialog, pushToast } from "@delebash/llm-ui";
import { useApi } from "../../stores/api.js";
import { useActiveProject } from "../../stores/activeProject.js";
import { usePersonasStore } from "../../stores/personas.js";
import { useProjectsStore } from "../../stores/projects.js";

const props = defineProps({
  result: { type: Object, default: null },        // this column's testOut (data = analyze response)
  allResults: { type: Object, default: () => ({}) }, // every column's results, keyed by column id
  config: { type: Object, default: () => ({}) },
  action: { type: String, default: "" },
  columnLabel: { type: String, default: "" },
});

const api = useApi();
const activeProjectStore = useActiveProject();
const personasStore = usePersonasStore();
const projectsStore = useProjectsStore();

const data = computed(() => props.result?.data || null);
const rows = computed(() => data.value?.rows || []);
const cast = computed(() => data.value?.characters || []);
// Discovery runs return candidates instead of attribution rows.
const candidates = computed(() => data.value?.candidates || null);

// ── (7) Disagreement vs the FIRST other column with rows. ─────────────
const otherRows = computed(() => {
  const mine = data.value;
  for (const r of Object.values(props.allResults || {})) {
    const d = r?.data;
    if (d && d !== mine && Array.isArray(d.rows) && d.rows.length) return d.rows;
  }
  return null;
});
function disagrees(i) {
  const o = otherRows.value;
  if (!o) return false;
  const a = o[i]?.speaker;
  const b = rows.value[i]?.speaker;
  return !!a && !!b && a !== b;
}

// The pipeline reports which instruction tier ran — say it in the approved
// human words (the copy law: tier names never reach the screen).
const TIER_WORDS = { guided: "with examples", direct: "rules only", reasoned: "rules + thinking" };
function tierWords(t) {
  return TIER_WORDS[t] || t || "";
}
function speakerLabel(spk) {
  if (!spk || spk === "unknown") return "unknown";
  if (spk === "narrator") return "Narrator";
  // The pipeline echoes the ids the run was given (the typed lab cast); a
  // reassigned row carries a REAL persona id instead.
  return cast.value.find((c) => c.id === spk)?.name || personasStore.byId(spk)?.name || spk;
}
function chipClass(source) {
  return {
    tag: "attr__chip attr__chip--tag",
    propagated: "attr__chip attr__chip--propagated",
    llm: "attr__chip attr__chip--llm",
    floored: "attr__chip attr__chip--floored",
    narration: "attr__chip attr__chip--narration",
  }[source] || "attr__chip";
}

// ── (6) Reassign — writes correction memory like Studio. ──────────────
// Corrections are per-project; the write targets the ACTIVE project (named on
// the card below). No project open → the reassign still updates the row here,
// and the card says nothing was recorded. The teachable choices are the
// project's REAL cast (persona rows — the FK the correction table demands),
// never the typed lab cast's synthetic ids.
const projectId = computed(() => activeProjectStore.id || null);
const projectName = computed(() => {
  const id = projectId.value;
  if (!id) return "";
  return projectsStore.items?.find((p) => p.id === id)?.name || id;
});
const castPersonaIds = ref([]);
async function loadProjectCast() {
  if (!projectId.value) { castPersonaIds.value = []; return; }
  const r = await api.safeRequest(`/v1/projects/${projectId.value}/cast`, { cast: [] });
  castPersonaIds.value = (r?.cast || []).map((c) => c.persona_id);
}
const reassignOptions = computed(() => [
  { value: "narrator", label: "Narrator" },
  ...castPersonaIds.value.map((id) => ({
    value: id,
    label: personasStore.byId(id)?.name || id,
  })),
  { value: "unknown", label: "unknown" },
]);

const correctionsCount = ref(null);
async function refreshCount() {
  if (!projectId.value) { correctionsCount.value = null; return; }
  const r = await api.safeRequest(`/v1/projects/${projectId.value}/corrections/count`, { count: 0 });
  correctionsCount.value = r?.count ?? 0;
}
onMounted(() => {
  refreshCount();
  loadProjectCast();
  projectsStore.ensureLoaded();
  personasStore.ensureLoaded();
});

async function reassign(row, newSpeaker) {
  const prev = row.speaker;
  if (newSpeaker === prev) return;
  row.speaker = newSpeaker;
  row.source = "corrected";
  // Only a real character teaches the model (Studio's rule: narrator splits are
  // mechanical, "unknown" teaches nothing).
  const teaches = newSpeaker && newSpeaker !== "narrator" && newSpeaker !== "unknown";
  if (!teaches) return;
  if (!projectId.value) {
    pushToast({ message: "Row updated. Open a project to record corrections for its next run.", kind: "info" });
    return;
  }
  try {
    const r = await api.request(`/v1/projects/${projectId.value}/corrections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text_snippet: row.text || "", character_id: newSpeaker }),
    });
    correctionsCount.value = r?.count ?? correctionsCount.value;
    pushToast({ message: `Recorded — the next run for ${projectName.value} learns from it.`, kind: "success", duration: 3000 });
  } catch (e) {
    row.speaker = prev;
    pushToast({ message: `Couldn't record the correction: ${e?.message || e}`, kind: "error" });
  }
}

async function clearCorrections() {
  if (!projectId.value) return;
  const ok = await confirmDialog({
    title: "Clear corrections?",
    message: `Clear all speaker corrections for ${projectName.value}? This cannot be undone.`,
    danger: true,
    confirmLabel: "Clear all",
  });
  if (!ok) return;
  try {
    await api.request(`/v1/projects/${projectId.value}/corrections`, { method: "DELETE" });
    correctionsCount.value = 0;
    pushToast({ message: "Corrections cleared.", kind: "success" });
  } catch (e) {
    pushToast({ message: `Clear failed: ${e?.message || e}`, kind: "error" });
  }
}
</script>

<template>
  <div class="attr">
    <!-- Discovery ("Find new speakers") — a review list, nothing is created. -->
    <template v-if="candidates">
      <div class="attr__meta jv-muted">{{ candidates.length }} speaker candidates not in the known list</div>
      <div v-if="candidates.length" class="attr__table">
        <div v-for="(c, i) in candidates" :key="i" class="attr__row">
          <span class="jv-mono jv-muted attr__n">{{ i + 1 }}</span>
          <span class="attr__who"><strong>{{ c.name }}</strong></span>
          <span class="attr__text">
            {{ c.role_hint || "" }}
            <span v-if="c.approx_lines != null" class="jv-muted"> · ~{{ c.approx_lines }} lines</span>
          </span>
        </div>
      </div>
      <p v-else class="jv-muted attr__empty">No new speakers — everyone who talks is already in the known list.</p>
    </template>

    <div v-if="data && !candidates" class="attr__meta jv-muted">
      {{ rows.length }} segments · read {{ tierWords(data.tier_used) }} · confidence floor {{ data.confidence_floor }}
      <span v-if="otherRows" class="attr__meta-note">· disagreements with the other column are underlined</span>
    </div>

    <div v-if="rows.length" class="attr__table">
      <div v-for="(row, i) in rows" :key="i" class="attr__row">
        <span class="jv-mono jv-muted attr__n">{{ i + 1 }}</span>
        <span class="attr__who">
          <strong :class="{ attr__disagree: disagrees(i) }">{{ speakerLabel(row.speaker) }}</strong>
          <span :class="chipClass(row.source)">{{ row.source }}</span>
          <span v-if="row.confidence != null" class="jv-mono jv-muted">{{ (row.confidence * 100).toFixed(0) }}%</span>
        </span>
        <span class="attr__text">{{ row.text }}</span>
        <UiSelect class="attr__reassign" width="id" :model-value="row.speaker"
          :options="reassignOptions" title="Correct the speaker — a real character teaches the next run"
          @update:model-value="(v) => reassign(row, v)" />
      </div>
    </div>
    <p v-else-if="data" class="jv-muted attr__empty">No dialogue segments in this passage — narration only.</p>

    <!-- (10) The corrections card, beside the results (attribution runs only —
         discovery proposes names, there is nothing to reassign). -->
    <div v-if="!candidates" class="attr__corrections">
      <span class="jv-eyebrow">Correction memory</span>
      <template v-if="projectId">
        <UiTag :intent="correctionsCount ? 'solid' : 'ghost'">{{ correctionsCount ?? "…" }}</UiTag>
        <span class="jv-muted attr__cor-note">for {{ projectName }} — the most recent teach the next run as worked examples</span>
        <UiButton intent="ghost" size="small" label="Clear all" :disabled="!correctionsCount" @click="clearCorrections" />
      </template>
      <span v-else class="jv-muted attr__cor-note">no project open — reassignments here update the table but are not remembered</span>
    </div>
  </div>
</template>

<style scoped>
.attr { display: flex; flex-direction: column; gap: 8px; }
.attr__meta { font-size: 11px; }
.attr__meta-note { font-style: italic; }
.attr__table { border: 1px solid var(--line); border-radius: 8px; max-height: 420px; overflow-y: auto; }
.attr__row {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 8px 12px; border-bottom: 1px dashed var(--line); font-size: 12.5px;
}
.attr__row:last-child { border-bottom: 0; }
.attr__n { flex: none; width: 18px; font-size: 10.5px; padding-top: 2px; }
.attr__who { flex: none; width: 170px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.attr__text { flex: 1; color: var(--ink-2); line-height: 1.5; }
.attr__reassign { flex: none; }
.attr__empty { font-size: 12px; margin: 0; }
.attr__chip {
  font-size: 9.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  border: 1px solid var(--line-strong); border-radius: 4px; padding: 0 5px;
  color: var(--ink-3); background: var(--surface);
}
.attr__chip--tag        { background: var(--accent-soft); color: var(--accent-ink); border-color: var(--accent-line); }
.attr__chip--propagated { background: var(--surface-2); }
.attr__chip--llm        { background: var(--info-soft, #eaf2fa); color: var(--info-blue, #2f74b5); border-color: var(--info-blue, #2f74b5); }
.attr__chip--narration  { border-style: dashed; }
.attr__chip--floored    { background: var(--warn-bg, var(--surface-2)); color: var(--warn-ink, var(--ink-2)); border-color: var(--warn-line, var(--border-soft)); }
.attr__disagree { color: var(--danger, #a8442e); text-decoration: underline wavy; text-underline-offset: 3px; }
.attr__corrections { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-2); }
.attr__cor-note { font-size: 11.5px; }
</style>
