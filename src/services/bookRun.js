// SPDX-License-Identifier: MIT
//
// The one-click audiobook's run, on the renderer side (the one-click plan's slice 5; the server's
// book_run.js runs it). The run lives on the server — it goes on while you leave the page, close
// the window, or run the server headless — so this window only starts it, follows it and stops
// it, the way Render follows a render job (renderRun.js):
//
//   loadBookRun    GET  /v1/projects/{id}/book_run — the plan (each step's model, the estimate,
//                  what stops it) and the book's latest run
//   startBookRun   POST /v1/book_runs
//   followBookRun  the run as a kit task (the AI tasks panel, Stop included), polled until it
//                  stops; each poll lands in `bookRunFor(projectId)`, which the Overview card reads
//
// The card's words live here, one wording per fact (design-law 6b): the steps' names, what each
// step says while it runs and after, the price, and the "what to check" list.

import { reactive } from "vue";
import { withAiTask } from "@delebash/llm-ui";
import { clock } from "./renderRun.js";

// ── the words ────────────────────────────────────────────────────────────

/** Each step's name, in the run's order (book_run.STEPS). */
export const STEP_LABELS = {
  discover: "Discover the speakers",
  merge: "Merge found names",
  add: "Add the speakers",
  analyze: "Analyze — who speaks each line",
  group_lines: "Lines with no single speaker",
  describe: "Describe the voices",
  design: "Design the voices",
  match: "Match the rest from your library",
  direction: "Direction",
  render: "Render every line",
  check: "Check the takes",
  export: "Master and export the M4B",
};

/** What a step counts, given the book's word for a chapter (`unit`: copy.chapter). */
function unitWord(key, n, unit) {
  const ch = n === 1 ? unit.singular : unit.plural;
  const words = {
    discover: ch,
    analyze: ch,
    group_lines: ch,
    direction: ch,
    merge: n === 1 ? "person" : "people",
    add: n === 1 ? "speaker" : "speakers",
    describe: n === 1 ? "voice" : "voices",
    design: n === 1 ? "voice" : "voices",
    match: n === 1 ? "speaker" : "speakers",
    render: n === 1 ? "line" : "lines",
    check: n === 1 ? "take" : "takes",
    export: n === 1 ? "part" : "parts",
  };
  return String(words[key] ?? "").toLowerCase();
}

const count = (key, n, unit) => `${Number(n || 0).toLocaleString()} ${unitWord(key, n, unit)}`;

/** The run's state, as the card's tag says it. */
export const RUN_TAGS = {
  queued: { label: "Running", intent: "info" },
  running: { label: "Running", intent: "info" },
  paused: { label: "Paused", intent: "secondary" },
  cancelled: { label: "Stopped", intent: "secondary" },
  failed: { label: "Stopped on a problem", intent: "danger" },
  completed: { label: "Done", intent: "success" },
};

export const LIVE = new Set(["queued", "running"]);
const ENDED = new Set(["paused", "cancelled", "failed", "completed"]);

/** What the take check found wrong with a take (take_check.js reasons), in Studio's words. */
export const TAKE_REASONS = {
  runaway: "runs away — far longer than its words",
  missed: "misses words",
  extra: "says more than its words",
  rerender_failed: "its new take couldn't be made",
};

/** A step's Status cell: where it stands, in a run. */
export function stepStatusText(step, unit, run) {
  if (!step) return "";
  const { key, status, done, total } = step;
  if (status === "running") {
    if (key === "check" && step.phase === "render") return `Running · rendering ${count("render", total, unit)} again`;
    if (!total) return "Running";
    const at = ["discover", "analyze", "group_lines", "direction"].includes(key) && run?.scene_title ? ` — ${run.scene_title}` : "";
    return `Running · ${Number(done).toLocaleString()} of ${count(key, total, unit)}${at}`;
  }
  if (status === "failed") return "Stopped here";
  if (status === "skipped") return step.note ? `Skipped — ${step.note}` : "Skipped";
  if (status === "pending") return run && ENDED.has(run.status) && run.status !== "completed" ? "Not reached" : "Waiting";
  // done
  const kept = step.kept ? ` · ${Number(step.kept).toLocaleString()} already done` : "";
  if (key === "add") return `Done · ${count("add", step.added ?? 0, unit)} added`;
  if (key === "design") return `Done · ${count("design", step.made ?? 0, unit)} made`;
  if (key === "match") return step.unmatched ? `Done · ${count("match", step.unmatched, unit)} left without a match` : `Done · ${count("match", total, unit)}`;
  if (key === "render") return `Done · ${count("render", total, unit)}${step.failed ? ` · ${Number(step.failed).toLocaleString()} failed` : ""}`;
  if (key === "check") return `Done · ${count("check", total, unit)}${step.flagged ? ` · ${Number(step.flagged).toLocaleString()} flagged` : ""}`;
  if (key === "export") return "Done";
  return `Done · ${count(key, total, unit)}${kept}`;
}

/** "about $0.76", "nothing to pay", or that the price isn't known. */
export function priceText(estimate) {
  if (!estimate) return "";
  if (estimate.price === null) return "price unknown — AI Settings → Pricing has no price for it";
  return `about $${Number(estimate.price).toFixed(2)}`;
}

/** The line under the steps before a run: what it will cost, or that it costs nothing. */
export function planLine(plan) {
  if (!plan?.estimate) return "";
  if (!plan.ask_price) return "Every AI step runs on this computer — nothing is sent anywhere, nothing to pay.";
  const e = plan.estimate;
  const models = [...new Set(plan.steps.filter((s) => s.kind === "ai" && s.cloud).map((s) => s.model))].join(", ");
  return `Sends the book to ${models}: about ${e.tokens_in.toLocaleString()} tokens in and ${e.tokens_out.toLocaleString()} out, ${priceText(e)}. The run asks once before it starts.`;
}

/** The price question — asked once, before a run that sends the book to a cloud model starts
 * (the plan's Q8). → confirmDialog's options. */
export function priceQuestion(plan) {
  const e = plan.estimate;
  const models = [...new Set(plan.steps.filter((s) => s.kind === "ai" && s.cloud).map((s) => s.model))].join(", ");
  const cost = e.price === null
    ? `AI Settings → Pricing has no price for ${e.unpriced.join(", ")}, so what it costs isn't known.`
    : `At your prices in AI Settings → Pricing that is about $${Number(e.price).toFixed(2)}.`;
  return {
    title: "Send the book to a cloud model?",
    message: `This run sends about ${e.tokens_in.toLocaleString()} tokens of the book to ${models} and gets about `
      + `${e.tokens_out.toLocaleString()} back. ${cost} It's an estimate; the run writes down what it really used. `
      + "It asks only this once — Resume won't ask again.",
    confirmLabel: e.price === null ? "Make audiobook" : `Make audiobook — about $${Number(e.price).toFixed(2)}`,
  };
}

/** Where the run goes on — the card's hint beside Stop, and the task's. */
export const RUNS_ON_SERVER = "Runs on the server — it goes on if you leave this page or close the window.";

/** What stops a run starting, and what it will meet (the plan's problems and warnings). */
export const PROBLEMS = {
  no_text: { text: "This book has no text yet — import it, or add its chapters in Script.", go: ["script"], link: "Open Script ➜" },
  no_model: { text: "No language model is set up for the AI steps.", go: ["ai"], link: "AI Settings ➜" },
  no_language: { text: "Set the book's Language below first — its voices are made in it.", go: null, link: "" },
  no_ffmpeg: { text: "ffmpeg isn't installed, so the run will stop before the M4B. Install ffmpeg and restart the server, then Resume.", go: null, link: "" },
  no_recognition: { text: "Speech recognition isn't installed, so the takes won't be checked.", go: ["ai", "speech-engines"], link: "Speech engines ➜" },
};

/** The banner above the steps for a run that has stopped or ended — `{intent, title, text}`, or
 * null while it runs or before one. */
export function runBanner(run) {
  if (!run) return null;
  const step = run.steps.find((s) => s.key === run.step);
  const where = step ? `${STEP_LABELS[step.key]}${run.scene_title ? `, ${run.scene_title}` : ""}` : "where it stopped";
  if (run.status === "paused") {
    return { intent: "warn", title: "Paused", text: `The app closed while this ran. Resume picks up at ${where}; what is done is kept.` };
  }
  if (run.status === "cancelled") return { intent: "info", title: "Stopped", text: `Resume picks up at ${where}; what is done is kept.` };
  if (run.status === "failed") {
    const name = STEP_LABELS[run.error?.step] ?? STEP_LABELS[run.step] ?? "A step";
    return { intent: "danger", title: `${name} stopped the run.`, text: `${run.error?.text ?? ""} Fix it, then Resume — it picks up there; what is done is kept.` };
  }
  if (run.status === "completed") {
    const t = run.totals;
    const tokens = t.tokens_in || t.tokens_out ? ` · ${t.tokens_in.toLocaleString()} tokens in, ${t.tokens_out.toLocaleString()} out` : "";
    const price = t.price > 0 ? ` · about $${t.price.toFixed(2)}` : "";
    return { intent: "success", title: "Done.", text: `Made in ${clock(t.seconds)}${tokens}${price}.` };
  }
  return null;
}

/** The step a run is on and where in it: "Direction · 1 of 2 chapters — CHAPTER VII. …". */
export function currentStepText(run, unit) {
  const step = run?.steps.find((s) => s.key === run.step) ?? run?.steps.find((s) => s.status === "running");
  if (!step) return "Starting";
  const where = stepStatusText({ ...step, status: "running" }, unit, run).replace(/^Running( · )?/, "");
  return where ? `${STEP_LABELS[step.key]} · ${where}` : STEP_LABELS[step.key];
}

/** The line under the bar while a run goes: the step, where it is, the time so far. */
export function runningLine(run, unit, elapsed) {
  if (!run || !LIVE.has(run.status)) return "";
  const bits = [currentStepText(run, unit), `${clock(elapsed)} so far`];
  if (run.totals.tokens_in) bits.push(`${run.totals.tokens_in.toLocaleString()} tokens in`);
  return bits.join(" · ");
}

/** Steps done of the run's twelve (the bar). */
export const stepsDone = (run) => (run ? run.steps.filter((s) => s.status === "done" || s.status === "skipped").length : 0);

/** The "what to check" list after a run → [{key, text, go, link}]. */
export function reviewItems(review) {
  if (!review) return [];
  const out = [];
  const lines = (n) => `${Number(n).toLocaleString()} line${n === 1 ? "" : "s"}`;
  for (const ch of review.script) {
    out.push({ key: `script:${ch.scene_id}`, text: `${ch.title} — ${lines(ch.lines)} to check in Script`, go: ["script", { sceneId: ch.scene_id, focus: "check" }], link: "Open in Script ➜" });
  }
  for (const t of review.takes) {
    const why = t.reasons.map((r) => TAKE_REASONS[r] ?? r).join(", ");
    out.push({ key: `take:${t.block_id}`, text: `${t.title}, line ${t.n} — its take ${why}, after one new take`, go: ["render", { sceneId: t.scene_id }], link: "Open in Render ➜" });
  }
  if (review.voices.length) {
    const n = review.voices.length;
    out.push({ key: "voices", text: `${n} voice${n === 1 ? "" : "s"} made from the book — ${review.voices.map((v) => v.name).join(", ")}: listen to each`, go: ["cast"], link: "Open Cast ➜" });
  }
  for (const s of review.uncast) {
    out.push({ key: `uncast:${s.speaker_id}`, text: `${s.name} has ${lines(s.lines ?? 0)} and no persona`, go: ["cast"], link: "Open Cast ➜" });
  }
  for (const r of review.refused) {
    out.push({ key: `refused:${r.step}:${r.scene_id}`, text: `${STEP_LABELS[r.step]} left ${r.title} as it was: ${r.reason}`, go: ["script", { sceneId: r.scene_id }], link: "Open in Script ➜" });
  }
  return out;
}

// ── the server ───────────────────────────────────────────────────────────

const JSON_HEADERS = { "Content-Type": "application/json" };

// {projectId: the run as last read} — the card reads it; a follow loop writes it.
const runs = reactive({});

/** The book's run as this window last read it, or null. Reactive. */
export function bookRunFor(projectId) {
  return (projectId && runs[projectId]) || null;
}

/** The plan and the latest run → {plan, run}; the run is kept for `bookRunFor`. */
export async function loadBookRun(api, projectId) {
  const r = await api.request(`/v1/projects/${projectId}/book_run`);
  runs[projectId] = r.run ?? null;
  return r;
}

/** Start a run. `acceptPrice`: yes to the price question. Returns the run. */
export async function startBookRun(api, projectId, { acceptPrice = false } = {}) {
  const run = await api.request("/v1/book_runs", {
    method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ project_id: projectId, accept_price: acceptPrice }),
  });
  runs[projectId] = run;
  return run;
}

export async function stopBookRun(api, run) {
  runs[run.project_id] = await api.request(`/v1/book_runs/${run.id}/cancel`, { method: "POST" });
  return runs[run.project_id];
}

export async function resumeBookRun(api, run) {
  runs[run.project_id] = await api.request(`/v1/book_runs/${run.id}/resume`, { method: "POST" });
  return runs[run.project_id];
}

const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => {
    clearTimeout(t);
    reject(signal.reason);
  }, { once: true });
});

/** Is this run followed in this window already (its task still running)? */
export function runFollowed(tasks, runId) {
  return tasks.visibleTasks.some((t) => t.feature === "book_run" && t.meta?.runId === runId && tasks.isRunning(t.id));
}

/**
 * Follow a run to where it stops, as a kit task — the AI tasks panel shows it, its Cancel stops
 * the run. Each poll lands in `bookRunFor`; the last one carries what to check. Resolves to the
 * run as it ended.
 */
export function followBookRun(api, { project, run, unit }) {
  return withAiTask({
    feature: "book_run",
    label: `${project.name || "Book"} → audiobook`,
    meta: { projectId: project.id, runId: run.id },
  }, async (task) => {
    let r = run;
    const t0 = Date.now();
    try {
      while (!ENDED.has(r.status)) {
        runs[project.id] = r;
        task.setProgress(stepsDone(r), r.steps.length, currentStepText(r, unit), RUNS_ON_SERVER);
        task.setStats(r.totals.tokens_in ? [`${r.totals.tokens_in.toLocaleString()} tokens in`, `${clock((Date.now() - t0) / 1000)}`] : [clock((Date.now() - t0) / 1000)]);
        await wait(1000, task.signal);
        r = await api.request(`/v1/book_runs/${run.id}`, { signal: task.signal });
      }
    } catch (e) {
      if (!task.signal.aborted) throw e;
      runs[project.id] = await api.safeRequest(`/v1/book_runs/${run.id}/cancel`, runs[project.id], { method: "POST" });
      throw new DOMException("Stopped", "AbortError");
    }
    const end = await api.safeRequest(`/v1/book_runs/${run.id}?review=true`, r);
    runs[project.id] = end;
    if (end.status === "failed") throw new Error(end.error?.text || "the run stopped on a problem");
    if (end.status === "cancelled" || end.status === "paused") {
      // Stopped from the card, or by a restart: the task ends cancelled, not failed.
      task.cancel();
      throw new DOMException("Stopped", "AbortError");
    }
    return { result: end, usage: { prompt_tokens: end.totals.tokens_in, completion_tokens: end.totals.tokens_out } };
  });
}
