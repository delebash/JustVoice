// SPDX-License-Identifier: MIT
// /v1/align + chapter captions — word-level timestamps (C1, 2026-08-21) (the port of
// justvoice/api/align_api.py).
//
// The route: rendered audio + the KNOWN text → per-word times. The speech-recognition engine's
// word aligner (Qwen3-ForcedAligner, a companion of the `asr` model in the speech runtime)
// times the given words, the host maps them onto the real words (alignment.js — an aligner
// that drops or splits a word never loses its neighbours' timing), and captions.js formats
// the result as WebVTT or SRT. Engine-agnostic by construction — it measures the finished
// audio, so it works identically for every TTS engine.
//
// Accuracy honest-note: a forced aligner is built for this job (it is told the words), but its
// timing is still model output — right for read-along highlighting and captions, not for
// frame-exact editing.

import { readFileSync } from "node:fs";
import { RequestValidationError } from "@delebash/llm-runner/platform/errors";
import { opt, T } from "@delebash/llm-runner/platform/models";
import { RuntimeError, strip } from "@delebash/llm-runner/platform/py";
import { alignKnownText } from "../alignment.js";
import { getState } from "../app_state.js";
import { parseWavHeader } from "../audio/wav.js";
import { toSrt, toVtt } from "../captions.js";
import { badRequest } from "../errors.js";
import * as captures from "./captures_api.js";
import * as renderChapter from "./render_chapter_api.js";

const msg = (e) => e?.message ?? String(e);

/** WAV + known text → [{word, start, end}], via the stt slot. */
export async function _alignWavBytes(wav, text, language) {
  const [mgr, settings] = await captures.ensureSttLoaded();
  const lang = language || settings.captures.language;
  const hyp = await mgr.align({ wav_b64: wav.toString("base64"), text, language: lang === "" || lang === "auto" ? null : lang });
  return alignKnownText(text, hyp, { totalDuration: _wavSeconds(wav) });
}

export function _wavSeconds(wav) {
  try {
    const [fmt] = parseWavHeader(wav);
    return fmt.durationSec;
  } catch {
    return null;
  }
}

export async function router(app) {
  await captures._useForms(app);

  /**
   * Upload audio + the text it speaks → when each word is spoken. Returns
   * {"words": [{word, start, end}]} in seconds, one entry per word of `text`, in order.
   */
  app.post("/v1/align", async (req) => {
    const form = await captures._readForm(req);
    const missing = [];
    if (form.files.file === undefined) missing.push("file");
    const textRaw = form.fields.text;
    if (textRaw === undefined || textRaw === "") missing.push("text");
    if (missing.length) {
      throw new RequestValidationError(missing.map((n) => ({ loc: ["body", n], msg: "Field required", type: "missing" })));
    }
    const language = captures._formField(form, "language", null);
    if (!strip(textRaw)) throw badRequest("text must not be empty — alignment needs the spoken words");
    const wav = readFileSync(form.files.file.path);
    if (wav.length > captures.cfg._MAX_UPLOAD_MB * 1024 * 1024) throw badRequest(`upload exceeds ${captures.cfg._MAX_UPLOAD_MB} MB`);
    let words;
    try {
      words = await _alignWavBytes(wav, strip(textRaw), language);
    } catch (e) {
      if (e instanceof RuntimeError) throw badRequest(msg(e));
      throw e;
    }
    return { words };
  });

  /**
   * Render the chapter (cache-warm lines render instantly), align every word, and return a
   * caption file. `format` is `vtt` or `srt`.
   */
  app.get(
    "/v1/scenes/:scene_id/captions",
    { schema: { querystring: T.Object({ format: opt(T.String(), "vtt") }) } },
    async (req, reply) => {
      const format = req.query.format;
      const sceneId = req.params.scene_id;
      if (format !== "vtt" && format !== "srt") throw badRequest("format must be vtt or srt");
      const st = getState();
      // No blanket catch: the resolver already throws the honest answers (404 for a missing
      // scene, 400 for an empty one).
      const lines = await renderChapter._resolveSceneToLines(sceneId, st, { strict: false });
      // What the audio says: a line that plays its ★ take says the take's words (Studio Slice
      // 4) — a stale take still says the old ones.
      const text = renderChapter
        .playedTexts(lines)
        .filter((t) => strip(t || ""))
        .map((t) => strip(t))
        .join(" ");
      if (!text) throw badRequest("this chapter has no renderable lines to caption");
      const wav = await renderChapter.renderSceneToWav(st, sceneId, { strict: false, master: true });
      let words;
      try {
        words = await _alignWavBytes(wav, text, null);
      } catch (e) {
        if (e instanceof RuntimeError) throw badRequest(msg(e));
        throw e;
      }
      const body = format === "vtt" ? toVtt(words) : toSrt(words);
      return reply
        .type(format === "vtt" ? "text/vtt; charset=utf-8" : "application/x-subrip")
        .header("content-disposition", `attachment; filename="chapter-${sceneId}.${format}"`)
        .send(body);
    },
  );
}
