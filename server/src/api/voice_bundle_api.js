// SPDX-License-Identifier: MIT
// /v1/voices/{id}/bundle.zip + /v1/voices/bundle — voice portability (C4) (the port of
// justvoice/api/voice_bundle_api.py).
//
// Its own file, apart from voices_api.js (a 2026-08-21 split). Voices calls both since
// 2026-10-05: ⋯ → Export on a voice you made, ⤒ Import voice… in the toolbar.

import { readFileSync } from "node:fs";
import { ValueError } from "@delebash/llm-runner/platform/py";
import { getState } from "../app_state.js";
import * as manager from "../engines/manager.js";
import { badRequest, notFound } from "../errors.js";
import { construct, Voice } from "../models.js";
import { buildBundle, importBundle, LookupError } from "../voice_bundle.js";
import * as captures from "./captures_api.js";

/**
 * A header value as Starlette writes it: latin-1, and a character past it is Python's
 * UnicodeEncodeError — a 500 through the app's catch-all, with Python's own words. (Python bug
 * kept on purpose until the whole-server comparison: a voice named in Japanese can't be
 * exported. The kit's `attachment()` is the fix, as JustWrite's export took it.)
 */
export function latin1Header(value) {
  const chars = [...value];
  let pos = 0;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i].codePointAt(0) <= 0xff) {
      pos += 1;
      continue;
    }
    let j = i;
    while (j + 1 < chars.length && chars[j + 1].codePointAt(0) > 0xff) j += 1;
    const err = new Error(
      j === i
        ? `'latin-1' codec can't encode character '${escapeChar(chars[i])}' in position ${pos}: ordinal not in range(256)`
        : `'latin-1' codec can't encode characters in position ${pos}-${pos + (j - i)}: ordinal not in range(256)`,
    );
    err.name = "UnicodeEncodeError";
    throw err;
  }
  return value;
}

function escapeChar(ch) {
  const c = ch.codePointAt(0);
  return c > 0xffff ? `\\U${c.toString(16).padStart(8, "0")}` : `\\u${c.toString(16).padStart(4, "0")}`;
}

export async function router(app) {
  await captures._useForms(app);

  /** Export a voice as one file. */
  app.get("/v1/voices/:voice_id/bundle.zip", async (req, reply) => {
    const st = getState();
    let payload;
    let filename;
    try {
      [payload, filename] = buildBundle(st.voices, req.params.voice_id);
    } catch (e) {
      if (e instanceof LookupError) throw notFound(e.message);
      if (e instanceof ValueError) throw badRequest(e.message);
      throw e;
    }
    return reply
      .type("application/zip")
      .header("content-disposition", latin1Header(`attachment; filename="${filename}"`))
      .send(payload);
  });

  /** Import a voice bundle. */
  app.post("/v1/voices/bundle", async (req, reply) => {
    const form = await captures._readForm(req);
    const file = captures._requireFile(form, "file");
    const payload = readFileSync(file.path);
    const cap = captures.cfg._MAX_UPLOAD_MB;
    if (payload.length > cap * 1024 * 1024) throw badRequest(`upload exceeds ${cap} MB`);

    const st = getState();
    // manifests() is keyed by engine id.
    const known = new Set(manager.getManager().manifests().keys());
    let rec;
    try {
      rec = importBundle(st.voices, payload, { knownEngines: known });
    } catch (e) {
      if (e instanceof ValueError) throw badRequest(e.message);
      throw e;
    }
    reply.code(201);
    return construct(Voice, {
      id: rec.id,
      engine: rec.engine,
      source: rec.source,
      name: rec.name,
      language: rec.language,
      gender: rec.gender || "",
    });
  });
}
