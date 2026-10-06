<!-- SPDX-License-Identifier: MIT -->
<!--
  Studio, as the mock draws it (dev only): the book picker, the step cards, and the step. Slice 4
  (decided 2026-10-04, TASKS "Studio Slice 4") — Render is a chapter grid (#/mock/render) that
  opens one chapter's lines (#/mock/render/:id), and Script's chapter grid gains ＋ Add chapter
  and Rename · Move · Delete (#/mock/script). The same frame as views/StudioView.vue, on
  `renderMock.js` in place of the server.
-->
<script setup>
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { UiButton, UiSelect, UiTag, pushToast } from "@delebash/llm-ui";
import { stepsFor } from "../views/studioSteps.js";
import { stepStatus } from "../views/studioStatus.js";
import MockRenderChapterView from "./MockRenderChapterView.vue";
import MockRenderGrid from "./MockRenderGrid.vue";
import MockScriptGrid from "./MockScriptGrid.vue";
import { MASTER, PROJECT, SPEAKERS, counts, render, speakerReady } from "./renderMock.js";

const route = useRoute();
const router = useRouter();
const tab = computed(() => route.meta.step);
const grid = ref(null);

const bookId = ref(PROJECT.id);
const BOOK_OPTIONS = [{ value: PROJECT.id, label: PROJECT.name }];

const STEP_TITLES = {
  overview: "Settings, and where each step stands",
  discover: "Find the speakers the text names",
  script: "Who speaks each line",
  cast: "Give each speaker a persona",
  render: "Every line's audio, and each chapter joined and mastered",
  export: "Package + ACX checklist",
};
// The app's step cards say Overview's own words (studioStatus.stepStatus — the
// one-wording audit B8, 2026-10-06); the mock feeds it the mock's counts.
const mockState = computed(() => {
  const k = counts(render.chapters.flatMap((c) => c.lines));
  return {
    chapters: render.chapters.length,
    scanned: render.chapters.filter((c) => c.scanned).length,
    proposed: 0,
    analyzed: render.chapters.filter((c) => c.script.analyzed).length,
    fromImport: 0,
    running: 0,
    lines: k.all,
    castTotal: SPEAKERS.length,
    castReady: SPEAKERS.filter((s) => speakerReady(s.id)).length,
    blocked: k.blocked,
    rendered: k.rendered,
    renderable: k.ready + k.rendered + k.stale,
    ready: k.ready,
    stale: k.stale,
  };
});
const UNIT = { singular: "Chapter", plural: "Chapters" };
const stepCards = computed(() => stepsFor("audiobook").map((t) => ({
  ...t,
  sub: t.key === "overview" ? "book" : stepStatus(t.key, mockState.value, UNIT).text,
})));
function goStep(k) {
  if (k === "render") router.push({ name: "mock-render" });
  else if (k === "script") router.push({ name: "mock-script" });
  else pushToast({ kind: "info", message: `Opens Studio · ${k[0].toUpperCase()}${k.slice(1)}.` });
}

const masterPill = `${MASTER.preset} target · ${MASTER.lufs} LUFS · peak ${MASTER.peak} dB`;
</script>

<template>
  <div class="studio jv-fill mock-studio">
    <div class="jv-section studio__project-bar">
      <label class="studio__project-label">Book:</label>
      <UiSelect v-model="bookId" width="name" :options="BOOK_OPTIONS" />
    </div>

    <div class="studio__steps">
      <button v-for="t in stepCards" :key="t.key" type="button" class="jv-stepcard"
        :class="{ 'jv-stepcard--active': tab === t.key }" :title="STEP_TITLES[t.key]" @click="goStep(t.key)">
        <span class="jv-stepcard__title">{{ t.label }}</span>
        <span class="jv-stepcard__sub">{{ t.sub }}</span>
      </button>
      <template v-if="tab === 'render'">
        <span class="jv-spacer" />
        <UiTag intent="success" title="The default for this project kind">{{ masterPill }}</UiTag>
        <UiButton intent="secondary" size="small" label="▶ Render all"
          title="Render every chapter: each line with no take gets one, then the chapter is joined and mastered"
          @click="grid ? grid.renderAll() : router.push({ name: 'mock-render' })" />
      </template>
    </div>

    <div class="mock-studio__step">
      <MockRenderGrid v-if="tab === 'render' && !route.params.id" ref="grid" @go="goStep" />
      <MockRenderChapterView v-else-if="tab === 'render'" @go="goStep" />
      <MockScriptGrid v-else-if="tab === 'script'" @go="goStep" />
    </div>
  </div>
</template>

<style scoped>
.studio { padding: 0; display: flex; flex-direction: column; gap: 16px; }
.studio__project-bar { display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: var(--surface-2);
  border-radius: 6px; border: 1px solid var(--border-soft); }
.studio__project-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-3); font-weight: 600; }
.studio__steps { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
</style>
