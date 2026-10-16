// SPDX-License-Identifier: MIT
// MOSS-TTSD — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Not settings (the narrowings review, E15): `voice_samples` is per-speaker reference WAV paths on
// the server — the clip is the voice's, which the app sends.
export const HIDDEN_OPTIONS = ["voice_samples"];

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
// audio.cpp's table says "Unclear"; our reading of the licence differs (RESEARCH §10.13).
export const LICENCE = {
  name: "Apache-2.0", // audio.cpp's table has none
  commercial: "Yes",
  summary: "Yes. MOSS-TTSD 1.0 is Apache-2.0, and its makers name podcast production among its uses.",
  url: "https://huggingface.co/OpenMOSS-Team/MOSS-TTSD-v1.0",
  checked: "2026-10-11",
};

// Its direction (the adoption plan's E3: its `instruct` becomes its direction option): the line's
// direction, in words, as its instruction. Not yet tested by JustVoice.
export const DIRECTION = {
  kind: "words",
  option: "instruct",
};

// Its text is speaker-tagged: "Tags are positional: `[S1]` is the first speaker"
// (../audio.cpp/docs/models/moss_ttsd.md:20-21), and so is what the clip says, `reference_text`,
// which it prepends to the dialogue (moss_ttsd.md:53; src/community_models/moss_ttsd/
// session.cpp:364-375). Each line of a line's text, and of the clip's words, is the cloned voice's,
// [S1]'s (decided 2026-10-15, TASKS "Slice 2's acceptance findings" 1; untested: 12 GB).
export const SPEAKER_SCRIPT = "[S1] {text}";

// The line's language: its session reads it only from the request's options
// (src/community_models/moss_ttsd/session.cpp:381-384) — a top-level language reaches only the
// request's text (app/server/server_protocol.cpp:72-75) — as a "Full language name; the model does
// not understand codes like 'en'" (its spec). Decided 2026-10-15, "Slice 2's acceptance findings" 7.
export const LANGUAGE_IN_OPTIONS = "name";

export const TESTED = null;
export const BEST_FOR = [];
