<!-- SPDX-License-Identifier: MIT -->
<!--
  Asked before Analyze runs on a book that has narration and no narrator
  (decided 2026-10-05): narration needs a narrator, so there is no "analyze
  without". ＋ Add Narrator and analyze is the usual answer; Choose on Cast is
  for a book told in the first person, whose narrator is one of its speakers.
  Script's chapter grid and a chapter's page both ask it, wherever Analyze
  starts.
-->
<script setup>
import { AppModal, UiButton } from "@delebash/llm-ui";

defineProps({
  busy: { type: Boolean, default: false },
});
const emit = defineEmits(["add", "cast", "close"]);
</script>

<template>
  <AppModal eyebrow="✨ Analyze" title="This book has no narrator" max-width="560px" dismissable @close="emit('close')">
    <p class="narrator-needed__lede">
      Its narration needs one — everything outside quote marks is read by the narrator. Add Narrator makes a
      speaker called Narrator, played by your persona called Narrator if you have one, and Analyze gives it
      the narration.
    </p>
    <p class="jv-hint narrator-needed__hint">
      Told in the first person? Choose on Cast, and tick that speaker as Narrator.
    </p>
    <template #footer>
      <UiButton intent="secondary" label="Choose on Cast" :disabled="busy" @click="emit('cast')" />
      <UiButton intent="primary" label="＋ Add Narrator and analyze" :loading="busy" @click="emit('add')" />
    </template>
  </AppModal>
</template>

<style scoped>
.narrator-needed__lede { margin: 0 0 8px; max-width: 60ch; }
.narrator-needed__hint { margin: 0; }
</style>
