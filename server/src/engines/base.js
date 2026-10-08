// SPDX-License-Identifier: MIT
// TTS backend protocol + shared types (the port of justvoice/engines/base.py).
//
// Every engine adapter — the cloud TTS providers and the external-OpenAI HTTP wrapper —
// implements the TTSBackend shape below; the registry treats them uniformly. (Managed engines
// run in the speech runtime through engines/manager.js and never sit in the registry.)
// Structurally typed: anything with these members is a backend.
//
// The dataclasses' fields are camelCase here (`voiceId`, `sampleRate`, `engineId`); the
// manager's synth BODY is a plain object with the wire's snake_case keys.

/** A preset voice an engine ships. */
export class PresetVoice {
  constructor({ id, name, language = "en", gender = null, sampleUrl = null }) {
    this.id = id;
    this.name = name;
    this.language = language;
    this.gender = gender;
    this.sampleUrl = sampleUrl;
  }
}

/** One synthesis request to a registry backend. */
export class SynthRequest {
  constructor({
    voiceId,
    text,
    language = null,
    delivery = {},
    seed = null,
    audioPromptPath = null,
    // Reference-clip transcript, for engines whose clone call takes one (Qwen3 Base
    // `ref_text`). null = the engine's no-transcript path.
    refText = null,
    // Clone from the speaker vector alone, ignoring the transcript (Qwen3 Base
    // `x_vector_only_mode`).
    xvectorOnly = false,
    // A blended voice's style vector.
    voiceVector = null,
  }) {
    this.voiceId = voiceId;
    this.text = text;
    this.language = language;
    this.delivery = delivery ?? {};
    this.seed = seed;
    this.audioPromptPath = audioPromptPath;
    this.refText = refText;
    this.xvectorOnly = xvectorOnly;
    this.voiceVector = voiceVector;
  }
}

/** Audio result. `bytes` is either raw 16-bit PCM (`isWavContainer` false — the caller wraps
 * it with sampleRate / channels) or a complete WAV file with its RIFF header (true). */
export class SynthOutput {
  constructor({ bytes, sampleRate, channels = 1, isWavContainer = false }) {
    this.bytes = bytes;
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.isWavContainer = isWavContainer;
  }
}

/** Static metadata an adapter exposes for the catalog. */
export class EngineMeta {
  constructor({
    engineId,
    displayName,
    backend,
    supportedRuntimes,
    // Engines split into disjoint kinds so the manager keeps one slot per kind loaded at once.
    kind = "tts", // "tts" | "llm" | "embedding"
    supportsCloning = false,
    supportsStreaming = false,
    supportsParalinguisticTags = false,
    supportsVoiceDesign = false,
    supportsInstructField = false,
    // The provider takes a speed itself; without it the server time-stretches the finished
    // line (switch plan §5, gap 8).
    supportsSpeed = false,
  }) {
    this.engineId = engineId;
    this.displayName = displayName;
    this.backend = backend;
    this.supportedRuntimes = supportedRuntimes;
    this.kind = kind;
    this.supportsCloning = supportsCloning;
    this.supportsStreaming = supportsStreaming;
    this.supportsParalinguisticTags = supportsParalinguisticTags;
    this.supportsVoiceDesign = supportsVoiceDesign;
    this.supportsInstructField = supportsInstructField;
    this.supportsSpeed = supportsSpeed;
  }
}

/**
 * The contract every engine adapter satisfies (Python's `TTSBackend` Protocol):
 *
 *   meta: EngineMeta
 *   async load(device = "auto", modelVariant = null)
 *   unload()                       — sync or async; callers await it
 *   ready(): boolean
 *   voices(): PresetVoice[]        — sync or async; callers await it
 *   async synthesize(req: SynthRequest): SynthOutput
 *
 * Retired 2026-08-19, all with zero implementations: get_embedding / synthesize_with_embedding
 * (blending is HOST-side file math — engines/blending.js) and train_start / train_cancel
 * (voice training was removed on 2026-10-02).
 */
export const TTSBackend = Object.freeze({
  members: ["meta", "load", "unload", "ready", "voices", "synthesize"],
  /** Python's runtime_checkable isinstance: does `x` have every member? */
  isInstance(x) {
    return x != null && this.members.every((m) => m in x);
  },
});
