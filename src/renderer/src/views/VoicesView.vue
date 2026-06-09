<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
import { ref, onMounted, computed } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog } from "../services/dialog.js";
import JvButton from "../components/jv/JvButton.vue";
import JvInput from "../components/jv/JvInput.vue";
import JvTextarea from "../components/jv/JvTextarea.vue";
import JvSelect from "../components/jv/JvSelect.vue";
import JvTag from "../components/jv/JvTag.vue";
import JvField from "../components/jv/JvField.vue";

const api = useApi();
const voices = ref([]);
const engines = ref([]);

async function refresh() {
  const v = await api.request("/v1/voices");
  voices.value = v.voices;
  const e = await api.request("/v1/engines");
  engines.value = e.engines;
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

// ── Modal state ──────────────────────────────────────────────────────────────

const modal = ref(null); // "clone" | "design" | "import" | "blend" | null
const busy = ref(false);

// shared
const selectedEngine = ref("");
const voiceName = ref("");

// clone
const cloneFile = ref(null);
const cloneTranscript = ref("");

// design
const designPrompt = ref("");

// import
const importFile = ref(null);
const importTranscript = ref("");

// blend
const blendStrategy = ref("slerp");
const blendSources = ref([
  { voice_id: "", weight: 1.0 },
  { voice_id: "", weight: 1.0 },
]);

const BLEND_STRATEGIES = [
  { label: "Spherical linear interpolation (slerp)", value: "slerp" },
  { label: "Linear interpolation (lerp)", value: "lerp" },
  { label: "Weighted sum", value: "weighted_sum" },
];

const defaultEngine = computed(() => {
  const loaded = engines.value.find((e) => e.status === "loaded");
  return loaded ? loaded.id : engines.value[0]?.id ?? "";
});

const engineVoiceOptions = computed(() =>
  voices.value
    .filter((v) => v.engine === selectedEngine.value)
    .map((v) => ({ label: `${v.name} (${v.id})`, value: v.id }))
);

const engineOptions = computed(() =>
  engines.value.map((e) => ({
    label: `${e.name ?? e.id}${e.status === "loaded" ? "" : " (not loaded)"}`,
    value: e.id,
  }))
);

const valid = computed(() => {
  if (!voiceName.value.trim() || !selectedEngine.value) return false;
  if (modal.value === "clone") return !!cloneFile.value;
  if (modal.value === "design") return !!designPrompt.value.trim();
  if (modal.value === "import") return !!importFile.value;
  if (modal.value === "blend")
    return blendSources.value.filter((s) => s.voice_id).length >= 2;
  return false;
});

const busyLabel = computed(() => {
  const map = { clone: "Cloning…", design: "Designing…", import: "Importing…", blend: "Blending…" };
  return map[modal.value] ?? "Working…";
});

const submitLabel = computed(() => {
  const map = { clone: "Clone voice", design: "Design voice", import: "Import clip", blend: "Blend voices" };
  return map[modal.value] ?? "Submit";
});

const modalTitle = computed(() => {
  const map = {
    clone: "Clone voice from reference",
    design: "Design voice from prose",
    import: "Import audio clip",
    blend: "Blend voices via embedding interpolation",
  };
  return map[modal.value] ?? "";
});

function openModal(kind) {
  voiceName.value = "";
  selectedEngine.value = defaultEngine.value;
  cloneFile.value = null;
  cloneTranscript.value = "";
  designPrompt.value = "";
  importFile.value = null;
  importTranscript.value = "";
  blendStrategy.value = "slerp";
  blendSources.value = [
    { voice_id: "", weight: 1.0 },
    { voice_id: "", weight: 1.0 },
  ];
  modal.value = kind;
}

function addBlendSource() {
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

    if (modal.value === "clone") {
      const ref_wav_b64 = await fileToB64(cloneFile.value);
      body = {
        engine, name, ref_wav_b64, language: "en-US",
        ...(cloneTranscript.value.trim() ? { transcript: cloneTranscript.value.trim() } : {}),
      };
      await api.request("/v1/voices/clone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      pushToast({ message: `Voice "${name}" cloned.` });
    } else if (modal.value === "design") {
      body = { engine, name, prompt: designPrompt.value.trim(), language: "en-US" };
      await api.request("/v1/voices/design", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      pushToast({ message: `Voice "${name}" designed.` });
    } else if (modal.value === "import") {
      const wav_b64 = await fileToB64(importFile.value);
      body = {
        engine, name, wav_b64, language: "en-US",
        ...(importTranscript.value.trim() ? { transcript: importTranscript.value.trim() } : {}),
      };
      await api.request("/v1/voices/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      pushToast({ message: `Voice "${name}" imported.` });
    } else if (modal.value === "blend") {
      const validSources = blendSources.value.filter((s) => s.voice_id);
      body = {
        engine, name,
        source_voice_ids: validSources.map((s) => s.voice_id),
        weights: validSources.map((s) => Number(s.weight) || 1.0),
        strategy: blendStrategy.value,
      };
      await api.request("/v1/voices/blend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      pushToast({ message: `Voice "${name}" blended.` });
    }

    await refresh();
    modal.value = null;
  } catch (e) {
    pushToast({ message: `${modal.value} failed: ${e.message || e}`, kind: "error" });
  } finally {
    busy.value = false;
  }
}

// Voice type → JvTag variant mapping
function voiceTypeVariant(source) {
  if (source === "preset") return "default";
  if (source === "clone") return "accent";
  if (source === "design") return "success";
  if (source === "blend") return "warn";
  return "default";
}
</script>

<template>
  <!-- ── Add a voice ──────────────────────────────────────────────────── -->
  <div class="jv-section">
    <div class="jv-card">
      <div class="jv-card__header">
        <h3 class="jv-card__title">Add a voice</h3>
      </div>
      <div class="jv-btn-group" style="margin-bottom: 14px;">
        <JvButton variant="secondary" @click="openModal('clone')">Clone from reference</JvButton>
        <JvButton variant="secondary" @click="openModal('design')">Design from prose</JvButton>
        <JvButton variant="secondary" @click="openModal('import')">Import existing clip</JvButton>
        <JvButton variant="secondary" @click="openModal('blend')">Blend voices</JvButton>
      </div>
      <p class="jv-muted" style="font-size: 12px; line-height: 1.6;">
        <strong style="color: var(--ink);">Clone</strong>: 3–30 second reference WAV → cloned voice (Qwen3, Chatterbox).
        <strong style="color: var(--ink);">Design</strong>: prose description → voice (Qwen3 native).
        <strong style="color: var(--ink);">Import</strong>: bring your own clip as-is, no synthesis training.
        <strong style="color: var(--ink);">Blend</strong>: interpolate between two or more voices in embedding space (engines with <code class="jv-mono">supports_embedding_blending</code>).
      </p>
    </div>
  </div>

  <!-- ── Voice table ──────────────────────────────────────────────────── -->
  <div class="jv-section">
    <div class="jv-card">
      <div class="jv-card__header">
        <h3 class="jv-card__title">{{ voices.length }} voices registered</h3>
      </div>
      <table v-if="voices.length" class="jv-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Engine</th>
            <th>Type</th>
            <th>Lang</th>
            <th>Identifier</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in voices" :key="v.id" :class="{ 'row-orphan': orphanIds.includes(v.id) }">
            <td>
              <strong>{{ v.name }}</strong>
              <JvTag v-if="orphanIds.includes(v.id)" variant="danger" label="orphan" style="margin-left: 8px;" />
            </td>
            <td><span class="jv-mono jv-muted">{{ v.engine }}</span></td>
            <td><JvTag :variant="voiceTypeVariant(v.source)" :label="v.source" /></td>
            <td class="jv-muted">{{ v.language }}</td>
            <td><code class="jv-mono">{{ v.id }}</code></td>
            <td class="jv-table__actions">
              <JvButton
                v-if="v.source !== 'preset'"
                variant="danger-outline"
                size="sm"
                @click="deleteVoice(v.id)"
              >Delete</JvButton>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="jv-muted" style="padding: 16px 0; font-style: italic;">No voices registered. Install + load an engine to see preset voices.</p>
    </div>
  </div>

  <!-- ── Modal ───────────────────────────────────────────────────────── -->
  <div class="modal-overlay" v-if="modal" @click.self="modal = null">
    <div class="modal">

      <div class="modal-head">
        <span class="modal-title">{{ modalTitle }}</span>
        <JvButton variant="ghost" size="sm" @click="modal = null">Close</JvButton>
      </div>

      <div class="modal-body">

        <!-- Engine + Name (all modes) -->
        <div class="jv-row" style="align-items: flex-end;">
          <div style="flex: 1;">
            <JvField label="Engine" layout="block">
              <JvSelect v-model="selectedEngine" :options="engineOptions" />
            </JvField>
          </div>
          <div style="flex: 1;">
            <JvField label="Voice name" layout="block">
              <JvInput v-model="voiceName" placeholder="e.g. Sarah" />
            </JvField>
          </div>
        </div>

        <!-- Clone fields -->
        <template v-if="modal === 'clone'">
          <JvField label="Reference audio (3–30 s WAV / MP3 / M4A / FLAC)" layout="block" style="margin-top: 14px;">
            <input type="file" accept="audio/*" class="jv-file-input" @change="cloneFile = $event.target.files[0]" />
          </JvField>
          <JvField label="Transcript of clip (optional — improves cloning fidelity)" layout="block" style="margin-top: 14px;">
            <JvTextarea v-model="cloneTranscript" placeholder="What's actually said in the reference clip — engines that support text-conditioned cloning use this." :rows="3" />
          </JvField>
        </template>

        <!-- Design fields -->
        <template v-else-if="modal === 'design'">
          <JvField label="Prose description" layout="block" style="margin-top: 14px;">
            <JvTextarea v-model="designPrompt" placeholder="a calm middle-aged British man, warm and unhurried" :rows="4" />
          </JvField>
          <p class="jv-muted" style="font-size: 12px; margin-top: 6px;">Qwen3-native via the CustomVoice design path. Other engines may approximate from the prompt as a fallback.</p>
        </template>

        <!-- Import fields -->
        <template v-else-if="modal === 'import'">
          <JvField label="Audio clip (WAV preferred)" layout="block" style="margin-top: 14px;">
            <input type="file" accept="audio/*" class="jv-file-input" @change="importFile = $event.target.files[0]" />
          </JvField>
          <JvField label="Transcript (optional)" layout="block" style="margin-top: 14px;">
            <JvTextarea v-model="importTranscript" placeholder="What's said in the clip." :rows="3" />
          </JvField>
          <p class="jv-muted" style="font-size: 12px; margin-top: 6px;">Imported clips are stored as-is. For voice cloning use the Clone flow.</p>
        </template>

        <!-- Blend fields -->
        <template v-else-if="modal === 'blend'">
          <JvField label="Interpolation strategy" layout="block" style="margin-top: 14px;">
            <JvSelect v-model="blendStrategy" :options="BLEND_STRATEGIES" />
          </JvField>

          <div style="margin-top: 14px;">
            <p class="jv-muted" style="font-size: 11px; text-transform: uppercase; font-weight: 600; letter-spacing: .04em; margin-bottom: 8px;">Source voices + weights</p>
            <table class="jv-table">
              <thead>
                <tr>
                  <th>Voice</th>
                  <th style="width: 110px;">Weight</th>
                  <th style="width: 60px;"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(s, idx) in blendSources" :key="idx">
                  <td>
                    <JvSelect
                      v-model="s.voice_id"
                      :options="[{ label: '— pick a voice —', value: '' }, ...engineVoiceOptions]"
                    />
                  </td>
                  <td>
                    <JvInput type="number" :modelValue="String(s.weight)" @update:modelValue="s.weight = $event" style="width: 90px;" />
                  </td>
                  <td>
                    <JvButton variant="ghost" size="sm" v-if="blendSources.length > 2" @click="removeBlendSource(idx)">Remove</JvButton>
                  </td>
                </tr>
              </tbody>
            </table>
            <JvButton variant="ghost" size="sm" style="margin-top: 8px;" @click="addBlendSource">+ Add source</JvButton>
            <p class="jv-muted" style="font-size: 12px; margin-top: 6px;">Weights normalize automatically. All source voices must belong to the selected engine.</p>
          </div>
        </template>

      </div><!-- /.modal-body -->

      <div class="modal-footer">
        <JvButton variant="ghost" @click="modal = null">Cancel</JvButton>
        <JvButton variant="primary" :disabled="busy || !valid" :loading="busy" @click="submit">
          {{ busy ? busyLabel : submitLabel }}
        </JvButton>
      </div>

    </div>
  </div>
</template>

<style scoped>
.row-orphan { opacity: 0.7; }

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}
.modal {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-xl);
  width: min(620px, 92vw);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-3);
  overflow: hidden;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 22px;
  border-bottom: 1px solid var(--line);
}
.modal-title { font-size: 14px; font-weight: 600; color: var(--ink); }
.modal-body { padding: 20px 22px; overflow-y: auto; flex: 1; }
.modal-footer {
  padding: 14px 22px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  border-top: 1px solid var(--line);
}

/* File input inherits basic styling */
.jv-file-input {
  display: block;
  font-size: 13px;
  color: var(--ink-2);
  margin-top: 4px;
}
</style>
