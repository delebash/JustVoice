// SPDX-License-Identifier: MIT
// sanoTTS — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-15 (RESEARCH §10.13); the licence itself is what counts.
// audio.cpp's table says "Yes"; our reading of the licence differs (RESEARCH §10.13).
export const LICENCE = {
  name: "GPL-3.0 (the project); MIT (its runtime)",
  commercial: "Unclear",
  summary: "Depends on the voice. heart and heart-nano learned from Kokoro (Apache-2.0), and kristin from a Piper voice trained on public-domain recordings: yes. The other voices learned from Piper voices whose own cards name non-commercial or unknown recordings, most of them fine-tuned from Piper’s research-only Lessac voice: unclear, though sanoTTS calls all its teachers MIT.",
  url: "https://huggingface.co/ampixa/sanoTTS",
  checked: "2026-10-15",
};
