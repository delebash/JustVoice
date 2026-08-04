# Audiobook + book-NLP competitor research (2026-06-24)

Deep dive on four reference projects for insights vs JustVoice (audiobook/TTS) +
JustWrite (prose NLP: entity sweep, character audit) + the JW↔JV contract
(speaker attribution handoff). Saved in full per PRIORITY RULE #2 (detail, not
highlights). Sources: the repos' READMEs read 2026-06-24.

- Alexandria — https://github.com/Finrandojin/alexandria-audiobook
- audiobook-creator — https://github.com/prakharsr/audiobook-creator
- audiobook-maker — https://github.com/DigiJoe79/audiobook-maker
- BookNLP2 — https://github.com/blueprintparadise/booknlp2 (outdated; research only)

## 1. Alexandria (Finrandojin) — closest to JV's Studio

Pipeline: upload (.txt/.md/.epub) → **LLM annotate** into JSON
`[{speaker,text,instruct}]` → **LLM review pass** → voice casting → smart
chunking+batching → Qwen3-TTS synth → assembly w/ pauses → export.

Notable, and where it may beat JV:
- **Two-pass LLM annotation (generation → REVIEW).** The review pass fixes
  speaker misattributions, strips attribution tags ("said he"), merges
  over-split narrator entries, splits narration mixed into character lines, and
  validates `instruct` fields (voice directions vs physical actions). *JV does
  one-pass speaker attribution — a dedicated review/QC pass is a clear upgrade
  for attribution accuracy.* (Alexandria ships `default_prompts.txt` +
  `review_prompts.txt`.)
- **Persona Generation — generate voices, not just match them.** LLM writes a
  voice description per character → **VoiceDesign** model makes reference audio →
  auto-assigned as a clone. "One click to a fully-voiced cast." *JV's
  smart-assign matches characters to EXISTING voices; generating a voice from a
  text description is a new capability (needs a VoiceDesign-style engine).*
- **Speaker aliases** — map name variants ("YOUNG ELENA"→"ELENA") to one voice,
  transitive with cycle detection. *JV personas could use this.*
- **Context preservation between chunks** — passes the character roster + last 3
  entries to each chunk so identity/style doesn't drift across batch synth.
- **Sub-batching by text length** — sorts chunks, splits a batch if longest/
  shortest ratio > 5×, min 4/sub-batch — cuts GPU padding waste. *Concrete perf
  idea for JV's render batching.*
- **Non-verbal sounds as pronounceable text** ("Ah!", "Hic… sniff…") rather than
  `[gasp]` bracket tags — reads more naturally through TTS.
- **Hot-reloading prompts** (re-read from disk per request) — fast prompt
  iteration. *JV's prompts are DB-seeded + Lab-editable, similar intent.*
- **Audacity multi-track export** (per-speaker WAV + `.lof` + labels) +
  **per-chunk vs chapter M4B markers**. *JV has render/export; per-speaker DAW
  stems + per-chunk chapters are nice-to-haves.*
- TTS: Qwen3-TTS only (Base/CustomVoice/Clone/VoiceDesign variants) + LoRA voice
  training + dataset builder. *JV's engine pool is broader; LoRA training +
  dataset builder are features JV lacks.*

## 2. audiobook-creator (prakharsr)

Pipeline: text clean (Calibre optional) → **LLM character ID w/ demographics** →
**LLM speaker attribution per line** → `character_gender_map.json` → emotion
tags (LLM, for Orpheus) → TTS (Kokoro or Orpheus) → M4B.

Notable:
- **Two-step LLM character pipeline**: first identify unique characters + age/
  gender, THEN attribute speakers per line — replaced an earlier GLiNER NLP
  approach with pure LLM "for improved accuracy." *Mirrors JV's
  speaker-attribution; the explicit character-roster-first step is cleaner.*
- **Gender-based voice mapping** — voice chosen automatically from gender score.
  *JV smart-assign uses age/gender/tone/accent — similar, JV is richer.*
- **Dialog-only voicing** — narration one voice, dialogue another (or only
  dialogue voiced). *A simple multi-voice mode JV could offer.*
- **Emotion tags** (laugh/sigh/gasp) added by LLM for Orpheus expressiveness.
- **Recommended models VALIDATE our research:** char ID → **"Qwen3 30B A3B
  Instruct (without thinking)"** (the MoE!); emotion → "gpt-oss-20B with
  thinking"; char ID needs ≥20k context, sequential (parallel=1) for accuracy.
  *Independent confirmation that the A3B MoE is the right pick for hard
  structured extraction — exactly our `candidateFor: attribution` model.*
- Async parallel TTS; precision-first Orpheus (no quant, retry on artifacts).

## 3. audiobook-maker (DigiJoe79) — same stack as us (Tauri + React + FastAPI)

Notable, and where it may beat JV:
- **Quality assurance via Whisper + Silero-VAD.** Transcribes generated audio,
  checks transcription accuracy vs the source text, VAD detects silence/
  artifacts; flags bad segments → **regenerate only the segments with issues**.
  *This is the biggest gap: JV renders audio but has no automated "did the TTS
  actually say the right words" QC. High-value reliability feature.*
- **Multi-engine + remote GPU.** 4 engine TYPES (TTS, STT, Text-processing,
  Audio-analysis); engines run local-subprocess, Docker, or **remote GPU via SSH
  tunnel**; **online engine catalog** (pull engine updates without app rebuild).
  *JV has a local engine pool; SSH GPU-offload + an online engine catalog are
  power features.*
- **spaCy smart segmentation** + **pattern-based pronunciation rules**. *JV uses
  lexicons for pronunciation; pattern rules are a lighter complement.*
- **DB-backed job queue with resume** + **SSE real-time updates** + drag-drop
  Projects/Chapters/Segments. *JV has tasks/SSE; resume-cancelled-jobs is good.*
- TTS: XTTS v2, Chatterbox, VibeVoice (long-form multi-speaker). *VibeVoice
  long-form multi-speaker is interesting for JV.* **No LLM** (deterministic
  spaCy) — so no auto speaker attribution; voices are segment-level, not
  character-mapped (weaker than JV/Alexandria here).

## 4. BookNLP2 — deterministic NLP (no LLM), relevant to JW + JV attribution

Full pipeline: tokenize → POS/dependency (spaCy) → **NER (6 types: PER/FAC/GPE/
LOC/VEH/ORG)** → **coreference** → **character name clustering** (Tom / Tom Sawyer
/ Mr Sawyer → one entity) → **quotation attribution** (resolve "she said" →
entity) → supersense (41 WordNet) → event tagging → **referential gender**.
Small/Big BERT models; **speaker attribution 86.4% / 89.9% B3 F1**; entity 88.2%
/ 90.0% F1. Outputs `.tokens/.entities/.quotes/.book(.html)`.

Why it matters:
- **A deterministic, offline, no-LLM path for entity extraction + quote/speaker
  attribution.** Relevant to **JW entity sweep + character audit** AND **JV
  speaker attribution + the contract handoff**.
- **Use it as a cross-check / seed, not a replacement.** Our LLM attribution can
  be seeded or verified by BookNLP's coref clustering (it's cheap + offline) —
  e.g. cluster character name variants (the alias problem Alexandria solves
  manually), or flag quotes where the LLM and BookNLP disagree for the review
  pass. Caveat: it's outdated + a heavy dependency (BERT + spaCy models); treat
  as research, not a drop-in.

## Prioritized adopt list (with reasoning)

1. **Speaker-attribution REVIEW pass (LLM, 2nd pass)** — Alexandria + audiobook-
   creator both do generation-then-review / roster-then-attribute. Highest-value,
   cheapest win for attribution accuracy (the exact JV feature the user found 8B
   weak at). Shared-stack: a per-feature "review" prompt + a second dispatch.
2. **Output QC: Whisper-transcribe the render + diff vs text + VAD** (audiobook-
   maker) — catches TTS dropouts/hallucinations/silence; auto-flag → regenerate
   segment. The biggest reliability gap in JV. JV already has Whisper (dictation/
   STT) — reuse it.
3. **Character name clustering / alias resolution** — Alexandria (manual aliases)
   + BookNLP (automatic coref clustering). Reduces casting overhead; could be LLM
   or BookNLP-seeded.
4. **Context preservation + sub-batching** (Alexandria) — coherence + render perf
   for batch TTS; concrete, low-risk.
5. **Voice generation from description (VoiceDesign-style)** — Alexandria's
   persona generation; new capability (generate a cast, not just match). Bigger
   lift (needs a design-capable engine).
6. **Dialog-only / gender-mapped voicing modes** (audiobook-creator) — simple
   multi-voice options.
7. **Model recommendations confirmed** — audiobook-creator independently picks
   Qwen3-30B-A3B for character ID → reinforces `justwrite-app/docs/plans/archive/2026-06-24-local-model-recommendations.md`
   (A3B MoE for hard structured tasks). Feed into the recommended set.

## What JV/JW already do as well or better
Broader native engine pool + ACX mastering + lexicons + personas + Stories
timeline + dictation + the shared LLM stack + the per-action Lab (JV); full
manuscript/analysis suite + RAG (JW). None of the four has the Lab/routing depth
or the cross-app shared stack.
