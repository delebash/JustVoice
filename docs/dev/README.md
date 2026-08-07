# Dev docs — start here (JustVoice)

**Docs live in exactly three places** (the JustWrite convention, enforced by the
2026-08-06 disposition sweep): user docs (`../*.md`, indexed by `../toc.json`),
dev docs (this folder), and plans (`../plans/`; closed work → `archive/`).
Decisions distill into `design-decisions.md`; a doc whose content is executed or
superseded goes to `../plans/archive/` with a status banner — never a fourth
folder. The old `decisions/`, `research/` and `journeys/` folders were dissolved
by that sweep after each file was verified against code.

Read in this order (closed history — including the old DESIGN_FREEZE, CONTRACT and
FEATURES roots — lives in `../plans/archive/`):

1. **`../../CLAUDE.md`** — the working rules and pointers.
2. **`TASKS.md`** — the live tracker (the F-arc convergence sequence, the open
   product questions extracted from the freeze, repo hygiene). **`IDEAS.md`** —
   the backlog incl. the deferred-v1.1+ list.
3. **`design-decisions.md`** — THE distilled design record: product shape (five
   use cases, type-discriminated projects), locked stack decisions as CURRENT
   truth, the JV↔JW boundary rules, convergence outcomes, and the
   reversed-since-freeze anti-drift ledger.
4. **`design-law.md`** — the "precedent before pattern" method behind CLAUDE.md
   RULE #1. **`CONCEPTS.md`** — the mock-era design-decision record (historical
   context for the preview/ mocks).
5. **Live research + specs (this folder)** — `ue-integration-design.md` (per-line
   WAV shipped; the JSON sidecar — Phase 1's deliverable — and the `.uplugin` are
   not) · `external-import-formats.md` (the six-tool importer survey, unbuilt) ·
   `2026-06-24-audiobook-nlp-competitor-research.md` (21 upgrade ideas, most
   unbuilt — indexed in `IDEAS.md`) · `journey-podcast.md` (the Timeline/episode-
   export spec, kept whole as the design target for the biggest parity gap).
   The per-kind flow shapes also live in `CONCEPTS.md` §6 and the user docs
   (`projects.md`, `studio.md`, `lines.md`). The executed decision records
   (2026-07-15 shared-LLM, 2026-06-18 cross-app, data-model, the
   persona/voiceprofile design, the audiobook/game journeys) are banner'd history
   in `../plans/archive/`.
6. **The shared stack**: `../../../just-llm-runner/docs/dev/README.md` + the family
   standard `../../../just-llm-runner/docs/app-structure.md`.

User-facing docs are `../*.md` indexed by `../toc.json` — update them in the SAME
change that alters anything a user sees.
