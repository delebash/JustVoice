// SPDX-License-Identifier: MIT
// /v1/projects/{id}/export — per-project ZIP for machine migration + handoff (the port of
// justvoice/api/project_export_api.py).
//
// Different from /v1/data/backup (whole-server disaster recovery): export bundles a single
// project's data (Scenes + Blocks + Speakers + the Personas that play them + Lexicons + each
// line's take in use) so a producer can hand off a book to an author for review or move it
// between studio + travel laptops. Mastered chapters are Export's "⬇ Chapter WAVs (zip)"
// (`export_jobs_api.js`); the `include_masters` option here wrote nothing and went on
// 2026-10-07.
//
// The archive is the kit's ZIP (platform/zip.js — CPython 3.12's zipfile, deflated).

import { statSync } from "node:fs";
import { Hono, input } from "@delebash/llm-runner/platform";
import { opt, T } from "@delebash/llm-runner/platform/models";
import { strip } from "@delebash/llm-runner/platform/py";
import { jsonLoads, pyJson } from "@delebash/llm-runner/platform/pyjson";
import { ZipWriter } from "@delebash/llm-runner/platform/zip";
import { Block, Generation, Lexicon, LexiconEntry, Persona, Project, Scene, Speaker, Take } from "../database/models.js";
import * as session from "../database/session.js";
import { notFound } from "../errors.js";
import { mediaFile } from "../media_paths.js";
import { dtIso, utcNow } from "../models.js";
import { VERSION } from "../version.js";

/** `re.sub(r"[^a-zA-Z0-9-_]+", "-", name).strip("-").lower() or "project"`. */
export function _slugify(name) {
  const s = strip(name.replace(/[^a-zA-Z0-9\-_]+/g, "-"), "-");
  return s.toLowerCase() || "project";
}

/** `format(n, "03d")` / `"04d"` (a negative keeps its sign inside the width, as Python). */
const zpad = (n, w) => (n < 0 ? `-${String(-n).padStart(w - 1, "0")}` : String(n).padStart(w, "0"));

const dump = (v) => pyJson(v, { indent: 2 });
const isFile = (p) => statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;
const marks = (n) => Array.from({ length: n }, () => "?").join(", ");

/** `datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")`. */
function stampNow() {
  const iso = new Date().toISOString(); // 2026-10-08T12:34:56.789Z
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

export function router() {
  const app = new Hono();
  app.get("/v1/projects/:project_id/export", input({ querystring: T.Object({ include_audio: opt(T.Boolean(), true) }) }), async (c) => {
    const h = session.getDb();
    const projectId = c.req.param("project_id");
    const includeAudio = c.req.valid("query").include_audio;
    const project = h.one(`select * from ${Project} where id = ? limit 1`, [projectId], Project);
    if (!project) throw notFound(`project ${projectId}`);

    const scenes = h.all(`select * from ${Scene} where project_id = ? order by position`, [projectId], Scene);
    const speakers = h.all(`select * from ${Speaker} where project_id = ?`, [projectId], Speaker);
    const personaIds = [...new Set(speakers.filter((s) => s.persona_id).map((s) => s.persona_id))].sort();
    const personas = personaIds.length ? h.all(`select * from ${Persona} where id in (${marks(personaIds.length)})`, personaIds, Persona) : [];
    const lexiconIds = [...new Set([project.default_lexicon_id, ...personas.map((p) => p.lexicon_id)])].filter((x) => x != null);
    const lexicons = lexiconIds.length ? h.all(`select * from ${Lexicon} where id in (${marks(lexiconIds.length)})`, lexiconIds, Lexicon) : [];
    const blocksOf = (sceneId) => h.all(`select * from ${Block} where scene_id = ? order by position`, [sceneId], Block);

    const zf = new ZipWriter();
    // project.json
    zf.writestr(
      "project.json",
      dump({
        id: project.id,
        name: project.name,
        description: project.description,
        project_type: project.project_type,
        metadata: jsonLoads(project.metadata_json || "{}"),
        mastering_preset: project.mastering_preset,
        default_lexicon_id: project.default_lexicon_id,
        scene_count: scenes.length,
      }),
    );

    // scenes/*.json with embedded blocks
    for (const scene of scenes) {
      const payload = {
        id: scene.id,
        position: scene.position,
        title: scene.title,
        description: scene.description,
        metadata: jsonLoads(scene.metadata_json || "{}"),
        blocks: blocksOf(scene.id).map((b) => ({
          id: b.id,
          position: b.position,
          text: b.text,
          speaker_id: b.speaker_id,
          direction: b.direction,
          metadata: jsonLoads(b.metadata_json || "{}"),
        })),
      };
      zf.writestr(`scenes/${zpad(scene.position, 3)}-${_slugify(scene.title || scene.id)}.json`, dump(payload));
    }

    // speakers/<speaker_id>.json — the people in the book
    for (const sp of speakers) {
      zf.writestr(
        `speakers/${sp.id}.json`,
        dump({
          id: sp.id,
          name: sp.name,
          aliases: sp.aliases ? jsonLoads(sp.aliases) : [],
          description: sp.description,
          persona_id: sp.persona_id,
          role_label: sp.role_label,
          pronouns: sp.pronouns,
        }),
      );
    }

    // personas/<persona_id>.json — the voices that play them
    for (const persona of personas) {
      // PYTHON-BUG (copied on purpose): the row's `default_delivery` is the stored JSON TEXT, and
      // Python called `.model_dump(exclude_none=True)` on it — so a persona with any delivery
      // saved fails the whole export with a 500 ("'str' object has no attribute 'model_dump'").
      // Only a persona with none saved exports (`{}`). The effects chain goes out as its text.
      if (persona.default_delivery) throw new TypeError("'str' object has no attribute 'model_dump'");
      zf.writestr(
        `personas/${persona.id}.json`,
        dump({
          id: persona.id,
          name: persona.name,
          language: persona.language,
          voice_id: persona.voice_id,
          voice_instruct: persona.voice_instruct,
          note: persona.note,
          // How it speaks — pace, pitch, gain, pauses and each model's own settings — and its
          // effects (2026-10-03).
          default_delivery: {},
          effects_chain: persona.effects_chain,
          lexicon_id: persona.lexicon_id,
        }),
      );
    }

    // lexicons/<id>.json
    for (const lex of lexicons) {
      const entries = h.all(`select * from ${LexiconEntry} where lexicon_id = ?`, [lex.id], LexiconEntry);
      zf.writestr(
        `lexicons/${lex.id}.json`,
        dump({
          id: lex.id,
          name: lex.name,
          description: lex.description,
          scope: lex.scope,
          entries: entries.map((e) => ({ word: e.word, pronunciation: e.pronunciation, notation: e.notation, notes: e.notes })),
        }),
      );
    }

    // audio/<scene_pos>/<block_pos>.wav (the default take per block)
    if (includeAudio) {
      for (const scene of scenes) {
        for (const block of blocksOf(scene.id)) {
          // Resolve the default take for this block.
          const take = h.one(`select * from ${Take} where block_id = ? and is_default = 1 limit 1`, [block.id], Take);
          if (take === null) continue;
          const gen = h.one(`select * from ${Generation} where id = ? limit 1`, [take.generation_id], Generation);
          if (gen === null || !gen.audio_path) continue;
          const audioPath = mediaFile(gen.audio_path);
          if (!isFile(audioPath)) continue;
          await zf.addFile(audioPath, `audio/${zpad(scene.position, 3)}/${zpad(block.position, 4)}-${block.id}.wav`);
        }
      }
    }

    // manifest.json (last so it includes the file count)
    zf.writestr(
      "manifest.json",
      dump({
        schema_version: "1",
        server_version: VERSION,
        project_id: project.id,
        exported_at: dtIso(utcNow()),
        scene_count: scenes.length,
        speaker_count: speakers.length,
        persona_count: personas.length,
        lexicon_count: lexicons.length,
        include_audio: includeAudio,
      }),
    );

    const bytesOut = zf.toBuffer();
    const filename = `${_slugify(project.name)}-${stampNow()}.justvoice.zip`;
    return c.body(bytesOut, 200, {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
      "content-length": String(bytesOut.length),
    });
  });
  return app;
}
