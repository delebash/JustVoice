// SPDX-License-Identifier: MIT
// Engine presets + the per-ACTION preset refs (the port of justvoice/seed_presets.py; the
// ONE-SOURCE model, 2026-07-15 family shape — JustWrite's seed_presets is the donor).
//
// Passed to `installLlm`. The ACTION is the base; its preset is the truth —
// `DEFAULT_FEATURE_PRESETS` maps each action → its preset id and `DEFAULT_PRESET_ID` is the
// catch-all. The PRESET owns the model + EVERY tunable; the JSON CONTRACT stays on the action
// (seed_feature_prompts).
//
// Temperatures are the measured values lifted off the retired per-row / hardcoded call
// sites (F1 Phase 2, 2026-08-05): attribution & friends 0.2 · show-notes 0.4 · compose 0.9 ·
// persona-rewrite 0.6 · refine 0.2. NO max_tokens anywhere (caps ruling 2026-08-07: empty =
// uncapped). Model per preset ships EMPTY ("" — Quick Setup/manual fills it, the family
// rule); provider is the bundled local runner.
//
// A whole-number float literal of the Python (`0.0`, `10240.0`) is a PyFloat here, so the
// seed writes what Python's does.

import { pyFloatValue as F } from "@delebash/llm-runner/platform/pyjson";

export const DEFAULT_ENGINE_PRESETS = [
  { id: "p_extract", name: "Structured extraction", provider_id: "local-llamacpp", model: "", temperature: 0.2, position: 0 },
  {
    id: "p_classify",
    name: "Deterministic classification",
    provider_id: "local-llamacpp",
    model: "",
    temperature: F(0.0),
    position: 1,
  },
  { id: "p_notes", name: "Grounded summary", provider_id: "local-llamacpp", model: "", temperature: 0.4, position: 2 },
  { id: "p_compose", name: "Creative compose", provider_id: "local-llamacpp", model: "", temperature: 0.9, position: 3 },
  { id: "p_voiced_edit", name: "Voiced rewrite", provider_id: "local-llamacpp", model: "", temperature: 0.6, position: 4 },
  // Named for the SHAPE like its five siblings, never for a feature (renamed 2026-08-08).
  // NOT merged into p_extract despite identical tunables: cleanup returns prose,
  // extraction returns JSON — same knobs, different shape.
  { id: "p_refine", name: "Faithful edit", provider_id: "local-llamacpp", model: "", temperature: 0.2, position: 5 },
  // Structured extraction WITH reasoning — speaker attribution's two routes (2026-09-28,
  // measured: docs/plans/2026-09-28-speaker-attribution-tuning.md). Reasoning took
  // gemma-4-26b-a4b-qat from 928/940 to 937/940 lines right across two books and removed the
  // one systematic miss, at ~1.7x the time. Its own preset so Discover and Smart-assign keep
  // p_extract's speed.
  {
    id: "p_extract_reasoned",
    name: "Reasoned extraction",
    provider_id: "local-llamacpp",
    model: "",
    temperature: 0.2,
    think: true,
    position: 6,
  },
];

// ── JV's model catalog: the family's measured daily driver, plus the 12B and E4B rungs
// (user QC ask 2026-08-06). Rows copied from JW's seed verbatim (the audited facts + the
// seed-facts-audit trail live there); only the user-facing `notes` speak JV's features. The
// MoE's 4B active slice is why it runs acceptably on CPU too.
export const JV_MODEL_CATALOG = [
  {
    id: "gemma-4-26b-a4b-qat",
    name: "Gemma 4 26B-A4B (QAT)",
    hf_repo: "unsloth/gemma-4-26B-A4B-it-qat-GGUF",
    quant: "UD-Q4_K_XL",
    total_params: "26B",
    active_params: "4B",
    mtp: true,
    output_bytes: 415247360,
    layers_nonexp_bytes: 971592640,
    exps_bytes: 12846382080,
    sliding_window: 1024,
    kv_global_bytes_per_token: F(10240.0),
    kv_windowed_bytes_per_token: F(102400.0),
    expert_byte_share: 0.9388753056,
    expert_used_count: 8,
    embedding_length: 2816,
    head_count: 16,
    n_kv_heads: 16,
    block_count: 30,
    size_bytes: 14249047104,
    size_label: "128x2.6B",
    est_vram_mb: 17032,
    type: "moe",
    mtp_draft_file: "MTP/mtp-gemma-4-26B-A4B-it-Q4_0.gguf",
    mtp_draft_quant: "Q4_0",
    samplers: { top_k: "64", top_p: "0.95", temperature: "1" },
    trained_ctx: 262144,
    tier: "low-vram-moe",
    license: "Apache-2.0",
    quality_rank: 5,
    position: 20,
    architecture: "gemma4",
    experts: 128,
    description: "26B mixture-of-experts model · 256k context · MTP draft for faster generation · UD-Q4_K_XL (QAT)",
    notes:
      "The recommended all-rounder — one setup covers speaker attribution, " +
      "dictation cleanup, and the rest of the AI features. Runs on 8 GB " +
      "graphics cards and up (and usably on CPU — only the 4B active slice " +
      "computes per token).",
  },
  {
    id: "gemma-4-12b-qat",
    name: "Gemma 4 12B (QAT)",
    hf_repo: "unsloth/gemma-4-12B-it-qat-GGUF",
    quant: "UD-Q4_K_XL",
    total_params: "12B",
    mtp: true,
    output_bytes: 566246400,
    layers_nonexp_bytes: 6134285824,
    sliding_window: 1024,
    kv_global_bytes_per_token: F(8192.0),
    kv_windowed_bytes_per_token: F(163840.0),
    embedding_length: 3840,
    head_count: 16,
    n_kv_heads: 16,
    block_count: 48,
    est_vram_mb: 10403,
    mtp_draft_file: "MTP/mtp-gemma-4-12B-it-Q4_0.gguf",
    mtp_draft_quant: "Q4_0",
    trained_ctx: 262144,
    samplers: { top_k: "64", top_p: "0.95", temperature: "1" },
    tier: "mid",
    license: "Apache-2.0",
    position: 21,
    quality_rank: 22,
    architecture: "gemma4",
    experts: 0,
    size_label: "12B",
    size_bytes: 6716356800,
    description: "12B model · 256k context · MTP draft for faster generation · UD-Q4_K_XL (QAT)",
    notes:
      "The lighter, faster pick — runs fully on a 10-12 GB graphics card " +
      "(tight on 8 GB) and needs little system RAM.",
  },
  {
    id: "gemma-4-e4b-qat",
    name: "Gemma 4 E4B (QAT)",
    hf_repo: "unsloth/gemma-4-E4B-it-qat-GGUF",
    quant: "UD-Q4_K_XL",
    total_params: "E4B",
    mtp: false,
    output_bytes: 377497600,
    layers_nonexp_bytes: 2221443392,
    sliding_window: 512,
    kv_global_bytes_per_token: F(14336.0),
    kv_windowed_bytes_per_token: F(35840.0),
    embedding_length: 2560,
    head_count: 8,
    n_kv_heads: 2,
    block_count: 42,
    mtp_draft_quant: "Q4_K_S",
    mtp_draft_file: "gemma-4-E4B-it-assistant.Q4_K_S.gguf",
    mtp_draft_repo: "AtomicChat/gemma-4-E4B-it-assistant-GGUF",
    est_vram_mb: 5211,
    size_bytes: 4215695776,
    size_label: "7.5B",
    trained_ctx: 131072,
    samplers: { top_k: "64", top_p: "0.95", temperature: "1" },
    tier: "mid",
    license: "Apache-2.0",
    position: 22,
    quality_rank: 23,
    architecture: "gemma4",
    experts: 0,
    description: "E4B model · 128k context · UD-Q4_K_XL (QAT)",
    notes:
      "Made for laptops with integrated graphics, where the GPU shares " +
      "system memory. Small and quick, and holds its quality well for the size.",
  },
];

// ── The daily driver's MEASURED class tunes (decision ④, 2026-08-05: class tunes are per-app
// data and travel WITH the catalog row) — the family's measured launch configs, copied
// verbatim from the shared seed at the move (the measurement trail lives in JW's
// seed_presets). Without them a fresh JV install launches the 26B on automatic fit — ctx
// 16384 with NO expert offload against a measured ctx 32768 + n_cpu_moe 21 (the family's
// recorded 27-minute lesson). Merge-by-(model, class): a user's Lab-measured row wins. The
// 12B + E4B rungs' rows came with them (2026-08-06): E4B's igpu-mem16 row is MEASURED on the
// family's Iris Xe box; the 12B dgpu rows are the per-band survey's recommendations.
const tune = (model_id, class_key, switches) => ({ model_id, class_key, switches });
const STD = { ctx_len: "32768", batch_size: "512", ubatch_size: "512", reasoning_budget: "1024" };
export const JV_CLASS_TUNES = [
  tune("gemma-4-26b-a4b-qat", "dgpu-vram8|ram32", {
    n_gpu_layers: "99",
    n_cpu_moe: "21",
    ctx_len: "32768",
    batch_size: "512",
    ubatch_size: "512",
    threads: "8",
    reasoning_budget: "1024",
  }),
  tune("gemma-4-e4b-qat", "igpu-mem16", {
    n_gpu_layers: "99",
    ctx_len: "32768",
    batch_size: "512",
    ubatch_size: "512",
    flash_attn: "off",
    reasoning_budget: "1024",
  }),
  tune("gemma-4-12b-qat", "dgpu-vram8|ram16", { n_gpu_layers: "99", ...STD }),
  tune("gemma-4-12b-qat", "dgpu-vram12|ram16", { n_gpu_layers: "99", ...STD }),
  tune("gemma-4-12b-qat", "dgpu-vram12|ram32", { n_gpu_layers: "99", ...STD }),
  tune("gemma-4-12b-qat", "dgpu-vram12|ram64", { n_gpu_layers: "99", ...STD }),
  tune("gemma-4-12b-qat", "dgpu-vram16|ram16", { n_gpu_layers: "99", ...STD }),
  tune("gemma-4-26b-a4b-qat", "igpu-mem32", {
    n_gpu_layers: "99",
    n_cpu_moe: "0",
    ctx_len: "32768",
    batch_size: "512",
    ubatch_size: "512",
    flash_attn: "off",
    reasoning_budget: "1024",
  }),
  tune("gemma-4-26b-a4b-qat", "dgpu-vram16|ram32", { ...STD }),
  tune("gemma-4-26b-a4b-qat", "dgpu-vram16|ram64", { ...STD }),
  tune("gemma-4-26b-a4b-qat", "dgpu-vram24|ram32", { n_gpu_layers: "99", n_cpu_moe: "0", ...STD }),
  tune("gemma-4-26b-a4b-qat", "dgpu-vram24|ram64", { n_gpu_layers: "99", n_cpu_moe: "0", ...STD }),
];

// What the tunes were measured on — binds them by identity if the row is ever renamed here
// (the docgen `-xl` id is the measured precedent for why).
export const JV_CLASS_TUNE_IDENTITY = {
  "gemma-4-26b-a4b-qat": { hf_repo: "unsloth/gemma-4-26B-A4B-it-qat-GGUF", quant: "UD-Q4_K_XL" },
  "gemma-4-12b-qat": { hf_repo: "unsloth/gemma-4-12B-it-qat-GGUF", quant: "UD-Q4_K_XL" },
  "gemma-4-e4b-qat": { hf_repo: "unsloth/gemma-4-E4B-it-qat-GGUF", quant: "UD-Q4_K_XL" },
};

// The preset refs. Speaker attribution's routes each route on their OWN action ref (the
// attribution restore, 2026-08-06). A feature whose rows are PIECES (dictation cleanup)
// routes ONCE at the FEATURE key — the pieces follow it through the resolver's feature layer
// (action ref → feature ref → default).
export const DEFAULT_FEATURE_PRESETS = {
  // Speaker attribution — two routed cards, same preset: Reasoned extraction (think on,
  // 2026-09-28 by measurement — see p_extract_reasoned above).
  "speaker_attribution.guided": "p_extract_reasoned",
  "speaker_attribution.direct": "p_extract_reasoned",
  // Find new speakers — its own runnable card, its own ref.
  "speaker_attribution.identify": "p_extract",
  // Analyze's second look — no thinking, at temperature 0 (decided 2026-10-06): at
  // p_extract's 0.2 it declined a line it could answer about one time in four; at 0 the 30
  // answer-keyed lines came back 30 right, 0 wrong (docs/plans/2026-10-05-second-look-test.md).
  speaker_second_look: "p_classify",
  smart_assign: "p_extract",
  // Deterministic classification
  voice_gender: "p_classify",
  // Grounded summary
  show_notes: "p_notes",
  // Persona voice
  compose: "p_compose",
  persona_rewrite: "p_voiced_edit",
  // Dictation cleanup — ONE chooser; the four section rows are pieces of the one composed
  // call and follow the feature ref.
  refine: "p_refine",
};

// Catch-all for an action with no ref (custom Lab actions before assignment).
export const DEFAULT_PRESET_ID = "p_notes";

// §7.3 Lab test samples — authored against each action's own RUN contract (the SAMPLE LAW,
// amended 2026-08-06 — "samples represent real world text": the attribution adapter feeds the
// REAL pipeline, which segments and adds the [D#] tags itself, so its sample is raw prose
// exactly as a user would paste it; its speakers box is plain names). SYNTHESIZED, never real
// user data. Fill-if-empty per (action, label). The attribution sample is the ORIGINAL
// Speaker Lab's cellar passage, word for word.
const ATTR_SAMPLE_VARS = {
  speakers: "Mara\nSarah",
  corrections: "",
  paragraphs:
    "Mara stood at the rail. The fog clawed at her ankles.\n\n" +
    '"Where are you going?" Sarah asked.\n\n' +
    '"Down," Mara said. "There\'s something in the cellar."\n\n' +
    'Sarah didn\'t move. "Are you sure?"\n\n' +
    '"No."',
};

export const DEFAULT_TEST_SAMPLES = [
  {
    actions: ["speaker_attribution.guided", "speaker_attribution.direct"],
    label: "Cellar scene — the original Speaker Lab sample",
    variables: ATTR_SAMPLE_VARS,
  },
  {
    actions: ["speaker_attribution.identify"],
    label: "Discover the harbor-master",
    variables: {
      known_speakers: "- Mara\n- Renn",
      manuscript:
        '"Boats out past the light again," the harbor-master said, ' +
        "nailing the notice to the gate. Mara read it twice. " +
        '"And you\'ll say nothing," she said. "Nothing worth coin," he said.',
    },
  },
  {
    actions: ["smart_assign"],
    label: "Two leads, four voices",
    variables: {
      speakers:
        '- id="c_mara", name="Mara" — dry, mid-30s archivist\n' +
        '- id="c_harbek", name="Old Harbek" — gravelly harbor-master, 70s',
      personas:
        '- id="v_finch", name="Finch" — bright youthful female\n' +
        '- id="v_slate", name="Slate" — low weathered male\n' +
        '- id="v_reed", name="Reed" — neutral mid male\n' +
        '- id="v_lark", name="Lark" — warm adult female',
    },
  },
  {
    actions: ["show_notes"],
    label: "Two-segment episode",
    variables: {
      script:
        "## The Ledger\n" +
        "MARA: The ink changes mid-entry. Same hand, different script.\n" +
        "RENN: The harbor-master's script. You know it is.\n" +
        "## The Quay\n" +
        "NARRATION: The tide turned below the floorboards.\n" +
        "MARA: Then we ask him tonight.",
    },
  },
  {
    actions: ["compose"],
    label: "Weathered harbor-master",
    variables: {
      personality:
        "Old Harbek — gravel-voiced harbor-master, 70s. Speaks in " +
        "short, salt-worn sentences; never wastes a word; dry humor " +
        "that lands like weather observations.",
    },
  },
  {
    actions: ["persona_rewrite"],
    label: "Line into Harbek's voice",
    variables: {
      personality:
        "Old Harbek — gravel-voiced harbor-master, 70s. Speaks in " +
        "short, salt-worn sentences; never wastes a word; dry humor " +
        "that lands like weather observations.",
      text: "I think we should probably wait until the morning to go out there.",
    },
  },
  {
    actions: ["refine.base"],
    label: "A question to tidy, not to answer",
    variables: { transcript: "um can you check whether the uh backup ran last night or should i start it again" },
  },
  {
    actions: ["refine.smart_cleanup"],
    label: "Filler words, no punctuation",
    variables: {
      transcript: "okay so um the garden centre called and uh basically the hedge trimmers are like ready to collect on saturday",
    },
  },
  {
    actions: ["refine.self_correction"],
    label: "A spoken change of mind",
    variables: {
      transcript: "the quarterly figures go to marta sorry i mean to the whole finance team by the end of next week",
    },
  },
  {
    actions: ["refine.preserve_technical"],
    label: "A command and a file name, said aloud",
    variables: {
      transcript: "run git checkout dash b feature slash login then open config dot yaml in the uh project root",
    },
  },
  {
    actions: ["speaker_second_look"],
    label: "The voice in the dark — named in the next chapter",
    variables: {
      cast: '- id="cael", name="Cael"\n- id="iven", name="Iven"\n- id="ode", name="Ode"',
      before: "(none — this is the first chapter)",
      chapter:
        "The candle burned. Out beyond the ring of their light, someone was waiting.\n\n" +
        "⟦“You always find the candle first. Every time.”⟧",
      after:
        "“Don't answer it,” Iven said. A woman stepped into the light. “I'm Ode,” she " +
        "said. “I've been waiting for you to find the candle.”",
      line: "“You always find the candle first. Every time.”",
    },
  },
  {
    actions: ["voice_gender"],
    label: "Catalog batch with an ambiguous name",
    variables: {
      voices:
        "- Finch — bright youthful voice\n" +
        "- Marcus — deep narrator\n" +
        "- Ryo — soft-spoken\n" +
        "- af_bella — preset voice",
    },
  },
];
