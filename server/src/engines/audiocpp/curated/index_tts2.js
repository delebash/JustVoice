// SPDX-License-Identifier: MIT
// IndexTTS 2 / 2.5 — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-
// catalog.md §4). Round 3's mapping (test branch 1b5bff4; plan §4: "`emotion_text` +
// `use_emotion_text` for IndexTTS"): a line's direction in words goes as emotion text, which its
// built-in emotion model turns into its emotion mix, at audio.cpp's own `emotion_alpha` (1.0)
// unless the model's settings say otherwise. Back to it 2026-10-13 (the narrowings review, E9,
// the lean "back to the words until a test says otherwise"; the user: "your rec on all go"). The
// authors' documented way — an eight-value emotion vector or an emotion clip at a weight "around
// 0.6" (README; RESEARCH §10.8) — is not tested here.

export const DIRECTION = {
  kind: "words",
  option: "emotion_text",
  set: { use_emotion_text: true },
};

// Its capability note says how it takes direction (decided 2026-10-15): in words — not
// "emotion and direction", the note of the families that take an emotion too.
export const DIRECTION_NOTE = "Takes a line's direction in words.";

// Round 3 (RESEARCH §10.6) used this mapping at weight 1.0 — like the book on 12 of 21 tries,
// steady per line, the clip's person kept.
export const TESTED = {
  date: "2026-10-11",
  record: "RESEARCH §10.6, round 3",
  note: "Acted 12 of 21 lines like the book in a blind test, with directions in words; kept the cloned voice.",
};

export const BEST_FOR = ["Acting a cloned voice's emotion"];

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
// audio.cpp's table says "Conditional"; our reading of the licence differs (RESEARCH §10.13).
export const LICENCE = {
  commercial: "Unclear",
  summary: "Unclear. bilibili’s own licence allows it while you earn under RMB 100 million a year (the Chinese text, which governs; the English says 1 billion), and its audio may not be used to train other AI. But one part it runs, MaskGCT’s semantic codec, is non-commercial (CC-BY-NC-4.0), and bilibili’s licence leaves that part to you.",
  url: "https://huggingface.co/IndexTeam/IndexTTS-2.5/blob/main/LICENSE",
  checked: "2026-10-11",
};

// Setting names audio.cpp renamed (its v0.9.2 spec against v0.9.0-jv.5's), old → new: a value saved
// under the old name is read as the new one (docs/plans/2026-10-13-adopt-everything-audiocpp.md
// §2, §4). The runtime still reads each old name (../audio.cpp src/models/index_tts2/request.cpp:171).
export const OLD_OPTION_NAMES = {
  duration_factor: "duration_scale",
};
