// SPDX-License-Identifier: MIT
// Made-up states over real facts for the Speech engines mock (#/mock/speech-engines, dev only;
// docs/plans/2026-10-11-audiocpp-engine-catalog.md slice 4). Names, licences, audio.cpp statuses,
// languages, download sizes and memory needs are the real ones (server/src/engines/audiocpp/
// catalog.json, 2026-10-11); each licence in plain words, and our commercial-use word, comes from
// the engine's own curated file, the one the server reads. Which models are on disk or loaded,
// and which licences are accepted, are made up to show each state.

import { CURATED } from "../../../server/src/engines/audiocpp/curated/index.js";

export const CARD_GB = 8; // this machine's graphics card: RTX 2070 SUPER, 8 GB

export const ENGINES = [
  {
    id: "kokoro",
    family: "kokoro_tts",
    name: "Kokoro",
    description: "Kokoro-82M: a small, fast multilingual voice with 54 built-in voices.",
    licence: { name: "Apache-2.0", commercial: "Yes", notes: "", url: "https://huggingface.co/hexgrad/Kokoro-82M" },
    status: "community",
    tested: { note: "Wired and measured by JustVoice (2026-10-01)." },
    bestFor: ["Ready-made voices, fast, on any machine", "Minor speakers in a large cast"],
    termsAccepted: true,
    models: [
      { id: "kokoro-82m-q8", name: "Kokoro 82M", langs: 9, cloning: false, presets: 54, directedBy: "sliders", sizeMb: 190, needGb: 1, onDisk: true, loaded: true },
      { id: "kokoro-82m-bf16", name: "Kokoro 82M (16-bit)", langs: 9, cloning: false, presets: 54, directedBy: "sliders", sizeMb: 212, needGb: 1, onDisk: false },
    ],
  },
  {
    id: "index_tts2",
    name: "IndexTTS2",
    description: "Bilibili IndexTTS2 zero-shot voice cloning with emotion control from a reference clip, a vector or words.",
    licence: {
      name: "bilibili Model Use License",
      commercial: "Conditional",
      notes: "A separate license is needed above RMB 1 billion yearly revenue or 100 million monthly users. The model and its outputs may not be used to improve other commercial AI models.",
      url: "https://huggingface.co/IndexTeam/IndexTTS-2.5/blob/main/LICENSE",
    },
    status: "supported",
    tested: { note: "Acted 12 of 21 lines like the book in a blind test, with directions in words; kept the cloned voice." },
    bestFor: ["Acting a cloned voice's emotion"],
    termsAccepted: false,
    models: [
      { id: "index_tts2-indextts25-q8", name: "IndexTTS2.5", langs: 5, cloning: true, presets: 0, directedBy: "words", sizeMb: 3341, needGb: 8, onDisk: false },
      { id: "index_tts2-indextts2-q8", name: "IndexTTS2", langs: 5, cloning: true, presets: 0, directedBy: "words", sizeMb: 3466, needGb: 8, onDisk: false },
    ],
  },
  {
    id: "cosyvoice3",
    name: "CosyVoice3",
    description: "Fun-CosyVoice3 for zero-shot, cross-lingual and instruction-conditioned speech.",
    licence: { name: "Apache-2.0", commercial: "Yes", notes: "", url: "https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512" },
    status: "supported",
    tested: { note: "Kept the cloned voice; acted 4 of 21 lines with free-text directions (since replaced by the authors' own sentences)." },
    bestFor: [],
    termsAccepted: true,
    models: [
      { id: "cosyvoice3-q8", name: "CosyVoice3", langs: 10, cloning: true, presets: 0, directedBy: "words", sizeMb: 2153, needGb: 8, onDisk: true },
    ],
  },
  {
    id: "higgs_audio_tts",
    name: "Higgs Audio v3 TTS",
    description: "Boson Higgs Audio v3 4B: expressive speech with emotion and style tags, and voice cloning.",
    licence: {
      name: "Boson Higgs TTS 3 Research and Non-Commercial License",
      commercial: "No",
      notes: "",
      url: "https://huggingface.co/bosonai/higgs-tts-3-4b/blob/main/LICENSE",
    },
    status: "supported",
    tested: null,
    bestFor: [],
    termsAccepted: false,
    models: [
      { id: "higgs_audio_tts-q8", name: "Higgs Audio v3 TTS", langs: 1, cloning: true, presets: 0, directedBy: "words", sizeMb: 4859, needGb: 6, onDisk: false },
    ],
  },
  {
    id: "omnivoice",
    name: "OmniVoice",
    description: "k2-fsa OmniVoice: zero-shot speech in 600+ languages with short-reference voice cloning.",
    licence: {
      name: "CC-BY-NC",
      commercial: "No",
      notes: "Changed from Apache-2.0 on 2026-07-03, \"due to constraints from its training data\". The code is Apache-2.0.",
      url: "https://huggingface.co/k2-fsa/OmniVoice#license",
    },
    status: "supported",
    tested: null,
    bestFor: [],
    termsAccepted: false,
    models: [
      { id: "omnivoice-q8", name: "OmniVoice", langs: 1, cloning: true, presets: 0, directedBy: "sliders", sizeMb: 1288, needGb: 10, onDisk: false },
    ],
  },
  {
    id: "moss_ttsd",
    name: "MOSS-TTSD",
    description: "MOSS-TTSD dialogue speech with per-speaker voice cloning.",
    licence: { name: "Not in audio.cpp's licence table", commercial: "Unclear", notes: "", url: "" },
    status: "experimental",
    tested: null,
    bestFor: [],
    termsAccepted: false,
    models: [
      { id: "moss_ttsd-q8", name: "MOSS-TTSD", langs: 2, cloning: true, presets: 0, directedBy: "sliders", sizeMb: 12437, needGb: null, onDisk: false },
    ],
  },
];

// Each licence in plain words (decided 2026-10-11): `commercial` becomes our reading of the
// licence, `table` keeps audio.cpp's word, `summary` answers "can I sell an audiobook made with it?".
for (const e of ENGINES) {
  const l = CURATED[e.family ?? e.id].LICENCE;
  e.licence = { ...e.licence, name: l.name ?? e.licence.name, table: e.licence.commercial, commercial: l.commercial, summary: l.summary, url: l.url, checked: l.checked };
}

// audio.cpp's own words for commercial use (decided 2026-10-11, answer 1).
export const COMMERCIAL_USE = ["Yes", "Conditional", "No", "Unclear"];

// What each word means, under it in the filter's open list (decided 2026-10-11, TASKS "Every
// speech engine's licence in plain words").
export const COMMERCIAL_HINTS = {
  Yes: "Sell what you make with it — no conditions.",
  Conditional: "Sell what you make if you meet its conditions — credit, a revenue cap. Hover a model's licence to see them.",
  No: "Personal and research use only — don't sell what you make.",
  Unclear: "The licence doesn't say. Treat it as No until it's checked.",
};
