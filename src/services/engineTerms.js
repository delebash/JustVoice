// SPDX-License-Identifier: MIT
// An engine's own terms — the manifest's TERMS: Pocket TTS's (Kyutai's prohibited-use terms, which
// gate CLONING — decided 2026-10-02, "use the copy and show kyutai's terms before first clone"), and
// the licence of every model whose commercial use isn't a plain "Yes", which gates its download
// (decided 2026-10-11). The server refuses the gated use until they are accepted: HTTP 403, problem
// type `…/terms-required` — JustVoice's own refusals with the engine's id (`engine`), the kit's
// audio.cpp runtime's with the model's (`modelId`; round E, G5).
//
// One door opens the prompt. The Clone tab, the Speech tab's engines and any refusal met on the way
// all dispatch `jv:engine-terms`; <EngineTermsDialog> (mounted once, in layouts/MainLayout.vue)
// answers it, and runs `onAccepted` once they are — the Speech tab's Download or Load again, the
// persona page's Load. A caller's catch block hands its error to handleTermsRefusal first.

export const TERMS_EVENT = "jv:engine-terms";

export function isTermsRefusal(err) {
  return err?.status === 403 && String(err?.problem?.type || "").endsWith("terms-required");
}

/** Open `engineId`'s terms; `onAccepted()` runs once the user accepts them. */
export function openEngineTerms(engineId, { onAccepted = null } = {}) {
  window.dispatchEvent(new CustomEvent(TERMS_EVENT, { detail: { engine: engineId, ...(onAccepted ? { onAccepted } : {}) } }));
}

// True when `err` was the terms refusal — the prompt is open and the caller should not toast the
// error as a failure. A refusal of the kit's names the model, not the engine: `engineId` is the
// engine the caller knows it by.
export function handleTermsRefusal(err, { engineId = "", onAccepted = null } = {}) {
  if (!isTermsRefusal(err)) return false;
  openEngineTerms(err.problem?.engine || engineId, { onAccepted });
  return true;
}

export async function acceptEngineTerms(api, engineId) {
  await api.request(`/v1/engines/${encodeURIComponent(engineId)}/terms`, { method: "POST" });
  // Every surface showing the engine re-reads it (the Clone tab's prompt goes away).
  window.dispatchEvent(new Event("jv:health-refresh"));
}
