// SPDX-License-Identifier: MIT
// The speech engine catalog — every engine JustVoice offers and its models (the port of
// justvoice/engines/model_catalog.py).
//
// Each engine's module (built from audio.cpp's own files, engines/audiocpp/generated.js, with our
// notes per family in audiocpp/curated/) carries its metadata, capabilities, terms and facts-only
// `VARIANTS` rows — id, name, languages, per-variant capabilities (cloning first-class), weights
// license, and pinned `sources` (repo + revision + verified file list + real summed bytes). This
// module wraps each one (`EngineManifest`), projects its rows onto the wire shape
// (`ModelVariant`), and answers which version an engine speaks by default. The kit's audio.cpp
// runtime downloads, loads and runs the models (round E — docs/plans/2026-10-29-round-e-onto-the-
// kit.md; until then engines/manager.js held this catalog beside its own runtime).
// A variant's footprint is MEASURED at load time; before that, audio.cpp's estimate or its files.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { getLogger } from "@delebash/core/platform/log";
import { floorDiv, pyInt, RuntimeError } from "@delebash/core/platform/py";
import * as appState from "../app_state.js";
import { ApiError } from "../errors.js";
import { construct, ModelVariant } from "../models.js";
import * as generated from "./audiocpp/generated.js";
import * as kitSpeech from "./audiocpp/kit_speech.js";
import * as slot from "./audiocpp/slot.js";
import * as self from "./model_catalog.js";

const log = getLogger("justvoice.engines.model_catalog");

export const ENGINES_DIR = path.dirname(fileURLToPath(import.meta.url));

const has = (o, k) => o != null && Object.hasOwn(o, k);
const attr = (o, k, d) => (has(o, k) ? o[k] : d);

/** Normalised OS string used by manifests' SUPPORTED_OSES lists. */
export function currentOsLabel() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

/** Lightweight wrapper around an engine's manifest module. */
export class EngineManifest {
  constructor(engineDir, module) {
    this.engineDir = engineDir;
    this.module = module;
  }

  get id() {
    return attr(this.module, "ID", path.basename(this.engineDir));
  }

  get name() {
    return attr(this.module, "NAME", this.id);
  }

  get description() {
    return attr(this.module, "DESCRIPTION", "");
  }

  get license() {
    return attr(this.module, "LICENSE", "");
  }

  /** Model-weights license — distinct from the framework code license; LICENSE when unset. */
  get weightsLicense() {
    return attr(this.module, "WEIGHTS_LICENSE", "") || attr(this.module, "LICENSE", "");
  }

  /** The engine's primary kind (tts / stt). */
  get kind() {
    return this.kinds[0];
  }

  /** Multi-capability engines declare KINDS = ["tts", "stt"]; single-capability manifests
   * keep KIND. Always non-empty; kinds[0] is the primary. */
  get kinds() {
    const ks = attr(this.module, "KINDS", null);
    if (Array.isArray(ks) && ks.length) return ks.map(String);
    return [attr(this.module, "KIND", "tts")];
  }

  get capabilities() {
    return attr(this.module, "CAPABILITIES", {});
  }

  get requirements() {
    return attr(this.module, "REQUIREMENTS", {});
  }

  /** Voices the engine ships statically — exposed to the host catalog even when the engine
   * isn't loaded. Cloning-based engines leave this empty. */
  get staticVoices() {
    return attr(this.module, "STATIC_VOICES", []);
  }

  /** The model variant a no-variant choice speaks (the user's Set-as-default choice is layered
   * over it by `resolvedDefaultVariant`). */
  get defaultVariantId() {
    return attr(this.module, "DEFAULT_VARIANT_ID", null);
  }

  /** Always "audiocpp": every engine's models run in the one shared speech runtime. The UI
   * reads it to show the runtime row instead of a per-engine Install. */
  get isolation() {
    return "audiocpp";
  }

  /** OSes this engine can run on: "windows" | "linux" | "macos". The catalog still LISTS a
   * blocked engine; `supported_on_this_os` carries the verdict. */
  get supportedOses() {
    return attr(this.module, "SUPPORTED_OSES", ["windows", "linux", "macos"]);
  }

  /** Non-empty = marked for removal; the string is the user-facing why. */
  get deprecated() {
    return attr(this.module, "DEPRECATED", "") || "";
  }

  supportsCurrentOs() {
    return this.supportedOses.includes(self.currentOsLabel());
  }
}

/** Every engine — id → EngineManifest (a Map): each built from audio.cpp's own files
 * (audiocpp/generated.js), the seven described by our own files first (the adoption plan's slice 4;
 * until then each was a hand-written `engines/<id>/manifest.js` this scanned for). Each wraps its
 * engine module, the same object every discovery, so a test may patch it (DEPRECATED,
 * SUPPORTED_OSES). */
export function discoverEngines() {
  const out = new Map();
  for (const [id, mod] of generated.generatedEngines()) out.set(id, new EngineManifest(path.join(ENGINES_DIR, id), mod));
  log.info(`discovered ${out.size} engines from audio.cpp's model specs and our notes`);
  return out;
}

/** The catalog, discovered once (`refreshManifests` discovers it again). */
export const cfg = { manifests: null };

export function refreshManifests() {
  cfg.manifests = self.discoverEngines();
}

/** id → EngineManifest (a copy of the Map). */
export function manifests() {
  if (cfg.manifests === null) self.refreshManifests();
  return new Map(cfg.manifests);
}

export function getManifest(engineId) {
  if (cfg.manifests === null) self.refreshManifests();
  return cfg.manifests.get(engineId) ?? null;
}

// ─── Terms ───────────────────────────────────────────────────────────────────

/** An engine refused a use its own terms gate until the user accepts them (manifest TERMS —
 * Pocket TTS cloning, decided 2026-10-02; every licence that gates downloads, 2026-10-11). The API
 * answers 403 with `code: terms_required` and the engine id, so the app can show the terms. */
export class TermsRequired extends RuntimeError {
  constructor(engineId, message) {
    super(message);
    this.name = "TermsRequired";
    this.engineId = engineId;
  }

  /** The 403 problem the app keys on: type `…/terms-required`, plus the engine. */
  apiError() {
    return new ApiError(403, "terms-required", "Terms not accepted", this.message, { engine: this.engineId });
  }
}

/** A licence that gates downloads (manifest TERMS with `gates: "download"` — every generated
 * engine whose commercial use isn't a plain "Yes", decided 2026-10-11) must be accepted once
 * before the first model file is fetched (the kit asks before each download — kit_hooks.js
 * `beforeDownload`). */
export function requireDownloadTerms(manifest) {
  const terms = manifest?.module?.TERMS;
  if (!terms || terms.gates !== "download" || slot.termsAccepted(manifest.id)) return;
  throw new TermsRequired(manifest.id, `Accept ${manifest.name}'s licence before downloading its models.`);
}

// ─── Versions ────────────────────────────────────────────────────────────────

/** The engine's manifest rows visible on this OS (others import it as Python did `_variant_rows`). */
export function _variantRows(engineId) {
  const m = self.getManifest(engineId);
  const rows = m ? m.module.VARIANTS : null;
  // A row may gate itself by OS ("oses": [...]) — no key = visible everywhere. Filtering at
  // THIS door covers modelsFor, sourcesFor and the default-variant picker in one place.
  const here = self.currentOsLabel();
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
        languages_note: r.languages_note || "",
        // audio.cpp's minimum graphics memory, for every model built from its files — the seven
        // engines described by our own files too since the adoption plan's slice 4 (the build's
        // answer 3, decided 2026-10-15; measured at load only, before — the 2026-08-14 ruling).
        min_vram_gb: r.audiocpp?.generated ? (r.min_vram_gb ?? null) : null,
        // What it needs before a load measures it: that estimate or its download, whichever is
        // more (decided 2026-10-12).
        need_gb: generated.needOf(r)?.gb ?? null,
      }),
    );
  }
  return out;
}

/** The operator's own default-model choice for this engine (Set as default). "" without
 * app state. */
export function userDefaultVariant(engineId) {
  try {
    const ov = appState.getState().settings.get().engines.engine_overrides[engineId];
    return ov ? ov.default_variant || "" : "";
  } catch {
    return "";
  }
}

/** The variant id a no-variant choice of this engine resolves to: the USER's default → manifest
 * DEFAULT_VARIANT_ID → sole catalog variant → the first variant already downloaded (the kit's
 * models cache) → the first catalog variant. "" for an engine the catalog doesn't have. */
export function resolvedDefaultVariant(engineId) {
  const m = self.getManifest(engineId);
  if (!m) return "";
  const user = self.userDefaultVariant(m.id);
  if (user) return user;
  if (m.defaultVariantId) return m.defaultVariantId;
  let variants;
  try {
    variants = self.modelsFor(m.id);
  } catch {
    return ""; // a manifest without a module (a test's)
  }
  if (!variants.length) return "";
  if (variants.length > 1) for (const v of variants) if (kitSpeech.onDisk(v.id)) return v.id;
  return variants[0].id;
}
