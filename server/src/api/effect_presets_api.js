// SPDX-License-Identifier: MIT
// /v1/effect-presets — saved effect chains the user can apply to a Persona's effects_chain from
// the EffectsChainEditorModal (the port of justvoice/api/effect_presets_api.py).
//
// Slice 7 of the Profile-kill plan / Effects v1 wiring. Pairs with the render-time effects
// pipeline (audio/effects.js). A preset is just a named chain + sort order + optional
// description. The /catalog endpoint exposes the 11 supported effect types so the modal can
// render the right parameter form per effect. /v1/effects/apply puts a chain on a held take — the
// chain editor's A / B.

import { randomUUID } from "node:crypto";
import { Hono, input } from "@delebash/llm-runner/platform";
import { nullable, opt, T } from "@delebash/llm-runner/platform/models";
import { strRepr } from "@delebash/llm-runner/platform/py";
import { pyJson, pyJsonParse } from "@delebash/llm-runner/platform/pyjson";
import { applyEffectsChain, chainEntries } from "../audio/effects.js";
import { EffectPreset, uuid } from "../database/models.js";
import * as session from "../database/session.js";
import { badRequest, notFound } from "../errors.js";
import { construct, DateTime } from "../models.js";
import { TTLCache } from "./voice_preview_api.js";

// ── Effect type catalog ──────────────────────────────────────────────────

export const EffectParam = T.Object({
  key: T.String(),
  label: T.String(),
  type: T.String(), // "number" | "boolean"
  default: T.Union([T.Number(), T.Boolean()]),
  min: opt(nullable(T.Number()), null),
  max: opt(nullable(T.Number()), null),
  step: opt(nullable(T.Number()), null),
});

export const EffectType = T.Object({
  type: T.String(),
  label: T.String(),
  description: T.String(),
  params: T.Array(EffectParam),
});

const p = (key, label, dflt, min, max, step) => ({ key, label, type: "number", default: dflt, min, max, step });

// Mirrors the effects audiocpp_dsp knows (our audio.cpp fork's dsp/src/effects.cpp table, and
// audio/effects.js's list). Per-effect parameter schemas drive the modal's input rendering.
export const EFFECT_CATALOG = [
  {
    type: "reverb",
    label: "Reverb",
    description: "Space simulation — room, hall, cathedral.",
    params: [
      p("room_size", "Room size", 0.5, 0.0, 1.0, 0.05),
      p("damping", "Damping", 0.5, 0.0, 1.0, 0.05),
      p("wet_level", "Wet", 0.33, 0.0, 1.0, 0.05),
      p("dry_level", "Dry", 0.4, 0.0, 1.0, 0.05),
      p("width", "Width", 1.0, 0.0, 1.0, 0.05),
    ],
  },
  {
    type: "distortion",
    label: "Distortion",
    description: "Asymmetric saturation — drive in dB.",
    params: [p("drive_db", "Drive (dB)", 25.0, 0.0, 60.0, 1.0)],
  },
  {
    type: "gain",
    label: "Gain",
    description: "Linear level adjust in dB. Use negative for cut.",
    params: [p("gain_db", "Gain (dB)", 0.0, -24.0, 24.0, 0.5)],
  },
  {
    type: "compressor",
    label: "Compressor",
    description: "Reduces dynamic range — broadcast / podcast staple.",
    params: [
      p("threshold_db", "Threshold (dB)", -16.0, -60.0, 0.0, 1.0),
      p("ratio", "Ratio", 2.5, 1.0, 20.0, 0.1),
      p("attack_ms", "Attack (ms)", 1.0, 0.1, 200.0, 0.5),
      p("release_ms", "Release (ms)", 100.0, 10.0, 2000.0, 10.0),
    ],
  },
  {
    type: "pitch_shift",
    label: "Pitch shift",
    description: "Re-pitch in semitones. Wide ranges introduce artefacts.",
    params: [p("semitones", "Semitones", 0.0, -12.0, 12.0, 0.5)],
  },
  {
    type: "delay",
    label: "Delay",
    description: "Echo with feedback.",
    params: [
      p("delay_seconds", "Delay (s)", 0.5, 0.0, 4.0, 0.05),
      p("feedback", "Feedback", 0.0, 0.0, 1.0, 0.05),
      p("mix", "Mix", 0.5, 0.0, 1.0, 0.05),
    ],
  },
  {
    type: "highpass",
    label: "High-pass",
    description: "Cut below cutoff frequency.",
    params: [p("cutoff_frequency_hz", "Cutoff (Hz)", 80.0, 20.0, 2000.0, 10.0)],
  },
  {
    type: "lowpass",
    label: "Low-pass",
    description: "Cut above cutoff frequency.",
    params: [p("cutoff_frequency_hz", "Cutoff (Hz)", 12000.0, 500.0, 20000.0, 100.0)],
  },
  {
    type: "eq_low",
    label: "EQ — Low shelf",
    description: "Boost or cut below cutoff with shelf curve.",
    params: [
      p("cutoff_frequency_hz", "Cutoff (Hz)", 120.0, 20.0, 500.0, 10.0),
      p("gain_db", "Gain (dB)", 0.0, -12.0, 12.0, 0.5),
      p("q", "Q", 0.7, 0.1, 4.0, 0.1),
    ],
  },
  {
    type: "eq_mid",
    label: "EQ — Mid peak",
    description: "Boost or cut around centre frequency.",
    params: [
      p("cutoff_frequency_hz", "Centre (Hz)", 1000.0, 100.0, 8000.0, 50.0),
      p("gain_db", "Gain (dB)", 0.0, -12.0, 12.0, 0.5),
      p("q", "Q", 1.0, 0.1, 4.0, 0.1),
    ],
  },
  {
    type: "eq_high",
    label: "EQ — High shelf",
    description: "Boost or cut above cutoff with shelf curve.",
    params: [
      p("cutoff_frequency_hz", "Cutoff (Hz)", 4000.0, 1000.0, 12000.0, 100.0),
      p("gain_db", "Gain (dB)", 0.0, -12.0, 12.0, 0.5),
      p("q", "Q", 0.7, 0.1, 4.0, 0.1),
    ],
  },
];

export const EffectCatalogResponse = T.Object({ effects: T.Array(EffectType) });

// ── Effect-chain presets (saved chains) ──────────────────────────────────

export const EffectPresetResponse = T.Object({
  id: T.String(),
  name: T.String(),
  description: opt(nullable(T.String()), null),
  chain: T.Array(T.Record(T.String(), T.Any())),
  is_builtin: T.Boolean(),
  sort_order: T.Integer(),
  created_at: DateTime(),
});

export const EffectPresetList = T.Object({ presets: T.Array(EffectPresetResponse) });

export const CreateEffectPresetRequest = T.Object({
  name: T.String({ minLength: 1, maxLength: 80 }),
  description: opt(nullable(T.String({ maxLength: 400 })), null),
  chain: opt(T.Array(T.Record(T.String(), T.Any())), []),
  sort_order: opt(T.Integer(), 100),
});

export const UpdateEffectPresetRequest = T.Object({
  name: opt(nullable(T.String({ minLength: 1, maxLength: 80 })), null),
  description: opt(nullable(T.String({ maxLength: 400 })), null),
  chain: opt(nullable(T.Array(T.Record(T.String(), T.Any()))), null),
  sort_order: opt(nullable(T.Integer()), null),
});

// ── A / B: one take, the chain off and on (2026-10-09, mock _s11) ──────────
// The chain editor's ▶ Dry asks the persona preview for its line with no effects and `hold`;
// the take is kept here for 10 minutes and ▶ Wet puts the chain on that same audio. Two
// renders would be two takes on a model that samples.

export const HELD_TAKE_TTL_S = 10 * 60;
export const heldTakes = new TTLCache(16, HELD_TAKE_TTL_S);

/** Hold a take (WAV bytes) → `[its id, when it lapses (unix seconds)]`. */
export function holdTake(wav) {
  const id = randomUUID();
  heldTakes.set(id, wav);
  return [id, Date.now() / 1000 + HELD_TAKE_TTL_S];
}

/** The persona preview's answer with `hold`: the take, and the id to put a chain on it. */
export const HeldTakeResponse = T.Object({
  take_id: T.String(),
  wav_b64: T.String(),
  duration_sec: T.Number(),
  expires_at: T.Number(), // unix timestamp
});

export const ApplyEffectsRequest = T.Object({
  take_id: T.String(),
  chain: opt(T.Array(T.Record(T.String(), T.Any())), []),
});

/** `EffectPresetResponse.from_orm(row)`: the stored chain read as Python's json.loads (a
 * whole-number float stays a float), anything unreadable or not a list → []. */
export function fromOrm(row) {
  let chain;
  try {
    chain = pyJsonParse(row.chain_json || "[]");
  } catch {
    chain = [];
  }
  if (!Array.isArray(chain)) chain = [];
  return construct(EffectPresetResponse, {
    id: row.id,
    name: row.name,
    description: row.description,
    chain,
    is_builtin: row.is_builtin,
    sort_order: row.sort_order,
    created_at: row.created_at,
  });
}

const byId = (h, id) => h.one(`select * from ${EffectPreset} where id = ? limit 1`, [id], EffectPreset);

/** `json.dumps(body.chain)` — a list of free dicts, its floats as sent (the routes read
 * PyFloats). */
const dumpChain = (chain) => pyJson(chain);

export function router() {
  const app = new Hono();
  /** The 11 supported effect types + their parameter schemas for the EffectsChainEditorModal. */
  app.get("/v1/effects/catalog", (c) => c.json(construct(EffectCatalogResponse, { effects: EFFECT_CATALOG })));

  /** A held take with `chain` on it, as audio/wav — the chain as a render runs it, after the
   * persona's pace, pitch and gain. 404 once the take has lapsed. */
  app.post("/v1/effects/apply", input({ body: ApplyEffectsRequest }), async (c) => {
    const body = c.req.valid("json");
    const wav = heldTakes.get(body.take_id);
    if (wav === undefined) throw notFound(`take ${body.take_id} — a take is kept 10 minutes; hear it dry again`);
    return c.body(await applyEffectsChain(wav, chainEntries(body.chain)), 200, { "content-type": "audio/wav" });
  });

  app.get("/v1/effect-presets", (c) => {
    const rows = session.getDb().all(`select * from ${EffectPreset} order by sort_order, created_at`, undefined, EffectPreset);
    return c.json({ presets: rows.map(fromOrm) });
  });

  app.post("/v1/effect-presets", input({ body: CreateEffectPresetRequest, pyFloats: true }), (c) => {
    const h = session.getDb();
    const body = c.req.valid("json");
    if (h.one(`select id from ${EffectPreset} where name = ? limit 1`, [body.name]) !== null) {
      throw badRequest(`effect preset name ${strRepr(body.name)} already exists`);
    }
    const id = uuid();
    h.insert(EffectPreset, {
      id,
      name: body.name,
      description: body.description,
      chain_json: dumpChain(body.chain),
      is_builtin: false,
      sort_order: body.sort_order,
    });
    return c.json(fromOrm(byId(h, id)), 201);
  });

  app.patch("/v1/effect-presets/:preset_id", input({ body: UpdateEffectPresetRequest, pyFloats: true }), (c) => {
    const h = session.getDb();
    const presetId = c.req.param("preset_id");
    const body = c.req.valid("json");
    const row = byId(h, presetId);
    if (row === null) throw notFound(`effect preset ${presetId}`);
    if (row.is_builtin) throw badRequest("built-in effect presets are read-only — duplicate and edit instead");
    const set = {};
    if (body.name !== null) {
      const clash = h.one(`select id from ${EffectPreset} where name = ? and id != ? limit 1`, [body.name, presetId]);
      if (clash !== null) throw badRequest(`effect preset name ${strRepr(body.name)} already exists`);
      set.name = body.name;
    }
    if (body.description !== null) set.description = body.description;
    if (body.chain !== null) set.chain_json = dumpChain(body.chain);
    if (body.sort_order !== null) set.sort_order = body.sort_order;
    if (Object.keys(set).length) h.update(EffectPreset, set, { id: presetId });
    return c.json(fromOrm(byId(h, presetId)));
  });

  app.delete("/v1/effect-presets/:preset_id", (c) => {
    const h = session.getDb();
    const presetId = c.req.param("preset_id");
    const row = byId(h, presetId);
    if (row === null) throw notFound(`effect preset ${presetId}`);
    if (row.is_builtin) throw badRequest("built-in effect presets cannot be deleted");
    h.delete(EffectPreset, { id: presetId });
    return c.json({ deleted: true });
  });
  return app;
}
