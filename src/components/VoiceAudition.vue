<!-- SPDX-License-Identifier: MIT -->
<!--
  VoiceAudition — hear a voice with YOUR line and YOUR knobs, in place.

  The workbench's first move (Slice B). Before it, deciding how a voice
  sounded meant a canned sentence in the library, knobs in a modal three
  screens away, and the delivery text on the persona — three surfaces, no
  way to hear the combination.

  Two lines are non-negotiable and always visible:
    · the LOAD line — one TTS engine is resident at a time, so auditioning
      across engines is a full model swap. Saying "this will take a minute"
      before the click beats an unexplained hang after it.
    · the STACK line — every layer contributing to what you are about to
      hear, including the ones that only apply at render (effects, lexicon),
      which are named and marked rather than silently implied.

  Mounted inline on a voice row (VoicesView). `personaContext` is Slice C's
  hook — the persona editor passes its draft so the same panel auditions a
  character rather than a bare voice.
-->
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { UiButton, UiInput, UiTextarea, pushToast, confirmDialog } from "@delebash/llm-ui";
import { useApi } from "../stores/api.js";
import { useEnginesStore } from "../stores/engines.js";
import { readPref, writePref } from "../services/prefs.js";
import { buildAuditionBody, loadNotice, resolvedStack } from "../services/audition.js";

const props = defineProps({
  voice: { type: Object, required: true },
  // Slice C: {name, voice_instruct, default_delivery, effects, lexiconName}.
  // Absent on the voice library rows — then this auditions the bare voice.
  personaContext: { type: Object, default: null },
});

const emit = defineEmits(["update:delivery"]);

const api = useApi();
const enginesStore = useEnginesStore();

const text = ref("");
const knobs = ref({});
const busy = ref(false);
const audioUrl = ref(null);
const capability = ref(null);

const engineId = computed(() => props.voice?.engine || "");
const engine = computed(() => enginesStore.items.find((e) => e.id === engineId.value) || null);

// Engines that declare instruct_field perform a written direction; the rest
// ignore it. No point offering the box where it does nothing.
const takesInstruct = computed(() => (engine.value?.capabilities || []).includes("instruct_field"));

const primaryKnobs = computed(() => (capability.value?.knobs || []).filter((k) => !k.advanced));
const advancedKnobs = computed(() => (capability.value?.knobs || []).filter((k) => k.advanced));

const notice = computed(() => loadNotice(engineId.value, enginesStore.items));

const stackLine = computed(() =>
  resolvedStack({
    voiceName: props.voice?.name,
    engineName: engine.value?.name || engineId.value,
    delivery: knobs.value,
    personaName: props.personaContext?.name,
    effects: props.personaContext?.effects,
    lexicon: props.personaContext?.lexiconName,
  }),
);

// The persona's own stack seeds the panel, so "hear this character" means
// the character as configured — not a bare voice wearing their name.
watch(
  () => [props.voice?.id, props.personaContext],
  () => {
    const ctx = props.personaContext;
    knobs.value = { ...(ctx?.default_delivery || {}) };
    if (ctx?.voice_instruct && !knobs.value.instruct) knobs.value.instruct = ctx.voice_instruct;
    void loadCapability();
  },
  { immediate: true, deep: false },
);

async function loadCapability() {
  if (!engineId.value) {
    capability.value = { knobs: [] };
    return;
  }
  await enginesStore.ensureLoaded();
  const caps = await api.safeRequest("/v1/engines/capabilities", { engines: {} });
  const map = caps?.engines || {};
  // Variant id first, then the base engine — the convention the endpoint
  // documents and lookup() follows server-side.
  capability.value = map[props.voice?.variant] || map[engineId.value] || { knobs: [] };
}

function setKnob(key, value) {
  const next = { ...knobs.value };
  if (value === "" || value === null || value === undefined || Number.isNaN(value)) delete next[key];
  else next[key] = value;
  knobs.value = next;
  emit("update:delivery", next);
}

function clearKnob(key) {
  setKnob(key, null);
}

function isSet(key) {
  return Object.hasOwn(knobs.value, key);
}

function revoke() {
  if (audioUrl.value) {
    URL.revokeObjectURL(audioUrl.value);
    audioUrl.value = null;
  }
}

async function listen() {
  if (busy.value || !props.voice?.id) return;
  busy.value = true;
  revoke();
  try {
    const body = buildAuditionBody({ text: text.value, delivery: knobs.value });
    const always = readPref("autoLoadEngine") === "always";
    let blob;
    try {
      blob = await post(always, body);
    } catch (e) {
      const notInstalled = String(e?.message || "").match(/engine_not_installed:([\w.-]+)/);
      if (notInstalled) {
        const ok = await confirmDialog({
          title: `Install ${notInstalled[1]} first`,
          message: `"${props.voice.name}" belongs to the ${notInstalled[1]} engine, which isn't installed yet (isolated engines need their own venv built once). Open Engines to install it?`,
          confirmLabel: "Open Engines",
        });
        if (ok) window.location.hash = "#engines";
        return;
      }
      const notLoaded = String(e?.message || "").match(/engine_not_loaded:([\w.-]+)/);
      if (!notLoaded) throw e;
      const ok = await confirmDialog({
        title: `Load ${notLoaded[1]}?`,
        message: `${notice.value.text} Load it now and listen?`,
        confirmLabel: "Load & listen",
      });
      if (!ok) return;
      pushToast({ message: `Loading ${notLoaded[1]}… this can take up to a minute.`, kind: "info" });
      blob = await post(true, body);
      pushToast({
        message: `${notLoaded[1]} loaded.`,
        kind: "success",
        action: { label: "Always auto-load", fn: () => writePref("autoLoadEngine", "always") },
      });
      window.dispatchEvent(new Event("jv:health-refresh"));
    }
    audioUrl.value = URL.createObjectURL(blob);
  } catch (e) {
    pushToast({ message: `Audition failed: ${e?.message || e}`, kind: "error" });
  } finally {
    busy.value = false;
  }
}

function post(autoLoad, body) {
  return api.request(`/v1/voices/${props.voice.id}/preview?auto_load=${autoLoad}`, {
    method: "POST",
    ...(body
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
}

onBeforeUnmount(revoke);
</script>

<template>
  <div class="audition">
    <div class="audition__row">
      <UiTextarea
        v-model="text"
        class="audition__text"
        placeholder="Type a line to hear in this voice — or leave empty for the stock sample."
      />
      <UiButton
        intent="primary"
        size="small"
        label="▶ Listen"
        :loading="busy"
        :title="notice.text"
        @click="listen"
      />
    </div>

    <audio v-if="audioUrl" :src="audioUrl" controls autoplay class="jv-audio-inline" />

    <!-- Always visible: what it costs, and what you're hearing. -->
    <p class="audition__notice" :class="notice.ready ? 'audition__notice--ready' : 'jv-muted'">
      {{ notice.text }}
    </p>
    <p class="jv-muted audition__stack">{{ stackLine }}</p>

    <label v-if="takesInstruct" class="audition__field audition__field--wide">
      <span>Spoken delivery for this listen</span>
      <UiInput
        :model-value="knobs.instruct ?? ''"
        placeholder="Clipped, world-weary. Dry wit."
        @update:model-value="setKnob('instruct', $event)"
      />
    </label>

    <div v-if="primaryKnobs.length" class="audition__grid">
      <label v-for="k in primaryKnobs" :key="k.key" class="audition__field">
        <span>
          {{ k.label }}
          <button
            v-if="isSet(k.key)"
            type="button"
            class="audition__reset"
            title="Clear — use the engine default"
            @click="clearKnob(k.key)"
          >reset</button>
        </span>
        <UiInput
          v-if="k.type === 'number'"
          type="number"
          width="token"
          :model-value="knobs[k.key] ?? ''"
          :min="k.min"
          :max="k.max"
          :step="k.step"
          :placeholder="`(default ${k.default})`"
          @update:model-value="setKnob(k.key, $event === '' ? null : Number($event))"
        />
        <UiInput
          v-else
          type="text"
          :model-value="knobs[k.key] ?? ''"
          :placeholder="`(default ${k.default})`"
          @update:model-value="setKnob(k.key, $event)"
        />
      </label>
    </div>
    <p v-else class="jv-muted audition__stack">This engine has no tunable knobs.</p>

    <details v-if="advancedKnobs.length" class="audition__advanced">
      <summary>⚙ Advanced ({{ advancedKnobs.length }})</summary>
      <div class="audition__grid">
        <label v-for="k in advancedKnobs" :key="k.key" class="audition__field">
          <span>
            {{ k.label }}
            <button v-if="isSet(k.key)" type="button" class="audition__reset" @click="clearKnob(k.key)">reset</button>
          </span>
          <UiInput
            v-if="k.type === 'number'"
            type="number"
            width="token"
            :model-value="knobs[k.key] ?? ''"
            :min="k.min"
            :max="k.max"
            :step="k.step"
            :placeholder="`(default ${k.default})`"
            @update:model-value="setKnob(k.key, $event === '' ? null : Number($event))"
          />
          <UiInput
            v-else
            type="text"
            :model-value="knobs[k.key] ?? ''"
            :placeholder="`(default ${k.default})`"
            @update:model-value="setKnob(k.key, $event)"
          />
        </label>
      </div>
    </details>
  </div>
</template>

<style scoped>
.audition {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.audition__row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.audition__text {
  flex: 1;
  min-height: 46px;
  font-family: inherit;
  resize: vertical;
}

.audition__notice { font-size: 11.5px; margin: 0; }
.audition__notice--ready { color: var(--accent-ink); font-weight: 600; }
.audition__stack { font-size: 11.5px; margin: 0; }

.audition__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px 16px;
}
.audition__field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.audition__field--wide { grid-column: 1 / -1; }
.audition__field > span {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.audition__reset {
  appearance: none;
  background: transparent;
  border: 0;
  font: inherit;
  font-size: 10px;
  color: var(--accent);
  cursor: pointer;
  text-transform: none;
  letter-spacing: 0;
  padding: 0;
}

.audition__advanced > summary {
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ink-3);
  user-select: none;
  padding: 6px 0;
}
</style>
