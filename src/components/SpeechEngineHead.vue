<!-- SPDX-License-Identifier: MIT -->
<!--
  One engine's head on AI Settings → Speech — the kit's audio.cpp tab, its `group-head` slot
  (round E, docs/plans/2026-10-29-round-e-onto-the-kit.md §4 step 5, G6): beside the engine's name
  (the kit's group heading, which opens and closes its models) what JustVoice knows of it — its
  kinds, its licence as "Commercial use" in plain words with whose reading it is (decided
  2026-10-11), whether JustVoice has tested it, an engine this OS can't run or one marked for
  removal, its description, what it's best for, and Set as default. Moved from the engine list
  of the Speech engines tab, which went with round E; its words and classes are that list's.
-->
<script setup>
import { computed } from "vue";
import { UiButton, openExternal, pushToast } from "@delebash/ui";
import { useEnginesStore } from "../stores/engines.js";
import { licClass, licTitle, reading } from "../services/engineFacts.js";

const props = defineProps({
  engineId: { type: String, required: true },
});

const engines = useEnginesStore();
const e = computed(() => engines.byId(props.engineId));
const caps = computed(() => (e.value?.kinds?.length ? e.value.kinds : [e.value?.kind || "tts"]));
// The OS gate's verdict, computed SERVER-side (`supported_on_this_os`) — never re-derived here:
// the renderer can be a browser on another machine than the server.
const osBlocked = computed(() => e.value?.supported_on_this_os === false);
const osBlockedTitle = computed(() => {
  const list = (e.value?.supported_oses || []).join(", ") || "no platforms";
  return `${e.value?.name || props.engineId} declares support for ${list}, and this server is not running one of them. Installing it would fail.`;
});
// A manifest DEPRECATED string = marked for removal; the string is the reason, the server's.
const deprecated = computed(() => (e.value?.deprecated || "").trim());
const isDefault = computed(() => engines.defaultEngineId === props.engineId);

async function setDefault() {
  try {
    await engines.setDefaultEngine(props.engineId);
    pushToast({ message: `${e.value.name || e.value.id} is now the default speech engine.`, kind: "success" });
  } catch (err) {
    pushToast({ message: `Couldn't set the default: ${err?.message || err}`, kind: "error" });
  }
}
</script>

<template>
  <template v-if="e">
    <span class="ev-caps">
      <span v-for="c in caps" :key="c" class="ev-cap" :class="c">{{ c.toUpperCase() }}</span>
      <span v-if="e.licence" class="ev-lic" :class="licClass(e.licence.commercial)" :title="licTitle(e.licence)">Commercial use: {{ e.licence.commercial }}</span>
      <span class="ev-cap" :class="{ tested: e.tested }" :title="e.tested?.note || 'Works as audio.cpp describes it; JustVoice hasn\'t listened to it yet'">
        {{ e.tested ? 'TESTED BY JUSTVOICE' : 'NOT TESTED BY JUSTVOICE YET' }}
      </span>
    </span>
    <!-- The OS gate (2026-08-17): listed rather than hidden, so a user learns the engine exists
         and why it is not offered. -->
    <span v-if="osBlocked" class="ev-badge none" :title="osBlockedTitle">not available on this OS · {{ (e.supported_oses || []).join(" · ") || "none" }}</span>
    <span v-if="deprecated" class="ev-badge none" :title="deprecated">⚠ marked for removal</span>
    <UiButton v-if="caps[0] === 'tts'" :intent="isDefault ? 'success' : 'secondary'" size="small"
      :label="isDefault ? 'Default ✓' : 'Set as default'"
      title="Which engine new-voice flows and first-render auto-setup prefer"
      @click="isDefault ? null : setDefault()" />
    <div class="ev-gnote">
      <span v-if="e.description">{{ e.description }}</span>
      <span v-if="e.best_for?.length">Best for: {{ e.best_for.join(" · ") }}</span>
      <span v-if="e.tested">Tested by JustVoice: {{ e.tested.note }}</span>
      <span v-if="e.licence">Commercial use: {{ e.licence.summary }}
        <span class="ev-gnote-src">({{ reading(e.licence) }}<template v-if="e.licence.url"> ·
          <a href="#" @click.prevent="openExternal(e.licence.url)">read it at its source</a></template>)</span></span>
    </div>
  </template>
</template>
