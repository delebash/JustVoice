# Chapter splitting for Script (and Discover) — plan

Status: **PLAN, not started.** Asked 2026-09-28: "figure out how to implement chapter splitting
next". Measurements behind it: `2026-09-28-speaker-attribution-tuning.md` passes 10-11.
Parked idea it replaces: `docs/dev/IDEAS.md` 2026-09-28.

## 1. What it is

Script reads a chapter of any length. When a chapter is too big for the model to read in one
go, Script cuts it into **pieces** at paragraph breaks, reads each piece with the full cast and
a short lead-in from the piece before, and stitches the answers back together by line number.

What the user sees:
- **One run, one result.** The task strip shows one Analyze run; its progress bar covers all
  the pieces. The chapter comes back analyzed exactly as a short one does: same table, same
  labels, same save.
- **The chapter itself is not changed.** No new chapters, no moved blocks. "Pieces" exist only
  for the length of the model call. (The app has no manual "split this chapter" action today;
  the only split is the import's "Split on" strategy.)
- **The error from pass 11 almost disappears.** It remains only for a single paragraph too big
  for the model on its own, which no real book has.

What it is not:
- Not "always chunk". Measured: a whole chapter read in one call is as accurate as a short one
  up to at least 7,800 words (131/132, 136/136). Splitting only happens when it must.
- Not a second model pass or a review step.

## 2. Measurements it rests on (Gemma 4 26B, 32,768 context, thinking on)

| Chapter | Words | Dialogue lines | Prompt tokens | Answer tokens (incl. reasoning) |
|---|---|---|---|---|
| A Debt Called In | 2,767 | 35 | 4,359 | 2,277 |
| Salt and Tally | 2,545 | 43 | 4,206 | 2,134 |
| The Wool-Buyer | 2,512 | 54 | 4,310 | 2,551 |
| 10 Salt-Iron chapters joined | 26,030 | 234 | 34,514 (overflow, 400 before any work) | — |

- Prompt ≈ 1.6 tokens per word including the system text and cast.
- Answer ≈ 45-65 tokens per dialogue line (the reasoning scales with the lines).
- So at 32k the whole prompt + answer fits up to roughly 12-14k words per chapter.
  Real chapters are 2-8k words, so splitting is for outliers: a book imported with "Don't
  split — one chapter", a novella with no chapter headings, a transcript.

**The dangerous band** is a chapter whose text fits but whose answer does not: llama.cpp stops
generating when the context fills, the reply is cut off mid-JSON, the salvage keeps the answers
it got, and the rest pad to "unknown". That is the silent failure pass 10 fixed for the prompt
side, back again on the answer side. The design has to catch it.

## 3. How it works

### 3.1 The budget — how big a piece may be

`fits = context − prompt_overhead − answer_reserve(lines)`, per piece.

- **context** — the model's real context size. For the built-in runner the kit reads it from
  llama.cpp's own model list (`n_ctx` of the loaded model, or the `--ctx-size` it will launch
  with). For any other provider it is unknown → no up-front splitting; the backstops (3.3)
  still catch an overflow.
- **prompt tokens** — counted by llama.cpp's tokenizer if the router exposes it (Slice 0
  checks), otherwise estimated from the text with a safety margin.
- **answer_reserve** — per dialogue line, a setting (§3.5), default from the table above.

### 3.2 Where to cut, and the lead-in

- Cut only **between paragraphs**, never inside one — a paragraph is a speaking turn and its
  tag ("…," said Hale) must stay with its line.
- Prefer a **scene break** (a `***` / `---` marker line) near the end of the budget; otherwise
  the last paragraph that fits.
- Each piece after the first starts with a **lead-in**: the last few paragraphs of the piece
  before, sent with their `[D#]` numbers as usual. The model answers them too; those answers
  are **thrown away** — the earlier piece owns those lines. This gives turn-taking context
  across the cut (who spoke last, who "she" is) with **no prompt change**: the prompt already
  says "every [D#] gets exactly one entry", and `align_picks` already matches by number.
- `[D#]` numbers stay chapter-wide (segmentation numbers them once), so stitching is a merge of
  the pieces' answers, then the existing `align_picks` over the whole chapter.
- Tag anchors (`find_anchors`) keep running over the **whole** chapter, once — no model, no
  budget.

### 3.3 Backstops — every provider, every case the budget misses

1. **The text overflows** (llama.cpp 400 `exceed_context_size_error`, instant, costs nothing):
   the error carries the exact prompt size and context, so re-plan with exact numbers and
   run the pieces.
2. **The answer is cut off** (`finish_reason: "length"`): split that piece in two and re-run
   it. Costs one wasted piece-run, only in the band of 3.1's estimate being wrong. Needs the
   kit's streamed "done" event to carry `finish_reason` (it does not today — §4 Slice 1).
3. **A single paragraph is too big on its own**: the pass-11 error, reworded — the current
   text tells the user to "split it into smaller chapters", which the app cannot do.

### 3.4 Progress

The strip's progress bar spans the pieces: piece *i* of *n* at fraction *p* shows
`(i + p) / n`. No kit change — the existing progress frame carries a number.

### 3.5 Settings (no hardcoded knobs — `settings.extraction`)

| Key | Default | Why |
|---|---|---|
| `split_lead_in_paragraphs` | measured in Slice 3 (start at 6) | context carried across a cut |
| `answer_tokens_per_line` | 65 (the top of the measured 45-65) | answer reserve per dialogue line |

Both reachable through `PATCH /v1/settings` like `direct_min_b`.

### 3.6 Discover — same problem, same fix

Discover sends the whole chapter to the model too, so a chapter past the context fails there
first (as a 502 "identification failed"). The same planner splits it; each piece's
candidates merge by name (lines summed, first quote kept, library link kept). No lead-in
needed — Discover finds names, not turns.

## 4. Slices

**Slice 0 — spike, no product code.** Answer from the running engine, not from docs:
- does the llama.cpp router answer `/tokenize` for a named model?
- where exactly does `n_ctx` / `--ctx-size` appear in `/v1/models` for loaded vs unloaded;
- what does llama.cpp send when the context fills during generation (finish_reason
  "length"? an error?), streamed and not.
Record the receipts in this doc.

**Slice 0 receipts (2026-09-28, llama.cpp b10750 router on 8080, the user's live app):**
- `POST /tokenize {"model": "gemma-4-26b-a4b-qat", "content": …}` → `{"tokens": [...]}`.
  Without `model` → 400 "model name is missing from the request". So exact counting works,
  per named model.
- `GET /v1/models`: every model's `status.args` carries `--ctx-size` (gemma-4-12b 16384,
  gemma-4-26b 32768, qwen3.6 32768), loaded or not; `meta.n_ctx` (32768) only once loaded.
  → read `--ctx-size` from the args; `meta.n_ctx` agrees when present.
- The answer filling the context: a 27,251-token prompt asked to copy itself back —
  non-streamed **200, `finish_reason: "length"`**, usage 27,277 + 5,489 = 32,766; streamed,
  the last chunk carries **`finish_reason: "length"`**. No error either way — the reply is
  simply cut off. That is the silent case backstop 2 must catch, and the kit's streamed done
  event must carry it.
- Pure prose ≈ 1.24 tokens per word (22,000 words → 27,251).

**Slice 1 — kit (additive; both consumer apps build + test).**
- `StreamDelta.finish_reason` on the done event, filled by the five adapters that already
  know it on the non-streamed path.
- A `context_size(model_id)` door for the built-in runner (None when unknown).
- Token count door (llama.cpp `/tokenize`) if Slice 0 says the router serves it.

**Slice 2 — JV pipeline.**
- `plan_pieces(segments, budget)` → paragraph ranges + lead-in ranges (pure, unit-tested).
- `analyze_scene` runs one call per piece (streamed or not), keeps each piece's owned
  answers, merges, then the existing `align_picks`.
- Backstops 1-2 re-plan and re-run; 3 raises the reworded `AttributionModelError`.
- Request override `max_context` (the Lab/eval door, like `route`) so a test can force
  splitting on a short chapter.

**Slice 3 — measure before it ships.** `eval:attribution --whole --max-context N` forces
the Ninth Facet (136 lines) and Salt-Iron (132) into 3-5 pieces. Pass bar: the same 267/268
as unsplit. Tune `split_lead_in_paragraphs` on it. One real overflow run (the 26k-word text)
end to end in the live app.

**Slice 4 — Discover** (§3.6), measured with `eval:discover` the same way.

**Slice 5 — docs.** `docs/studio.md` Script: a "Long chapters" paragraph replacing the
"split the chapter" advice; `docs/ai-features.md` Troubleshooting entry reworded; the two
new settings documented where `direct_min_b` is.

## 4b. What was built (2026-09-28, "go your rec 1 yes 2 no")

- **Kit (Slice 1):** `StreamDelta.finish_reason` on the done event (openai_compat,
  ollama, anthropic, gemini, openai_sdk ×2 — each mapped as its non-streamed path maps
  it); `measure_action` / `ActionFit` in `llm/prompts.py` — same resolve + ensure as
  `run_action`, then llama.cpp `/v1/models` (`meta.n_ctx`, else `--ctx-size`),
  `/apply-template` and `/tokenize` for the exact prompt size; None off the local
  runner or when the router cannot say. 7 new tests; kit suite 985 pass, the 10
  `test_lifecycle` failures are pre-existing (same with the change stashed).
- **JV (Slices 2 + 4):** `extraction/pieces.py` (the planner); `pipeline.py`
  `_attribute_in_pieces` (measure → plan → per-piece calls → owned answers → the
  existing `align_picks`; both backstops); `identify.py` splits the same way, no
  lead-in, candidates merged by name; `settings.extraction.split_lead_in_paragraphs`
  (6) + `answer_tokens_per_line` (65); `RunUsage.pieces`; `max_context` on
  analyze-text + `eval:attribution --max-context`. Measuring never fails a run — if it
  cannot measure, the run goes unmeasured and the backstops cover.
- **Defect found by Slice 3 and fixed:** at a forced 5k context, 1 run in 3 lost a whole
  piece (25 lines unknown, no error): the model wrote the speaker handle in the `id`
  field, the piece filter kept nothing. Now a piece's id-less reply with one answer per
  line is placed by order (as `align_picks` does for a whole chapter), otherwise the
  piece is retried once. `_DID` became a full match — "nettle_2" is not line 2.

**Slice 3 measurements** (live app, Gemma 4 26B, both books as ONE chapter each, forced
context):

| Forced context | The Ninth Facet (136) | The Salt-Iron Road (132) |
|---|---|---|
| none (fits, 1 piece) | 136/136 | 131/132 |
| 8,000 → 3 pieces | 136/136 | 131/132 |
| 5,000 → 6 pieces, before the fix | 110/136 (25 blank: one piece's id-less reply) | 132/132 |
| 5,000 → 6 pieces, after the fix, 3 runs | **408/408** | **392/396** — 3× the known "Quartermaster." miss (every setup misses it) + D126 once |

- One new miss in 396 split readings (D126, run 1 only); Ninth Facet perfect. Lead-in
  stays at 6 — not tuned further; the data gives no reason to.
- **The real overflow, end to end** (live app): the 26,030-word text that failed in pass
  10 — measured, **2 pieces, all 234 lines answered** (220 by the model, 14 by tags),
  299 s. Discover on the same text (the Lab endpoint, which does not measure): refused →
  halved by the backstop → 2 pieces, 105 s, 21 names. Some of those names are poor
  ("Old Ката", "Thief", "Toll") — Discover's reading of this text, not the split; the
  Studio endpoint's quote check flags invented ones.

## 5. Blast radius (pasted greps, 2026-09-28)

| Change | Callers / producers (grep) | Existing exception on that path |
|---|---|---|
| `analyze_scene` runs N calls | `api/extraction_api.py:459` (analyze-text), `:533` (stream), `:701` (scene analyze), `labs/extraction/run.py:109` | all four catch exceptions; the stream persists only on its done frame (`extraction_api.py` worker) |
| `format_paragraphs` on a subset | `extraction/pipeline.py:463` — its only caller | — |
| `align_picks` over merged answers | `extraction/pipeline.py:512` — its only caller | gaps pad to unknown 0.4 (kept) |
| `AttributionModelError` text reworded | raised `pipeline.py:510`; caught `extraction_api.py:462`, `:564`, `:704`; test `tests/test_extraction_config.py` asserts "Split it into smaller chapters" | the test changes with the text |
| `identify_speakers` per piece (Slice 4) | `extraction_api.py:987` (Discover), `:1157` (Lab discover-text) | both catch → 502 |
| `ExtractionSettings` gains 2 keys | read at `extraction_api.py:777`, `:790` (`direct_min_b`) | stale keys ignored on load (class docstring) |
| kit `StreamDelta.finish_reason` | producers: `anthropic.py:264`, `gemini.py:253`, `ollama.py:204`, `openai_compat.py:292`, `openai_sdk.py:390`, `:415`; dispatch mutates the same object (`dispatch.py:422 delta.model = model`) so a new field survives | default value → every other consumer unaffected (JW, docgen) |

## 6. Open for the user

1. **Discover too (Slice 4)?** Rec: yes — a chapter too long for Script is too long for
   Discover, and Discover runs first.
2. **A manual "split this chapter" action?** Rec: no — with automatic pieces nothing needs
   it for the model's sake. Say if you want it for other reasons (render length, export
   track length) and it goes to IDEAS.
