<script setup>
import { ref, onMounted, computed } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog } from "../services/dialog.js";

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
  { id: "slerp", label: "Spherical linear interpolation (slerp)" },
  { id: "lerp", label: "Linear interpolation (lerp)" },
  { id: "weighted_sum", label: "Weighted sum" },
];

const defaultEngine = computed(() => {
  const loaded = engines.value.find((e) => e.status === "loaded");
  return loaded ? loaded.id : engines.value[0]?.id ?? "";
});

const engineVoices = computed(() =>
  voices.value.filter((v) => v.engine === selectedEngine.value)
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
  const map = {
    clone: "Cloning…",
    design: "Designing…",
    import: "Importing…",
    blend: "Blending…",
  };
  return map[modal.value] ?? "Working…";
});

const submitLabel = computed(() => {
  const map = {
    clone: "Clone voice",
    design: "Design voice",
    import: "Import clip",
    blend: "Blend voices",
  };
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
  // reset all fields
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
        engine,
        name,
        ref_wav_b64,
        language: "en-US",
        ...(cloneTranscript.value.trim() ? { transcript: cloneTranscript.value.trim() } : {}),
      };
      await api.request("/v1/voices/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      pushToast({ message: `Voice "${name}" cloned.` });
    } else if (modal.value === "design") {
      body = { engine, name, prompt: designPrompt.value.trim(), language: "en-US" };
      await api.request("/v1/voices/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      pushToast({ message: `Voice "${name}" designed.` });
    } else if (modal.value === "import") {
      const wav_b64 = await fileToB64(importFile.value);
      body = {
        engine,
        name,
        wav_b64,
        language: "en-US",
        ...(importTranscript.value.trim() ? { transcript: importTranscript.value.trim() } : {}),
      };
      await api.request("/v1/voices/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      pushToast({ message: `Voice "${name}" imported.` });
    } else if (modal.value === "blend") {
      const validSources = blendSources.value.filter((s) => s.voice_id);
      body = {
        engine,
        name,
        source_voice_ids: validSources.map((s) => s.voice_id),
        weights: validSources.map((s) => Number(s.weight) || 1.0),
        strategy: blendStrategy.value,
      };
      await api.request("/v1/voices/blend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
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
</script>

<template>
  <!-- ── Add a voice ──────────────────────────────────────────────────── -->
  <section class="block">
    <h3>Add a voice</h3>
    <div class="row">
      <button @click="openModal('clone')">Clone from reference</button>
      <button @click="openModal('design')">Design from prose</button>
      <button @click="openModal('import')">Import existing clip</button>
      <button @click="openModal('blend')">Blend voices</button>
    </div>
    <p class="endnote" style="margin-top: 14px;">
      <strong style="font-style: normal; color: var(--ink); font-weight: 600;">Clone</strong>: 3–30 second reference WAV → cloned voice (Qwen3, Chatterbox).
      <strong style="font-style: normal; color: var(--ink); font-weight: 600;">Design</strong>: prose description → voice (Qwen3 native).
      <strong style="font-style: normal; color: var(--ink); font-weight: 600;">Import</strong>: bring your own clip as-is, no synthesis training.
      <strong style="font-style: normal; color: var(--ink); font-weight: 600;">Blend</strong>: interpolate between two or more voices in embedding space (engines with <span class="mono">supports_embedding_blending</span>).
    </p>
  </section>

  <!-- ── Voice table ──────────────────────────────────────────────────── -->
  <section class="block">
    <h3>{{ voices.length }} voices registered</h3>
    <table v-if="voices.length">
      <thead>
        <tr>
          <th>Name</th>
          <th>Engine</th>
          <th>Source</th>
          <th>Lang</th>
          <th>Identifier</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="v in voices" :key="v.id" :class="{ orphan: orphanIds.includes(v.id) }">
          <td>
            <span class="em">{{ v.name }}</span>
            <span v-if="orphanIds.includes(v.id)" class="tag danger" style="margin-left: 8px;">orphan</span>
          </td>
          <td><span class="tag">{{ v.engine }}</span></td>
          <td>{{ v.source }}</td>
          <td>{{ v.language }}</td>
          <td><span class="mono">{{ v.id }}</span></td>
          <td>
            <button v-if="v.source !== 'preset'" class="bare danger" @click="deleteVoice(v.id)">Delete</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="endnote">No voices registered. Install + load an engine to see preset voices.</p>
  </section>

  <!-- ── Modal ───────────────────────────────────────────────────────── -->
  <div class="modal-overlay" v-if="modal" @click.self="modal = null">
    <div class="modal">

      <div class="modal-head">
        <span class="modal-title">{{ modalTitle }}</span>
        <button class="bare" @click="modal = null">Close</button>
      </div>

      <div class="modal-body">

        <!-- Engine + Name (all modes) -->
        <div class="row">
          <label class="grow">
            <span>Engine</span>
            <select v-model="selectedEngine">
              <option v-for="e in engines" :key="e.id" :value="e.id">
                {{ e.name ?? e.id }}{{ e.status === 'loaded' ? '' : ' (not loaded)' }}
              </option>
            </select>
          </label>
          <label class="grow">
            <span>Voice name</span>
            <input v-model="voiceName" placeholder="e.g. Sarah" />
          </label>
        </div>

        <!-- Clone fields -->
        <template v-if="modal === 'clone'">
          <label style="margin-top: 14px; display: block;">
            <span>Reference audio (3–30 s WAV / MP3 / M4A / FLAC)</span>
            <input type="file" accept="audio/*" @change="cloneFile = $event.target.files[0]" />
          </label>
          <label style="margin-top: 14px; display: block;">
            <span>Transcript of clip <em style="font-weight:400;">(optional — improves cloning fidelity)</em></span>
            <textarea v-model="cloneTranscript" placeholder="What's actually said in the reference clip — engines that support text-conditioned cloning use this." style="min-height: 72px;"></textarea>
          </label>
        </template>

        <!-- Design fields -->
        <template v-else-if="modal === 'design'">
          <label style="margin-top: 14px; display: block;">
            <span>Prose description</span>
            <textarea v-model="designPrompt" placeholder="a calm middle-aged British man, warm and unhurried" style="min-height: 90px;"></textarea>
          </label>
          <p class="endnote" style="margin-top: 6px;">Qwen3-native via the CustomVoice design path. Other engines may approximate from the prompt as a fallback.</p>
        </template>

        <!-- Import fields -->
        <template v-else-if="modal === 'import'">
          <label style="margin-top: 14px; display: block;">
            <span>Audio clip (WAV preferred)</span>
            <input type="file" accept="audio/*" @change="importFile = $event.target.files[0]" />
          </label>
          <label style="margin-top: 14px; display: block;">
            <span>Transcript <em style="font-weight:400;">(optional)</em></span>
            <textarea v-model="importTranscript" placeholder="What's said in the clip." style="min-height: 72px;"></textarea>
          </label>
          <p class="endnote" style="margin-top: 6px;">Imported clips are stored as-is. For voice cloning use the Clone flow.</p>
        </template>

        <!-- Blend fields -->
        <template v-else-if="modal === 'blend'">
          <label style="margin-top: 14px; display: block;">
            <span>Interpolation strategy</span>
            <select v-model="blendStrategy">
              <option v-for="s in BLEND_STRATEGIES" :key="s.id" :value="s.id">{{ s.label }}</option>
            </select>
          </label>

          <div style="margin-top: 14px;">
            <span style="font-size: 11px; text-transform: uppercase; color: var(--muted); font-weight: 600; letter-spacing: .04em; display: block; margin-bottom: 8px;">Source voices + weights</span>
            <table>
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
                    <select v-model="s.voice_id">
                      <option value="">— pick a voice —</option>
                      <option v-for="v in engineVoices" :key="v.id" :value="v.id">
                        {{ v.name }} ({{ v.id }})
                      </option>
                    </select>
                  </td>
                  <td>
                    <input type="number" step="0.1" min="0" v-model="s.weight" style="width: 90px;" />
                  </td>
                  <td>
                    <button class="bare" v-if="blendSources.length > 2" @click="removeBlendSource(idx)">Remove</button>
                  </td>
                </tr>
              </tbody>
            </table>
            <button class="bare" style="margin-top: 8px;" @click="addBlendSource">+ Add source</button>
            <p class="endnote" style="margin-top: 6px;">Weights normalize automatically. All source voices must belong to the selected engine.</p>
          </div>
        </template>

      </div><!-- /.modal-body -->

      <div style="padding: 14px 22px; display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--border);">
        <button class="bare" @click="modal = null">Cancel</button>
        <button class="primary" :disabled="busy || !valid" @click="submit">
          {{ busy ? busyLabel : submitLabel }}
        </button>
      </div>

    </div>
  </div>
</template>

<style scoped>
.orphan { opacity: 0.7; }
</style>
