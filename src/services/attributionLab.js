// SPDX-License-Identifier: MIT
// The speaker-attribution Lab adapter (parity batch 2026-08-06 — the Speaker
// Lab reunification). Registered under the `speaker_attribution` FEATURE via
// installLlmUi({ labAdapters }), so every attribution action's Lab column runs
// the REAL pipeline (/v1/extraction/analyze-text — segmentation, [D#] tags,
// anchors, floors; the discovery action runs /v1/extraction/discover-speakers)
// instead of the generic /v1/ai/run, renders the speaker table with reassign
// (AttributionResult), and carries the floor + anchor controls
// (AttributionConfigExtra). Each card's run forces its OWN route — the card
// IS the route (the Auto simplification, 2026-08-06). CONCEPTS §16 holds:
// the lab and production share one pipeline, so they cannot drift.
import AttributionConfigExtra from "../components/lab/AttributionConfigExtra.vue";
import AttributionResult from "../components/lab/AttributionResult.vue";
import CastEditor from "../components/lab/CastEditor.vue";
import { useActiveProject } from "../stores/activeProject.js";
import { useApi } from "../stores/api.js";
import { useRenderTasks } from "../stores/renderTasks.js";

// The passage text can arrive under any of the rows' template names —
// guided/direct use {{paragraphs}}, discovery uses {{manuscript}}.
export function passageFrom(vars) {
  return vars.paragraphs || vars.manuscript || vars.text || vars.user_content || "";
}

// Cast lines → structured characters — the ONE agreed characters shape
// (Part 6): one per line, shared by this parser, CastEditor's serializer,
// the seeded cellar sample and labTestData's cast fills.
//   "Mara"  ·  "Mara | Lady Mara, the captain"  ·  "Mara: Lady Mara"
export function parseCharacters(raw) {
  return String(raw || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const m = line.split(/[|:]/);
      const name = (m[0] || "").trim();
      const aliases = (m[1] || "").split(",").map((a) => a.trim()).filter(Boolean);
      return { id: `c_${name.toLowerCase().replace(/\s+/g, "_")}_${i}`, name, aliases };
    })
    .filter((c) => c.name);
}

// Each card IS its route (the Auto simplification, 2026-08-06): a card's Lab
// run always forces its own route, so the column's edited prompt boxes
// always ride as overrides — "what you see is what runs", with no
// route-vs-prompt mismatch possible.
export const ACTION_ROUTE = {
  "speaker_attribution.guided": "guided",
  "speaker_attribution.direct": "direct",
  "speaker_attribution.reasoned": "reasoned",
};

// Card labels for the task strip — the rows' own on-screen names.
const ACTION_LABEL = {
  "speaker_attribution.guided": "Guided",
  "speaker_attribution.direct": "Direct",
  "speaker_attribution.reasoned": "Reasoned",
  "speaker_attribution.identify": "Find new speakers",
};

async function run(body, { signal } = {}) {
  const api = useApi();
  const vars = body.variables || {};
  const extra = body.extra || {};

  // §16: a Lab run is a real AI task — task row, live seconds, tokens on the
  // strip, Cancel both ways (the strip's Cancel aborts the request; the Lab
  // column's own cancel marks the task). Words are known at start.
  const tasks = useRenderTasks();
  const ctrl = new AbortController();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  const words = String(passageFrom(vars)).trim().split(/\s+/).filter(Boolean).length;
  const task = tasks.start({
    kind: "extract",
    feature: "extract",
    label: `Lab — ${ACTION_LABEL[body.action] || body.action}`,
    meta: { words },
    statsFn: (t) => {
      const out = [`${t.meta.words ?? 0} words`];
      if (t.meta.tokens != null) out.push(`${t.meta.tokens} tok`);
      return out;
    },
    onCancel: () => ctrl.abort(),
  });
  try {
    const result = await runInner(body, vars, extra, api, ctrl.signal);
    const u = result?.data?.usage;
    if (u) {
      tasks.update(task.id, {
        meta: {
          words,
          tokens: (u.prompt_tokens || 0) + (u.completion_tokens || 0),
        },
      });
    }
    tasks.finish(task.id);
    return result;
  } catch (e) {
    if (ctrl.signal.aborted) tasks.cancel(task.id);
    else tasks.fail(task.id, e?.message || String(e));
    throw e;
  }
}

async function runInner(body, vars, extra, api, signal) {
  // Discovery ("Find new speakers") has its own pipeline door — the ad-hoc
  // identify twin of analyze-text. The column's prompt boxes ARE this action's
  // row, so they always ride as overrides; known characters come from the
  // {{known_characters}} box (one name per line, "- " bullets tolerated).
  if (body.action === "speaker_attribution.identify") {
    const known = String(vars.known_characters || vars.characters || "")
      .split("\n")
      .map((s) => s.trim().replace(/^[-•]\s*/, ""))
      .filter(Boolean)
      .map((s) => s.split(/[|:]/)[0].trim())
      .filter(Boolean);
    const r = await api.request("/v1/extraction/discover-speakers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: passageFrom(vars),
        known_characters: known,
        providerId: body.providerId || null,
        model: body.model || null,
        temperature: body.temperature ?? null,
        systemPrompt: body.system || null,
        userPrompt: body.userTemplate || null,
        // The column's tunables ride (Part 2, 2026-08-06: the controls are
        // REAL — what you see is what runs; the run path applies them like
        // any kit feature).
        think: body.think ?? null,
        reasoningEffort: body.reasoningEffort ?? null,
        maxTokens: body.maxTokens || null,
        topP: body.topP ?? null,
        samplers: body.samplers || [],
      }),
      signal,
    });
    return {
      content: JSON.stringify(r?.candidates || [], null, 2),
      // Top-level usage feeds the column's own stats readout (tok/s · tokens).
      promptTokens: r?.usage?.prompt_tokens || 0,
      completionTokens: r?.usage?.completion_tokens || 0,
      model: r?.usage?.model || "",
      data: { candidates: r?.candidates || [], usage: r?.usage || null },
    };
  }

  const tier = ACTION_ROUTE[body.action] || null; // the card's own route, forced

  const payload = {
    text: passageFrom(vars),
    characters: parseCharacters(vars.characters),
    // Part 5 (2026-08-06): the typed corrections box died — with a project
    // open, the run uses that project's STORED corrections server-side,
    // through the same resolver production uses.
    corrections: [],
    project_id: useActiveProject().id || null,
    tier,
    propagate: extra.propagate ?? true,
    use_floor: extra.useFloor ?? true,
    providerId: body.providerId || null,
    model: body.model || null,
    temperature: body.temperature ?? null,
    systemPrompt: body.system || null,
    userPrompt: body.userTemplate || null,
    // The column's tunables ride (Part 2, 2026-08-06: the controls are REAL —
    // what you see is what runs; the run path applies them like any feature).
    think: body.think ?? null,
    reasoningEffort: body.reasoningEffort ?? null,
    maxTokens: body.maxTokens || null,
    topP: body.topP ?? null,
    samplers: body.samplers || [],
    confidence_floor:
      (extra.useFloor ?? true) && extra.floor !== "" && extra.floor != null
        ? Number(extra.floor)
        : null,
  };
  const r = await api.request("/v1/extraction/analyze-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  return {
    content: r?.raw_llm || "",
    // Top-level usage feeds the column's own stats readout (tok/s · tokens).
    promptTokens: r?.usage?.prompt_tokens || 0,
    completionTokens: r?.usage?.completion_tokens || 0,
    model: r?.usage?.model || "",
    // The render needs the parsed cast beside the rows (labels + reassign).
    data: { ...r, characters: payload.characters },
  };
}

// Per-variable input affordances (the Lab restoration Part 3, 2026-08-06 —
// the kit's varConfig seam): the cast boxes become the original Speaker
// Lab's chip editor (no visible ids), the passage boxes get the original's
// live words · chars · ~tokens counters.
export const attributionLabAdapter = {
  run,
  render: AttributionResult,
  configExtra: AttributionConfigExtra,
  varConfig: {
    characters: { editor: CastEditor },
    known_characters: { editor: CastEditor },
    paragraphs: { counters: true },
    manuscript: { counters: true },
    // Part 5 (2026-08-06): nothing can honestly be typed here — corrections
    // only exist by fixing real results. With a project open the run uses
    // that project's stored corrections (the adapter sends project_id).
    corrections: { hidden: true },
  },
};
