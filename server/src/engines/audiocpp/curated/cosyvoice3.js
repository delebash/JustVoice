// SPDX-License-Identifier: MIT
// CosyVoice3 — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md
// §4). The released model documents a fixed list of 26 instructions (`cosyvoice/utils/common.py`
// `instruct_list`); its only emotions are three Chinese sentences, and loud / soft are two
// English ones (RESEARCH §10.8). Free English prose outside the list came back plain in round 3,
// so only a line's emotion is sent, as the documented sentence; audio.cpp wraps it as "You are
// a helpful assistant. …<|endofprompt|>". A plain line uses the clip's words when the voice has
// them (zero_shot), else the clip alone (cross_lingual).

export const DIRECTION = {
  kind: "phrases",
  option: "instruction",
  set: { template_name: "instruct" },
  // The instruct template takes no transcript (the official frontend drops the prompt tokens).
  drop_reference_text: true,
  phrases: {
    happy: "请非常开心地说一句话。",
    sad: "请非常伤心地说一句话。",
    angry: "请非常生气地说一句话。",
    shouted: "Please say a sentence as loudly as possible.",
    whispered: "Please say a sentence in a very soft voice.",
  },
};

export const PLAIN = {
  with_reference_text: { template_name: "zero_shot" },
  without_reference_text: { template_name: "cross_lingual" },
};

// Round 3 (RESEARCH §10.6) sent free English prose — like the book on 4 of 21 tries, the clip's
// person kept. The documented sentences above are not yet tested.
export const TESTED = {
  date: "2026-10-11",
  record: "RESEARCH §10.6, round 3",
  note: "Kept the cloned voice; acted 4 of 21 lines with free-text directions (since replaced by the authors' own sentences).",
};

export const BEST_FOR = [];

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes. Apache-2.0. Its “academic purposes only” disclaimer covers the demo examples on its page, not the model.",
  url: "https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512",
  checked: "2026-10-11",
};

// Setting names audio.cpp renamed (its v0.9.2 spec against v0.9.0-jv.5's), old → new: a value saved
// under the old name is read as the new one (docs/plans/2026-10-13-adopt-everything-audiocpp.md
// §2, §4). The runtime still reads each old name (../audio.cpp src/models/cosyvoice3/session.cpp:175).
export const OLD_OPTION_NAMES = {
  instruction: "instruct",
};
