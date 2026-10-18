// SPDX-License-Identifier: MIT
// /v1/capture/readiness — speech-recognition + LLM model readiness for dictation (the port of
// justvoice/api/capture_readiness_api.py).
//
// Polled every 5s by useDictationReadiness while either model is missing or downloading; stops
// once both green. Drives the readiness checklist + the hotkey-enabled toggle gating in Settings
// → Captures. Speech recognition is the `asr` engine's model in the speech runtime: ready = the
// model the dictation setting names (`settings.captures.stt_model`) is in the speech cache. It
// loads on first use, so "downloaded" is the gate, not "loaded".

import { Hono } from "@delebash/core/platform";
import { nullable, opt, T } from "@delebash/core/platform/models";
import { getState } from "../app_state.js";
import * as manager from "../engines/manager.js";
import * as modelCatalog from "../engines/model_catalog.js";
import { construct } from "../models.js";
import * as speechCache from "../speech_cache.js";

export const ModelReadiness = T.Object({
  ready: T.Boolean(),
  display_name: T.String(),
  size_mb: opt(nullable(T.Integer()), null),
  downloading: opt(T.Boolean(), false),
  progress: opt(T.Number(), 0.0), // 0..100
  error: opt(nullable(T.String()), null),
});

export const CaptureReadiness = T.Object({ stt: ModelReadiness, llm: ModelReadiness });

/** The dictation recogniser: the one loaded — any recogniser on Speech engines transcribes (the
 * adoption plan's slice 2, E1) — else the setting's Qwen3-ASR model, on disk in the speech cache
 * = ready. */
export function _sttReadiness() {
  try {
    const mgr = manager.getManager();
    const loaded = mgr.loadedFor("stt");
    if (loaded !== null) {
      const vid = mgr.currentVariantId(loaded.manifest.id);
      const v = (loaded.manifest.module?.VARIANTS || []).find((x) => x.id === vid);
      const bytes = (v?.sources || []).reduce((n, s) => n + (s.size_bytes || 0), 0);
      return { ready: true, display_name: v?.name ?? loaded.manifest.name, size_mb: bytes ? Math.floor(bytes / (1024 * 1024)) : null };
    }
  } catch {
    // no manager (bare tests): the setting's model below
  }
  try {
    const st = getState();
    const want = st.settings.get().captures.stt_model;
    const variants = modelCatalog.modelsFor("asr");
    const v = variants.find((x) => x.id === want) ?? (variants.length ? variants[0] : null);
    if (v === null) return { ready: false, display_name: "No speech-recognition model" };
    return { ready: speechCache.variantOnDisk(st.dataDir, "asr", v.id), display_name: v.name, size_mb: v.size_mb || null };
  } catch {
    return { ready: false, display_name: "Speech recognition not set up" }; // not-set-up is a state
  }
}

/**
 * The dictation-cleanup LLM = whatever the refine action resolves to on the SHARED stack (its
 * preset → provider → model). Ready = the route resolves to a model; the LLM engine setup
 * wizard is what fills it.
 */
export async function _llmReadiness() {
  try {
    const { resolveRoute } = await import("@delebash/core/llm/dispatch");
    const { resolveFeaturePreset } = await import("@delebash/core/llm/preset_resolve");
    const { jvLlmConfig } = await import("../engines/llm/run.js");
    const preset = resolveFeaturePreset("refine.base");
    const [, model] = resolveRoute(jvLlmConfig(), "refine", {
      action: "refine.base",
      providerOverride: preset ? preset.providerId || null : null,
      modelOverride: preset ? preset.model || null : null,
    });
    if (model) return { ready: true, display_name: model };
    return { ready: false, display_name: "No AI model selected" };
  } catch {
    return { ready: false, display_name: "AI engine not set up" }; // not-set-up is a state
  }
}

export function router() {
  const app = new Hono();
  app.get("/v1/capture/readiness", async (c) => c.json(construct(CaptureReadiness, { stt: _sttReadiness(), llm: await _llmReadiness() })));
  return app;
}
