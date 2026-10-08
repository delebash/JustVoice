// SPDX-License-Identifier: MIT
// Engine status derivation (the port of justvoice/engines/catalog.py).
//
// The hand-typed static catalog that used to live here was excised 2026-08-14 — the manifests
// (`engines/<id>/manifest.js`) are the catalog. `computeStatus` survives because it is NOT
// about that list: it derives a status for RUNTIME-registered engines — the external
// OpenAI-compatible servers a user adds, which have no manifest by design.

/** Match the Rust crate's compute_status logic. */
export function computeStatus(entryId, registered, registeredReady, currentId) {
  if (!registered) return "not_installed";
  const isCurrent = currentId === entryId;
  if (isCurrent && registeredReady) return "loaded";
  if (isCurrent) return "loading";
  return "installed";
}
