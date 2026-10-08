// SPDX-License-Identifier: MIT
// JustVoice's seed + store parity check (wave A of step 5): the Python server's modules and
// this port each act on their own fresh data folder, and the databases are compared cell by
// cell — every table's DDL in sqlite_master and every cell as SQLite's quote() (type and
// bytes), in rowid order — plus every store answer as JSON. Four phases:
//   1. constants: every seed constant (presets, catalog, class tunes, test samples, prompt
//      rows, feature catalog, effect presets) against Python's, floats included;
//   2. boot: init + AppState + installLlm(headless, JV's arguments) + seedWorkspace, then the
//      same boot again on the same folder (idempotency) — compared after each;
//   3. ops: a replay of store writes (personas, lexicons, settings patches, voices) — answers,
//      databases and voice manifests compared;
//   4. real: two COPIES of JustVoice's dev database (src-tauri/target/debug/data — read only;
//      the copies live in temp): every store read for real rows, then every persona,
//      lexicon, voice and the settings row rewritten unchanged — answers and databases.
// Masked: datetime columns and uuid-default ids (compared by FORMAT — each side's clock and
// random ids), and datetimes inside answers (compared by shape: Z / naive / offset).
//
//   node scripts/node24.mjs server/scripts/compare-seed.mjs      (JV_PYTHON overrides)
//
// Modules other slices still port (extraction/*, refinement, engines/llm/*) are stood in by
// a resolve hook ONLY while their file is missing: the prompt texts come from Python itself,
// and the engines/llm migrations are no-ops — what they are on a fresh database.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HERE, "..");
const REPO = resolve(SERVER, "..");
const PY = process.env.JV_PYTHON || join(SERVER, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const DEV_DATA = join(REPO, "src-tauri", "target", "debug", "data");

const dir = mkdtempSync(join(tmpdir(), "jv-compare-seed-"));
process.env.JUST_AI_HOME = join(dir, "family");
process.env.LLM_RUNNER_CACHE = join(dir, "user-cache");

const procs = await import("@delebash/llm-runner/platform/procs");
async function python(...args) {
  const r = await procs.run([PY, join(HERE, "compare-seed.py"), ...args], {
    cwd: SERVER,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  if (r.returncode !== 0) throw new Error(`compare-seed.py ${args[0]} failed:\n${r.stderr}`);
  return r;
}

// ── stand-ins for other slices' files, only while missing ──────────────────────────
await python("texts", join(dir, "texts.json"));
const texts = JSON.parse(readFileSync(join(dir, "texts.json"), "utf8"));
const STUBS = {};
for (const [file, consts] of Object.entries(texts.stubs)) {
  STUBS[file] = Object.entries(consts)
    .map(([k, v]) => `export const ${k} = ${JSON.stringify(v)};`)
    .join("\n");
}
STUBS["engines/llm/migrate_prompts.js"] =
  "export function migrateJvPromptsToShared() {}\nexport function liftEditedTunablesIntoPresets() {}";
STUBS["engines/llm/migrate_providers.js"] = "export function migrateSettingsProvidersToDb() { return 0; }";
const HOOKS = `const STUBS = ${JSON.stringify(STUBS)};
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); } catch (e) {
    if (e?.code === "ERR_MODULE_NOT_FOUND") {
      const hit = Object.keys(STUBS).find((k) => specifier.endsWith(k));
      if (hit) return { url: "data:text/javascript," + encodeURIComponent(STUBS[hit]), shortCircuit: true };
    }
    throw e;
  }
}`;
register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);

const { PyFloat, pyJson } = await import("@delebash/llm-runner/platform/pyjson");
const { openDatabase } = await import("@delebash/llm-runner/platform/sql");
const { installLlm, LLM_TABLES } = await import("@delebash/llm-runner/llm");
const session = await import("../src/database/session.js");
const { TABLES } = await import("../src/database/models.js");
const { seedWorkspace, BUILTIN_EFFECT_PRESETS } = await import("../src/database/seed.js");
const { AppState, setState, getState } = await import("../src/app_state.js");
const seedPresets = await import("../src/seed_presets.js");
const { DEFAULT_FEATURE_PROMPTS } = await import("../src/seed_feature_prompts.js");
const { FEATURE_CATALOG, PREFER_LOCAL_FEATURES } = await import("../src/feature_catalog.js");
const { PRODUCT } = await import("../src/version.js");
const { pyJsonParse } = await import("../src/models.js");

let failures = 0;
const fail = (m) => {
  failures++;
  if (failures <= 60) console.log(`  DIFF ${m}`);
};

// ── 1. constants ───────────────────────────────────────────────────────────────────
const marked = (v) => {
  if (v instanceof PyFloat) return { $float: v.v };
  if (v instanceof Set) return [...v].sort().map(marked);
  if (Array.isArray(v)) return v.map(marked);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, marked(x)]));
  if (typeof v === "number" && !Number.isInteger(v)) return { $float: v };
  return v;
};
const jsConsts = marked({
  DEFAULT_ENGINE_PRESETS: seedPresets.DEFAULT_ENGINE_PRESETS,
  JV_MODEL_CATALOG: seedPresets.JV_MODEL_CATALOG,
  JV_CLASS_TUNES: seedPresets.JV_CLASS_TUNES,
  JV_CLASS_TUNE_IDENTITY: seedPresets.JV_CLASS_TUNE_IDENTITY,
  DEFAULT_FEATURE_PRESETS: seedPresets.DEFAULT_FEATURE_PRESETS,
  DEFAULT_PRESET_ID: seedPresets.DEFAULT_PRESET_ID,
  DEFAULT_TEST_SAMPLES: seedPresets.DEFAULT_TEST_SAMPLES,
  DEFAULT_FEATURE_PROMPTS,
  FEATURE_CATALOG,
  PREFER_LOCAL_FEATURES,
  BUILTIN_EFFECT_PRESETS,
});
console.log("1. constants");
for (const [k, v] of Object.entries(texts.constants)) {
  // key order too (dict order is observable: seeds insert in it)
  if (JSON.stringify(jsConsts[k]) !== JSON.stringify(v)) fail(`constant ${k}`);
  else console.log(`  ${k}: identical`);
}

// ── the database comparison ────────────────────────────────────────────────────────
const COLS = {};
for (const t of [...TABLES, ...LLM_TABLES]) COLS[t.name] = t.columns || {};
const DT = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d{1,6})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const unq = (s) => (typeof s === "string" && s.startsWith("'") ? s.slice(1, -1).replaceAll("''", "'") : s);

function compareDbs(label, aPath, bPath) {
  const a = openDatabase(aPath, { foreignKeys: false, readonly: true });
  const b = openDatabase(bPath, { foreignKeys: false, readonly: true });
  const master = (h) => h.all("select type, name, tbl_name, sql from sqlite_master order by type, name");
  const ma = master(a);
  const mb = master(b);
  let cells = 0;
  let masked = 0;
  const before = failures;
  if (!isDeepStrictEqual(ma, mb)) {
    const names = (m) => m.map((r) => `${r.type}:${r.name}`);
    fail(`${label}: sqlite_master differs (${names(ma).filter((x) => !names(mb).includes(x))} | ${names(mb).filter((x) => !names(ma).includes(x))})`);
    for (const r of ma) {
      const o = mb.find((x) => x.type === r.type && x.name === r.name);
      if (o && o.sql !== r.sql) fail(`${label}: DDL of ${r.name}`);
    }
  }
  for (const { name } of ma.filter((r) => r.type === "table")) {
    if (!mb.some((r) => r.type === "table" && r.name === name)) continue;
    const cols = a.columnNames(name);
    const q = `select rowid as "__rowid", ${cols.map((c) => `quote("${c}") as "${c}"`).join(", ")} from "${name}" order by rowid`;
    const ra = a.all(q);
    const rb = b.all(q);
    if (ra.length !== rb.length) {
      fail(`${label}: ${name} has ${ra.length} vs ${rb.length} rows`);
      continue;
    }
    for (let i = 0; i < ra.length; i++) {
      for (const c of ["__rowid", ...cols]) {
        cells++;
        const [x, y] = [ra[i][c], rb[i][c]];
        if (x === y) continue;
        const spec = COLS[name]?.[c] || {};
        if (spec.kind === "datetime" && DT.test(unq(x)) && DT.test(unq(y))) {
          masked++;
          continue;
        }
        if (spec.defaultFn?.endsWith("._uuid") && UUID.test(unq(x)) && UUID.test(unq(y))) {
          masked++;
          continue;
        }
        if (c === "lexicon_id" || c.endsWith("_id")) {
          // a reference to a masked uuid row — same shape is all we can ask
          if (UUID.test(unq(x)) && UUID.test(unq(y))) {
            masked++;
            continue;
          }
        }
        fail(`${label}: ${name}[${i}].${c}: py ${String(x).slice(0, 160)} | js ${String(y).slice(0, 160)}`);
      }
    }
  }
  a.close();
  b.close();
  console.log(
    `  ${label}: ${ma.filter((r) => r.type === "table").length} tables, ${cells} cells, ${failures - before} different, ${masked} masked (clock/uuid)`,
  );
}

const DT_WIRE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{6})?(Z|[+-]\d\d:\d\d)?$/;
const shape = (s) => (s.endsWith("Z") ? "Z" : /[+-]\d\d:\d\d$/.test(s) ? "offset" : "naive");
function compareJson(label, a, b, at = "") {
  if (typeof a === "string" && typeof b === "string" && DT_WIRE.test(a) && DT_WIRE.test(b)) {
    if (shape(a) !== shape(b)) fail(`${label}${at}: datetime ${a} vs ${b}`);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return fail(`${label}${at}: length ${a.length} vs ${b.length}`);
    a.forEach((x, i) => compareJson(label, x, b[i], `${at}[${i}]`));
    return;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.join("|") !== kb.join("|")) return fail(`${label}${at}: keys ${ka} vs ${kb}`);
    for (const k of ka) compareJson(label, a[k], b[k], `${at}.${k}`);
    return;
  }
  if (!isDeepStrictEqual(a, b)) fail(`${label}${at}: py ${JSON.stringify(a)?.slice(0, 120)} | js ${JSON.stringify(b)?.slice(0, 120)}`);
}
/** An answer as the API's JSON (PyFloat → its number). */
const wire = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

// ── 2. boot ────────────────────────────────────────────────────────────────────────
async function jsBoot(dataDir, { seed }) {
  session.closeDb();
  session.cfg.dbPath = null;
  session.initDb(dataDir);
  setState(new AppState(dataDir));
  await installLlm(null, {
    db: session.getDb(),
    featureCatalog: FEATURE_CATALOG,
    featurePrompts: DEFAULT_FEATURE_PROMPTS,
    enginePresets: seedPresets.DEFAULT_ENGINE_PRESETS,
    featurePresets: seedPresets.DEFAULT_FEATURE_PRESETS,
    defaultPresetId: seedPresets.DEFAULT_PRESET_ID,
    testSamples: seedPresets.DEFAULT_TEST_SAMPLES,
    modelCatalogExtra: seedPresets.JV_MODEL_CATALOG,
    classTunesSeed: seedPresets.JV_CLASS_TUNES,
    classTuneIdentity: seedPresets.JV_CLASS_TUNE_IDENTITY,
    preferLocalFeatures: PREFER_LOCAL_FEATURES,
    dataDir,
    product: PRODUCT,
  });
  if (seed) await seedWorkspace();
}

console.log("2. boot");
const pyBoot = join(dir, "py-boot");
const jsBootDir = join(dir, "js-boot");
await python("boot", pyBoot);
await jsBoot(jsBootDir, { seed: true });
compareDbs("fresh seed", join(pyBoot, "justvoice.db"), join(jsBootDir, "justvoice.db"));
await python("reboot", pyBoot);
await jsBoot(jsBootDir, { seed: true });
compareDbs("second boot", join(pyBoot, "justvoice.db"), join(jsBootDir, "justvoice.db"));

// ── 3. ops ─────────────────────────────────────────────────────────────────────────
const F = (v) => new PyFloat(v);
const acx = {
  loudness_target_lufs: F(-21.0),
  true_peak_dbfs: -3.5,
  loudness_range_lu: 7,
  sample_rate: 44100,
  channels: 1,
  format: "mp3",
  bitrate_kbps: 192,
  head_silence_secs: 0.75,
  tail_silence_secs: 3,
};
const ops = [
  [
    "persona.create",
    "Mara",
    {
      id: "persona_mara",
      voice_id: "af_heart",
      note: "warm, low",
      voice_instruct: "Calm.",
      default_delivery: {
        speed: F(1.0),
        pitch: -2,
        gain_db: 0.5,
        pause_after: 300,
        models: { kokoro: { knobs: { temperature: F(1.0), x: 2 }, seed: 0 }, qwen3: { knobs: {} }, turbo: { emotion: "", knobs: {} } },
        junk: 1,
      },
      effects_chain: [
        { type: "gain", enabled: true, params: { gain_db: F(6.0) } },
        { type: "chorus", params: { depth: 1, mix: 0.5, rate_hz: F(2.0) } },
      ],
    },
  ],
  ["persona.create", "Ödön “ünicode” 📚", { id: "persona_u", default_delivery: {} }],
  ["persona.update", "persona_mara", { note: null }],
  ["persona.update", "persona_mara", { name: "Mara 2", default_delivery: { speed: 1.5, models: { m: { knobs: { k: 3 } } } } }],
  ["persona.update", "persona_mara", { effects_chain: null, lexicon_id: null }],
  ["persona.update", "missing", { name: "x" }],
  ["persona.update", "persona_u", { default_delivery: { speed: 5 } }],
  ["persona.get", "persona_mara"],
  ["persona.list"],
  [
    "lexicon.create",
    "Names",
    {
      id: "lex_a",
      entries: [
        { grapheme: "Beauchamp", alias: "bee-chum" },
        { grapheme: "Hecate", phoneme_ipa: "/ˈhɛkəti/", alias: "x" },
      ],
      description: "d",
    },
  ],
  ["lexicon.append", "lex_a", { grapheme: "Zoë", alias: "zoh-ee" }],
  ["lexicon.get", "lex_a"],
  ["lexicon.update", "lex_a", [{ grapheme: "Worcester", alias: "WUSS-ter" }, { grapheme: "Ng", phoneme_ipa: "ŋ" }], "  Renamed  "],
  ["lexicon.update", "lex_a", [], "   "],
  ["lexicon.update", "nope", [], null],
  ["lexicon.create", "Hers", { id: "lex_b", scope: "persona", persona_id: "persona_u" }],
  ["lexicon.list"],
  ["persona.delete", "persona_u"],
  ["lexicon.list"],
  ["lexicon.delete", "nope"],
  ["settings.patch", { logging: { level: "debug" } }],
  ["settings.patch", { extraction: { direct_min_b: 3 }, server: null }],
  [
    "settings.patch",
    {
      engines: {
        engine_overrides: { kokoro: { sources: { v1: { hf_repo: null, hf_revision: "x" } }, placements: { v1: "cpu" }, split_chars: { v1: 240 } } },
        speech_runtime: { cpu_min_realtime: 3 },
      },
    },
  ],
  ["settings.patch", { server: { port: 9999 }, cors: { origins: [] } }],
  ["settings.patch", { mastering: { acx } }],
  ["settings.patch", { extraction: { direct_min_b: 0 } }],
  ["settings.get"],
  [
    "voice.create",
    {
      id: "voice_a",
      engine: "kokoro",
      source: "blended",
      name: "Mix",
      language: "en-US",
      blend_recipe: { strategy: "blend", sources: ["a", "b"], weights: [1, 0.5] },
      embedding: [0.1, 1, -2],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ],
  ["voice.update", "voice_a", { gender: "F", name: null }],
  ["voice.add_sample", "voice_a"],
  ["voice.list"],
];
const opsText = pyJson(ops); // whole-number floats go out as "1.0", as Python's client would send
writeFileSync(join(dir, "ops.json"), opsText);

async function jsOps(dataDir) {
  await jsBoot(dataDir, { seed: false });
  const st = getState();
  const results = [];
  for (const [op, ...a] of pyJsonParse(opsText)) {
    try {
      let r;
      if (op === "persona.create") r = st.personas.create(a[0], a[1]);
      else if (op === "persona.update") r = st.personas.update(a[0], a[1]);
      else if (op === "persona.get") r = st.personas.get(a[0]);
      else if (op === "persona.list") r = st.personas.list();
      else if (op === "persona.delete") r = st.personas.delete(a[0]);
      else if (op === "lexicon.create") r = st.lexicons.create(a[0], a[1]);
      else if (op === "lexicon.update") r = st.lexicons.update(a[0], a[1], a[2]);
      else if (op === "lexicon.append") r = st.lexicons.appendEntry(a[0], a[1]);
      else if (op === "lexicon.get") r = st.lexicons.get(a[0]);
      else if (op === "lexicon.list") r = st.lexicons.list();
      else if (op === "lexicon.delete") r = st.lexicons.delete(a[0]);
      else if (op === "settings.patch") r = st.settings.patch(a[0]);
      else if (op === "settings.get") r = st.settings.get();
      else if (op === "voice.create") r = st.voices.create(a[0]);
      else if (op === "voice.update") r = st.voices.update(a[0], a[1]);
      else if (op === "voice.add_sample") r = st.voices.addSample(a[0], Buffer.from("RIFF"));
      else if (op === "voice.list") r = st.voices.list();
      else throw new Error(`unknown op ${op}`);
      results.push({ ok: wire(r) });
    } catch (e) {
      results.push({ error: e?.constructor?.name === "ModelValidationError" ? "ValidationError" : e.name });
    }
  }
  return results;
}

console.log("3. ops");
const pyOps = join(dir, "py-ops");
const jsOpsDir = join(dir, "js-ops");
await python("ops", pyOps, join(dir, "ops.json"), join(dir, "py-ops.json"));
const pyRes = JSON.parse(readFileSync(join(dir, "py-ops.json"), "utf8"));
const jsRes = await jsOps(jsOpsDir);
const before3 = failures;
ops.forEach(([op], i) => compareJson(`op ${i} ${op}`, pyRes[i], jsRes[i]));
console.log(`  answers: ${ops.length} ops, ${failures - before3} different`);
compareDbs("after ops", join(pyOps, "justvoice.db"), join(jsOpsDir, "justvoice.db"));
const maskDt = (t) => t.replace(/"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{6})?(\+00:00|Z)?"/g, (m, _f, z) => `"<dt${z ?? ""}>"`);
for (const f of ["voices/voice_a/manifest.json"]) {
  const [a, b] = [readFileSync(join(pyOps, f), "utf8"), readFileSync(join(jsOpsDir, f), "utf8")];
  if (maskDt(a) !== maskDt(b)) fail(`${f}:\n--- py\n${a}\n--- js\n${b}`);
  else console.log(`  ${f}: identical bytes (times masked)`);
}
const samples = (d) => (existsSync(d) ? readdirSync(d).sort() : []);
if (!isDeepStrictEqual(samples(join(pyOps, "voices/voice_a/samples")), samples(join(jsOpsDir, "voices/voice_a/samples")))) {
  fail("voice samples differ");
}

// ── 4. the real database ───────────────────────────────────────────────────────────
console.log("4. real database (copies of the dev data root's justvoice.db)");
const pyReal = join(dir, "py-real");
const jsReal = join(dir, "js-real");
for (const d of [pyReal, jsReal]) {
  mkdirSync(d, { recursive: true });
  copyFileSync(join(DEV_DATA, "justvoice.db"), join(d, "justvoice.db"));
}
await python("real", pyReal, join(dir, "py-real.json"));
const pyReal1 = JSON.parse(readFileSync(join(dir, "py-real.json"), "utf8"));
session.closeDb();
session.cfg.dbPath = null;
session.initDb(jsReal);
const st = new AppState(jsReal);
setState(st);
const read = {
  personas: wire(st.personas.list()),
  persona_get: Object.fromEntries(st.personas.list().map((p) => [p.id, wire(st.personas.get(p.id))])),
  lexicons: wire(st.lexicons.list()),
  lexicon_get: Object.fromEntries(st.lexicons.list().map((x) => [x.id, wire(st.lexicons.get(x.id))])),
  settings: wire(st.settings.get()),
  voices: wire(st.voices.list()),
};
st.settings.set(st.settings.get());
const written = { personas: [], lexicons: [] };
for (const p of st.personas.list()) written.personas.push(wire(st.personas.update(p.id, { name: p.name })));
for (const x of st.lexicons.list()) written.lexicons.push(wire(st.lexicons.update(x.id, x.entries, null)));
for (const v of st.voices.list()) st.voices.update(v.id, { name: v.name });
const before4 = failures;
// Reads come straight from the database on both sides: compared EXACTLY (times included).
if (!isDeepStrictEqual(pyReal1.read, read)) compareJson("real read", pyReal1.read, read);
compareJson("real rewrite", pyReal1.written, written);
console.log(
  `  read: ${read.personas.length} personas, ${read.lexicons.length} lexicons (${read.lexicons.reduce((s, x) => s + x.entries.length, 0)} entries), settings, ${read.voices.length} voices — ${failures - before4} different`,
);
compareDbs("real, after every row rewritten", join(pyReal, "justvoice.db"), join(jsReal, "justvoice.db"));
session.closeDb();

console.log(failures ? `\n${failures} difference(s)` : "\nno differences");
process.exit(failures ? 1 : 0);
