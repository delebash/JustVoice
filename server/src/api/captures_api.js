// SPDX-License-Identifier: MIT
// Captures — dictation recordings and their transcription (the port of
// justvoice/api/captures_api.py).
//
// PARTIAL — the extraction/imports/MCP wave (wave D) ported only what the MCP server's
// `justvoice.transcribe` reads: the upload cap and the speech-recognition door
// (`ensureSttLoaded`, `_sttTranscribe`). The API wave fills in the rest of this file (the
// /v1/captures routes, `_maybeRefine`, the row models) under the same names.

import { getLogger } from "@delebash/llm-runner/platform/log";
import { getState } from "../app_state.js";
import { badRequest } from "../errors.js";

const log = getLogger("justvoice.api.captures_api");

export const _MAX_UPLOAD_MB = 200;

/** The stt slot's manager (and the settings), with speech recognition auto-loaded on first use.
 * Shared by transcription and word alignment — one loading rule. → `[manager, settings]`. */
export async function ensureSttLoaded() {
  const { getManager } = await import("../engines/manager.js");
  const mgr = getManager();
  const settings = getState().settings.get();
  if (mgr.loadedFor("stt") === null) {
    const status = mgr.status("asr");
    if (status === "installed") {
      log.info(`captures: auto-loading speech recognition (${settings.captures.stt_model}) on first use`);
      await mgr.load("asr", { device: "auto", variant: settings.captures.stt_model });
    } else {
      throw badRequest(`Speech recognition is ${status} — install the speech runtime on the AI page first`);
    }
  }
  return [mgr, settings];
}

/** Transcribe via the stt-slot engine; auto-load speech recognition if installed. What
 * dictation, MCP and the /v1/transcribe door share. */
export async function _sttTranscribe(audioPath, language) {
  const [mgr, settings] = await ensureSttLoaded();
  const lang = language || settings.captures.language;
  return mgr.transcribe({ audio_path: audioPath, language: lang === "" || lang === "auto" ? null : lang });
}
