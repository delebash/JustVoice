# TODO (JustVoice) — deep-research: audiobook converters + speaker attribution

**Status: NOT STARTED — parked for later (user, 2026-06-27).** We were finishing
the shared **LLM** work (model catalog + per-job recommendations) and deferred this.
Speaker attribution for the LLM speaker-extraction feature can be *improved* later
using what this research surfaces.

## What this is
The user collected a set of open-source **book → audiobook** converters + **speaker
/ quote attribution** projects worth mining for two things:
1. **Features to add to JustVoice** — UX, input-format handling (EPUB/PDF), casting
   flow, chaptering, export, TTS-engine choices, multi-voice orchestration.
2. **Techniques for speaker attribution** — how each detects quotes and assigns each
   line to the right character (rule-based / BookNLP / classical ML / LLM / hybrid),
   so we can upgrade our `speaker_attribution` feature beyond pure LLM prompting.

> The user's note: *"You can also do your own deep research — not limited to these
> sites; these are just some I found interesting."* So treat the list as seeds, not
> the whole corpus. The `/deep-research` harness is the tool (see the two LLM-research
> docs it already produced: `just-llm-runner/docs/plans/archive/2026-06-24-small-vram-multimodel-research.md`
> and `justwrite-app/docs/plans/archive/2026-06-24-local-model-recommendations.md`).

## Repos to investigate
> Categories are **inferred from the repo name and have NOT been verified** — confirm
> each (purpose, method, TTS engine, input formats, LICENSE) during the research; some
> may be dead, tiny, or mis-categorized.

### Speaker / quote attribution — specific
- https://github.com/caggazzotti/speech-attribution — attribution-focused (method? dataset?)
- **BookNLP / BookNLP2** (David Bamman literary-NLP) — quote attribution + coreference + character clustering. The reference pipeline; check license + GGUF/transformer backbone + accuracy on PDNC.
- https://github.com/Finrandojin/alexandria-audiobook — audiobook pipeline; likely includes per-character casting → check its attribution step.

### Full book → audiobook pipelines (mine for features + attribution + TTS choices)
- https://github.com/lukaszliniewicz/Pandrator — (named earlier) large audiobook generator; check casting + attribution + TTS engines.
- https://github.com/mateogon/pdf-narrator — PDF → narration (input-format handling).
- https://github.com/dudarenok-maker/Castwright — name implies multi-cast ("cast" + "playwright"); likely attribution + multi-voice.
- https://github.com/gianpaj/audiobook-gemini-multi — multi-voice via Gemini; cloud-LLM attribution approach.
- https://github.com/ColbyStarr/vocalbook
- https://github.com/Vasanth2005kk/VoxLibri
- https://github.com/cnghockey/book-to-audiobook
- https://github.com/michaelsanford/Speak-EPUB — EPUB input handling specifically.
- https://github.com/marcusau2/VOX-1-Audiobook-Maker
- https://github.com/saabst/book-v2-audio

### TTS engine / API (compare vs our engine pool)
- https://github.com/confused-ai/supertonic-api — appears to be a TTS engine/API ("Supertonic"); compare capability/license vs our engines (Kokoro/Chatterbox/etc.).

## Research questions (the deliverable when we DO this)
**A. Speaker attribution (the priority — feeds our `speaker_attribution` feature):**
- Per tool: what attribution METHOD (rule-based / BookNLP / classical ML / LLM-prompted / hybrid), accuracy if reported, language/stack, **LICENSE**.
- SOTA for fiction quote attribution + benchmarks: **PDNC (Project Dialogism Novel Corpus)**, RIQUA, any shared tasks + their numbers.
- LLM-only vs dedicated pipeline vs **hybrid** (pipeline proposes candidate spans/speakers → LLM resolves hard cases). Which models/libs to adopt at our 8–32 GB tiers.
- Coreference (pronoun/epithet → canonical character) — which tool/lib does it best.

**B. Audiobook features for JV:**
- Input formats (EPUB/PDF/DOCX) + chaptering + cleanup (front-matter, footnotes).
- Casting UX (auto-cast from attribution → voice-per-character; manual override).
- Export shapes (per-chapter, M4B chapters, per-line WAV+JSON like our game export).
- Which TTS engines each uses; any worth adding to our engine pool.

**C. Output:** save a cited decision doc to `docs/plans/` (like the LLM-research docs);
list reusable techniques + a recommended attribution architecture for JV; flag
licenses (we ship **MIT** as of 2026-07-29; this line read GPL-3.0-or-later while pedalboard was a
dependency — note any copyleft deps, which are now blockers rather than merely something to match).

## Cross-refs
- Our shared LLM stack + per-job model recs: `justwrite-app/docs/plans/2026-06-2X-*` (LLM model research, in progress now).
- JV `speaker_attribution` today: routed via the shared dispatch (`engines/llm/config.py` → `extraction_api.py:147` reads the active production config); small dense ~8B did poorly → needs a capable model or a dedicated pipeline.
- CONTRACT.md — the JW→JV boundary (JW hands prose; JV casts + narrates).
