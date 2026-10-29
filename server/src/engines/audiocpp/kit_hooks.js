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
//   - `transcribe`: a transcription's request and time limit — its recording at 16 kHz for a
//     recogniser that takes nothing else;
//   - `beforeDownload`: the licence the user accepts before its first download.

import { pyInt } from "@delebash/core/platform/py";
import * as appState from "../../app_state.js";
import { DEFAULT_MAX_CHUNK_CHARS } from "../../audio/chunked.js";
import * as modelCatalog from "../model_catalog.js";
import { variantOf } from "./kit_models.js";
import { runtimeNumber } from "./kit_settings.js";
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

/** The piece length a line reaches `engineId`'s model `version` (its VARIANTS row) in, by
 * `settings` (the app's): the user's own for it (`engine_overrides[engine].split_chars`), else the
 * catalog's (`split_chars`), under the cap every line is split at (`generation.max_chunk_chars`,
 * 800) — a render's pieces (render_core.js `lineSplitChars`) and the kit's price alike. */
export function pieceLengthOf(engineId, version, s) {
  const cap = pyInt(s?.generation?.max_chunk_chars || DEFAULT_MAX_CHUNK_CHARS);
  const mine = pyInt(s?.engines?.engine_overrides?.[engineId]?.split_chars?.[version.id] || 0);
  const split = mine > 0 ? mine : version.split_chars ? pyInt(version.split_chars) : null;
  return split ? Math.min(cap, split) : cap;
}

/** The piece length a line reaches the model in — and the one its price is measured at. */
export function pieceLength(row) {
  const { engineId, row: version } = versionOf(row);
  return pieceLengthOf(engineId, version, settings());
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
  modelCatalog.requireDownloadTerms({ id: engineId, name: mod.NAME, module: mod });
}

/** A load's warm-up on `server` (the kit's AudioCppServer holding the model): a full-length piece —
 * the piece length its price is measured at — when it `calibrate`s. → whether it calibrated. */
export async function warm({ server, row, calibrate }) {
  const { row: version } = versionOf(row);
  return slot.warmModel(server, version, row.kind, calibrate ? pieceLength(row) : 0);
}

/** A transcription of `body` (`{audio_path, language}`) on a recogniser's row: `{body, timeout}` —
 * the request as the model takes it (slot.js `transcribeRequest`: the language named its way), its
 * recording at 16 kHz mono for every recogniser but Qwen3-ASR (slot.js `recognizerInput`, a copy
 * in the cache — the kit runs this hook under the stt kind's lock), and its time limit, the
 * runtime's request limit or three times the recording. */
export async function transcribe(body, row) {
  const { row: version } = versionOf(row);
  const given = String(body?.audio_path ?? "");
  const audio = given && version.audiocpp.family !== "qwen3_asr" ? await slot.recognizerInput(given) : given.replaceAll("\\", "/");
  return { body: slot.transcribeRequest(version, body, audio), timeout: slot._transcribeTimeout(audio, runtimeNumber("request_timeout_s")) };
}

/** Every hook, as `installLlm`'s `runtimeSpeech.audiocpp`. */
export const SPEECH_HOOKS = Object.freeze({ warm, pieceLength, loadOptionsKey, sessionOptions, transcribe, beforeDownload });
