// SPDX-License-Identifier: MIT
// /v1/voices/{id}/bundle.zip + /v1/voices/bundle — voice portability (C4) (the port of
// justvoice/api/voice_bundle_api.py).
//
// Its own file, apart from voices_api.js (a 2026-08-21 split). Voices calls both since
// 2026-10-05: ⋯ → Export on a voice you made, ⤒ Import voice… in the toolbar.

import { readFileSync } from "node:fs";
import { Hono } from "@delebash/core/platform";
import { attachment } from "@delebash/core/platform/server";
import { ValueError } from "@delebash/core/platform/py";
import { getState } from "../app_state.js";
import * as modelCatalog from "../engines/model_catalog.js";
import { badRequest, notFound } from "../errors.js";
import { construct, Voice } from "../models.js";
import { buildBundle, importBundle, LookupError } from "../voice_bundle.js";
import * as captures from "./captures_api.js";

export function router() {
  const app = new Hono();

  /** Export a voice as one file. */
  app.get("/v1/voices/:voice_id/bundle.zip", (c) => {
    const st = getState();
    let payload;
    let filename;
    try {
      [payload, filename] = buildBundle(st.voices, c.req.param("voice_id"));
    } catch (e) {
      if (e instanceof LookupError) throw notFound(e.message);
      if (e instanceof ValueError) throw badRequest(e.message);
      throw e;
    }
    return c.body(payload, 200, {
      "content-type": "application/zip",
      // RFC 6266/5987, as every download here: a name outside Latin-1 survives (it was a 500 — a
      // Python bug copied into the port, fixed 2026-11-05 as decided 2026-10-08).
      "content-disposition": attachment(filename),
    });
  });

  /** Import a voice bundle. */
  app.post("/v1/voices/bundle", captures._formSpool, async (c) => {
    const form = await captures._readForm(c);
    const file = captures._requireFile(form, "file");
    const payload = readFileSync(file.path);
    const cap = captures.cfg._MAX_UPLOAD_MB;
    if (payload.length > cap * 1024 * 1024) throw badRequest(`upload exceeds ${cap} MB`);

    const st = getState();
    // manifests() is keyed by engine id.
    const known = new Set(modelCatalog.manifests().keys());
    let rec;
    try {
      rec = importBundle(st.voices, payload, { knownEngines: known });
    } catch (e) {
      if (e instanceof ValueError) throw badRequest(e.message);
      throw e;
    }
    return c.json(
      construct(Voice, {
        id: rec.id,
        engine: rec.engine,
        source: rec.source,
        name: rec.name,
        language: rec.language,
        gender: rec.gender || "",
      }),
      201,
    );
  });
  return app;
}
