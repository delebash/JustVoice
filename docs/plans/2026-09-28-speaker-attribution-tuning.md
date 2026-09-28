# Speaker attribution tuning — measured, not eyeballed

<!-- SPDX-License-Identifier: MIT -->

**Go:** 2026-09-28, user: *"test the speaker extraction … recommend any prompt or ai settings llm
changes or any other changes such as review process … keep going without my approvial until you
get a good result … just let me know the changes you made when you are satisfied"*. Tracker item:
`docs/dev/TASKS.md` → "Speaker extraction (Script · Analyze) works well". This doc is the running
record — **read it first after a compact**; every pass lands here as it happens.

User asks carried into the work (same session): test **Qwen 3.6 35B-A3B** later; free to search
the web / other models for this machine; look at **Alexandria**'s prompts, attribution and its
second run; free to rewrite prompts completely; a **second AI pass** for missed / unsure lines.

## The harness

- **Answer key:** `samples/the-ninth-facet/attribution-truth.json` — every [D#] dialogue segment
  of The Ninth Facet (4 chapters, 136 segments) labelled by hand from the text. Sedge (not cast)
  → "unknown". Bigger Inside D39 (the voice in the dark = Ode, unrevealed there) accepts unknown.
- **Runner:** `npm run eval:attribution` (`server/scripts/eval_attribution.py`) → POST
  `/v1/extraction/analyze-text` = the full production pipeline, writes nothing. Cast built like
  `_resolve_cast`. Flags: `--runs`, `--route`, `--system FILE`, `--user FILE`, `--floor`,
  `--temperature`, `--no-propagate`, `--chapter`, `--out`.
- **Verdicts:** right · WRONG (another cast member — looks finished, the dangerous one) · blank
  (unknown where the key names someone — visible, blocks render).
- Server: `justvoice-server serve --port 8741 --data-dir src-tauri/target/debug/data` (the real
  data dir; user granted running anything). Model: gemma-4-26b-a4b-qat, preset `p_extract`
  (temp 0.2), route Auto → **direct** (26B ≥ 14B), floor 0.5.

## Environment facts found on the way

- After the user's DB reset the presets had no model; set `p_extract p_classify p_notes
  p_compose p_voiced_edit p_refine` → local-llamacpp / gemma-4-26b-a4b-qat (the "Set as default"
  edit). The engine (b10750 cuda12) was installed by the user's app setup at 00:32.
- **Local runner timeout was 60 s** (`llm_providers.timeout_seconds`, kit default for every
  provider). A non-streaming analyze of a 42-line chapter took >60 s → the whole chapter came
  back blank. Raised to **900 s** on `local-llamacpp` via PATCH /v1/llm-providers. Studio's
  Script STREAMS (60 s between chunks), so the app usually survived; the plain analyze API, the
  Lab and the harness did not. OPEN: should the kit seed a longer local default?

## Passes

### Pass 0 — baseline (live prompts, unedited shipped text) · 2 runs/chapter
**right 149/272 (55%) · WRONG 38 (14%) · blank 85 (31%)**. by source: tag 18/18, propagated
4/4, llm 115/153 (38 wrong), floored 12/97.
- Brass Rank 18-19/35, 15 WRONG — **every wrong answer was the NEXT line's speaker** (D5 got D6's,
  D7 got D8's…): the reply is a positional array with no ids; one merged/skipped entry early
  shifted every later answer, each at confidence 1.00. Keystone the same from D12.
- The Same Hour 3/42 — the model call **timed out** (60 s) → every line padded "unknown 0.40".
- Bigger Inside 38/40 — fine.

### Pass 1 — answers keyed by [D#] id + 900 s timeout (candidate `attr_c1`)
Code: `pipeline.align_picks` matches by the answer's `id` (positional fallback kept for replies
without ids; a missing id stays a gap). Prompt: DIRECT_SYSTEM output line now
`[{"id": "D0", "speaker": …, "confidence": …}]` + "every [D#] gets exactly one entry".
**right 267/272 (98%) · WRONG 3 (1%) · blank 2 (1%)**. tag 18/18, propagated 4/4, llm 233/236,
floored 12/14. Brass Rank 35 then 33 (2 blank), Bigger Inside 40/40 ×2, The Same Hour 42 then 39
(3 WRONG), Keystone 19/19 ×2.
→ The alignment bug was most of "it wasn't working that well". NOT yet promoted to the live rows.

Residual errors (c1): Brass Rank D8/D9 blank (untagged two-person back-and-forth; rule 5 forbids
alternating); The Same Hour D9-D11 WRONG Cael→Nettle (the paragraph before is Cael's interior
monologue that NAMES Nettle; then `"It's about an hour," she said.`).

### Pass 2 — candidate `attr_c2` = c1 + rule 3 "read in context" + rule 5 "follow clear turn order
at 0.6-0.75" · 2 runs
**right 266/272 (98%) · WRONG 6 (2%) · blank 0**. Brass Rank D8/D9 now RIGHT; The Same Hour
D9-D11 still Cael→Nettle, both runs (stable). llm 242/248.
→ Turn-order inference is safe here (no new errors); the Cael/Nettle case is a reasoning miss.

### Pass 3 — c2 + think (reasoning on; harness `--think`) · 2 runs
**right 272/272 (100%) · WRONG 0 · blank 0**. The Cael/Nettle miss is gone. Cost: 35-51 s per
~9 k-char chapter vs 14-29 s without (≈2x). Leaning: think ON for attribution — a wrong answer
costs the user a review; minutes of compute do not. `p_extract` is used only by the three
speaker_attribution actions (feature_preset_refs), so its think flag is the switch.
Risk to check before promoting: one book can flatter a prompt → validate on a second book.

### Second book — The Salt-Iron Road (so the prompt is not tuned to one author)
Added `samples/the-salt-iron-road/book.json` (JW's second sample, byte copy) + a hand-labelled
key for 3 dialogue-heavy chapters (A Debt Called In 35, Salt and Tally 43, The Wool-Buyer 54 =
132 lines; 14-person cast, titles like "Regent Halloran Sarthe"; ~13.5 k-char chapters). The
harness now skips chapters a key does not cover. 1 run each:
- shipped prompt: **84/132 (64%) · WRONG 44 (33%)** — worse than book 1; positional shift again.
- c2: **132/132 (100%)**.
- c2 + think: **131/132 (99%)**, 1 WRONG (A Debt Called In); 49-61 s/chapter vs 33-40 s.
Combined both books: c2 398/404 (98.5%) · c2+think 403/404 (99.75%). Deciding think needs
more runs (next).

### Pass 4 — repeats (2 more runs each, both books) → the think decision
All runs pooled (Ninth Facet 4 runs × 136, Salt-Iron 3 runs × 132):
- **c2: 928/940 (98.7%)** — Salt-Iron 396/396; Ninth Facet 532/544, the 12 errors ALL the same
  systematic miss (The Same Hour D9-D11 Cael→Nettle at 1.00, every run).
- **c2 + think: 937/940 (99.7%)** — 3 one-off slips, none repeated: Salt-Iron A Debt Called In
  (1 run), Salt-Iron D7 "Quartermaster." Ino→Sable (1 run), Ninth Facet D24 Nettle→Cael at 0.70.
- Time: think ≈ 1.7× (≈45 s vs ≈25 s per 9 k-char chapter; ≈55 s vs ≈35 s per 13.5 k).
**DECIDED: think ON for attribution** — it removes the only systematic error; what is left is
noise. Every remaining error came back at confidence 1.00 or 0.70, which is why a second pass
gated on LOW confidence would never see them (the user's own finding, redesign §8.13).

### Pass 5 — PROMOTED (code + the user's live settings)
- `extraction/prompts.py`: `DIRECT_SYSTEM` = c2 verbatim (the measured text); `GUIDED_SYSTEM` =
  DIRECT + examples rewritten with ids, example 3 flipped from "never alternate" to clear
  two-person turn order at 0.7.
- `extraction/pipeline.py`: `align_picks` (id-keyed, positional fallback). Tests:
  `tests/test_attribution_alignment.py`.
- `seed_presets.py`: NEW preset `p_extract_reasoned` "Reasoned extraction" (temp 0.2, think
  ON); `speaker_attribution.direct` + `.guided` → it. Discover (`.identify`) + Smart-assign stay
  on `p_extract` (think off). `tests/test_llm_seeds.py` now pins exactly one thinking preset.
  `docs/ai-features.md` says so and why (the measured case).
- Live DB (via the app's own APIs): the new preset seeded on restart, model set to
  gemma-4-26b-a4b-qat, both routes assigned to it, both live prompt rows PUT to the new texts
  (user template + JSON setting kept). Local runner timeout 900 s (see above).
- Prior research agreed before we started: `just-llm-runner/docs/plans/archive/
  2026-06-27-speaker-attribution-llm-research.md` (NAACL 2025 SOTA recipe): number every quote,
  JSON keyed by quote id, whole-chunk reason-then-emit, alias roster up front — exactly the fixes
  measured here. Its remaining items: ~4k-token chunks with 1k overlap for long chapters (ours
  fit whole: 9-14 k chars) and an incremental refinement pass (+~1 pt).

### Pass 6 — live verification (no overrides) — INTERRUPTED by low system memory
- **Live direct route, Ninth Facet: 136/136 (100%)** — the promoted config reproduces.
- **Guided route (forced), Ninth Facet: 114/136 (84%)** — a NEW defect: the guided examples use
  ids shaped `c_mara`, and the model copied that shape, answering `c_odeline_marran`,
  `c_iven_sarraz`… for the real ids. Those are not cast ids, so the lines fail even though
  the person is right (19 of the 22 "wrong"). In the app the ids are UUIDs, so the same thing
  happens there. Fix candidates: (a) map an answer that is not a cast id back to a cast member
  by name (extraction/names.match after stripping a `c_`/`p_` prefix and underscores); (b)
  examples in the real id shape. Plus the Cael→Ode miss (D9-D11, 0.90).
- Not run: live Salt-Iron, guided Salt-Iron.
- Claude Code stopped the gate server and the run because the machine hit critically low memory
  while the Qwen 3.6 35B-A3B download (22.85 GB, started via POST /v1/llm-runner/download) ran
  beside a loaded Gemma 26B. Nothing restarted; resume only on the user's word.
- Qwen catalog row `qwen3.6-35b-a3b-mtp` IS saved (UD-Q4_K_XL, inspect facts: qwen35moe, 256
  experts, MTP built in, 22.85 GB, RAM floor 32 GB = this machine's 31.9 GB). The download was
  cut off mid-way; no complete GGUF on disk.

### Pass 7 — two defects the readable test ids had been hiding (fixed)
The harness used readable persona ids (`p_cael_ferren`). The app's are UUIDs. Switched the
harness to UUID-shaped ids (stable sha1-derived) — `--readable-ids` keeps the old shape for
diagnosis — and two things surfaced:
1. **Guided route copied the examples' id shape** (`c_iven_sarraz` for a real id) → 84% on the
   Ninth Facet. FIX `pipeline.resolve_speaker`: an answer that is not a cast id is matched back
   by name (names.match after stripping a `c_`/`p_` prefix + underscores); unmatched → unknown,
   never a phantom id. Rule 2 now says "copied exactly as written there". Guided → 136/136 and
   131/132.
2. **UUIDs in the prompt made the model misread "The Same Hour"** — Cael→Nettle in 7/7 runs with
   reasoning ON (one run 18/42), vs 42/42 in 2/2 with readable ids. Answering with NAMES instead
   (candidate c3) did not help; the ids in the cast list itself were the noise. FIX
   `pipeline.prompt_handles`: the model sees each persona under a name handle (`cael_ferren`,
   `nettle_2` on a duplicate name); answers map back to the real ids; anchors and persistence
   keep real ids; corrections are shown under handles too. → **The Same Hour 42/42 in 3/3 runs
   with UUID ids.**
Also: `tests/test_extraction_stream.py` had passed on a phantom id ("mara" passed through
unresolved); it now asserts the resolved real id.

### Pass 8 — FINAL confirmation (live settings, UUID-shaped ids, no overrides)
- **Direct route (Auto for 26B): 535/536 (99.8%)** — Ninth Facet 272/272 (2 runs), Salt-Iron
  263/264 (2 runs; the 1 = D7 "Quartermaster." Ino→Sable, the known one-off).
- **Guided route (forced): 268/268 (100%)** — both books, 1 run each.
- Time: 31-61 s per chapter (9-14 k chars) on the RTX 2070 Super 8 GB.
From the shipped 55% / 64% (14% / 33% confidently wrong).

### Pass 9 — Qwen3.6-35B-A3B (user ask) + a parser defect it exposed
- Catalog row `qwen3.6-35b-a3b-mtp` (unsloth/Qwen3.6-35B-A3B-MTP-GGUF). Q4_K_XL (22.85 GB) is
  over this box's headroom — the first download beside a loaded Gemma tripped Claude Code's
  low-memory stop. Tested at **UD-IQ4_XS (18.21 GB)** with Gemma unloaded; resident Qwen left
  ~10 GB RAM free. Same live prompt + reasoning preset, `--model` override.
- Run 1: chapters that answered were perfect, but three came back ~all blank at the 0.40 pad
  (Brass Rank 3/35, Salt and Tally 2/43, Wool-Buyer 5/54) → 104/136 + 40/132. No failure in
  the log: the reply had prose around the JSON, and `_extract_first_json_array`'s greedy
  `[.*]` began at a bracket in the prose ("[D5]"). FIX: try every `[{` start, keep the
  longest array that parses; else salvage single answer objects (safe — each names its [D#]).
  The harness now saves the raw reply of any mostly-blank chapter.
- Run 2 (robust parser): **Qwen 268/268 (100%)** — both books perfect. Time 51-245 s per
  chapter (The Wool-Buyer 245 s) vs Gemma 31-61 s.
- Run 3: Ninth Facet 135/136 (Brick→Nettle @0.85), Salt-Iron 130/132 (Sable→Adder @0.95, one
  "Yes, Quartermaster." floored to unknown). Two-run total **533/536 (99.4%)**, 46-85 s/chapter.
- Verdict: **Gemma stays the default** — 535/536 (99.8%) over two runs, faster, and it leaves
  RAM for the TTS engine. Qwen is a fine alternative on bigger machines; the catalog row stays.
- Second pass: **not built.** The residual errors come back at 0.85-1.00, so a pass keyed on
  low confidence would not see them, and a blanket re-ask doubles the time for ~0.3%.
  Revisit only if a harder book shows low-confidence misses.
- Also: a stubbed/echoed REAL id is accepted as-is (the model sees handles, but an id that is
  in the cast is unambiguous) — `test_analyze_persist` relies on it.

### Pass 10 — long chapters, and what happens past the context (2026-09-28, the user's live app)
- `eval:attribution --whole` joins the keyed chapters into ONE chapter and shifts the key.
  Live settings (Gemma 4 26B, ctx 32768, thinking on), server on 17494:
  - The Ninth Facet whole, 6,478 words (~8.7k tok): **136/136**, 144 s.
  - Salt-Iron whole, 7,824 words (~10.6k tok): **131/132**, 124 s (the same "Quartermaster." miss).
  - So a chapter 2-4x normal length reads as well as a normal one. No chunking needed below
    the context.
- Past the context (10 Salt-Iron chapters, 26,030 words, 34,514 prompt tokens > 32,768):
  llama.cpp answers 400 `exceed_context_size_error` and **the pipeline swallows it**
  (`pipeline.py` `except Exception: log.warning(...); llm_picks = []`). The response is a 200
  with 220/234 lines "unknown" (floored), `raw_llm` None, and no message anywhere the user
  sees. The same swallow hid the 00:39 timeout this morning and a failed MTP draft load on
  2026-08-17 — every model failure looks like "the model couldn't tell who spoke".
- Not fixed here (behaviour change, needs its word). Recommendation in TASKS.

### Pass 11 — A/B/C built ("commit and go your rec a b c", 2026-09-28)
- A: `pipeline.py` raises `AttributionModelError(model_failure_message(e))` instead of
  swallowing; a context overflow names both sizes. All four `analyze_scene` callers already
  surfaced exceptions; the stream frame and the two JSON routes now pass the message uncut.
  Live: the 26k-word chapter answers 502 "The chapter is too long … 34,514 tokens and the
  model holds 32,768 …".
- B: IDEAS entry (chapter splitting), nothing built.
- C: Discover sends the library personas the chapter could be naming (`names.named_in`)
  as `{{library}}`; the model returns `library_name`; the endpoint keeps it only when it
  names a real persona, else falls back to `names.match`.
  - The first wording ("Do list them when the passage names them") made Gemma treat
    library people as already known: The Same Hour returned only Odeline/Ode, 3/3 runs;
    `eval:discover` (now library-aware, scores links) recall **18/28**.
  - "The library never changes who you list — … It only fills library_name": **28/28
    found, 28/28 linked, 0 wrong** (2 runs x 4 chapters). No-library check: 13/14, the same
    shape as before.
  - Side effect: with the library shown, Gudgeon stopped being proposed (Brick's
    description says "an enchanted maul named Gudgeon").
  - Live app, all four chapters rescanned: every proposal links to its library persona,
    "Ode" → Odeline Marran, "Threll" → Haldane Threll, no Gudgeon.
- Live DB: identify row system + user template updated (the row still held my earlier
  text, no user edit); the identify test sample gained `library`. The app was restarted
  on the new code first — the renderer fails loud on a `{{library}}` the old server did
  not send.

### Alexandria, read 2026-09-28 (agent report; code in `E:\Dev\Web\alexandria-audiobook`)
- First pass (`app/generate_script.py`, prompts `default_prompts.txt`): 3000-char non-overlapping
  chunks; the model RE-TYPES the book as `[{"speaker","text","instruct"}]` — no ids, no alignment,
  no check against the source (wording drifts; a failed chunk's text is silently lost). No cast
  list — the model invents UPPERCASE names; between chunks it gets `Characters in this book: A,
  B…` + the last 3 entries. temperature 0.6, top_p 0.8, max_tokens 4096, no JSON mode.
- Review (`app/review_script.py`, `review_prompts.txt`): MANUAL button; batches of 25 script
  entries; never sees the source text; fixes tag stripping / narration-vs-dialogue splits /
  merges / instructs, can change speakers; a word-count guard (0.95-1.05) rejects a batch that
  lost text. Contextual mode passes N previous/next entries marked "Context Only, do not output".
- Alias merging after the fact (`generate_personas.py`): honorific-stripping + Jaccard, then one
  LLM call label→canonical name, stored as alias_of.
- Verdict: our deterministic segmentation + tag anchors + id-keyed answers is the stronger frame.
  Worth taking: the one-line test *"if another character in the scene would hear the words, it
  is dialogue"*; context-only neighbours in a review pass; a running cast roster across chunks.

## Status — DONE, committed and pushed (2026-09-28)

| What | Where |
|---|---|
| Passes 0-9 (ids, timeout, c2 prompt, reasoned preset, handles, resolver, robust parser, Qwen) | JV `df15ecf` |
| Pass 10 (long-chapter measure, `eval --whole`), kit 900 s seed timeout | JV `ac82576`, kit `81511e3` |
| Pass 11 (A: failures show · B: IDEAS · C: Discover knows the library) | JV `7609177` |
| Chapter splitting (B built after all) — `2026-09-28-chapter-splitting.md` | JV `7a62c66`, kit `4f8320b` |
| Cut-off answers fail the task (kit client + routes) | kit `9fda2f9`, JW `247dc8e`, JV `4352bc2` |

Final numbers: 55-64% → **99.8%** (Gemma 4 26B, thinking, 2 books, 2 runs); Qwen3.6-35B-A3B
99.4%, slower, Gemma stays default. The one stable miss is Salt-Iron D7 "Quartermaster."
(Ino) — every model/setup says Sable Coyne at 1.00.

Decided, not built: **no second AI pass** — residual misses come back at 0.85-1.00, so a pass
keyed on low confidence would not see them.

Still open (no go given): the Script failure toast/strip was never watched on screen (the
path is the existing renderer one); Discover's reading of very long free text is noisy
("Old Ката", "Thief", "Toll" on the 26k-word test) — the quote check flags invented ones.
