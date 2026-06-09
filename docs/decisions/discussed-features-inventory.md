---
name: discussed-features-inventory
description: "Cross-cutting features + design decisions surfaced in the 2026-06-09 multi-message UX session that span multiple tasks. Read before working on Settings, Generate, Voices, Chapter, or any audiobook-production flow."
metadata:
  type: project
---

This memory captures features the user and I worked out across the 2026-06-09 audit session that span many tasks and might fall through cracks if any one task is implemented in isolation. Each item names the canonical task ID and the JustWrite lift source where applicable.

## Voice + Render tuning (3-tier model) — Task #88

JustWrite has a 3-tier param system. JustVoice lifts it whole.

- **Tier 1 — Engine defaults** in Settings → Engines → params. Per engine: Chatterbox (`exaggeration` / `cfg_weight` / `temperature` / `speed_factor` / `chunk_size` / `language`), Kokoro (`speed` / `response_format` / `lang_code`), OpenAI (`speed` / `response_format` / `instructions`).
- **Tier 2 — Per-voice overrides** via ⚙ "Tune {voice}" modal on each Voices row. Modal has a **Preview** button that synthesizes with pending edits without saving. Voices with overrides render ⚙ in accent color.
- **Tier 3 — Per-chapter render presets** at project level. Settings → Render presets table. Assignable on each chapter row in StudioView Render tab via a "Preset:" dropdown. **4 built-in seeded presets**: Narration / Dramatic Dialogue / Quiet Reflection / Action.
- **"Suggest" LLM button** per chapter: sends opening + ending tone-summary + preset names → model picks one, surfaces reason as toast.
- **"Suggest for all" sweep banner** when several chapters lack a preset.
- Engines silently ignore params they don't understand (Chatterbox-tuned preset applied via OpenAI render no-ops on `exaggeration`).

Source: `E:\Dev\Web\justwrite-app\docs\audio-studio.md` (Tuning the sound section) + `E:\Dev\Web\justwrite-app\src\renderer\src\views\StudioView.vue`.

## Engine capability manifests — Task #89

Each engine publishes a capability manifest that drives the Generate UI's controls:

```
GET /v1/engines/{id}/capabilities → {
  instruct: "none" | "freeform" | "structured",
  emotions: list[str] | null,       // null = engine doesn't accept discrete emotions
  paralinguistic_tags: list[str],    // [] = no slash-menu rendered
  pitch_range: [min, max] | null,    // null = no pitch slider
  speed_range: [min, max],
  voice_cloning: bool,
  style_prompt: bool,
  multi_speaker: bool
}
```

UI uses this to gate:
- Emotion dropdown only when `emotions != null` (Chatterbox: 10 discrete enum; Qwen3: null because it accepts freeform instead)
- Delivery-direction textarea only when `instruct == "freeform"`
- "+ Clone new voice" button only when `voice_cloning == true` (Chatterbox-only — see #99)
- Paralinguistic slash menu only when `paralinguistic_tags` is non-empty (Chatterbox)
- Pitch slider clamps to `pitch_range`

This came out of the JSON-vs-sliders-vs-dropdown discussion in `preview/full-app-preview.html` (Generate section).

## Speaker attribution (Script tab) — Tasks #74, #84

LIFT speakerAttribution.js (857 LOC) from JustWrite. Production pipeline IS the lab. Single source of truth used by StudioView Script tab + SpeakerLabView.

- **3-tier prompts**: Guided (small/local models, worked examples) / Direct (capable, strict rules) / Reasoned (Direct + `think:true` for Ollama reasoning models).
- **Deterministic dialogue-anchor propagation**: "Sarah said" → anchor adjacent dialogue → forward/back-propagate. Anchors win on tie-break with LLM picks.
- **Confidence floor**: low-confidence picks demoted to "unknown" so wrong attribution doesn't leak into audiobook.
- **Per-project correction memory**: every speaker fix stored as `{ project_id, line_text, correct_speaker_id }`. Up to **12 most recent** injected into each Re-analyze LLM prompt as worked examples. Up to **200 stored**. Narration-line edits do NOT feed the loop (narration is mechanically split out). Corrections referencing deleted characters quietly drop out. Settings → AI panel shows correction count + Clear-all per project.

Source: `E:\Dev\Web\justwrite-app\src\renderer\src\services\speakerAttribution.js`.

## Voice gender auto-detect + click-cycle override — Task #85

Auto-detect rules per provider:
- **OpenAI voices**: built-in canon (Alloy / Echo / Fable / Onyx / Nova / Shimmer + Ash / Coral / Sage / Verse / Ballad) — published gender + accent + tone.
- **Kokoro voices**: parse `<region><gender>_<name>` (af_alloy = American Female, bm_george = British Male). Accent comes free.
- **Chatterbox / freeform**: check first-name dictionary. sarah.wav → F, michael.wav → M. Ambiguous (Alex / Jamie / Riley / Sam / Charlie) deliberately **unset** rather than guessed wrong.

Chip click-cycles: ❓ → F → M → N (neutral) → unset → ❓. Override saved on the voice, used by Smart-assign on subsequent runs. Existing voices backfilled on next library refresh — fills blanks, never overwrites a manual chip.

Source: `E:\Dev\Web\justwrite-app\docs\audio-studio.md` (Gender tags section).

## Smart-assign LLM voice→character matcher — Task #83

Cast tab "Smart-assign" button. Sends to LLM:
- Each character: `{ name, role, gender, pronouns, aliases[] }` from Story Bible
- Each voice: `{ name, gender, age, accent, tone }` from voice library

System prompt explicitly tells the model to match on age / gender / tone / accent. Returns proposed character → voice mapping. User can override any assignment. "Clear cast" button resets all.

**Both sides matter**: a character with no gender set gives the LLM no signal on that axis. The pre-flight ritual: (1) fix voice library ❓ chips, (2) confirm each character's Gender + Pronouns in Story Bible, (3) click Smart-assign.

## What needs UI wiring beyond the renderer skin (preview vs reality)

Things in `preview/full-app-preview.html` that are NOT in the actual app yet:

| Preview feature | Task |
|---|---|
| Auto-updater UI (channel picker / progress bar / restart-and-install) | #90 |
| GpuInfoCard | #91 |
| CUDA wheel download flow (idle→stopping→waiting→ready) | #91 |
| MCP install snippets (Claude Desktop / claude-code / stdio) | #92 |
| Theme + accent hue + density + i18n locale picker | #93 |
| Paralinguistic slash menu in Generate / Chapter textareas | #94 |
| Stories timeline trim / split / volume / version-pin / WaveSurfer / drag-drop import | #95 |
| Inline API reference card in Settings General | #96 |
| Take-lineage chain viewer | #98 |
| Voice "+ Clone" gate on Chatterbox capability | #99 |

Plus task #87 (view rewrites) is THE main piece — most preview content is structurally absent from real views.

## Chatterbox-specific render param knobs (writers reach for these)

From JustWrite docs — useful when surfacing Tier 1/2/3 controls in Settings + voice-tune modal:

- `speed_factor`: 0.92–1.05 typical audiobook narration; >1.1 starts to sound rushed
- `exaggeration`: 0.8–1.0 calm narration, 1.3 Chatterbox default, 1.4–1.7 emotional dialogue
- `cfg_weight`: lower (0.3–0.4) = more emotional variance; higher (0.7) = locks tightly to reference voice, flattens expression
- `temperature`: 0.7–0.8 consistent delivery; higher = richer prosody but less predictability across takes

## Source-lineage Compare flow

ChapterView's "← from Take N" pill is a single-step indicator. The full lineage chain UX (clickable, shows the chain of all takes that led to current) is **task #98**.

Backend: `GET /v1/blocks/{id}/lineage` returns the chain with the change-event per step (regenerate / effect-applied / settings-snapshot-diff). Frontend: LineagePanel.vue side panel.

## Voice cloning is Chatterbox-only

Among local engines, only Chatterbox does voice cloning from reference audio. Cloud engines + presets don't. The "+ Clone new voice" button + the reference-WAV upload affordance must check engine capability manifest (#89) and disable with a tooltip when no clone-capable engine is loaded.

Drop a WAV/MP3 into Chatterbox's `voices/` or `reference_audio/` folder — both auto-picked-up, clone entries appear in cast picker with `(clone)` suffix.

## Web Speech caveat (engine catalog gotcha)

OS-built-in voices ("Web Speech" / SAPI / NSSpeechSynthesizer) can be **previewed** but not used for final renders — they only exist live, no file output. Should be surfaced in the engine catalog as "auditioning voices only" with `voice_cloning=false, file_output=false`.

## Render-job UI patterns

Per JustWrite Render tab:
- Per-chapter Render button (disabled until scripted)
- Batch select with "Select all unrendered" master + "Render selected (N)"
- Progress strip during render: elapsed / current line / total / Cancel. Same status strip every AI feature uses (also appears in header status panel + survives navigating away).
- Once rendered: Play / Stop / WAV (download with native Save As) / Re-render / Delete per chapter, plus rendered-duration shown.
- "Delete all rendered (N)" tab toolbar button when at least one chapter has a render.
- Renders survive a refresh (written to disk under app data; only deleted on explicit Delete / Delete-all / Trash-purge / project-delete).
- Re-render overwrites the same on-disk file (no two copies).
- WAV button opens native Save As dialog (no Downloads lock-in).
- Render is sequential per-project.

## Related memory

- [[justwrite-lift-targets]] — where to find each lift source
- [[help-system-design]] — help drawer + per-feature docs
- [[multi-use-onboarding]] — first-run flow that drives default tab + terminology
- [[import-format-strategy]] — multi-adapter import (#69 / #86)
- [[ultracode-usage-rule]] — when to fan out (subagents disabled 2026-06-09 — inline by default)
