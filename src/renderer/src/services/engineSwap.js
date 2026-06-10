// SPDX-License-Identifier: GPL-3.0-or-later
//
// Swap-at-render client helper (plan WS3).
//
// The server's render endpoints return 409 problem+json with
// code "engine-swap-required" when the picked voice needs a managed
// engine that isn't loaded and the request didn't opt in via
// allow_engine_swap. This helper owns the shared prompt-and-retry flow:
//
//   const blob = await withEngineSwap((allowSwap) =>
//     api.post("/v1/generate", { ...body, allow_engine_swap: allowSwap }));
//   if (blob === null) return;  // user declined the swap
//
// On 409: one confirm dialog (with "always swap without asking" — persists
// settings.generation.auto_engine_swap via read-modify-write of the
// generation section, since PATCH /v1/settings replaces whole sections),
// then the retry runs under a task-strip entry so the swap is visible in
// the AI progress UI like any other engine load.

import { confirmDialog } from "./dialog.js";
import { useApi } from "../stores/api.js";
import { useRenderTasks } from "../stores/renderTasks.js";

export function isSwapRequired(err) {
  return err?.status === 409 && err?.body?.code === "engine-swap-required";
}

async function persistAlwaysSwap(api) {
  try {
    const settings = await api.request("/v1/settings");
    const generation = { ...(settings?.generation || {}), auto_engine_swap: true };
    await api.request("/v1/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generation }),
    });
  } catch {
    // Non-fatal: the retry below still carries allow_engine_swap=true.
  }
}

export async function withEngineSwap(doRequest, { taskLabel } = {}) {
  try {
    return await doRequest(false);
  } catch (err) {
    if (!isSwapRequired(err)) throw err;
    const info = err.body;
    const estimate = info.weights_on_disk
      ? `takes ~${info.est_seconds || 40}s`
      : "downloads the model first — may take minutes";
    const res = await confirmDialog({
      title: "Engine swap needed",
      message:
        `This voice uses ${info.to_engine}` +
        (info.from_engine ? ` (currently loaded: ${info.from_engine})` : "") +
        `. Swapping ${estimate}.`,
      confirmLabel: "Swap & render",
      checkbox: { label: "Always swap without asking" },
    });
    if (!res?.ok) return null;

    const api = useApi();
    if (res.checked) await persistAlwaysSwap(api);

    const tasks = useRenderTasks();
    const task = tasks.start({
      kind: "load",
      label: taskLabel || `Swapping to ${info.to_engine}…`,
    });
    try {
      const out = await doRequest(true);
      tasks.finish(task.id);
      return out;
    } catch (e2) {
      tasks.fail(task.id, String(e2?.message || e2));
      throw e2;
    }
  }
}
