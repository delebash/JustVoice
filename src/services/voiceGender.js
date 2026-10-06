// SPDX-License-Identifier: MIT
//
// A voice's gender — ONE answer for every screen (decided 2026-09-30, built
// with the persona redesign 2026-10-03; docs/plans/2026-09-30-voice-gender-
// and-pronouns.md). Until then only the Voices page worked a gender out, so
// a voice showed a gender there and none in the persona editor or on Cast.
//
// The rules, first match wins:
//   - your own override: a stored voice's `gender_user_override`, or a
//     preset's override kept in the renderer prefs (Voices → click the letter);
//   - the voice's own `gender` (Kokoro and Qwen3 presets carry one; a clone
//     carries what you set);
//   - OpenAI's built-in voices from their published canon;
//   - Kokoro ids: <region><f|m>_<name> (af_heart = American Female);
//   - a first name at the start of the voice's name (sarah.wav, Michael);
//   - otherwise unknown ("?").

import { readPref, writePref } from "./prefs.js";

const OPENAI_VOICE_GENDER = {
  alloy: "N", echo: "M", fable: "M", onyx: "M", nova: "F", shimmer: "F",
  ash: "M", coral: "F", sage: "N", verse: "M", ballad: "M",
};
const FIRST_NAME_GENDER = {
  // Female-leaning
  sarah: "F", emma: "F", lily: "F", maya: "F", anna: "F", mara: "F", lisa: "F", rachel: "F", chloe: "F", hannah: "F", grace: "F", sophia: "F", olivia: "F", emily: "F", isabella: "F", ava: "F", mia: "F", abigail: "F", nicole: "F", katie: "F", laura: "F",
  // Male-leaning
  michael: "M", james: "M", john: "M", robert: "M", david: "M", peter: "M", paul: "M", george: "M", thomas: "M", chris: "M", brian: "M", scott: "M", mark: "M", jack: "M", henry: "M", oliver: "M", tom: "M", andrew: "M", daniel: "M",
  // Ambiguous — deliberately omitted: alex, jamie, sam, riley, charlie, taylor, jordan, robin, casey
};

/** Preset overrides live in the renderer prefs (a preset has no stored record). */
export function loadPresetGenderOverrides() {
  const m = readPref("presetGenderOverrides", {});
  return m && typeof m === "object" ? m : {};
}

export function savePresetGenderOverride(id, gender) {
  const map = { ...loadPresetGenderOverrides() };
  if (gender) map[id] = gender;
  else delete map[id];
  writePref("presetGenderOverrides", map);
}

function letter(g) {
  const c = String(g || "").trim().charAt(0).toUpperCase();
  return c === "F" || c === "M" || c === "N" ? c : "";
}

/** "F" · "M" · "N" · "?" — the one-letter chip the Voices table shows. */
export function voiceGender(v) {
  if (!v) return "?";
  if (letter(v.gender_user_override)) return letter(v.gender_user_override);
  if (v.source === "preset") {
    const o = letter(loadPresetGenderOverrides()[v.id]);
    if (o) return o;
  }
  if (letter(v.gender)) return letter(v.gender);
  if (v.engine === "openai" || v.engine?.startsWith("openai")) {
    const m = OPENAI_VOICE_GENDER[v.name?.toLowerCase()];
    if (m) return m;
  }
  if (v.engine === "kokoro") {
    // af_alloy → American Female; bm_george → British Male. The id carries the
    // convention — the display name ('Alloy') doesn't.
    const m = /^[a-z]([fm])_/.exec((v.id || v.name || "").toLowerCase());
    if (m) return m[1] === "f" ? "F" : "M";
  }
  const first = v.name?.toLowerCase()?.split(/[\s._-]/)[0];
  if (first && FIRST_NAME_GENDER[first]) return FIRST_NAME_GENDER[first];
  return "?";
}

// "Not known" is THE word for an unknown gender on every screen (2026-10-06,
// one wording per fact — it was ?, unset, Unset, unknown and Not known).
const WORDS = { F: "Female", M: "Male", N: "Neutral", "?": "Not known" };

/** The word for a gender letter ("F" → "Female", "?" or "" → "Not known"). */
export function genderWord(letter) {
  return WORDS[letter] || WORDS["?"];
}

/** "Female" · "Male" · "Neutral" · "?" — a word, for dropdown labels, where
 *  there is no column heading to explain a letter. */
export function voiceGenderWord(v) {
  return WORDS[voiceGender(v)] || "?";
}
