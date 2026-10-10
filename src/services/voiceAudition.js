// SPDX-License-Identifier: MIT
//
// Hear a voice — or a persona — from a list: the ▶ beside a voice anywhere
// but the Voices table (which streams), and the ▶ on a persona row (the
// Personas list, Cast). One door, so the ask-before-load contract is the
// same everywhere: a play never loads a model behind your back unless you
// chose "Always auto-load" (the pref the Voices page shares) — and even then
// it says so (2026-10-07): it asks the server without loading first, so it
// knows a load is coming and shows "Loading …" and "… loaded" either way.
//
// Each returns the WAV Blob, or null when you declined the load. Throws what
// the server said otherwise (the caller runs handleTermsRefusal first).

import { confirmDialog, pushToast } from "@delebash/llm-ui";
import { readPref, writePref } from "./prefs.js";

async function askingToLoad(play, { who, modelName }) {
  const always = readPref("autoLoadEngine") === "always";
  try {
    return await play(false);
  } catch (e) {
    const m = String(e?.message || "").match(/engine_not_loaded:([\w.-]+)/);
    if (!m) throw e;
    const name = modelName || m[1];
    if (!always) {
      const ok = await confirmDialog({
        title: `Load ${name}?`,
        message: `"${who}" speaks on ${name}, which isn't loaded. Load it now to hear it? The first load can take up to a minute; after that it plays at once.`,
        confirmLabel: "Load & play",
      });
      if (!ok) return null;
    }
    pushToast({ message: `Loading ${name}… this can take up to a minute.`, kind: "info" });
    const blob = await play(true);
    pushToast({
      message: `${name} loaded.`,
      kind: "success",
      ...(always ? {} : { action: { label: "Always auto-load", fn: () => writePref("autoLoadEngine", "always") } }),
    });
    // The topbar pill and the Engines page track loads from anywhere.
    window.dispatchEvent(new Event("jv:health-refresh"));
    return blob;
  }
}

/** The voice on its own — its sample, before any persona shapes it. */
export function auditionVoice(api, voice) {
  return askingToLoad(
    (load) => api.request(`/v1/voices/${voice.id}/preview?auto_load=${load}`, { method: "POST" }),
    { who: voice.name, modelName: voice.model_name },
  );
}

/** A persona saying `text` with one lexicon or with none — Lexicons' ▶ and Try a word
 *  (2026-10-09). The persona goes as a draft with its lexicon swapped, through the same
 *  preview the persona page uses, so before and after differ by that lexicon alone; it
 *  reads the lexicon's saved entries. */
export function auditionWithLexicon(api, persona, text, lexiconId) {
  return askingToLoad(
    (load) => api.request("/v1/personas/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona: { ...persona, lexicon_id: lexiconId }, text, auto_load: load }),
    }),
    { who: persona.name, modelName: persona.model_name },
  );
}

/** Effects' A / B (2026-10-09): the persona's line with no effects, the take held on the server
 *  for 10 minutes → `{ take_id, wav_b64, duration_sec, expires_at }`, or null when you declined
 *  the load. POST /v1/effects/apply puts a chain on that same take. */
export function holdDryTake(api, persona, text) {
  return askingToLoad(
    (load) => api.request("/v1/personas/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona: { ...persona, effects_chain: [] }, text, hold: true, auto_load: load }),
    }),
    { who: persona.name, modelName: persona.model_name },
  );
}

/** A saved persona speaking the stock line in its language — through the
 *  same path a chapter renders with (`POST /v1/personas/preview`). */
export function auditionPersona(api, persona) {
  return askingToLoad(
    (load) => api.request("/v1/personas/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona_id: persona.id, auto_load: load }),
    }),
    { who: persona.name, modelName: persona.model_name },
  );
}
