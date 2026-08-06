# SPDX-License-Identifier: MIT
"""Engine presets + the per-ACTION preset refs (the ONE-SOURCE model, 2026-07-15
family shape; JustWrite's `seed_presets.py` is the donor).

Passed to `install_llm` (app.py). The ACTION is the base; its preset is the
truth — `DEFAULT_FEATURE_PRESETS` maps each action → its preset id and
`DEFAULT_PRESET_ID` is the catch-all. The PRESET owns the model + EVERY tunable;
the JSON CONTRACT stays on the action (`seed_feature_prompts.py`).

Temperatures are TODAY'S measured values lifted off the retiring per-row /
hardcoded call sites (behavior-preserving migration, F1 Phase 2 2026-08-05):
attribution & friends 0.2 · preset-suggest 0.0 · show-notes 0.4 · compose 0.9
(was hardcoded at personas_api.py:270 — ruling 9 moves it onto the preset) ·
persona-rewrite 0.6 · refine 0.2/2048. Callers with dynamic token budgets
(attribution's 12×dialogue, smart-assign's 80×characters, rewrite's
length-based) keep passing them as per-call RunRequest.maxTokens — code
computes VALUES, presets own defaults. A user's hand-changed row temperature
from the old system lifts onto the assigned preset at migration
(engines/llm/migrate_prompts.py).

Model per preset ships EMPTY ("" — Quick Setup/manual fills it, the family
rule); provider is the bundled local runner. Until the user runs Quick Setup,
dispatch guards the pre-setup state with its run-Quick-Setup message — the
clean-drop semantics ruling 1 accepted.
"""

from __future__ import annotations

DEFAULT_ENGINE_PRESETS: list[dict] = [
    {"id": "p_extract", "name": "Structured extraction", "provider_id": "local-llamacpp",
     "model": "", "temperature": 0.2, "position": 0},
    {"id": "p_classify", "name": "Deterministic classification", "provider_id": "local-llamacpp",
     "model": "", "temperature": 0.0, "max_tokens": 200, "position": 1},
    {"id": "p_notes", "name": "Grounded summary", "provider_id": "local-llamacpp",
     "model": "", "temperature": 0.4, "position": 2},
    {"id": "p_compose", "name": "Creative compose", "provider_id": "local-llamacpp",
     "model": "", "temperature": 0.9, "max_tokens": 300, "position": 3},
    {"id": "p_voiced_edit", "name": "Voiced rewrite", "provider_id": "local-llamacpp",
     "model": "", "temperature": 0.6, "position": 4},
    {"id": "p_refine", "name": "Dictation cleanup", "provider_id": "local-llamacpp",
     "model": "", "temperature": 0.2, "max_tokens": 2048, "position": 5},
    # Speaker attribution's own preset (the 2026-08-06 rework): think ON is the
    # task's tested want — the runner's CAPABILITY GATE turns it into "thinks on
    # models that can, cleanly off elsewhere" (the old forced-Reasoned behavior,
    # now built from standard parts). Same measured 0.2 temperature family.
    {"id": "p_read", "name": "Careful reading", "provider_id": "local-llamacpp",
     "model": "", "temperature": 0.2, "think": True, "position": 6},
]

# ── JV's model catalog (user direction 2026-08-05, QC of the AI area): the
# family's measured daily driver ONLY. (The shared writing-curated
# DEFAULT_CATALOG its 12B/E4B/style-tune/uncensored rows came from is EMPTY
# since decision ④ — every app seeds its own catalog; there is no suppress
# flag anymore.) Row copied from
# JW's DEFAULT_MODEL_CATALOG_EXTRA verbatim; only the user-facing `notes`
# speak JV's features (the 2026-07-25 ruling: box-independent plain words).
# The MoE's 4B active slice is why it runs acceptably on CPU too — the floors
# say so (min_vram 4 GB with CPU expert offload; binary-MB convention).
JV_MODEL_CATALOG: list[dict] = [
    {"id": "gemma-4-26b-a4b-qat", "name": "Gemma 4 26B-A4B (QAT)",
     "hf_repo": "unsloth/gemma-4-26B-A4B-it-qat-GGUF", "quant": "UD-Q4_K_XL",
     "total_params": "26B", "active_params": "4B", "mtp": True, "size_bytes": 14249045120, "size_label": "128x2.6B", "est_vram_mb": 17713, "type": "moe",
     "mtp_draft_file": "MTP/mtp-gemma-4-26B-A4B-it-Q4_0.gguf", "mtp_draft_quant": "Q4_0",
     "samplers": {"top_k": "64", "top_p": "0.95", "temperature": "1"},
     "trained_ctx": 262144, "min_vram_mb": 4096, "min_ram_mb": 24576,
     "tier": "low-vram-moe", "license": "Apache-2.0", "quality_rank": 5, "position": 20,
     "architecture": "gemma4", "experts": 128,
     "description": "26B mixture-of-experts model · 256k context · MTP draft for faster generation · UD-Q4_K_XL (QAT)",
     "notes": "The recommended all-rounder — one setup covers speaker attribution, "
              "dictation cleanup, and the rest of the AI features. Runs on 8 GB "
              "graphics cards and up (and usably on CPU — only the 4B active slice "
              "computes per token); thinking is managed per task automatically."},
]

# ── The daily driver's MEASURED class tunes (decision ④, 2026-08-05: class tunes
# are per-app data and travel WITH the catalog row). These six rows are the
# family's measured launch configs for exactly the model above, copied verbatim
# from the shared seed at the move (the measurement trail lives in JW's
# seed_presets.py, which carries the full 13-row library). Without them a fresh
# JV install launches the 26B on automatic fit — ctx 16384 with NO expert
# offload against a measured ctx 32768 + n_cpu_moe 21 (the family's recorded
# 27-minute lesson). Merge-by-(model, class): a user's Lab-measured row wins.
JV_CLASS_TUNES: list[dict] = [
    {"model_id": "gemma-4-26b-a4b-qat", "class_key": "dgpu-vram8|ram32", "switches": {
        "n_gpu_layers": "99", "n_cpu_moe": "21", "ctx_len": "32768",
        "batch_size": "512", "ubatch_size": "512", "threads": "8",
        "reasoning_budget": "1024",
    }},
    {"model_id": "gemma-4-26b-a4b-qat", "class_key": "igpu-mem32", "switches": {
        "n_gpu_layers": "99", "n_cpu_moe": "0", "ctx_len": "32768",
        "batch_size": "512", "ubatch_size": "512", "flash_attn": "off",
        "reasoning_budget": "1024",
    }},
    {"model_id": "gemma-4-26b-a4b-qat", "class_key": "dgpu-vram16|ram32", "switches": {
        "ctx_len": "32768", "batch_size": "512", "ubatch_size": "512",
        "reasoning_budget": "1024",
    }},
    {"model_id": "gemma-4-26b-a4b-qat", "class_key": "dgpu-vram16|ram64", "switches": {
        "ctx_len": "32768", "batch_size": "512", "ubatch_size": "512",
        "reasoning_budget": "1024",
    }},
    {"model_id": "gemma-4-26b-a4b-qat", "class_key": "dgpu-vram24|ram32", "switches": {
        "n_gpu_layers": "99", "n_cpu_moe": "0", "ctx_len": "32768",
        "batch_size": "512", "ubatch_size": "512", "reasoning_budget": "1024",
    }},
    {"model_id": "gemma-4-26b-a4b-qat", "class_key": "dgpu-vram24|ram64", "switches": {
        "n_gpu_layers": "99", "n_cpu_moe": "0", "ctx_len": "32768",
        "batch_size": "512", "ubatch_size": "512", "reasoning_budget": "1024",
    }},
]

# What the tunes were measured on — binds them by identity if the row is ever
# renamed here (the docgen `-xl` id is the measured precedent for why).
JV_CLASS_TUNE_IDENTITY: dict[str, dict] = {
    "gemma-4-26b-a4b-qat": {"hf_repo": "unsloth/gemma-4-26B-A4B-it-qat-GGUF",
                            "quant": "UD-Q4_K_XL"},
}


# The preset refs (the 2026-08-06 pieces rework): a feature whose rows are
# PIECES routes ONCE at the FEATURE key — the pieces follow it through the
# resolver's feature layer (action ref → feature ref → default). Only rows
# that genuinely run alone keep an action-level ref.
DEFAULT_FEATURE_PRESETS: dict[str, str] = {
    # Speaker attribution — ONE chooser for both reading styles (Careful
    # reading: think on; the capability gate handles models that can't).
    "speaker_attribution": "p_read",
    # Find new speakers — its own runnable card, its own ref.
    "speaker_attribution.identify": "p_extract",
    "smart_assign": "p_extract",
    # Deterministic classification
    "render_preset_suggest": "p_classify",
    "voice_gender": "p_classify",
    # Grounded summary
    "show_notes": "p_notes",
    # Persona voice
    "compose": "p_compose",
    "persona_rewrite": "p_voiced_edit",
    # Dictation cleanup — ONE chooser; the four section rows are pieces of the
    # one composed call and follow the feature ref.
    "refine": "p_refine",
}

# Catch-all for an action with no ref (custom Lab actions before assignment).
DEFAULT_PRESET_ID: str = "p_notes"


# §7.3 Lab test samples — authored against each action's own prompt contract
# (the SAMPLE LAW: read the prompt, shape the sample like a real run's
# composer output). SYNTHESIZED, never real user data. Fill-if-empty per
# (action, label).
_ATTR_SAMPLE_VARS = {
    "characters": '- id="c_mara", name="Mara", gender="female"\n'
                  '- id="c_renn", name="Renn", gender="male"',
    "corrections": "",
    "paragraphs": 'Mira reached the quay as the bell finished counting. '
                  '[D1] "You knew before the funeral," Renn said. He did not look at her.\n\n'
                  '[D2] "The page told me," she said. [D3] "Ask me who else can read it."',
}

DEFAULT_TEST_SAMPLES: list[dict] = [
    {"actions": ["speaker_attribution.guided", "speaker_attribution.direct"],
     "label": "Quay scene — tagged + bare quotes",
     "variables": _ATTR_SAMPLE_VARS},
    {"actions": ["speaker_attribution.identify"], "label": "Discover the harbor-master",
     "variables": {
         "known_characters": "- Mara\n- Renn",
         "manuscript": '"Boats out past the light again," the harbor-master said, '
                       'nailing the notice to the gate. Mara read it twice. '
                       '"And you\'ll say nothing," she said. "Nothing worth coin," he said.',
     }},
    {"actions": ["smart_assign"], "label": "Two leads, four voices",
     "variables": {
         "characters": '- id="c_mara", name="Mara" — dry, mid-30s archivist\n'
                       '- id="c_harbek", name="Old Harbek" — gravelly harbor-master, 70s',
         "voices": '- id="v_finch", name="Finch" — bright youthful female\n'
                   '- id="v_slate", name="Slate" — low weathered male\n'
                   '- id="v_reed", name="Reed" — neutral mid male\n'
                   '- id="v_lark", name="Lark" — warm adult female',
     }},
    {"actions": ["render_preset_suggest"], "label": "Storm chapter",
     "variables": {
         "presets": "  - Narration — even, steady long-form narration\n"
                    "  - Dramatic Dialogue — heightened, emotional character dialogue\n"
                    "  - Quiet Reflection — soft, slow, introspective passages\n"
                    "  - Action — fast, urgent sequences",
         "chapter_text": "The first wave took the rail off the pier. Mara ran, the "
                         "lantern dead in her hand, counting doors until the ninth — "
                         "and the ninth was already open.",
     }},
    {"actions": ["show_notes"], "label": "Two-segment episode",
     "variables": {
         "script": "## The Ledger\n"
                   "MARA: The ink changes mid-entry. Same hand, different script.\n"
                   "RENN: The harbor-master's script. You know it is.\n"
                   "## The Quay\n"
                   "NARRATION: The tide turned below the floorboards.\n"
                   "MARA: Then we ask him tonight.",
     }},
    {"actions": ["compose"], "label": "Weathered harbor-master",
     "variables": {
         "personality": "Old Harbek — gravel-voiced harbor-master, 70s. Speaks in "
                        "short, salt-worn sentences; never wastes a word; dry humor "
                        "that lands like weather observations.",
     }},
    {"actions": ["persona_rewrite"], "label": "Line into Harbek's voice",
     "variables": {
         "personality": "Old Harbek — gravel-voiced harbor-master, 70s. Speaks in "
                        "short, salt-worn sentences; never wastes a word; dry humor "
                        "that lands like weather observations.",
         "text": "I think we should probably wait until the morning to go out there.",
     }},
    {"actions": ["refine.base"], "label": "Question stays a question",
     "variables": {
         "transcript": "um can you check if the uh export finished before we send it",
     }},
    {"actions": ["refine.smart_cleanup"], "label": "Fillers + missing punctuation",
     "variables": {
         "transcript": "so um like the meeting moved to you know thursday at "
                       "three and basically everyone needs the new deck",
     }},
    {"actions": ["refine.self_correction"], "label": "Mid-utterance correction",
     "variables": {
         "transcript": "send the invoice to becca no wait actually scratch that "
                       "send it to pete before friday",
     }},
    {"actions": ["refine.preserve_technical"], "label": "Dictated code path",
     "variables": {
         "transcript": "open src slash components slash index dot tsx and um run "
                       "npm install first",
     }},
    {"actions": ["voice_gender"], "label": "Catalog batch with an ambiguous name",
     "variables": {
         "voices": "- Finch — bright youthful voice\n"
                   "- Marcus — deep narrator\n"
                   "- Ryo — soft-spoken\n"
                   "- af_bella — preset voice",
     }},
]
