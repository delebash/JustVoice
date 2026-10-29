// SPDX-License-Identifier: MIT
//
// Loading one speech model on the kit's audio.cpp runtime from a page of ours (the persona page's
// Load — round E, docs/plans/2026-10-29-round-e-onto-the-kit.md §4 step 5), as a task for the
// kit's createDownloadTask and its DownloadBar: POST /v1/ai/runtimes/audiocpp/models/:id/load —
// 200 loaded, or 202 {status: "downloading"} for a model not on disk, which downloads and then
// loads in the background (G4) — then the model's row in GET …/models until the runtime holds it.
// Cancel is the kit's Unload, which stops a load on its way, its download included (G12). The
// Speech tab's own Load is the kit's (LuRuntimeTab), read the same way.

import { createDownloadTask, kitT } from "@delebash/ui";
import { isTermsRefusal } from "./engineTerms.js";

const BASE = "/v1/ai/runtimes/audiocpp/models";
const problemCode = (e) => /([^/]+)$/.exec(e?.problem?.type || "")?.[1] || "";

/** One model's row (GET …/models) as a task reading. */
export function readSpeechLoad(m) {
  if (!m) return { terminal: "error", error: kitT("kit.runtimes.modelGone") };
  if (m.loadError) return { terminal: "error", error: m.loadError };
  if (m.status === "error") return { terminal: "error", error: m.error };
  if (m.loading === "downloading" || m.status === "downloading") return { detail: "downloading", done: m.downloaded, total: m.total, status: "downloading" };
  if (m.loading) return { detail: "loading", status: "loading" };
  if (m.running) return { terminal: "done" };
  // not loading and not held: an Unload stopped it
  return { terminal: "cancelled" };
}

/**
 * The channel over the kit's routes for model `modelId`. `api` is the useApi() store. A licence
 * the user hasn't accepted (403 terms-required, G5) goes to `onTerms()` — the caller opens its
 * terms — and the load ends without a failure, as one an Unload cancelled (409 load-cancelled).
 */
export function speechLoadChannel(api, modelId, { onTerms = null } = {}) {
  const one = `${BASE}/${encodeURIComponent(modelId)}`;
  return {
    start: async () => {
      try {
        await api.post(`${one}/load`, {});
      } catch (e) {
        if (isTermsRefusal(e) && onTerms) return onTerms();
        if (problemCode(e) === "load-cancelled") return;
        throw e;
      }
    },
    statusUrl: BASE,
    fetch: (url) => api.request(url),
    read: (st) => readSpeechLoad((st?.models || []).find((m) => m.id === modelId)),
    cancel: () => api.post(`${one}/unload`, {}),
    friendly: (detail) => (detail === "downloading" ? kitT("kit.phase.downloading") : "Loading model"),
    // The bar's captions name the operation (the persona page's load said these before round E).
    armPhase: "Loading model",
    donePhase: "Loaded",
  };
}

/** A ready task loading `modelId` (`speechLoadChannel`'s options). */
export function speechLoadTask(api, modelId, opts = {}) {
  return createDownloadTask(speechLoadChannel(api, modelId, opts));
}
