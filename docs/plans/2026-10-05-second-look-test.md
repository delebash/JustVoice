<!-- SPDX-License-Identifier: MIT -->
# A second look at lines Analyze leaves with no speaker — the test (2026-10-05)

**Asked:** the user, on Bigger Inside's last line ("You always find the candle first…" — *AI gave
no answer*): "is there any way to tweak the ai to find it maybe by using next of prevous chapters,
how much whould it slow down process". Three options were shown; the user: **"test 1"** — option
1, tested, not built:

> "1. A second look, only at lines left with no speaker. After a chapter is analyzed, if any
> spoken line has no speaker, ask once more about just those lines, adding the end of the
> previous chapter and the start of the next one. Cost: nothing on chapters with no blanks …
> Safety: a wrong name is worse than a blank … its answer would come back marked to check."

Not the 2026-09-28 "second pass" (`2026-09-28-speaker-attribution-tuning.md:179`), which was a
re-ask keyed on low confidence or on every line — this one only touches lines left blank.

## Method

A scratch script, no app code changed: each keyed chapter through `POST
/v1/extraction/analyze-text` (the production pipeline, writes nothing; the cast built as
`eval_attribution.py` builds it — the key's cast, so The Ninth Facet has no Sedge), then for every
dialogue row left `unknown`, ONE call to the app's loaded model (the kit's router,
`127.0.0.1:8080/v1/chat/completions`, gemma-4-26b-a4b-qat, temperature 0.2, thinking **off**):

- system: attribute ONE marked line; the chapter before and after may reveal an unseen
  speaker; name a cast member only when the text makes it clear; otherwise "unknown" — "a wrong
  name is worse than unknown"; JSON `{reason, speaker, confidence}`.
- user: the cast (id: name, also called, description) · the last 800 words of the chapter before
  · the whole chapter with the line marked ⟦…⟧ · the first 1,500 words of the chapter after.

Scored against `samples/<book>/attribution-truth.json`. A **stress** run also asked about 3 lines
per chapter whose speaker the key knows, as if Analyze had left them blank — the false-name test.

## Results (the user's machine, RTX 2070 Super 8 GB, the app running)

| Run | Lines asked | Right | WRONG | Time per line |
|---|---|---|---|---|
| The Ninth Facet — real blanks | 6 | **6** — D39 "the voice in the dark" → **Odeline Marran** ("revealed in the following chapter as Odeline Marran (Ode)"); Sedge's D4, D5, D7, D8, D9 kept **unknown** (Sedge isn't in the key's cast — it named him in its reason and still answered unknown) | 0 | 11.0–11.6 s (~5,700 tokens in) |
| The Salt-Iron Road — real blanks | 0 (no line left blank this run) | — | — | — |
| The Speckled Band — real blanks | 3 — the trap's driver, not in the cast, kept **unknown** | 3 | 0 | 22.8–23.7 s (~12,600 tokens in: one long chapter, no neighbours) |
| Stress — known lines as if blank | 21 (12 Ninth Facet, 9 Salt-Iron) | **21** | 0 | 4.7–14.7 s |

Totals: **30 lines asked, 30 right, 0 wrong.** The production Analyze in the same runs: 33–62 s
per chapter (188 s for the 247-line Speckled Band chapter).

## What it means for a build

- Cost lands only where a line is blank: this book has one such line in 136 after Old Sedge was
  added (six before), Salt-Iron had none this run.
- A call costs ~5–15 s on a normal chapter and grows with the chapter: ~23 s at 12.6 k tokens.
  A build would cap the text around the line (e.g. ±2,000 words) instead of the whole chapter.
- Thinking was off here (Analyze runs with it on); it held at 30/30 without it.
- Not shown: a book where the second look names the wrong person. 30 lines is a small sample;
  the answer still comes back **marked to check**, as option 1 promised.
- The second look also named speakers who aren't in the cast (Sedge, "the driver") in its
  reason — a build could offer *"Old Sedge isn't in the cast — add him?"* from it.

## 2026-10-06 — the built second look, temperature 0 against 0.2

**Why:** after a re-analyze the candle line (Bigger Inside D39) came back blank. The same
question, asked 8 times each way on the user's book: 6 Odeline Marran, 2 unknown, streamed or
not — the model declines it about one time in four at the preset's temperature 0.2, its reason
reading "while the next chapter reveals Ode…". At temperature 0: 4 of 4 Odeline Marran. Decided
(TASKS "The second look runs at temperature 0"): test the 30 lines first, then switch.

**Method:** a scratch script, nothing written: each keyed chapter through
`/v1/extraction/analyze-text` with `second_look: false` (the production main pass, the scorer's
cast — no Sedge in The Ninth Facet's key); every dialogue row left blank, and 3 known rows per
chapter of The Ninth Facet and The Salt-Iron Road (evenly spread — the stress set), asked the
BUILT second look's question (`second_look.py`: its prompt row, `cast_lines`, `around` at
`second_look_words`, the neighbours' tail and head) through `/v1/ai/run` with `temperature` 0,
then 0.2; the build's 0.5 floor applied; scored against `attribution-truth.json`.

| Temperature | Real blanks (9) | Stress (21) | All 30 |
|---|---|---|---|
| **0** | 9 right · 0 wrong | **21 right** · 0 wrong · 0 blank | **30 right, 0 wrong** |
| 0.2 | 9 right · 0 wrong | 20 right · 0 wrong · 1 blank (The Same Hour D14, *"Odeline Marran,"*) | 29 right, 0 wrong |

The real blanks: Bigger Inside's five Sedge lines kept unknown and D39 named Odeline Marran;
The Speckled Band's three driver lines kept unknown. Per line 4–14 s at 0 (first calls, cold
cache) against 1–2 s at 0.2 (the same prompts again, cached) — the time is the prompt cache,
not the temperature. Switched 2026-10-06: `seed_presets.py` → `p_classify`, and the live
database's assignment set the same way.
