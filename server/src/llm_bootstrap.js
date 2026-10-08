// SPDX-License-Identifier: MIT
// Shared-LLM boot/reseed helpers used by BOTH the boot seed and factory reset (the port of
// justvoice/llm_bootstrap.py).
//
// JV's SQLite file carries TWO seed sets — its own (effect presets) and the shared stack's
// (prompt rows, presets, providers, runner settings). A factory reset deletes the file, so
// the shared half must be re-wired and re-seeded too (the family's dual-table reset lesson):
// storage re-pointed at the NEW handle, tables re-created, then the shared seed.
//
// (`apply_jv_warm_default`, the 2026-08-05 warm-OFF stopgap, RETIRED 2026-08-13 with the
// VRAM wiring: the kit's family default (warm ON) reaches fresh JV databases. Seeds-only
// rule: an existing DB keeps its stored value until the user resets or flips it.)

import * as llmDb from "@delebash/llm-runner/llm/db";
import * as llmSeed from "@delebash/llm-runner/llm/seed";
import { getLogger } from "@delebash/llm-runner/platform/log";
import * as self from "./llm_bootstrap.js";

const log = getLogger("justvoice.llm_bootstrap");

// The shared DEFAULT_CATALOG ids JV retired (user direction 2026-08-05: the catalog shows the
// family's measured daily driver and nothing else — AMENDED 2026-08-06: the 12B and E4B rungs
// returned and live in JV_MODEL_CATALOG). Existing DBs seeded the rest before the
// suppression; the one-time cleanup removes exactly this list — a user-ADDED row has a
// different id and is never touched. Downloaded GGUFs stay on disk.
export const _RETIRED_DEFAULT_CATALOG_IDS = [
  "llama-3.3-70b-q4_k_m",
  "glm-4.5-air",
  "qwen3.6-27b",
  "gryphe-styletune-v2",
  "gemma-4-26b-a4b-uncensored-ez",
  "qwen3-embedding-4b",
  "qwen3-embedding-8b",
  "kalm-embedding-gemma3-12b",
];

/**
 * Once, marker-guarded: drop the retired shared-default catalog rows (and their soft-ref
 * sampler/embed-template children) from an existing DB, so an upgraded install shows the same
 * catalog as a fresh one. A cleanup nicety — never boot-fatal.
 */
export function retireDefaultCatalogRows() {
  try {
    const h = llmDb.session();
    if (h.get("runner_setting", "jv_default_catalog_retired")) return;
    let removed = 0;
    // Python's one flush: the marker INSERT, then the DELETEs (children before their row).
    h.tx(() => {
      h.insert("runner_setting", { key: "jv_default_catalog_retired", value: "1" });
      for (const mid of _RETIRED_DEFAULT_CATALOG_IDS) {
        h.delete("model_samplers", { model_id: mid });
        h.delete("model_embed_templates", { model_id: mid });
        removed += h.delete("model_catalog", { id: mid }).changes;
      }
    });
    if (removed) log.info(`retired ${removed} shared-default catalog row(s)`);
  } catch (e) {
    log.warning(`default-catalog retirement failed (rows remain visible): ${e?.message ?? e}`);
  }
}

// (The 2026-08-06 attribution one-time fixup migrations were REMOVED in the tier-debris
// cleanup, 2026-08-07: each fixed only pre-restore DBs, which the reset rule makes extinct.)

/**
 * Factory-reset's shared-stack half: re-point storage at the NEW handle, re-create the shared
 * tables in the fresh file, re-run the shared seed (the family's warm-ON default included).
 * Router mounts are untouched — they read through the store accessors, which follow the
 * re-configured storage. (Python took an engine and a session factory; here both are the
 * one handle.)
 */
export function reseedSharedLlm(handle) {
  llmDb.configureStorage(handle);
  llmDb.createAll(handle);
  llmSeed.seedLlm();
  self.retireDefaultCatalogRows();
}
