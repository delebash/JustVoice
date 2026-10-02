// SPDX-License-Identifier: MIT
// An engine's own terms — the manifest's TERMS. Today only Pocket TTS has them: Kyutai's
// prohibited-use terms, which gate CLONING (decided 2026-10-02 — "use the copy and show
// kyutai's terms before first clone"). The server refuses the gated use until they are
// accepted: HTTP 403, problem type `…/terms-required`, with the engine id.
//
// One door opens the prompt. The Clone tab, the Speech engines row and any refusal met on
// the way all dispatch `jv:engine-terms`; <EngineTermsDialog> (mounted once, in App.vue)
// answers it. A caller's catch block hands its error to handleTermsRefusal first.

export const TERMS_EVENT = "jv:engine-terms";

export function isTermsRefusal(err) {
  return err?.status === 403 && String(err?.problem?.type || "").endsWith("terms-required");
}

export function openEngineTerms(engineId) {
  window.dispatchEvent(new CustomEvent(TERMS_EVENT, { detail: { engine: engineId } }));
}

// True when `err` was the terms refusal — the prompt is open and the caller should not
// toast the error as a failure.
export function handleTermsRefusal(err) {
  if (!isTermsRefusal(err)) return false;
  openEngineTerms(err.problem?.engine || "");
  return true;
}

export async function acceptEngineTerms(api, engineId) {
  await api.request(`/v1/engines/${encodeURIComponent(engineId)}/terms`, { method: "POST" });
  // Every surface showing the engine re-reads it (the Clone tab's prompt goes away).
  window.dispatchEvent(new Event("jv:health-refresh"));
}
