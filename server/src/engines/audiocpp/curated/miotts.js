// SPDX-License-Identifier: MIT
// MioTTS — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes. Apache-2.0. It was trained partly on Emilia, a non-commercial dataset; its maker still licenses the model Apache-2.0.",
  url: "https://huggingface.co/Aratako/MioTTS-1.7B",
  checked: "2026-10-11",
};

// MioTTS "requires a reference voice and a MioCodec model" for its acoustic decoding, given as the
// `miotts.codec_model_path` session option (audio.cpp docs/models/miotts.md); its spec doesn't
// name that dependency. The codec downloads with the model (decided 2026-10-11, TASKS "The download
// test's first findings").
export const SESSION_FILES = {
  "miotts.codec_model_path": { family: "miocodec", package: "miocodec_q8_0" },
};
