// SPDX-License-Identifier: MIT
// The speech model catalog — a READER over the engine manifests (the port of
// justvoice/engines/model_catalog.py).
//
// Phase ②c of the 2026-08-13 redesign (plan doc §12): each engine's `manifest.js` carries
// facts-only `VARIANTS` rows — id, name, languages, per-variant capabilities (cloning
// first-class), weights license, and pinned `sources` (repo + revision + verified file list +
// real summed bytes). This module projects those rows onto the wire shape (`ModelVariant`).
// No memory numbers live here — a variant's footprint is MEASURED at load time.

import { floorDiv, pyInt, pyMin } from "@delebash/llm-runner/platform/py";
import { construct, ModelVariant } from "../models.js";
import * as manager from "./manager.js";

/** The engine's manifest rows visible on this OS (others import it as Python did `_variant_rows`). */
export function _variantRows(engineId) {
  const m = manager.getManager().getManifest(engineId);
  const rows = m ? m.module.VARIANTS : null;
  // A row may gate itself by OS ("oses": [...]) — no key = visible everywhere. Filtering at
  // THIS door covers modelsFor, sourcesFor and the default-variant picker in one place.
  const here = manager._currentOsLabel();
  return (rows || []).filter((r) => (r.oses && r.oses.length ? r.oses : [here]).includes(here));
}

const firstOf = (sources, key) => {
  for (const s of sources) if (s[key]) return s[key];
  return null;
};

/** The engine's variants as `ModelVariant` wire objects. */
export function modelsFor(engineId) {
  const out = [];
  for (const r of _variantRows(engineId)) {
    const sources = r.sources || [];
    const size = sources.reduce((acc, s) => acc + pyInt(s.size_bytes || 0), 0);
    out.push(
      construct(ModelVariant, {
        id: r.id,
        name: Object.hasOwn(r, "name") ? r.name : r.id,
        description: Object.hasOwn(r, "description") ? r.description : "",
        size_mb: floorDiv(size, 1024 * 1024),
        quality: pyInt(r.quality || 0),
        languages: [...(r.languages || [])],
        voice_cloning: r.voice_cloning ?? null,
        voice_design: r.voice_design ?? null,
        preset_voices: r.preset_voices ?? null,
        weights_license: Object.hasOwn(r, "weights_license") ? r.weights_license : "",
        hf_repo: firstOf(sources, "hf_repo"),
        url: firstOf(sources, "url"),
      }),
    );
  }
  return out;
}

/** The variant's verified source rows — the download spec the sources layer and the
 * speech-cache fetch consume verbatim (multi-source variants keep every row). */
export function sourcesFor(engineId, variantId) {
  for (const r of _variantRows(engineId)) {
    if (r.id === variantId) return (r.sources || []).map((s) => ({ ...s }));
  }
  return [];
}

/** The variant a no-choice install fetches: the manager's resolved default (user override →
 * manifest DEFAULT_VARIANT_ID → on-disk → first), else the smallest download. */
export function defaultVariantFor(engineId) {
  const variants = modelsFor(engineId);
  if (!variants.length) return null;
  try {
    const vid = manager.getManager().resolvedDefaultVariant(engineId);
    const chosen = variants.find((v) => v.id === vid);
    if (chosen !== undefined) return chosen;
  } catch {
    /* no manifest (legacy engine) / bare tests */
  }
  return pyMin(variants, (v) => v.size_mb);
}
