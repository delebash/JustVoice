<!-- SPDX-License-Identifier: MIT -->
<!--
  "Loaded now" on AI Settings → Speech — the kit's audio.cpp tab, its `before-models` slot (round E,
  docs/plans/2026-10-29-round-e-onto-the-kit.md §4 step 5): what each kind of the runtime holds now
  (speech, transcription — the kit's kind words, §5 items 6–7), from its status's `loaded`
  ({modelId, placement, kind, reason}): the model's name, where it runs (the kit's placement word, the
  reason under it on hover), and Unload through the kit's POST …/models/:id/unload, then the tab reads
  again. Back from the Speech engines tab's rail, which went with round E; its words and look are
  that rail's (.ev-rail), sized to its content.
-->
<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { UiButton, pushToast } from "@delebash/ui";
import { useApi } from "../stores/api.js";

const props = defineProps({
  // the runtime's status (GET /v1/ai/runtimes/audiocpp/engine/status): `loaded`, `kinds`
  engine: { type: Object, default: null },
  // its every model, as the kit's tab lists them — the loaded one's name
  models: { type: Array, default: () => [] },
  // the tab's own `refresh` — it reads its engine and models again
  refresh: { type: Function, default: null },
});

const { t } = useI18n();
const api = useApi();

// One slot per kind, from the server's loaded set; none while the runtime keeps no such set (not
// installed yet). audio.cpp's two kinds when the status names none.
const slots = computed(() => {
  const loaded = props.engine?.loaded;
  if (!Array.isArray(loaded)) return [];
  const kinds = props.engine.kinds?.length ? props.engine.kinds : ["tts", "stt"];
  return kinds.map((kind) => {
    const l = loaded.find((x) => x.kind === kind) ?? null;
    const m = l ? props.models.find((x) => x.id === l.modelId) : null;
    return { kind, loaded: l, name: l ? m?.name || l.modelId : "" };
  });
});
const where = (l) => (l.placement === "gpu" || l.placement === "cpu" ? t(`kit.runtimes.placement.${l.placement}`) : "");

async function unload(l) {
  try {
    await api.post(`/v1/ai/runtimes/audiocpp/models/${encodeURIComponent(l.modelId)}/unload`, {});
    window.dispatchEvent(new Event("jv:health-refresh"));
  } catch (e) {
    pushToast({ message: `Unload failed: ${e?.message || e}`, kind: "error" });
  }
  await props.refresh?.();
}
</script>

<template>
  <div v-if="slots.length" class="ev-rail">
    <div class="ev-rail-h">Loaded now</div>
    <div v-for="s in slots" :key="s.kind" class="ev-slot" :class="{ empty: !s.loaded }">
      <span class="k">{{ t(`kit.aiTabs.kinds.${s.kind}`) }}</span>
      <div v-if="s.loaded">
        <div class="nm">{{ s.name }}</div>
        <div v-if="where(s.loaded)" class="sub" :title="s.loaded.reason || undefined">{{ where(s.loaded) }}</div>
      </div>
      <div v-else><div class="nm">— nothing loaded</div></div>
      <UiButton v-if="s.loaded" intent="secondary" size="small" :label="t('kit.runtimes.model.unload')"
        title="Free this slot — weights stay on disk" @click="unload(s.loaded)" />
    </div>
  </div>
</template>
