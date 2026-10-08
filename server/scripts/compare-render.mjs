// SPDX-License-Identifier: MIT
// The render layer's parity check (wave C of step 5), checks (a) and (b): Python's render layer
// and this port each read their own COPY of JustVoice's dev data root, augmented first by
// Python's own stores (compare-render.py `augment`: stored voices of every source, personas
// with deliveries, per-model settings, effects and lexicons, and a second book whose lines carry
// their own numbers, per-model settings, direction, tags, a marker, a dialogue tag and a long
// line — the real data is ten Kokoro personas with no delivery). Then both dump:
//
//   (a) for EVERY line of EVERY chapter: the chapter line the resolver makes, the render-cache
//       key and everything derived for it without synthesizing — engine, model, the prepared
//       text and delivery, the seed, speed-native, the split size and the pieces, the shape,
//       the effects hash, the hashed delivery text, the cache probe — and per block the take
//       path's plan and key (plan_block → plan_key);
//   (b) the read answers: voice_model for every voice and model, persona_render for every
//       persona, line_takes' line pages, project states, heard lines, takes, render_jobs' job
//       status for every job, merge_override on fixed patches;
//
// and the dumps are compared value for value, key order included. The speech cache, the render
// cache and the take audio are junctions to the real ones (read only — fingerprinted before and
// after); the JS data root's `engines-runtime` is a junction to Python's source-tree runtime.
//
//   node scripts/node24.mjs server/scripts/compare-render.mjs      (JV_PYTHON overrides)

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { attempt, cleanup, compare, DEV_DATA, dataCopy, fingerprint, leaves, python, tempRoot } from "./compare-render-lib.mjs";

const dir = tempRoot("jv-compare-render-");
const before = Object.fromEntries(["cache", "generations", "speech-cache"].map((d) => [d, fingerprint(join(DEV_DATA, d))]));

const base = dataCopy(dir, "base", { links: [] });
console.log(`augment: ${(await python(["augment", base])).trim()}`);
const LINKS = ["speech-cache", "cache", "generations"];
const pyData = dataCopy(dir, "py-data", { from: base, copy: ["voices"], links: LINKS });
const jsData = dataCopy(dir, "js-data", { from: base, copy: ["voices"], links: LINKS, runtime: true });
await python(["dump", pyData, join(dir, "py.json")]);

// ── this port ───────────────────────────────────────────────────────────────────
const { pyFloatValue, pyJson } = await import("@delebash/llm-runner/platform/pyjson");
const { pySorted } = await import("@delebash/llm-runner/platform/py");
const llmDb = await import("@delebash/llm-runner/llm/db");
const session = await import("../src/database/session.js");
const { AppState, setState } = await import("../src/app_state.js");
const runtime = await import("../src/engines/audiocpp/runtime.js");
const manager = await import("../src/engines/manager.js");
const { CAPABILITY_DETAILS } = await import("../src/engines/capability_details.js");
const vm = await import("../src/voice_model.js");
const rc = await import("../src/render_core.js");
const pr = await import("../src/persona_render.js");
const lt = await import("../src/line_takes.js");
const rj = await import("../src/render_jobs.js");
const rca = await import("../src/api/render_chapter_api.js");
const { personaForBlock } = await import("../src/api/_speaker_helpers.js");
const { splitTextIntoChunks } = await import("../src/audio/chunked.js");
const { effectsChainHash } = await import("../src/audio/effects.js");
const { canonicalJson } = await import("../src/delivery.js");
const { ChapterLine, modelDump } = await import("../src/models.js");

session.initDb(jsData);
llmDb.configureStorage(session.cfg.handle);
const st = new AppState(jsData);
setState(st);
await runtime.ensureHardware();
const t0 = performance.now();
const mgr = manager.getManager();
const h = session.cfg.handle;

const jtext = (v) => pyJson(v, { sortKeys: true, ensureAscii: false });
const planOut = (p) => ({
  voice: p.voice,
  model: p.model,
  text: p.text,
  language: p.language,
  delivery: jtext(p.delivery),
  seed: p.seed,
  effects: jtext(p.effects),
  lexicons: p.lexicons,
});
const shapeOut = (s) => ({ stretch_factor: s.stretchFactor, gain_db: s.gainDb, pitch_semitones: s.pitchSemitones });
const kwOut = (kw) => ({
  voice: kw.voice,
  text: kw.text,
  language: kw.language,
  seed: kw.seed,
  lexicons: kw.lexicons,
  effects: kw.effects,
  cache_scope: kw.cacheScope,
  use_cache: kw.useCache,
});
const out = {};

// ── models ──
const families = pySorted([...new Set(Object.values(CAPABILITY_DETAILS).map((r) => r.engine_id))]);
out.models = {};
for (const m of families) {
  out.models[m] = {
    name: vm.modelName(m),
    directed_by: vm.directedBy(m),
    can: Object.fromEntries(["clone", "design", "blend"].map((a) => [a, vm.can(m, a)])),
    engine_of: vm.engineOfModel(m),
    emotions: pr.emotionChoices(m),
    registers: pr.registerChoices(m),
    knobs: Object.keys(pr.knobSpecs(m)),
    phoneme: rc._supportsPhonemeInput(m),
    emotion_tagset: rc._emotionTagset(m) !== null,
    model_of_variant: vm.modelOfVariant(m),
  };
}
out.engines = {};
for (const e of pySorted([...mgr.manifests().keys()])) {
  const fams = vm.modelsOfEngine(e);
  const rec = {
    families: fams,
    preset_model: vm.modelForPreset(e),
    default: Object.fromEntries([null, "clone", "design", "blend"].map((n) => [String(n ?? "None"), vm._defaultModel(e, { need: n })])),
    native: rc.speedNative(st, e),
    takes_tags: rc._engineTakesTags(st, e),
    per_model: {},
  };
  for (const m of [...fams, "kokoro", "nonsense"]) {
    rec.per_model[m] = {
      name: vm.modelName(m, e),
      speaks: vm.modelSpeaks(e, m),
      check: {},
      variants: {},
      loaded: vm.isModelLoaded(e, m),
      native: rc.speedNative(st, e, m),
      split: rc.lineSplitChars(st, e, null),
    };
    for (const a of ["clone", "design", "blend"]) rec.per_model[m].check[a] = await attempt(() => vm.checkModelFor(e, m, a));
    for (const lang of [null, "en", "de-DE", "ja", "fr"]) rec.per_model[m].variants[String(lang ?? "None")] = await attempt(() => vm.variantForModel(e, m, lang));
  }
  rec.check_none = {};
  for (const a of ["clone", "design", "blend"]) rec.check_none[a] = await attempt(() => vm.checkModelFor(e, null, a));
  out.engines[e] = rec;
}

// ── voices ──
const ids = [...[...mgr.manifests().values()].flatMap((m) => m.staticVoices.map((v) => v.id)), ...st.voices.list().map((v) => v.id), "no-such-voice", ""];
const dataReal = realpathSync.native(jsData);
out.voices = {};
for (const vid of ids) {
  const v = await vm.voiceModel(st, vid);
  const stored = st.voices.get(vid);
  const fields = rc.voiceSynthFields(st, stored);
  if (fields.audio_prompt_path) fields.audio_prompt_path = relative(dataReal, fields.audio_prompt_path).replaceAll("\\", "/");
  out.voices[vid] = {
    vm: v === null ? null : { engine_id: v.engineId, model: v.model, name: v.name, directed_by: v.directedBy, speaks: [...v.speaks] },
    language: await vm.voiceLanguage(st, vid),
    key: await vm.modelKey(st, vid),
    versions: await attempt(() => vm.versionsOf(st, vid)),
    versions_de: await attempt(() => vm.versionsOf(st, vid, "de-DE")),
    design: rc.voiceDesignInstructForId(st, vid),
    is_desc: rc.isDescriptionVoice(st, vid),
    desc_seed: rc.descriptionSeed(vid),
    synth_fields: fields,
    engine: await rc._resolveEngineForVoice(st, vid),
    split: await attempt(async () => rc.lineSplitChars(st, (await rc._resolveEngineForVoice(st, vid)) || "x", vid)),
    stored_model: stored != null ? vm.modelForStored(st, stored) : null,
  };
}

// ── personas ──
out.personas = {};
for (const p of st.personas.list()) {
  const settings = {};
  for (const m of [...families, null]) {
    const [d, tags, seed] = pr.modelSettings(p, m);
    settings[String(m ?? "None")] = [jtext(d), tags, seed];
  }
  const v = p.voice_id ? await vm.voiceModel(st, p.voice_id) : null;
  out.personas[p.id] = {
    stock: planOut(await pr.planLine(st, p, { text: pr.stockLine(p.language) })),
    directed: planOut(
      await pr.planLine(st, p, {
        text: "Hello there, Cael.",
        direction: "quietly",
        bookLexicon: "lex-x",
        requestDelivery: { speed: 1.25, seed: 5, engine: { top_k: 3 } },
        lineModels: { [v ? v.model : "x"]: { emotion: "", knobs: { temperature: 0.25 } } },
      }),
    ),
    check: pr.checkDelivery(p.default_delivery),
    settings,
    language: pr.personaLanguage(p, v, await vm.voiceLanguage(st, p.voice_id)),
  };
}
out.stock_lines = Object.fromEntries(["en", "ja", "de-DE", "xx", null, "zh-CN"].map((l) => [String(l ?? "null"), pr.stockLine(l)]));

// ── chapters ──
const projects = h.all("select * from projects order by created_at", [], "projects");
const scenesMeta = h.all("select id, project_id from scenes order by project_id, position").map((r) => [r.id, r.project_id]);
const blockRows = h.all("select * from blocks order by scene_id, position", [], "blocks").map((b) => [b, personaForBlock(h, b)?.id ?? null]);
const jobIds = h.all("select id from render_jobs order by created_at").map((r) => r.id);
const bookLex = Object.fromEntries(projects.map((p) => [p.id, p.default_lexicon_id]));
const sceneProject = Object.fromEntries(scenesMeta);

out.chapters = {};
let nLines = 0;
for (const [sid] of scenesMeta) {
  let lines;
  try {
    lines = await rca._resolveSceneToLines(sid, st, { strict: false });
  } catch (e) {
    out.chapters[sid] = { error: `${e?.name}: ${e?.detail ?? e?.message}` };
    continue;
  }
  const recs = [];
  for (const line of lines) {
    nLines += 1;
    const kw = rca._lineKwargs(line, `scene:${sid}`);
    const engine = await rc._resolveEngineForVoice(st, line.voice);
    const rec = { chapter_line: modelDump(ChapterLine, line), delivery_text: jtext(kw.delivery), kwargs: kwOut(kw), engine };
    if (engine !== null && rc._engineTakesTags(st, engine) !== null) {
      const model = await rc._lineModel(st, line.voice, engine);
      const [text, prepared] = rc.prepareLineText(st, engine, model, line.text, { ...(kw.delivery || {}) }, [...(kw.lexicons || [])]);
      let seed = kw.seed;
      if (seed == null && rc.isDescriptionVoice(st, line.voice)) seed = rc.descriptionSeed(line.voice);
      const native = rc.speedNative(st, engine, model);
      const split = rc.lineSplitChars(st, engine, line.voice);
      Object.assign(rec, {
        model,
        effective_text: text,
        prepared: jtext(prepared),
        seed,
        native,
        phoneme: rc._supportsPhonemeInput(model),
        split,
        chunks: rc.pyLen(text) > split ? splitTextIntoChunks(text, split) : [text],
        shape: shapeOut(rc.lineShape(prepared, { speedNative: native })),
        fx_hash: effectsChainHash(kw.effects || []),
        key_delivery: canonicalJson(rc._keyDelivery(prepared, native)),
      });
    }
    const opts = { language: kw.language, delivery: kw.delivery, seed: kw.seed, lexicons: kw.lexicons, effects: kw.effects };
    rec.key = await rc.lineInputsKey(st, line.voice, line.text, opts);
    rec.probe = await rc.probeLineCached(st, line.voice, line.text, { ...opts, delivery: kw.delivery || {}, cacheScope: `scene:${sid}` });
    recs.push(rec);
  }
  out.chapters[sid] = { lines: recs, played_texts: rca.playedTexts(lines) };
}
out.line_count = nLines;

// ── blocks ──
out.blocks = {};
for (const [b, personaId] of blockRows) {
  const rec = {
    override: jtext(lt.lineOverride(b)),
    line_models: jtext(lt.lineModels(b)),
    override_delivery: jtext(lt.overrideDelivery(b)),
    marker: lt.isMarker(b),
    meta: jtext(lt.blockMeta(b)),
  };
  const p = personaId ? st.personas.get(personaId) : null;
  if (p != null && p.voice_id) {
    const bookLexicon = bookLex[sceneProject[b.scene_id]];
    const r = await attempt(async () => planOut(await lt.planBlock(st, p, b, { bookLexicon })));
    rec.plan = r;
    if ("ok" in r) {
      rec.plan_key = await attempt(async () => lt.planKey(st, await lt.planBlock(st, p, b, { bookLexicon })));
      rec.plan_key_seed = await attempt(async () => lt.planKey(st, await lt.planBlock(st, p, b, { bookLexicon, seed: 123456 })));
    }
  }
  out.blocks[b.id] = rec;
}

// ── read answers ──
out.scene_lines = {};
for (const [sid] of scenesMeta) out.scene_lines[sid] = await attempt(() => lt.sceneLines(h, st, sid));
out.render_state = {};
for (const p of projects) out.render_state[p.id] = await lt.projectRenderState(h, st, p.id);
out.heard = {};
for (const [sid, pid] of scenesMeta) {
  const scene = h.get("scenes", sid);
  const project = h.get("projects", pid);
  const hb = lt.heardBlocks(h, scene, project);
  const idsOf = hb.map(([, b]) => b.id);
  out.heard[sid] = {
    heard: hb.map(([n, b]) => [n, b.id]),
    joins: pySorted([...lt.paragraphJoins(hb.map(([, b]) => b))]),
    ends: pySorted([...lt.sceneEnds(hb.map(([, b]) => b))]),
    live: Object.fromEntries([...lt.liveTakes(h, idsOf)].map(([bid, [t, g]]) => [bid, [t.id, g.id]])),
    played: Object.fromEntries([...lt.playedTakes(h, idsOf)].map(([bid, g]) => [bid, g.id])),
  };
}
out.jobs = Object.fromEntries(jobIds.map((jid) => [jid, rj.jobStatus(jid, { includeBlocks: true })]));
out.merges = [];
// A stored metadata's floats arrive as PyFloats (line_takes.blockMeta reads it with pyJsonParse).
const F = pyFloatValue;
for (const [meta, patch] of [
  [{}, { speed: 1, pitch: "-2.5", pause_after_ms: 900.7 }],
  [{ speed: F(1.5), x: F(1.0) }, { speed: null, gain_db: 12 }],
  [{}, { models: { chatterbox: { knobs: { exaggeration: 1 }, emotion: " sad " } } }],
  [{ line_models: { chatterbox: { knobs: { a: F(1.0), b: F(2.0) } } } }, { models: { chatterbox: { knobs: { a: null } } } }],
  [{}, { speed: 5 }],
  [{}, { volume: 2 }],
  [{}, { pause_after_ms: "x" }],
  [{}, { models: "x" }],
  [{}, { models: { k: { emotion: "x".repeat(61) } } }],
  [{}, { models: { k: { nope: 1 } } }],
]) {
  out.merges.push(await attempt(() => jtext(lt.mergeOverride(meta, patch))));
}
out.seconds = Math.round((performance.now() - t0) / 100) / 10;
await manager.shutdownManager();
session.closeDb();
writeFileSync(join(dir, "js.json"), JSON.stringify(out, null, 1));

// ── compare ─────────────────────────────────────────────────────────────────────
const a = JSON.parse(readFileSync(join(dir, "py.json"), "utf8"));
const b = JSON.parse(readFileSync(join(dir, "js.json"), "utf8"));
const timing = `python ${a.seconds} s, js ${b.seconds} s`;
delete a.seconds;
delete b.seconds;
const diffs = compare(a, b);
let keys = 0;
let probes = 0;
for (const ch of Object.values(a.chapters)) for (const l of ch.lines || []) if (l.key) keys += 1;
for (const ch of Object.values(a.chapters)) for (const l of ch.lines || []) if (l.probe) probes += 1;
const planKeys = Object.values(a.blocks).filter((r) => r.plan_key?.ok).length;
console.log(
  `(a) ${a.line_count} chapter lines in ${Object.keys(a.chapters).length} chapters: ${keys} render-cache keys (${probes} cached), ` +
    `${planKeys} take-path keys; (b) ${Object.keys(a.voices).length} voices, ${Object.keys(a.personas).length} personas, ` +
    `${Object.keys(a.scene_lines).length} line pages, ${Object.keys(a.jobs).length} jobs — ${leaves(a)} values compared (${timing})`,
);
const sections = {};
for (const d of diffs) {
  const s = d.split(/[.:[]/)[1];
  sections[s] = (sections[s] ?? 0) + 1;
}
for (const d of diffs.slice(0, 60)) console.log(`  DIFF ${d}`);
console.log(diffs.length ? `${diffs.length} difference(s): ${JSON.stringify(sections)}` : "0 differences");

const after = Object.fromEntries(["cache", "generations", "speech-cache"].map((d) => [d, fingerprint(join(DEV_DATA, d))]));
const unchanged = JSON.stringify(before) === JSON.stringify(after);
console.log(`real cache / generations / speech-cache unchanged: ${unchanged} ${JSON.stringify(after)}`);
if (process.argv.includes("--keep")) console.log(`kept ${dir}`);
else cleanup(dir);
process.exit(diffs.length || !unchanged ? 1 : 0);
