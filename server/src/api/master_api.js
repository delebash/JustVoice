// SPDX-License-Identifier: MIT
// POST /v1/master — apply a mastering preset to an uploaded WAV (the port of
// justvoice/api/master_api.py).

import { nullable, opt, T } from "@delebash/llm-runner/platform/models";
import { b64decode, ValueError } from "@delebash/llm-runner/platform/py";
import { getState } from "../app_state.js";
import { parseWavHeader } from "../audio/wav.js";
import { badRequest, serviceUnavailable } from "../errors.js";
import * as mastering from "../mastering.js";

export const MasterRequest = T.Object({
  wav_b64: T.String(),
  preset: T.String(), // acx | inaudio | podcast | youtube
  title: opt(nullable(T.String()), null),
  author: opt(nullable(T.String()), null),
  book: opt(nullable(T.String()), null),
});

const msg = (e) => e?.message ?? String(e);

// The YouTube preset encodes MP3 (`MasterPresetSettings.youtube`); this said audio/aac until
// 2026-10-06.
const MEDIA = { acx: "audio/mpeg", inaudio: "audio/mpeg", podcast: "audio/mpeg", youtube: "audio/mpeg" };

export async function router(app) {
  app.post("/v1/master", { schema: { body: MasterRequest } }, async (req, reply) => {
    const body = req.body;
    let buf;
    try {
      buf = b64decode(body.wav_b64);
    } catch (e) {
      throw badRequest(`invalid base64: ${msg(e)}`);
    }

    if (!mastering.haveFfmpeg()) {
      throw serviceUnavailable("ffmpeg not installed. Install ffmpeg + restart to use mastering.");
    }

    let fmt;
    let dataOff;
    let dataSize;
    try {
      [fmt, dataOff, dataSize] = parseWavHeader(buf);
    } catch (e) {
      if (!(e instanceof ValueError)) throw e;
      throw badRequest(msg(e));
    }

    const pcm = buf.subarray(dataOff, dataOff + dataSize);
    const settings = getState().settings.get();
    let mastered;
    try {
      mastered = await mastering.master(pcm, fmt.sampleRate, fmt.channels, {
        presetName: body.preset,
        presets: settings.mastering,
        title: body.title,
        author: body.author,
        book: body.book,
      });
    } catch (e) {
      throw badRequest(`mastering: ${msg(e)}`);
    }
    return reply.type(Object.hasOwn(MEDIA, body.preset) ? MEDIA[body.preset] : "audio/wav").send(mastered);
  });
}
