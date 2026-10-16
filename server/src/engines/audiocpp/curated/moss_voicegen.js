// SPDX-License-Identifier: MIT
// MOSS-VoiceGenerator — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-15 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes. Apache-2.0, as the whole MOSS-TTS family is, built on Qwen3 (Apache-2.0).",
  url: "https://huggingface.co/OpenMOSS-Team/MOSS-VoiceGenerator",
  checked: "2026-10-15",
};

// The line's language: its session reads it only from the request's options
// (src/community_models/moss_voicegen/session.cpp:271-275) — a top-level language reaches only the
// request's text (app/server/server_protocol.cpp:72-75) — as an "Optional full language name, such
// as English or Chinese; not an ISO language code" (its spec; docs/models/moss_voicegen.md:33-34).
// Decided 2026-10-15, TASKS "Slice 2's acceptance findings" 7.
export const LANGUAGE_IN_OPTIONS = "name";
