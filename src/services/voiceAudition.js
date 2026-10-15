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

/** What Lexicons' ▶ and Try a word send to `POST /v1/personas/preview` (2026-10-13): the
 *  line as a render reads it — the book's lexicon, then the persona's (the server's
 *  `lineLexicons`) — with this lexicon in its slot (`after`) or without it. Its slot is the
 *  book's when `book` chose it, else the persona's. `entries` are the editor's, saved or
 *  not, read in place of the lexicon's saved ones. No `book`: the persona's slot alone, as
 *  before (2026-10-09). */
export function lexiconPreviewBody(persona, text, { lexiconId, entries = null, book = null, after = true }) {
  const bookSlot = !!book && book.default_lexicon_id === lexiconId;
  const own = persona.lexicon_id ?? null;
  let personaLexicon;
  if (!bookSlot) personaLexicon = after ? lexiconId : null;
  else personaLexicon = !after && own === lexiconId ? null : own;
  const body = { persona: { ...persona, lexicon_id: personaLexicon }, text };
  if (book && (after || !bookSlot)) body.project_id = book.id;
  if (after && entries) body.draft_lexicon = { id: lexiconId, entries };
  return body;
}

/** What one take of Lexicons' ▶ or Try a word says: the persona, before or after, the words. */
export const lexiconTake = (persona, text, which) => JSON.stringify([persona?.id ?? null, which, String(text || "").trim()]);

/** Whether ▶ replays the take already loaded under `key` (pause / play) rather than asking the
 *  server again: only when that take says the same thing — a changed word or persona is a new
 *  take (2026-10-15: Try a word replayed the old word). */
export const replaysTake = (playerKey, key, heard, take) => playerKey === key && heard === take;

/** A persona saying `text` with one lexicon or without it — Lexicons' ▶ and Try a word
 *  (2026-10-09), through the same preview the persona page uses, so before and after
 *  differ by that lexicon alone. `opts`: lexiconPreviewBody's. */
export function auditionWithLexicon(api, persona, text, opts) {
  return askingToLoad(
    (load) => api.request("/v1/personas/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...lexiconPreviewBody(persona, text, opts), auto_load: load }),
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
