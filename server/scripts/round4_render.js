// SPDX-License-Identifier: MIT
// Round 4's takes (docs/plans/2026-10-16-test-kit-and-round-4.md §3): every cue line of Alice
// VII–VIII whose cue names an emotion, told and not told, on each candidate model, given emotion
// the way its authors document it — through the running app, written with the test kit's
// manifest (tools/take-check).
//
//     npm run round4:render                                   # the app on 127.0.0.1:17494
//     npm run round4:render -- --arms voxcpm2,cosyvoice3 --seeds 7
//     npm run round4:render -- --voice <voice id>             # the Hatter's voice, else by name
//
// Needs a running JustVoice (it owns the models and the voices) and a voice with a clip to copy —
// the Hatter's, frozen from his VoiceDesign audition as in rounds 1–3. Each arm copies that voice to
// its model (`POST /v1/voices/{id}/copy`, reused by name on a second run), loads the model
// (`POST /v1/engines/{engine}/load`) and renders each take with `POST /v1/generate`, uncached. A
// take already on disk is kept, so a run picks up where it stopped. Built 2026-10-16.
//
// Round 5 (TASKS "Round 5 — …", RESEARCH §10.25), the same way into its own folder:
//
//     npm run round4:render -- --out data/round5 --direction <eval:direction --out dump> \
//       --arms voxcpm2-r5,breeze-r5,index_tts25-r5,index_tts20-r5,chatterbox-r5
//     npm run round4:render -- --out data/round5 --arms index_tts25-clip,index_tts20-clip \
//       --runtime http://127.0.0.1:<the speech runtime's port> --bank-voice <a voice to act the clips>
//
// A round-5 arm is told the words the app's direction step wrote for the line (the dump's
// `direction`; the book's own cue words where it wrote none), the way its authors document. An
// emotion-clip arm (`clip`) sends IndexTTS an acted clip per emotion as its emotion reference
// (audio.cpp's `audio` input) — something the app can't send yet, so those takes go straight to the
// speech runtime the app runs (`/v1/tasks/run`), the model loaded through the app first. The clips
// (`<out>/bank/`) are BreezeTTS 2 acting each emotion in another voice (`--bank-voice`), made once.
//
// Round 6b step 3 (docs/plans/2026-10-16-customvoice-our-voice.md) — Qwen3 CustomVoice 1.7B
// speaking the voice's own clip, told the line's words as its instruct:
//
//     npm run round4:render -- --out data/round6b --direction <the round-5 dump> \
//       --arms customvoice-ours,customvoice-ours-icl --voice <the Hatter's id> \
//       --runtime http://127.0.0.1:<the speech runtime's port> [--lines 7-95,8-57,…]
//
// The app can't send a clip to CustomVoice yet (our fork's `qwen3_tts.base_model_path`), so each
// arm loads the model through the app first (its memory booking), registers the same id again on
// the speech runtime with that option added, and sends its takes there (`/v1/tasks/run`); it
// unloads through the app at the end. No voice is copied: the takes use the voice's own clip.
//
// Round 6b step 2 (TASKS "Round 6b") — priming: each told take says a short lead-in in the line's
// feeling first (`PRIME`), and the lead-in is cut off where the app's aligner (`/v1/align`) times
// the line's first word. Told takes only, into `<arm>-primed/`:
//
//     npm run round4:render -- --out data/round6b/primed --prime --direction <the round-5 dump> \
//       --arms voxcpm2-r5,cosyvoice3,customvoice-ours --voice <the Hatter's id> \
//       --runtime http://127.0.0.1:<the speech runtime's port> --lines 7-70,7-31,8-27,8-44,7-117

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { splitWords } from "../src/alignment.js";
import { parseWavHeader, writeWavContainer } from "../src/audio/wav.js";
import { segmentParagraphs, splitIntoParagraphs } from "../src/extraction/segmentation.js";
import { runAdapter } from "../src/imports/index.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

// A told line's direction in words, per the app's emotion (models.js EMOTION_VALUES) — what the
// one-click run's direction step writes beside the emotion.
const WORDS = {
  happy: "happy",
  sad: "sad",
  angry: "angry",
  fearful: "frightened",
  whispered: "whispering",
  shouted: "shouting",
  contemptuous: "contemptuous",
  sarcastic: "sarcastic",
};

// IndexTTS's eight emotions, in its order (../audio.cpp src/models/index_tts2/qwen_emotion.cpp:
// happy, angry, sad, afraid, disgusted, melancholic, surprised, calm); an emotion with no category
// of its own (shouted, whispered, sarcastic) gets none — the authors have none for it.
const INDEX_VECTOR = { happy: 0, angry: 1, sad: 2, fearful: 3, contemptuous: 4 };
function indexVector(emotion) {
  const at = INDEX_VECTOR[emotion];
  if (at === undefined) return null;
  return Array.from({ length: 8 }, (_, i) => (i === at ? 1 : 0)).join(",");
}

// The arms: a model, and how a told line reaches it. `told(emotion)` gives the line's delivery;
// the app's own direction mapping (curated/<family>.js) does the rest unless an arm says otherwise.
const appWay = (emotion) => ({ emotion, instruct: WORDS[emotion] ?? emotion });
// Round 5: the line's own direction words (what the one-click run sends), not one word.
const described = (emotion, line) => ({ emotion, instruct: line.direction || WORDS[emotion] || emotion });
const ARMS = {
  voxcpm2: { engine: "voxcpm2", variant: "voxcpm2-q8", told: appWay },
  "index_tts25-words": { engine: "index_tts2", variant: "index_tts2-indextts25-q8", told: appWay },
  // The authors' way (README; RESEARCH §10.8): an emotion vector at weight ~0.65, text mode off.
  "index_tts25-vector": {
    engine: "index_tts2",
    variant: "index_tts2-indextts25-q8",
    told: (emotion) => {
      const v = indexVector(emotion);
      return v ? { engine: { emotion_vector: v, emotion_alpha: 0.65, use_emotion_text: false } } : {};
    },
  },
  // The authors' tip for expressive speech (README): exaggeration ~0.7, guidance ~0.3.
  "chatterbox-multilingual": {
    engine: "chatterbox",
    variant: "chatterbox-multilingual-v2-q8",
    told: (emotion) => ({ ...appWay(emotion), engine: { exaggeration: 0.7, cfg_weight: 0.3 } }),
  },
  cosyvoice3: { engine: "cosyvoice3", variant: "cosyvoice3-q8", told: appWay },
  higgs: { engine: "higgs_audio_tts", variant: "higgs_audio_tts-q8", told: appWay },
  fish: { engine: "fish_audio", variant: "fish_audio-q8", told: appWay },
  breeze: { engine: "breeze_tts", variant: "breeze_tts-q8", told: appWay },
  "chatterbox-turbo": { engine: "chatterbox", variant: "chatterbox-turbo-q8", told: appWay },

  // ── Round 5 (RESEARCH §10.25) ──
  // VoxCPM2: a described delivery at stronger guidance (usage guide: cfg 2.0–3.0), plain at the same.
  "voxcpm2-r5": {
    engine: "voxcpm2",
    variant: "voxcpm2-q8",
    told: (e, l) => ({ ...described(e, l), engine: { cfg_value: 2.7 } }),
    plain: { engine: { cfg_value: 2.7 } },
  },
  // BreezeTTS 2 on the graphics card (pinned for the round), told the line's words.
  "breeze-r5": { engine: "breeze_tts", variant: "breeze_tts-q8", told: described, pin: "gpu" },
  // IndexTTS 2.5 and 2.0 in words at the README's strength ("around 0.6 (or lower)").
  "index_tts25-r5": {
    engine: "index_tts2",
    variant: "index_tts2-indextts25-q8",
    told: (e, l) => ({ ...described(e, l), engine: { emotion_alpha: 0.6 } }),
  },
  "index_tts20-r5": {
    engine: "index_tts2",
    variant: "index_tts2-indextts2-q8",
    told: (e, l) => ({ ...described(e, l), engine: { emotion_alpha: 0.6 } }),
  },
  // IndexTTS with an acted emotion clip (README: emo_audio_prompt at emo_alpha 0.9).
  "index_tts25-clip": { engine: "index_tts2", variant: "index_tts2-indextts25-q8", clip: 0.9 },
  "index_tts20-clip": { engine: "index_tts2", variant: "index_tts2-indextts2-q8", clip: 0.9 },
  // Chatterbox at the top of the README's expressive range ("~0.7 or higher").
  "chatterbox-r5": {
    engine: "chatterbox",
    variant: "chatterbox-multilingual-v2-q8",
    told: (e) => ({ ...appWay(e), engine: { exaggeration: 1.0, cfg_weight: 0.3 } }),
  },

  // ── Round 6b step 3 ──
  // CustomVoice 1.7B with the voice's x-vector (Base's speaker encoder) in its speaker slot, or
  // the x-vector plus the clip and its words (ICL), told the line's words as its instruct.
  "customvoice-ours": { engine: "qwen3", variant: "qwen3-cv-1.7b-q8", base: "qwen3-base-1.7b-q8", ours: "x-vector", told: described },
  "customvoice-ours-icl": { engine: "qwen3", variant: "qwen3-cv-1.7b-q8", base: "qwen3-base-1.7b-q8", ours: "icl", told: described },
};

// The emotion clips: a short emotional sentence per emotion, acted by BreezeTTS 2 in another voice.
const BANK = {
  angry: ["How dare you speak to me like that!", "angry, furious, raising his voice"],
  sad: ["I lost everything I ever loved.", "sad, close to tears"],
  fearful: ["Please, please don't hurt me.", "frightened, trembling"],
  happy: ["This is the best day of my whole life!", "happy, delighted"],
  contemptuous: ["You really think you're clever, don't you?", "contemptuous, sneering"],
  whispered: ["Keep your voice down, they can hear us.", "whispering"],
  shouted: ["Get out of here, right now!", "shouting at the top of his voice"],
};

// Round 6b step 2's lead-ins: said before the line in the same take, in its feeling, then cut off.
// Written for the test; in the app the direction step would write them.
const PRIME = {
  sad: "Oh dear. It's no use, it's all gone wrong.",
  fearful: "Oh no. Oh dear, I'm so frightened.",
  happy: "Ha! I knew it, I knew it all along!",
};

class Exit extends Error {}

/** A model load, asked again while its download outlasts Node's 300 s wait for a reply's headers
 * (undici's `headersTimeout`; IndexTTS 2.0's 3.5 GB stopped round 5) — the server keeps fetching. */
async function load(server, engine, variant) {
  for (let tries = 0; ; tries++) {
    try {
      return await call(server, `/v1/engines/${engine}/load`, { method: "POST", body: { model_variant: variant }, timeoutS: 1800 });
    } catch (e) {
      if (!/Headers Timeout|fetch failed/i.test(String(e?.cause?.message ?? e?.message ?? e)) || tries >= 12) throw e;
      console.log(`   still loading ${variant} (a download, most likely) — asking again`);
    }
  }
}

async function call(server, route, { method = "GET", body, timeoutS = 900, raw = false } = {}) {
  const r = await fetch(server + route, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutS * 1000),
  });
  if (!r.ok) throw new Exit(`${method} ${route} -> ${r.status}: ${(await r.text()).slice(0, 400)}`);
  return raw ? Buffer.from(await r.arrayBuffer()) : r.json();
}

/** Every cue line whose cue names an emotion: its chapter, its [D#], its words and the emotion. */
function cueLines(directionFile = "") {
  const root = path.join(ROOT, "server", "samples", "alice-in-wonderland");
  // eval:direction's dump: {chapter, d, direction, …} per keyed line — the words the app wrote.
  const said = new Map();
  if (directionFile) {
    for (const r of JSON.parse(readFileSync(directionFile, "utf8"))) if (r.direction) said.set(`${r.chapter}#${r.d}`, r.direction);
  }
  const key = JSON.parse(readFileSync(path.join(root, "attribution-truth.json"), "utf8"));
  const book = runAdapter(key.adapter, readFileSync(path.join(root, key.book)), { filename: key.book });
  const lines = [];
  for (const [ci, title] of Object.keys(key.cues).entries()) {
    const scene = book.scenes.find((s) => s.title === title);
    if (!scene) throw new Exit(`the book has no chapter called ${title}`);
    const text = scene.lines.filter((l) => l.text).map((l) => l.text).join("\n\n");
    const spoken = segmentParagraphs(splitIntoParagraphs(text)).filter((s) => s.kind === "dialogue").map((s) => s.text);
    for (const [d, cue] of Object.entries(key.cues[title])) {
      if (!cue.emotion) continue;
      lines.push({ line: `${ci + 7}-${d}`, text: spoken[Number(d)], emotion: cue.emotion, cue: cue.cue, direction: said.get(`${title}#${d}`) ?? cue.cue });
    }
  }
  return lines;
}

/** The capability row a variant belongs to: the longest row id the variant starts with. */
function rowOf(rows, variant) {
  return Object.keys(rows)
    .filter((id) => variant === id || variant.startsWith(`${id}-`))
    .sort((a, b) => b.length - a.length)[0];
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      server: { type: "string", default: "http://127.0.0.1:17494" },
      "data-dir": { type: "string", default: path.join(ROOT, "data") },
      out: { type: "string", default: path.join(ROOT, "data", "round4") },
      arms: { type: "string", default: Object.keys(ARMS).join(",") },
      seeds: { type: "string", default: "7,8,9" },
      voice: { type: "string", default: "" },
      limit: { type: "string", default: "" },
      direction: { type: "string", default: "" }, // round 5: an eval:direction --out dump
      runtime: { type: "string", default: "" }, // round 5's clip arms: the speech runtime's URL
      "bank-voice": { type: "string", default: "" }, // round 5's clip arms: the voice that acts the clips
      lines: { type: "string", default: "" }, // only these line ids (e.g. 7-95,8-57)
      prime: { type: "boolean", default: false }, // round 6b step 2: told takes with a lead-in, cut off
    },
  });
  const server = args.server.replace(/\/+$/, "");
  const seeds = args.seeds.split(",").map((s) => Number.parseInt(s, 10));
  const arms = args.arms.split(",").map((a) => a.trim()).filter(Boolean);
  for (const a of arms) if (!ARMS[a]) throw new Exit(`no arm called ${a} — the arms: ${Object.keys(ARMS).join(", ")}`);
  let lines = cueLines(args.direction);
  if (args.lines) {
    const wanted = new Set(args.lines.split(",").map((s) => s.trim()));
    lines = lines.filter((l) => wanted.has(l.line));
    const missing = [...wanted].filter((id) => !lines.some((l) => l.line === id));
    if (missing.length) throw new Exit(`no cue line ${missing.join(", ")}`);
  }
  if (args.limit) lines = lines.slice(0, Number.parseInt(args.limit, 10));

  const { voices } = await call(server, "/v1/voices");
  const source = args.voice
    ? voices.find((v) => v.id === args.voice)
    : voices.find((v) => /hatter/i.test(v.name) && !/round 4/i.test(v.name) && v.source !== "preset");
  if (!source) throw new Exit("no Hatter voice to copy — make one (a design kept as a take), or name one with --voice");
  const reference = path.join(args["data-dir"], "voices", source.id, "ref.wav");
  if (!existsSync(reference)) throw new Exit(`${source.name} has no clip at ${reference}`);
  const { engines: rows } = await call(server, "/v1/engines/capabilities");

  mkdirSync(args.out, { recursive: true });
  const manifestPath = path.join(args.out, "manifest.json");
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { takes: [] };
  const seen = new Set(manifest.takes.map((t) => t.id));
  const save = () => writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${lines.length} lines × told/not × ${seeds.length} seeds, on ${arms.length} arms; the voice: ${source.name} (${source.id})`);

  for (const arm of arms) {
    const a = ARMS[arm];
    const row = rowOf(rows, a.variant);
    if (!row) throw new Exit(`${arm}: no capability row for ${a.variant}`);
    const name = `${source.name} · round 4 · ${arm}`;
    const { voices: now } = await call(server, "/v1/voices");
    let voice = a.ours ? source : now.find((v) => v.name === name);
    if (!voice) voice = await call(server, `/v1/voices/${source.id}/copy`, { method: "POST", body: { model: row, name } });
    // The voice list leaves the clip's words out; its manifest has them.
    if (a.ours === "icl" && !source.transcript) {
      const manifestFile = path.join(args["data-dir"], "voices", source.id, "manifest.json");
      source.transcript = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")).transcript : null;
      if (!source.transcript) throw new Exit(`${source.name} has no transcript for its clip`);
    }
    if (a.pin) {
      // Pinned for the round; the setting is put back to Auto at the end of the arm.
      await call(server, "/v1/settings", { method: "PATCH", body: { engines: { engine_overrides: { [a.engine]: { placements: { [a.variant]: a.pin } } } } } });
    }
    const bank = a.clip ? await emotionBank(server, args, rows, path.resolve(args.out, "bank")) : null;
    console.log(`\n${arm}: loading ${a.variant} …`);
    const t0 = Date.now();
    await load(server, a.engine, a.variant);
    if (a.ours) await registerWithBase(args.runtime, a.variant, baseModelFile(args["data-dir"], a.engine, a.base));
    console.log(`   loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s; voice ${voice.id}`);
    const armName = args.prime ? `${arm}-primed` : arm;
    const dir = path.join(args.out, armName);
    mkdirSync(dir, { recursive: true });
    for (const l of lines) {
      const lead = args.prime ? PRIME[l.emotion] : null;
      if (args.prime && !lead) throw new Exit(`no lead-in for ${l.emotion} (line ${l.line})`);
      const text = lead ? `${lead} ${l.text}` : l.text;
      for (const told of args.prime ? [true] : [false, true]) {
        for (const seed of seeds) {
          const id = `${armName}/${l.line}-${told ? "told" : "plain"}-${seed}`;
          const wav = path.join(dir, `${l.line}-${told ? "told" : "plain"}-${seed}.wav`);
          // A primed take is written whole first; the cut (`wav`) comes after the aligner.
          const rendered = lead ? wav.replace(/\.wav$/, ".full.wav") : wav;
          if (seen.has(id) && existsSync(rendered)) continue;
          const delivery = told ? (a.clip ? { emotion_clip: bank[l.emotion], emotion_alpha: a.clip } : a.told(l.emotion, l)) : (a.plain ?? null);
          const started = Date.now();
          let error = null;
          try {
            const audio = a.ours
              ? await oursTake(args.runtime, a.variant, {
                  text,
                  voiceRef: path.resolve(reference),
                  transcript: a.ours === "icl" ? source.transcript : null,
                  instruct: told ? delivery.instruct : "",
                  seed,
                })
              : told && a.clip
                ? await runtimeTake(args.runtime, a.variant, { text, voiceRef: path.join(args["data-dir"], "voices", voice.id, "ref.wav"), clip: bank[l.emotion], alpha: a.clip, seed })
                : await call(server, "/v1/generate", {
                    method: "POST",
                    body: { voice: voice.id, text, language: "en", seed, cache: false, delivery },
                    raw: true,
                  });
            writeFileSync(rendered, audio);
          } catch (e) {
            error = String(e.message || e);
            console.log(`   ${id}: ${error}`);
          }
          const entry = {
            id, wav: path.relative(args.out, wav), text: l.text, reference_wav: reference,
            emotion_asked: told ? l.emotion : null, emotion_of_line: l.emotion, cue: l.cue,
            model: armName, variant: a.variant, seed, told, line: l.line, delivery,
            render_s: (Date.now() - started) / 1000, error,
            ...(lead ? { primed: lead, full_wav: path.relative(args.out, rendered), cut_at: null } : {}),
          };
          manifest.takes = manifest.takes.filter((t) => t.id !== id);
          manifest.takes.push(entry);
          seen.add(id);
          save();
        }
      }
    }
    const done = manifest.takes.filter((t) => t.model === armName && !t.error);
    console.log(`   ${done.length} takes; median ${median(done.map((t) => t.render_s)).toFixed(1)} s each`);
    if (a.pin) await call(server, "/v1/settings", { method: "PATCH", body: { engines: { engine_overrides: { [a.engine]: { placements: { [a.variant]: "auto" } } } } } });
    // The app loads its own registration again next time (the runtime reloads a changed entry).
    if (a.ours) await call(server, "/v1/engines/unload", { method: "POST", body: { kind: "tts" } });
  }
  if (args.prime) await cutLeadIns(server, args.out, manifest, save);
}

/** Round 6b step 2: each primed take's lead-in cut off where the app's aligner (`/v1/align`) times
 * the line's first word, 60 ms early, with a 10 ms fade-in. The speech model is unloaded first, so
 * the speech recogniser and its aligner have the card. */
async function cutLeadIns(server, out, manifest, save) {
  const todo = manifest.takes.filter((t) => t.primed && !t.error && t.cut_at == null);
  if (!todo.length) return;
  console.log(`\ncutting ${todo.length} lead-ins …`);
  await call(server, "/v1/engines/unload", { method: "POST", body: { kind: "tts" } });
  for (const t of todo) {
    const full = readFileSync(path.join(out, t.full_wav));
    const form = new FormData();
    form.append("file", new Blob([full], { type: "audio/wav" }), "take.wav");
    form.append("text", `${t.primed} ${t.text}`);
    form.append("language", "en");
    const r = await fetch(`${server}/v1/align`, { method: "POST", body: form, signal: AbortSignal.timeout(900 * 1000) });
    if (!r.ok) throw new Exit(`align ${t.id} -> ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const { words } = await r.json();
    const first = words[splitWords(t.primed).length];
    const [fmt, offset, size] = parseWavHeader(full);
    const frame = fmt.channels * 2;
    const at = Math.max(0, first.start - 0.06);
    const pcm = Buffer.from(full.subarray(offset + Math.floor(at * fmt.sampleRate) * frame, offset + size));
    const fade = Math.floor(0.01 * fmt.sampleRate);
    for (let i = 0; i < fade && (i + 1) * frame <= pcm.length; i++) {
      for (let c = 0; c < fmt.channels; c++) {
        const p = i * frame + c * 2;
        pcm.writeInt16LE(Math.round((pcm.readInt16LE(p) * i) / fade), p);
      }
    }
    writeFileSync(path.join(out, t.wav), writeWavContainer(pcm, fmt.sampleRate, fmt.channels));
    t.cut_at = Math.round(at * 1000) / 1000;
    save();
    console.log(`   ${t.id}: cut at ${t.cut_at} s, before "${first.word}"`);
  }
}

/** The GGUF of an installed variant (`<data>/speech-cache/<engine>/<variant>/…`). */
function baseModelFile(dataDir, engine, variant) {
  const dir = path.join(dataDir, "speech-cache", engine, variant);
  if (!existsSync(dir)) throw new Exit(`${variant} isn't installed (${dir})`);
  const found = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith(".gguf"));
  if (found.length !== 1) throw new Exit(`${dir}: expected one .gguf, found ${found.length}`);
  return path.resolve(dir, String(found[0]));
}

/** Register the app's entry for `id` again on the speech runtime, with our fork's
 * `qwen3_tts.base_model_path` added; the runtime reloads an entry whose options changed. */
async function registerWithBase(runtime, id, baseFile) {
  if (!runtime) throw new Exit("a CustomVoice-with-our-voice arm needs --runtime, the speech runtime's URL");
  const url = runtime.replace(/\/+$/, "");
  const listed = await (await fetch(`${url}/v1/models?include_session_options=true`)).json();
  const entry = listed.data.find((m) => m.id === id);
  if (!entry) throw new Exit(`the speech runtime has no model ${id} — is the app's runtime at ${url}?`);
  const body = {
    id: entry.id,
    family: entry.family,
    task: entry.task,
    mode: entry.mode,
    path: entry.path,
    session_options: { ...(entry.session_options || {}), "qwen3_tts.base_model_path": baseFile },
  };
  const r = await fetch(`${url}/v1/models/load`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(900 * 1000),
  });
  if (!r.ok) throw new Exit(`runtime load ${r.status}: ${(await r.text()).slice(0, 400)}`);
  console.log(`   registered ${id} with qwen3_tts.base_model_path=${baseFile}`);
}

/** One take from CustomVoice speaking the voice's clip (`/v1/tasks/run`): the x-vector alone, or
 * with the clip's words (ICL); `instruct` when told. → WAV bytes. */
async function oursTake(runtime, model, { text, voiceRef, transcript, instruct, seed }) {
  const options = { seed, ...(instruct ? { instruct } : {}), ...(transcript ? {} : { x_vector_only_mode: "true" }) };
  const request = { text, language: "en", voice_ref: voiceRef, options, ...(transcript ? { reference_text: transcript } : {}) };
  const r = await fetch(`${runtime.replace(/\/+$/, "")}/v1/tasks/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, request }),
    signal: AbortSignal.timeout(900 * 1000),
  });
  if (!r.ok) throw new Exit(`runtime ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const body = await r.json();
  if (typeof body.audio !== "string") throw new Exit(`runtime answered no audio: ${JSON.stringify(body).slice(0, 300)}`);
  return Buffer.from(body.audio, "base64");
}

/** The emotion clips, made once: BreezeTTS 2 acting each emotion's sentence in `--bank-voice`'s
 * voice (copied to Breeze), seed 7. → {emotion: wav path}. */
async function emotionBank(server, args, rows, dir) {
  const out = Object.fromEntries(Object.keys(BANK).map((e) => [e, path.join(dir, `${e}.wav`)]));
  if (Object.values(out).every((f) => existsSync(f))) return out;
  if (!args["bank-voice"]) throw new Exit("the emotion clips aren't made yet — name the voice that acts them with --bank-voice");
  const { voices } = await call(server, "/v1/voices");
  const source = voices.find((v) => v.id === args["bank-voice"]);
  if (!source) throw new Exit(`no voice ${args["bank-voice"]}`);
  const name = `${source.name} · round 5 · emotion clips`;
  const row = rowOf(rows, "breeze_tts-q8");
  let voice = voices.find((v) => v.name === name);
  if (!voice) voice = await call(server, `/v1/voices/${source.id}/copy`, { method: "POST", body: { model: row, name } });
  await load(server, "breeze_tts", "breeze_tts-q8");
  mkdirSync(dir, { recursive: true });
  for (const [emotion, [text, instruct]] of Object.entries(BANK)) {
    if (existsSync(out[emotion])) continue;
    const audio = await call(server, "/v1/generate", {
      method: "POST",
      body: { voice: voice.id, text, language: "en", seed: 7, cache: false, delivery: { emotion, instruct } },
      raw: true,
    });
    writeFileSync(out[emotion], audio);
    console.log(`   emotion clip: ${emotion} — “${text}”`);
  }
  return out;
}

/** One take straight from the speech runtime (`/v1/tasks/run`): the voice's clip, the emotion
 * clip as IndexTTS's emotion reference, at `alpha`. → WAV bytes. */
async function runtimeTake(runtime, model, { text, voiceRef, clip, alpha, seed }) {
  if (!runtime) throw new Exit("an emotion-clip arm needs --runtime, the speech runtime's URL");
  const r = await fetch(`${runtime.replace(/\/+$/, "")}/v1/tasks/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, request: { text, language: "en", voice_ref: voiceRef, audio: clip, options: { emotion_alpha: alpha, seed } } }),
    signal: AbortSignal.timeout(900 * 1000),
  });
  if (!r.ok) throw new Exit(`runtime ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const type = r.headers.get("content-type") || "";
  // The task route answers JSON with the WAV in base64 (`audio`).
  if (type.includes("json")) {
    const body = await r.json();
    if (typeof body.audio !== "string") throw new Exit(`runtime answered no audio: ${JSON.stringify(body).slice(0, 300)}`);
    return Buffer.from(body.audio, "base64");
  }
  return Buffer.from(await r.arrayBuffer());
}

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

main().catch((e) => {
  if (e instanceof Exit) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
});
