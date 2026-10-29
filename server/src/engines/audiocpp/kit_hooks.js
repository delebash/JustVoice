// SPDX-License-Identifier: MIT
// JustVoice's hooks on the kit's audio.cpp runtime — `installLlm({ runtimeSpeech: { audiocpp } })`
// (round E, docs/plans/2026-10-29-round-e-onto-the-kit.md §3.3, §4 step 1). The kit loads, places,
// books and runs our models (runner/runtime_service.js, runner/speech_placement.js); what stays ours,
// each read from the model's kit row (kit_models.js — its id is our model version's):
//   - `warm`: a load's warm-up, a full-length piece when it calibrates (slot.js `warmModel`);
//   - `pieceLength`: the piece length a line reaches the model in, which its price is measured at —
//     the user's own for the model, else the catalog's, under `generation.max_chunk_chars` (800);
//   - `loadOptionsKey`: the load-option set its price is kept under (runtime_options.js);
//   - `sessionOptions`: the load options the user saved for it, registered by every load;
//   - `transcribe`: a transcription's request and time limit;
//   - `beforeDownload`: the licence the user accepts before its first download.

import { stores } from "@delebash/core/llm";
import { pyInt } from "@delebash/core/platform/py";
import { DEFAULT_AUDIOCPP_SETTINGS } from "@delebash/core/runner/config";
import * as appState from "../../app_state.js";
import { DEFAULT_MAX_CHUNK_CHARS } from "../../audio/chunked.js";
import * as manager from "../manager.js";
import { RUNTIME, variantOf } from "./kit_models.js";
import * as runtimeOptions from "./runtime_options.js";
import * as slot from "./slot.js";

/** The model version a kit row is (`{engineId, mod, row}`), or an error naming it. */
function versionOf(row) {
  const v = variantOf(row.id);
  if (v === null) throw new Error(`no speech model "${row.id}" in JustVoice's catalog`);
  return v;
}

function settings() {
  try {
    return appState.getState().settings.get();
  } catch {
    return null; // no app state (a bare test, a script): the defaults
  }
}

/** The piece length a line reaches the model in — and the one its price is measured at: the
 * user's own for it (`engine_overrides[engine].split_chars`), else the catalog's (`split_chars`),
 * under the cap every line is split at (`generation.max_chunk_chars`, 800). */
export function pieceLength(row) {
  const { engineId, row: version } = versionOf(row);
  const s = settings();
  const cap = pyInt(s?.generation?.max_chunk_chars || DEFAULT_MAX_CHUNK_CHARS);
  const mine = pyInt(s?.engines?.engine_overrides?.[engineId]?.split_chars?.[version.id] || 0);
  const split = mine > 0 ? mine : version.split_chars ? pyInt(version.split_chars) : null;
  return split ? Math.min(cap, split) : cap;
}

/** The load-option set the model's price is kept under: "" for the default set, else
 * "key=value;…" (decided 2026-10-15: a price per load-option set). */
export function loadOptionsKey(row) {
  const { engineId, row: version } = versionOf(row);
  return runtimeOptions.priceKeyFor(engineId, version);
}

/** The load options the user saved for the model, as every load registers them (those other than
 * audio.cpp's own defaults). */
export function sessionOptions(row) {
  const { engineId, row: version } = versionOf(row);
  return runtimeOptions.sessionOptionsFor(engineId, version);
}

/** The licence a model's engine gates its downloads with (every engine whose commercial use isn't a
 * plain "Yes", decided 2026-10-11), accepted once: throws `TermsRequired` until it is — the kit
 * answers 403 terms-required and nothing downloads. At once: the settings are read in memory. */
export function beforeDownload(row) {
  const { engineId, mod } = versionOf(row);
  manager.requireDownloadTerms({ id: engineId, name: mod.NAME, module: mod });
}

/** A load's warm-up on `server` (the kit's AudioCppServer holding the model): a full-length piece —
 * the piece length its price is measured at — when it `calibrate`s. → whether it calibrated. */
export async function warm({ server, row, calibrate }) {
  const { row: version } = versionOf(row);
  return slot.warmModel(server, version, row.kind, calibrate ? pieceLength(row) : 0);
}

/** One request's limit on the kit's audio.cpp runtime (its `request_timeout_s` setting), seconds. */
function requestTimeoutS() {
  const v = Number(stores.getRunnerConfigStore().getRuntimeConfig(RUNTIME).settings?.request_timeout_s);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_AUDIOCPP_SETTINGS.request_timeout_s;
}

/** A transcription of `body` (`{audio_path, language}`) on a recogniser's row: `{body, timeout}` —
 * the request as the model takes it (slot.js `transcribeRequest`: the language named its way) and
 * its time limit, the runtime's request limit or three times the recording. The recording goes as
 * it is: a recogniser that takes only 16 kHz (OWSM, CrisperWhisper …) needs the copy slot.js makes
 * for its own request, which this hook can't remove once the kit has sent it (round E's open item). */
export async function transcribe(body, row) {
  const { row: version } = versionOf(row);
  const audio = String(body?.audio_path ?? "").replaceAll("\\", "/");
  return { body: slot.transcribeRequest(version, body, audio), timeout: slot._transcribeTimeout(audio, requestTimeoutS()) };
}

/** Every hook, as `installLlm`'s `runtimeSpeech.audiocpp`. */
export const SPEECH_HOOKS = Object.freeze({ warm, pieceLength, loadOptionsKey, sessionOptions, transcribe, beforeDownload });
