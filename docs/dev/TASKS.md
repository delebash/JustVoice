# TASKS — the live open-work tracker (JustVoice)

> **THIS is JustVoice's live tracker** — created 2026-08-04 by the family docs
> campaign (`just_ai_i18n_docgen/docs/plans/2026-08-04-docs-cleanup-campaign.md`),
> per the convention in `just-llm-runner/docs/app-structure.md` §13. One line per
> open item + a pointer to its detail doc. **Close = delete** — git and the plan
> docs keep history. **An item lives where the code that closes it lives** — JV
> work HERE; kit/shared-server → `../just-llm-runner/docs/dev/TASKS.md`; JW →
> `../justwrite-app/docs/dev/TASKS.md`. A tracker line is a claim, not evidence;
> lines are marked **[verified]** (code-checked 2026-08-04) or **[attributed]**
> (a plan doc's claim, not re-verified).
>
> **THE STANDING SEQUENCE (the user's roadmap ruling, 2026-07-26):** *"completely
> finish JW and all AI stuff, then we will work on JV."* Everything here is parked
> behind that unless the user says otherwise; every item needs its own go.

## The convergence arc (moved from JW's whole-system tracker 2026-08-04)

- **F1 — convergence onto the current shared stack (THE big one).** CORRECTED
  2026-08-04 [verified]: the old "JV can't even import `llm_runner`" claim is
  STALE — `models.py`'s dead `LLMRolesSettings` imports were removed 2026-08-01
  (its :20 comment records it) and `check-consumers.py` passes for JV (29 imports
  resolve). The real scope stands: adopt the 2026-07 shared work JV still lacks —
  the model catalog/tune system with per-machine tune saves, gated auto-MTP +
  Gemma draft-file support, the quant dropdown with QAT labels, provider connect,
  the per-day Logs panel. **Read BEFORE any F1/F2 work:** the 2026-07-15
  integration decisions record —
  `docs/decisions/2026-07-15-jv-shared-llm-integration-decisions.md` (JV stays
  standalone with its own book door; the current shared stack replaces the pinned
  snapshot; all 8 features kept + `voice_gender` built for real; merged "AI
  Settings" nav hosting the kit `AiModelsArea` with two JV host tabs). Ledger
  history: `just-llm-runner/docs/plans/archive/2026-07-06-outstanding-master-plan.md` §F1.
- **F2 — `speaker_attribution` task scaffolding** (a JV need; JW bans speaker
  analysis) — after F1. Ledger §F2.
- **F4 — `EngineManager.load()` → shared VRAM-arbiter hook** — the decision was
  made 2026-07-04 and the arbiter is BUILT in the runner; only the JV-side wiring
  remains. After F1. Ledger §F4.
- **F5 — Appearance knob-set gap** — JV exposes Theme/size/accent/language while
  the shared engine supports the full JW set. Independent of F1. Ledger §F5.
  (Related: the user's 2026-08-04 ruling that the appearance SURFACE should be
  shared JV + i18n-docgen — tracked in docgen's TASKS.)
- **F3 — audiobook converters + speaker-attribution deep research** — PARKED by
  the user's word 2026-06-27 (`docs/plans/archive/2026-06-27-audiobook-tools-research-todo.md`).
- **I6 — the JV tail beyond F1–F5** — ledger §I6.

## Product decisions still open — extracted from the archived DESIGN_FREEZE §10

The freeze said "code resumes on user's answer"; these were never answered and had
no tracker line until the docs campaign. All yours:

- **Brand-name clearance** — USPTO TESS + Google check (the old "task #58"), then
  the rename PR (the `justvoice`/`justvoice-server` console-script split survives
  any rename — the Windows spawn-loop guard).
- **Code signing** — Windows-only EV cert ($200-400/yr) at v1.0 vs all platforms
  day 1 (±4-6 weeks of launch timeline).
- **Audio-channels UI** in v1 (gated toggle) vs v1.1 — REFRAMED by code: bindings
  are persona-level now, so the question is about the persona-channels surface.
- **External provider per-character** in v1 vs v1.1.
- **Tab discovery order** — the freeze's 13-tab question is moot (14 routes +
  Labs/Settings collapse today); the underlying "does discovery order match
  intent?" question stands for the current nav.
- **Loading-message tone** (playful pro-tool vs too playful) · **v1 scope check** —
  anything in the deferred list (IDEAS) that belongs in v1.0.

## Repo hygiene (found by the 2026-08-04 campaign)

- **F1's concrete artifact: `server/pyproject.toml:44` pins a June commit SHA** of
  the shared stack [verified by the recap; the pin is the stale-snapshot mechanism
  F1 removes].
- **Hardware-gated runner work** [attributed: the recap]: the built-in runner's
  P1.5b auto-spawn + P1.6 benchmark + working-config cache need building/verifying
  on the user's GPU box.
- **Layer C anti-divergence guard + parity sweep** [attributed: the convergence
  outcomes, `docs/dev/design-decisions.md` §4]: a lint/CI check that fails on a new
  hand-rolled fetch / forked primitive / second `init_db` copy · the server-basics
  parity sweep (camelCase responses, health/settings shape).
- **CI contract enforcement is CLAIMED but not found** [verified]: the archived
  CONTRACT cites `server/justvoice/openapi.json` + `tests/test_contract.py` —
  neither exists. Build it or strike the claim.
- **Missing user docs** [verified vs toc.json]: stories (tracked above) · backup/
  restore · render presets · a settings reference · troubleshooting · run-modes
  (desktop vs headless). The archived FEATURES.md §s name the content to lift.

- **Family-contract gaps [verified against `app-structure.md` §1/§2]:** no
  `scripts/py.js` (the `server` script calls bare `python`); no `lint` /
  `test:server` / `test` / `screenshots` npm scripts; no e2e harness. Port is
  17494 (the standard's registry was wrong until 2026-08-04, not this app).
- **`docs/stories.md` is missing while `toc.json` listed a `stories` slug
  [verified]** — the entry was removed from the TOC 2026-08-04 (it 404'd in-app);
  write the doc for `StoriesView` and restore the entry.
- **Root strays need your classification:** `DESIGN_FREEZE.md` (940 lines,
  ⏳-pending legend, touched Aug 1) · `CONTRACT.md` (JV↔JW boundary, last revised
  2026-06-09) · `FEATURES.md` (911-line user guide overlapping `docs/*`). Too
  big/live-looking for the light pass — keep / update / archive is your call.
- **`2026-06-12-justwrite-roundtrip-slice1.md` — "JW side MISSING" [attributed]:**
  the JW half lives in the other repo and no status was ever written back; verify
  in JW's code, then close or queue.
- **`2026-06-20-deep-audit.md` (JV) — a backlog posing as a plan [attributed]:**
  self-described "ordered by value/effort", never triaged; fold what's live into
  this tracker or archive it.
- **June QC queues presumed complete [attributed]:** `2026-06-12-qc-round-2-queue`,
  `2026-06-13-qc-batch-1`, `2026-06-14-deep-audit-v2` were banner'd
  "presumed complete" (sibling round-3 is explicitly complete; their own items
  were never marked). If one still bites on your box, it comes back as a line here.
- **VOICEBOX_PARITY G1–G5 gap list [attributed]** — the live residue of the
  archived 2026-06-11 parity audit; re-verify against today's app before acting.
