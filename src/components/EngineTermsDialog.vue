<!-- SPDX-License-Identifier: MIT -->
<!--
  An engine's own terms, shown before the use they gate (decided 2026-10-02 — Pocket TTS:
  "use the copy and show kyutai's terms before first clone"). Mounted once, in AppShell.vue;
  opened by `jv:engine-terms` from services/engineTerms.js — the Clone tab, the Speech
  engines row, and any refusal the server answers with `terms-required`. Accept records it
  once per install (POST /v1/engines/{id}/terms); the server then lets the use through.
-->
<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";
import { AppModal, UiButton, openExternal, pushToast } from "@delebash/llm-ui";
import { useApi } from "../stores/api.js";
import { TERMS_EVENT, acceptEngineTerms } from "../services/engineTerms.js";

const api = useApi();
const engine = ref(null);   // the /v1/engines row whose terms are showing, or null
const busy = ref(false);

async function open(ev) {
  const id = ev?.detail?.engine || "";
  const list = await api.safeRequest("/v1/engines", { engines: [] });
  const row = (list?.engines || []).find((e) => e.id === id && e.terms);
  if (!row) return;
  if (row.terms_accepted) {
    pushToast({ message: `You have already accepted ${row.terms.owner}'s terms for ${row.name}.`, kind: "info" });
    return;
  }
  engine.value = row;
}

function close() { engine.value = null; }

async function accept() {
  busy.value = true;
  try {
    await acceptEngineTerms(api, engine.value.id);
    pushToast({ message: `${engine.value.name} can clone voices now.`, kind: "success" });
    close();
  } catch (e) {
    pushToast({ message: `Couldn't record that: ${e?.message || e}`, kind: "error" });
  } finally {
    busy.value = false;
  }
}

onMounted(() => window.addEventListener(TERMS_EVENT, open));
onBeforeUnmount(() => window.removeEventListener(TERMS_EVENT, open));
</script>

<template>
  <AppModal v-if="engine" :eyebrow="`Before cloning with ${engine.name}`" :title="engine.terms.title"
    max-width="620px" @close="close">
    <p class="engine-terms__lede">
      JustVoice downloads {{ engine.name }} from a copy that needs no sign-in.
      {{ engine.terms.owner }}, who made it, asks everyone who clones voices with it to accept these terms.
      Built-in voices need no acceptance.
    </p>
    <div class="jv-banner engine-terms__text">{{ engine.terms.text }}</div>
    <p class="jv-hint">
      You accept once, on this install.
      <a href="#" @click.prevent="openExternal(engine.terms.url)">Read them where {{ engine.terms.owner }} publishes them</a>.
    </p>
    <template #footer>
      <UiButton intent="ghost" label="Not now" @click="close" />
      <span class="jv-spacer" />
      <UiButton intent="primary" :loading="busy" :label="`Accept ${engine.terms.owner}'s terms`" @click="accept" />
    </template>
  </AppModal>
</template>

<style scoped>
.engine-terms__lede { margin: 0 0 12px; max-width: 62ch; }
.engine-terms__text { white-space: pre-wrap; margin: 0 0 12px; max-width: 62ch; }
</style>
