<!-- SPDX-License-Identifier: MIT -->
<!--
  Make the audiobook — the one-click run's card on a book's Overview (the one-click plan's
  slice 5, §1 and §6). Drawn first in the in-app mock (#/mock/one-click, pages/mock/
  MockOneClickPage.vue), which feeds it made-up data; StudioBookRun.vue feeds it the server's.
  It only shows and asks — the run lives on the server (book_run.js) and this card's container
  starts, follows and stops it.

  What §1 fixes it must show: one start; the model each step will use (from routing — the kit's
  LuFeatureChip, which opens AI Settings → Routing by feature); the estimated price on a cloud
  route (and the price question, asked once by the container); progress per step and chapter;
  and afterwards what to check, each with a link to where it is fixed.

  Precedents (design-law): the card is `.jv-card` with `.jv-lede`; the steps a `UiTable` with
  `.jv-table-look` and Overview's own "Status" column; the current step `.jv-row--selected`, the
  step that stopped the run `.jv-row--attention`; a state that needs a word `.jv-banner` and its
  intents; the numbers a `.jv-fold`; the actions a `.jv-inline-row`.
-->
<script setup>
import { computed } from "vue";
import { useQuasar } from "quasar";
import { LuFeatureChip, UiButton, UiProgress, UiTable, UiTag } from "@delebash/ui";
import {
  LIVE, PROBLEMS, RUN_TAGS, RUNS_ON_SERVER, STEP_LABELS, planLine, priceText, reviewItems,
  runBanner, runningLine, stepStatusText, stepsDone,
} from "../services/bookRun.js";
import { clock } from "../services/renderRun.js";

const props = defineProps({
  // The book's word for a chapter (copy.chapter).
  unit: { type: Object, required: true },
  // GET /v1/projects/{id}/book_run's plan; null while it loads.
  plan: { type: Object, default: null },
  // The book's latest run (as GET /v1/book_runs/{id} answers), or null before its first.
  run: { type: Object, default: null },
  // The start (or Resume) was pressed and its answer isn't back yet.
  busy: { type: Boolean, default: false },
  // Seconds the run has worked so far (its steps' time).
  elapsed: { type: Number, default: 0 },
});
const emit = defineEmits(["start", "stop", "resume", "save", "go", "routing"]);

// Below 600 px (Quasar's `sm`, the app's phone width) what a step runs on goes under its name,
// so the table keeps two columns.
const $q = useQuasar();
const narrow = computed(() => $q.screen.lt.sm);

const live = computed(() => !!props.run && LIVE.has(props.run.status));
const tag = computed(() => (props.run ? RUN_TAGS[props.run.status] : null));
const banner = computed(() => runBanner(props.run));
const problems = computed(() => props.plan?.problems ?? []);
// What a run will meet is said before it starts; a run that met it says so itself.
const warnings = computed(() => (props.run ? [] : props.plan?.warnings ?? []));
const blocked = computed(() => !props.plan || problems.value.length > 0);
const showCost = computed(() => !!props.plan?.ask_price && !props.run);
const review = computed(() => (props.run?.status === "completed" ? reviewItems(props.run.review) : []));
// A run that stopped can be resumed; a finished one run again (it does only what is new).
const resumable = computed(() => !!props.run && ["paused", "cancelled", "failed"].includes(props.run.status));

const runStep = (key) => props.run?.steps.find((s) => s.key === key) ?? null;
const rows = computed(() => (props.plan?.steps ?? []).map((s) => ({ ...s, label: STEP_LABELS[s.key], step: runStep(s.key) })));
const COLUMNS = computed(() => [
  { id: "label", header: "Step" },
  ...(narrow.value ? [] : [{ id: "model", header: "Runs on" }]),
  ...(showCost.value ? [{ id: "estimate", header: "Estimate", headerStyle: { textAlign: "right" }, cellStyle: { textAlign: "right" } }] : []),
  ...(props.run ? [{ id: "status", header: "Status" }] : []),
]);
const rowClass = (row) => {
  if (!row.step) return "";
  if (row.step.status === "failed") return "jv-row--attention";
  return live.value && props.run.step === row.key ? "jv-row--selected" : "";
};

// What a speech, recognition or file step runs on, in words.
function modelText(row) {
  if (row.key === "add") return "—";
  if (row.key === "render") return "Each speaker's persona";
  if (row.key === "export") return props.plan?.warnings.some((w) => w.code === "no_ffmpeg") ? "ffmpeg — not installed" : "ffmpeg";
  if (row.key === "check" && props.plan?.warnings.some((w) => w.code === "no_recognition")) return `${row.model} — not installed`;
  return row.model || "—";
}
const RECIPES = { local: "Local", frontier: "Frontier" };
// The same, as one line under the step's name at phone width: the model, then the recipe.
function narrowModel(row) {
  if (row.kind !== "ai") return modelText(row);
  if (!row.configured) return "No model set";
  return [row.model, row.recipe ? RECIPES[row.recipe] : null].filter(Boolean).join(" · ");
}
const estimateText = (row) => {
  const e = row.estimate;
  if (!e) return "";
  const tokens = `${(e.tokens_in + e.tokens_out).toLocaleString()} tokens`;
  return e.price === null ? tokens : `${tokens} · $${e.price.toFixed(2)}`;
};

// The numbers each step wrote down (the plan's §5): model, recipe, tokens in and out, calls, time.
const NUMBER_COLUMNS = [
  { id: "label", header: "Step" },
  { id: "used", header: "Model · recipe" },
  { id: "tokens", header: "Tokens in / out", headerStyle: { textAlign: "right" }, cellStyle: { textAlign: "right" } },
  { id: "calls", header: "Calls", headerStyle: { textAlign: "right" }, cellStyle: { textAlign: "right" } },
  { id: "time", header: "Time", headerStyle: { textAlign: "right" }, cellStyle: { textAlign: "right" } },
];
const numbers = computed(() => (props.run?.steps ?? [])
  .filter((s) => s.status !== "pending")
  .map((s) => ({
    key: s.key,
    label: STEP_LABELS[s.key],
    used: [s.model, s.recipe ? RECIPES[s.recipe] : null].filter(Boolean).join(" · ") || "—",
    tokens: s.tokens_in || s.tokens_out ? `${s.tokens_in.toLocaleString()} / ${s.tokens_out.toLocaleString()}` : "—",
    calls: s.calls ? s.calls.toLocaleString() : "—",
    time: clock(s.seconds),
  })));
</script>

<template>
  <div class="jv-card book-run">
    <div class="jv-card__header">
      <h3 class="jv-card__title">Make the audiobook</h3>
      <UiTag v-if="tag" :intent="tag.intent">{{ tag.label }}</UiTag>
    </div>
    <div class="jv-card__body">
      <p v-if="!run" class="jv-lede">
        One press finds the speakers, decides who says every line, gives the main ones voices made
        from the book, directs the lines, renders and checks every take, and exports the M4B — without
        stopping to ask. What it isn't sure of is marked for you to check afterwards.
      </p>

      <div v-for="p in problems" :key="p.code" class="jv-banner jv-banner--warn book-run__note">
        {{ PROBLEMS[p.code].text }}
        <UiButton v-if="PROBLEMS[p.code].go" intent="ghost" size="small" :label="PROBLEMS[p.code].link"
          @click="emit('go', ...PROBLEMS[p.code].go)" />
      </div>
      <div v-for="w in warnings" :key="w.code" class="jv-banner jv-banner--info book-run__note">
        {{ PROBLEMS[w.code].text }}
        <UiButton v-if="PROBLEMS[w.code].go" intent="ghost" size="small" :label="PROBLEMS[w.code].link"
          @click="emit('go', ...PROBLEMS[w.code].go)" />
      </div>

      <div v-if="banner" class="jv-banner book-run__note" :class="`jv-banner--${banner.intent}`">
        <strong>{{ banner.title }}</strong> {{ banner.text }}
      </div>

      <div v-if="live" class="book-run__progress">
        <UiProgress :value="stepsDone(run)" :max="run.steps.length" bare />
        <span class="jv-hint">{{ runningLine(run, unit, elapsed) }}</span>
      </div>

      <UiTable v-if="plan" class="jv-table-look book-run__steps" :class="{ 'book-run__steps--narrow': narrow }"
        :data="rows" :columns="COLUMNS" data-key="key"
        :row-class="rowClass">
        <template #label="{ row }">
          <span class="book-run__step">{{ row.label }}</span>
          <span v-if="narrow && row.key !== 'add'" class="jv-hint book-run__runs-on--below"
            :class="{ 'jv-text-warn': row.kind === 'ai' && !row.configured }">{{ narrowModel(row) }}</span>
        </template>
        <template #model="{ row }">
          <span v-if="row.kind === 'ai'" class="book-run__runs-on">
            <LuFeatureChip v-if="row.configured" compact :feature="row.feature || row.key"
              :resolved-provider-name="row.provider || '—'" :resolved-model="row.model || '—'"
              @navigate="emit('routing', row)" />
            <span v-else class="jv-text-warn">No model set</span>
            <UiTag v-if="row.recipe && row.configured" intent="ghost">{{ RECIPES[row.recipe] }}</UiTag>
          </span>
          <span v-else>{{ modelText(row) }}</span>
        </template>
        <template #estimate="{ row }">{{ estimateText(row) }}</template>
        <template #status="{ row }">
          <span :class="{ 'jv-text-warn': row.step?.status === 'failed' }">{{ stepStatusText(row.step, unit, run) }}</span>
        </template>
      </UiTable>

      <p v-if="!run && planLine(plan)" class="jv-hint book-run__cost">{{ planLine(plan) }}</p>

      <div class="jv-inline-row book-run__actions">
        <template v-if="!run">
          <UiButton intent="primary" :label="showCost ? `▶ Make audiobook — ${priceText(plan.estimate)}` : '▶ Make audiobook'"
            :loading="busy" :disabled="blocked" @click="emit('start')" />
          <span class="jv-hint">{{ RUNS_ON_SERVER }}</span>
        </template>
        <template v-else-if="live">
          <UiButton intent="secondary" label="Stop"
            title="Stops at the next chapter or line. What is done is kept; Resume picks up there." @click="emit('stop')" />
          <span class="jv-hint">{{ RUNS_ON_SERVER }}</span>
        </template>
        <template v-else-if="resumable">
          <UiButton intent="primary" label="▶ Resume" :loading="busy" :disabled="blocked" @click="emit('resume')" />
        </template>
        <template v-else>
          <UiButton v-if="run.m4b" intent="primary" label="⬇ Save the M4B" @click="emit('save')" />
          <UiButton intent="secondary" label="↻ Run again" :loading="busy" :disabled="blocked"
            title="Does only what is new or unfinished — chapters already done are kept." @click="emit('start')" />
          <span v-if="!run.m4b" class="jv-hint">
            The M4B was saved or the app restarted since — Export makes it again.
            <UiButton intent="ghost" size="small" label="Open Export ➜" @click="emit('go', 'export')" />
          </span>
        </template>
      </div>

      <template v-if="run?.status === 'completed'">
        <h4 class="book-run__subhead">What to check</h4>
        <p v-if="!review.length" class="jv-hint">Nothing was flagged.</p>
        <UiTable v-else class="jv-table-look book-run__review" :data="review" data-key="key"
          :columns="narrow ? [{ id: 'text', header: 'Flagged' }] : [{ id: 'text', header: 'Flagged' }, { id: 'open', header: '' }]">
          <template #text="{ row }">
            {{ row.text }}
            <UiButton v-if="narrow" intent="ghost" size="small" :label="row.link" @click="emit('go', ...row.go)" />
          </template>
          <template #open="{ row }">
            <UiButton intent="ghost" size="small" :label="row.link" @click="emit('go', ...row.go)" />
          </template>
        </UiTable>
      </template>

      <details v-if="run && numbers.length" class="jv-fold book-run__numbers">
        <summary>Model, tokens and time for each step</summary>
        <UiTable class="jv-table-look" :data="numbers" :columns="NUMBER_COLUMNS" data-key="key" />
      </details>
    </div>
  </div>
</template>

<style scoped>
.book-run__note { margin: 0 0 10px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.book-run__progress { display: flex; flex-direction: column; gap: 4px; margin: 0 0 10px; max-width: 70ch; }
.book-run__step { font-weight: 600; color: var(--ink); }
.book-run__runs-on { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.book-run__runs-on--below { display: block; margin-top: 2px; overflow-wrap: anywhere; }
.book-run__steps--narrow :deep(.ui-table) { table-layout: fixed; width: 100%; }
.book-run__cost { margin-top: 8px; }
.book-run__actions { margin-top: 12px; gap: 10px; flex-wrap: wrap; align-items: center; }
.book-run__subhead { font-size: 13px; font-weight: 600; color: var(--ink); margin: 16px 0 6px; }
.book-run__numbers { margin-top: 12px; }
</style>
