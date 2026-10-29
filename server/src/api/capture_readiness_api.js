// SPDX-License-Identifier: MIT
// /v1/capture/readiness — speech-recognition + LLM model readiness for dictation (the port of
// justvoice/api/capture_readiness_api.py).
//
// Polled every 5s by useDictationReadiness while either model is missing or downloading; stops
// once both green. Drives the readiness checklist + the hotkey-enabled toggle gating in Settings
// → Captures. Speech recognition is the Transcription feature's model (its preset, on the kit's
// audio.cpp runtime): ready = the kit's readiness for the feature (llm/speech_dispatch.js
// `speechFeatureReadiness` — the runtime installed, the model downloaded; round E,
// docs/plans/2026-10-29-round-e-onto-the-kit.md §4 step 3). It loads on first use, so "downloaded"
// is the gate, not "loaded".

import { Hono } from "@delebash/core/platform";
import { nullable, opt, T } from "@delebash/core/platform/models";
import { variantOf } from "../engines/audiocpp/kit_models.js";
import * as kitSpeech from "../engines/audiocpp/kit_speech.js";
import { construct } from "../models.js";

export const ModelReadiness = T.Object({
  ready: T.Boolean(),
  display_name: T.String(),
  size_mb: opt(nullable(T.Integer()), null),
  downloading: opt(T.Boolean(), false),
  progress: opt(T.Number(), 0.0), // 0..100
  error: opt(nullable(T.String()), null),
});

export const CaptureReadiness = T.Object({ stt: ModelReadiness, llm: ModelReadiness });

/** The dictation recogniser: the Transcription feature's model, ready once the runtime is
 * installed and the model downloaded — with its download's progress while it downloads. */
export function _sttReadiness() {
  let r;
  try {
    r = kitSpeech.transcriptionReadiness();
  } catch {
    return { ready: false, display_name: "Speech recognition not set up" }; // not-set-up is a state
  }
  if (!r.model) return { ready: false, display_name: "No speech-recognition model" };
  const m = r.modelState;
  const bytes = Number(m?.bytes || 0);
  return {
    ready: Boolean(r.ready),
    display_name: m?.name ?? variantOf(r.model)?.row?.name ?? r.model,
    size_mb: bytes ? Math.floor(bytes / (1024 * 1024)) : null,
    downloading: m?.status === "downloading",
    progress: m?.status === "downloading" && Number(m.total) > 0 ? (100 * Number(m.downloaded || 0)) / Number(m.total) : 0.0,
    error: m?.error || null,
  };
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
