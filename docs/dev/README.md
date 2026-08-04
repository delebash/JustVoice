# Dev docs — start here (JustVoice)

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
5. **`../decisions/`** — durable decision records: the 2026-07-15 shared-LLM
   integration decisions (READ before any F1/F2 work) · the 06-18 backend decision
   · data-model-per-usecase ("no forks, no per-use-case subtypes").
6. **`../research/`** — live research: the persona/voiceprofile multi-use design ·
   UE integration (post-v1) · external importer formats.
   **`../journeys/`** — the per-use-case UX narratives (audiobook · game ·
   podcast); the only place the kind-picker/Studio flow shapes are written down.
7. **The shared stack**: `../../../just-llm-runner/docs/dev/README.md` + the family
   standard `../../../just-llm-runner/docs/app-structure.md`.

User-facing docs are `../*.md` indexed by `../toc.json` — update them in the SAME
change that alters anything a user sees.
