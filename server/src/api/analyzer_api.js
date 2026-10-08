// SPDX-License-Identifier: MIT
// POST /v1/analyze + /v1/compare — WAV format + loudness + A/B (the port of
// justvoice/api/analyzer_api.py).

import { ValueError } from "@delebash/llm-runner/platform/py";
import * as analyzer from "../audio/analyzer.js";
import { badRequest } from "../errors.js";
import { AnalyzeRequest, CompareRequest } from "../models.js";
import { b64decode } from "../py_compat.js";

const msg = (e) => e?.message ?? String(e);
const isValueError = (e) => e instanceof ValueError;

export async function router(app) {
  app.post("/v1/analyze", { schema: { body: AnalyzeRequest } }, async (req) => {
    let bytes;
    try {
      bytes = b64decode(req.body.wav_b64);
    } catch (e) {
      throw badRequest(`invalid base64: ${msg(e)}`);
    }
    try {
      // The analyzer answers the wire shape itself (a silent clip reads -Infinity, which the
      // JSON answer writes as null — pydantic's inf_nan "null").
      return await analyzer.analyze(bytes);
    } catch (e) {
      if (isValueError(e)) throw badRequest(msg(e));
      throw e;
    }
  });

  app.post("/v1/compare", { schema: { body: CompareRequest } }, async (req) => {
    let a;
    let b;
    try {
      a = b64decode(req.body.a_wav_b64);
      b = b64decode(req.body.b_wav_b64);
    } catch (e) {
      throw badRequest(`invalid base64: ${msg(e)}`);
    }
    let report;
    try {
      report = await analyzer.compare(a, b);
    } catch (e) {
      if (isValueError(e)) throw badRequest(msg(e));
      throw e;
    }
    report.a_label = req.body.a_label;
    report.b_label = req.body.b_label;
    return report;
  });
}
