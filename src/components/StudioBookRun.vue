<!-- SPDX-License-Identifier: MIT -->
<!--
  The one-click run on a book's Overview (the one-click plan's slice 5): BookRunCard.vue, fed by
  the server. It reads the plan and the book's latest run (services/bookRun.js), asks the price
  question once before a run that sends the book to a cloud model (the plan's Q8), starts, stops
  and resumes the run, follows a live one as a kit task — the AI tasks panel shows it — and saves
  the M4B the run made. The run itself lives on the server (book_run.js): leaving the page or
  closing the window doesn't stop it, and a window that opens the book later follows it again.

  Its links: a step of Studio goes up to Overview (`go`), AI Settings opens here; when a run stops
  or ends, `changed` tells Studio to read the book again — its speakers, lines and takes moved.
-->
<script setup>
import { computed, onActivated, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { confirmDialog, openPath, pushToast, saveBlob, useAiTasksStore } from "@delebash/llm-ui";
import BookRunCard from "./BookRunCard.vue";
import {
  LIVE, bookRunFor, followBookRun, loadBookRun, priceQuestion, resumeBookRun, runFollowed, startBookRun, stopBookRun,
} from "../services/bookRun.js";
import { useCopy } from "../services/copy.js";
import { savedMessage } from "../services/exportRun.js";
import { useApi } from "../stores/api.js";

const props = defineProps({
  project: { type: Object, required: true },
});
const emit = defineEmits(["go", "changed"]);

const api = useApi();
const tasks = useAiTasksStore();
const copy = useCopy();
const router = useRouter();
const unit = computed(() => copy.value.chapter);

const plan = ref(null);
const busy = ref(false);
const run = computed(() => bookRunFor(props.project.id));

async function load() {
  const id = props.project.id;
  try {
    const r = await loadBookRun(api, id);
    if (id === props.project.id) plan.value = r.plan;
    follow();
  } catch (e) {
    if (id === props.project.id) plan.value = null;
    pushToast({ kind: "error", message: `Couldn't read the audiobook run: ${e?.message || e}` });
  }
}
watch(() => props.project.id, load, { immediate: true });
onActivated(load);

/** Follow a live run in this window (once), and read the book again when it stops. */
function follow() {
  const r = run.value;
  if (!r || !LIVE.has(r.status) || runFollowed(tasks, r.id)) return;
  followBookRun(api, { project: props.project, run: r, unit: unit.value })
    .catch(() => { /* the card and the task strip say why */ })
    .finally(() => {
      if (props.project.id === r.project_id) load();
      emit("changed");
    });
}

async function start() {
  if (busy.value || !plan.value) return;
  let acceptPrice = false;
  if (plan.value.ask_price) {
    const q = priceQuestion(plan.value);
    if (!(await confirmDialog({ title: q.title, message: q.message, confirmLabel: q.confirmLabel }))) return;
    acceptPrice = true;
  }
  busy.value = true;
  try {
    await startBookRun(api, props.project.id, { acceptPrice });
    follow();
  } catch (e) {
    pushToast({ kind: "error", message: String(e?.message || e), duration: 7000 });
  } finally {
    busy.value = false;
  }
}

async function stop() {
  try {
    await stopBookRun(api, run.value);
  } catch (e) {
    pushToast({ kind: "error", message: String(e?.message || e) });
  }
}

async function resume() {
  if (busy.value) return;
  busy.value = true;
  try {
    await resumeBookRun(api, run.value);
    follow();
  } catch (e) {
    pushToast({ kind: "error", message: String(e?.message || e), duration: 7000 });
  } finally {
    busy.value = false;
  }
}

// ⬇ Save the M4B: the run's export job hands its file over once (as Export's does).
async function save() {
  const m4b = run.value?.m4b;
  if (!m4b) return;
  try {
    const blob = await api.requestBlob(`/v1/export_jobs/${m4b.job_id}/file`);
    const res = await saveBlob(blob, m4b.filename, { title: "Save audiobook", filterName: "M4B audiobook", filterExt: "m4b" });
    const said = savedMessage(res, m4b.filename);
    pushToast({
      kind: said.kind, message: said.message, duration: said.folder ? 9000 : 5000,
      ...(said.folder ? { action: { label: "Open folder", fn: () => openPath(said.folder) } } : {}),
    });
  } catch (e) {
    pushToast({ kind: "error", message: `Couldn't save the M4B: ${e?.message || e}`, duration: 7000 });
  }
  load();
}

// A link: AI Settings here (a tab of it with `arg`), a step of Studio up to Overview.
function go(step, arg = null) {
  if (step === "ai") router.push({ path: "/ai", query: arg ? { tab: arg } : {} });
  else emit("go", step, arg);
}
// A step's model chip: its card in AI Settings → Routing by feature.
function routing(row) {
  router.push({ path: "/ai", query: { tab: "features", action: row.action } });
}
</script>

<template>
  <BookRunCard :unit="unit" :plan="plan" :run="run" :busy="busy" :elapsed="run?.totals.seconds || 0"
    @start="start" @stop="stop" @resume="resume" @save="save" @go="go" @routing="routing" />
</template>
