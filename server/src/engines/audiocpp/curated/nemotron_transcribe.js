// SPDX-License-Identifier: MIT
// NVIDIA Nemotron 3.5 Transcribe 30B-A4B — what audio.cpp's spec can't say (docs/plans/2026-10-11-
// audiocpp-engine-catalog.md §4). Speech recognition in 40 languages; "34B (4.3B active), including
// the audio encoder" (its model card) — more than an 8 GB card holds, which audio.cpp meets with CPU
// expert offload (upstream #1154).

// Its load options, as Fish Audio Drama 3's (curated/fish_drama3.js): since our fork's merge of
// upstream 408935bf (Drama 3 and Nemotron Transcribe on shared MoE execution) its routed experts can
// read from the file into a bounded cache (`disk_experts`, ../audio.cpp docs/models/
// nemotron_transcribe.md "CPU weight offload") — on by default here so its 20.4 GB of experts fit an
// 8 GB card; a bigger card can switch it off on the model's row. Auto then weighs it by its first
// load on the card, not by its files (decided 2026-11-08, docs/plans/2026-11-08-latest-models.md D16).
// What JustVoice measured (2026-11-08, docs/plans/2026-11-08-latest-models.md D18): on our fork's merged
// build, the 8 GB card, Experts from disk and one read thread, its IQ4_NL package took about 5.4 GB of the
// card and wrote every word of the test voice's 10-second clip, in 36 s with the load.
export const TESTED = {
  date: "2026-11-08",
  record: "docs/plans/2026-11-08-latest-models.md D18",
  note: "On an 8 GB card with Experts from disk: about 5.4 GB, every word of a 10-second clip.",
};

// Its experts are read on one thread, as Drama 3's are by audio.cpp's own default: audio.cpp's default
// for Nemotron is 4, and more than one "require[s] ENGINE_ENABLE_OPENMP=ON" (measured 2026-11-08 on the
// card: the load refused) — which upstream's own release builds and ours switch off
// (.github/workflows/release.yml, scripts/audiocpp-dev.js; D18).
export const LOAD_OPTIONS = {
  disk_experts: {
    label: "Experts from disk",
    hint: "Reads the routed experts from the model file as they're needed, so it fits an 8 GB card; switch off on a 24 GB card for speed.",
    default: true,
    keepsWeightsOffCard: true,
  },
  disk_expert_read_threads: {
    label: "Expert read threads",
    hint: "How many workers read the experts from the file. Keep 1: more needs a speech runtime built with OpenMP, and JustVoice's isn't.",
    default: 1,
  },
};

// Its licence in plain words — can a person use it, and what it writes, in work they sell? Our
// reading of the licence at its source, checked 2026-11-05 (RESEARCH §10.13); the licence itself is
// what counts. Its card: "Use of this model is governed by the OpenMDW License Agreement, version 1.1"
// and "This model is ready for commercial or non-commercial use."
export const LICENCE = {
  name: "OpenMDW-1.1",
  commercial: "Yes",
  summary: "Yes. OpenMDW-1.1, and NVIDIA says it’s ready for commercial use. Keep its licence and notices with any copy.",
  url: "https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B",
  checked: "2026-11-05",
};
