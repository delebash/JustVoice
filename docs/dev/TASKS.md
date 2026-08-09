# TASKS — open work (JustVoice)

> **This is JustVoice's live tracker.** One item per piece of open work, written
> so it can be read cold. **Close = delete** — git keeps the history, so nothing
> finished stays on this page. **An item lives where the code that closes it
> lives** — JustVoice work here; shared-kit and shared-server work in
> `../just-llm-runner/docs/dev/TASKS.md`; JustWrite work in
> `../justwrite-app/docs/dev/TASKS.md`. Unscheduled ideas go in `IDEAS.md`;
> adding an idea is never starting it.
>
> **THE FORMAT (user ruling, 2026-08-08).** Twice this file has failed: once as
> long prose that restated code and went stale, once as stubs that dropped the
> decision and made a later session re-derive it from a transcript. The rule that
> fixes both: **an item holds what code cannot tell you; everything else is a
> cite.** If the code can answer it, cite `file:line` — never retype it. If only
> the conversation can answer it, it is written here, verbatim, in the same reply
> the decision is made. Six fields, 25 lines max; longer means either code
> restatement (cut it) or a real plan (one line here, pointing at the plan doc):
>
> ```
> ### <the outcome, one line>
> STATE:  DECIDED <date> — "<your words>"  |  OPEN — your call  |  FINDING — code-verified <date>
> WHY:    <why this beat the alternative — 1-2 lines>
> NOT:    <what was rejected, one line each, so it stays rejected>
> BUILT:  <file:line>        OPEN: <the exact remaining change, one sentence>
> GO:     given <date> | needed
> ```
>
> **Never record a decision anywhere but here.** The session task tool is scratch
> and dies with the session — that is how the dictation-cleanup proposal was lost
> and had to be excavated from a 30 MB transcript on 2026-08-08.
>
> **A line here is a claim, not evidence — verify against the code before acting
> on it.** Every item below was re-verified against the code on 2026-08-08 **with
> two exceptions, each of which says so on its own line**: the contract-doc rows
> (they live under `docs/plans/archive/`, out of scope by the no-archives ruling)
> and whether `design-decisions.md` already covers the five rationales. The sweep
> deleted the lint-gate item (fixed), the ratified Lab-tunables item, the
> duplicate cleanup-card item, and one false claim about a missing npm script.
>
> **Nothing points into an archive.** If an item needs detail, that detail is
> either written here or lives in a live doc named on the item's own line.
>
> **The order of work (the user's ruling, 2026-07-26):** *"completely finish JW
> and all AI stuff, then we will work on JV."* Everything here is parked behind
> that unless the user says otherwise, and every item needs its own go.
>
> **GitHub Actions stay off (user ruling, re-issued 2026-08-05: "i asked you to
> turn off github actions when yo commit jv you ignored this fix it").** All
> three workflows — `CI`, `CodeQL`, `release.yml` — are `disabled_manually` on
> the remote. That is a repo setting (`gh workflow disable <file>`), not a file
> edit, and it is reversible with `gh workflow enable <file>`. It was ignored
> once and three pushes each triggered failing runs. **Before pushing JustVoice,
> confirm `gh workflow list --all` still shows all three disabled.** The workflow
> YAML is deliberately left untouched so turning CI back on is one command.

## Waiting on your decision

### Settings → Capture is a localStorage mock — its controls never reach the server

STATE: FINDING — code-verified 2026-08-08 (found wiring the cleanup redesign's
live toggles).
WHY it matters: `SettingsView.vue:585-599` says it itself — "Persisted via
PATCH /v1/settings when wired; for now uses localStorage"
(`justvoice:capture_settings`). Every control on the card (STT model,
refinement mode, language, auto-paste, playback voice) writes only
localStorage; the SERVER's `captures.*` settings — the ones production reads —
never change. Worse, "Refinement mode" is a single-choice select over what the
server stores as THREE independent booleans (`smart_cleanup` /
`self_correction` / `preserve_technical`) — the control cannot even express
the real state. The cleanup card's pane toggles (2026-08-08) write the real
flags, so the two surfaces can now visibly disagree. Violates the
no-renderer-store law (the 2026-06-19 storage rewrite).
NOT: fixed as a rider on the redesign build — un-go'd scope, recorded instead.
OPEN: wire the card to PATCH `/v1/settings` (deep-merge proven), replace the
mode select with the three real toggles, delete the localStorage shim — or
strip the card to what's real.
GO: needed.

### Seed a pronunciation lexicon from the imported book's proper nouns

STATE: OPEN — your call. Raised and deliberately PULLED OUT of the 2026-08-08
JustWrite-zip build ("outside what you asked for, plus one unverified risk").
WHY: a book's proper nouns are the pronunciation problem, and "pronunciation
discipline" is a named audiobook differentiator (CLAUDE.md). JW hands over every
character, location and object name for free in `book.json`; import could
create the project lexicon pre-filled with them, pronunciation blank, as a
worklist.
NOT: folded into the zip build as a rider — un-go'd scope.
OPEN: first verify what an empty-pronunciation entry does at RENDER time —
`_materialize_lexicon` writes `pronunciation=""` (`projects_api.py:750-758`), and
if the render path applies that literally it would blank the word instead of
leaving it alone. If it is inert, seed the roster; if not, seed only entries the
user has filled.
GO: needed.

### A scene break could carry a real pause instead of a glyph

STATE: OPEN — your call. Noted 2026-08-08 during the JustWrite-zip build.
WHY: JW's `* * *` is display-only, but the boundary it marks is real structured
data (scene rows). In audio the equivalent is a longer silence, and
`StandardLine.pause_after_ms` already exists (`standard_schema.py:51`).
NOT: hardcoded in the adapter — that is exactly the "no hardcoded
operator-tunable values" law.
OPEN: add a settings knob (default scene-break pause, ms) and have the importer
stamp it on each scene's last line.
GO: needed.

## The next build

**Deferred by your word (2026-08-06):** the real-webview test harness and the
deep exhaustive audit — *"for now we are not doing jv harness or deep audit i
want to finish all features and complete the jv llm runner conversion."*

### VRAM: STOP AND THINK before any arbiter wiring

STATE: the 2026-07-04 decision stands (one shared VRAM budget family-wide; an
LLM **or** a TTS engine on the GPU, never both) — but the user ORDERED A STOP
first, 2026-08-08: *"once done with those tasks we need to stop and think about
vram, has that already been planned? some tts engines can run direclyt on cpu
and dont need vram, same with some of our modles so we need to take that into
consideration as well as the fact that we dont autoload the lmm model so how
does a user know what they can and cannot load if llm model is not even
selected or loaded, as we have it load on demand"*.
WHY: the old item assumed the wiring was the remaining work; the user names two
unplanned dimensions — CPU-resident engines/models that need NO budget, and the
load-on-demand LLM meaning the budget's biggest consumer is invisible until it
runs.
BUILT: the arbiter itself, in the runner (`runner/arbiter.py`); JustVoice's
`EngineManager.load()` neither reserves nor releases ("arbiter" appears nowhere
in `server/`, verified 2026-08-08). The engines are OS subprocesses, not
in-process (design-doc correction rides along).
OPEN: the THINK is DELIVERED, then twice hardened by ordered adversarial
passes — `docs/plans/2026-08-08-vram-think.md`. Pass 2 found the budgeted
policy ALREADY RUNS in JV's process for the LLM (`lifecycle.py:491`), reversing
Q1 to budgeted-from-the-start and cutting two overbuilt pieces. Pass 3 found
the decisive structural fact: naive TTS reservations would CORRUPT the runner's
`_admit` (it would "evict" a foreign key via router_unload no-op + release —
the ledger lies, overcommit returns), so the wiring's PREREQUISITE is the
kit-side eviction-executor seam (reservation kind + evict_fn + a shared
make_room; `_admit` refactored onto it). Pass 3 also disproved pass 2's
self-shrink assumption (the load fits against the FULL card and EVICTS —
`lifecycle.py:1937` + `_admit`) and found the shipped in-runner precedent for
Q2's policy shape (the #274 embed placement). The workflow pass (the user's
"how does the flow work" question) added §4 + two more calls: Q6 — Quick Setup
UNCHANGED (family-canon charter; TTS has no default-model concept, voices are
the unit and engines follow them), but the 2026-08-05 warm-boot stopgap
("TTS owns the GPU until F4's arbiter", main.js:208-214) comes back — rec:
flip LLM warm-boot ON as the wiring's last step; Q7 — mixed-GPU-engine casts
thrash full model loads per engine crossing (one-slot-per-kind +
per-line auto-load, verified) — rec: chapter render synthesizes grouped by
engine. Pass 4 verified the newest pieces in code: Q7's premise holds (the
chapter render is collect-then-assemble, `render_chapter_api.py:250-264`, so
grouping is just iteration order); Q6's mechanics corrected (warm is a per-DB
SETTING — kit default ON, JV's `llm_bootstrap.py:34-36` seeds it 0; the flip
reaches fresh DBs only, seeds-only rule); and Q8 found the deeper limiter —
`synth()` is slot-coupled (`manager.py:1415-1417`), so CPU-kokoro + GPU-engine
can never co-reside; multi-resident engines recorded as the later refactor,
NOT built. make_room's busy protection also closes the pre-existing same-kind
hole (loading LLM B could evict busy LLM A). Pass 5 produced ZERO design
reversals and four wiring corrections (§5 of the doc — convergence): whisper
IS the third kind and AUTO-LOADS today (`captures_api.py:48-60`, stt slot,
1500 MB cuda-only manifest) so dictation's resident set is stt+llm at once;
there are TWO engine-load doors and `render_core.render_line`'s direct
`engine.load` would BYPASS arbitration — door unification onto
`EngineManager.load()` is wiring prerequisite #2; `models_max`'s count cap
must be kind-scoped or a TTS resident eats a llama.cpp child slot; TTS
admission reuses the existing `safety_margin_mb` knob; and the claim line's
two sources are verified (measurements record `vram_total_mb`; `compute_fit`
prices an on-disk gguf). llm-busy lands in the KIT dispatch layer (JW inherits
the protection free); tts/stt-busy at the manager chokes. Your calls on Q1–Q8
are the gate. NO code before those decisions.
GO: needed — the decisions, then the wiring gets its own go.

## Features the docs promise and the code does not do

### The effects chain never runs on a chapter or batch render

STATE: FINDING — code-verified 2026-08-08.
WHY it matters: a user builds an effects chain, hears it on a one-off generate,
and loses it on the render that matters.
BUILT: `apply_effects_chain` on single-line paths only — `generate_api.py:276,
296, 371, 388`. `render_core.py` contains **zero** effects code.
OPEN: wire it into the render path AND put the chain's hash in the render cache
key — today editing the chain does not invalidate the cache, so a naive wiring
would serve stale audio.
GO: needed — needs its own plan.

### Nothing is mastered by project kind, and the UI says otherwise

STATE: FINDING — code-verified 2026-08-08.
WHY it matters: Studio renders a pill reading "ACX target · −20 LUFS · peak −3 dB
· noise floor −60 dB" with the tooltip "Applied on render — set per project in
Projects" (`StudioView.vue:841-846`, `:1430`), and `renderScene()` sends
`{scene_id, preset_id}` with **no master field** (`:779-782`), so the server
returns raw WAV (`render_chapter_api.py:259`). The ACX QC column therefore grades
unmastered audio and can pass a file that fails on delivery.
BUILT: the per-project picker (`ProjectsView.vue:562`); `acx` is assigned in
exactly one place, audiobook import (`projects_api.py:643`). The podcast −16 LUFS
default the docs describe exists nowhere.
OPEN: wire real per-kind defaults + a mastered render + a QC path over the
mastered file — or cut the promise from the docs and the pill.
GO: needed.

### `chapter.md` documents a page that doesn't exist and audio that isn't mastered

STATE: FINDING — code-verified 2026-08-08.
BUILT: nothing to keep — `chapter.md:5` links `stories.md` (absent), `:32` and
`:81` link `profiles.md` (absent), `:3` claims "render the whole chapter as a
single mastered WAV" (the item above shows it is not true).
OPEN: the rewrite, which waits on the mastering decision. `docs/export.md`'s
"Chapter render → mastered WAV" section is the same suspect class and is still
unverified.
GO: needed, after the mastering call.

## Docs and repo debt

### The Stories tab advertises a feature that isn't built

STATE: OPEN — your call: reword the lede, or hide the tab until the timeline is
real.
WHY it matters: app copy is code. `App.vue:43` sells "Multi-track timeline editor.
For podcasting, game-dialogue assembly, and per-chapter multi-voice arrangement."
BUILT: nothing behind it — `StoriesView.vue` has been deliberately inert since
2026-06-13, and the live server's `openapi.json` has **no `/v1/stories*` route at
all** (verified 2026-08-08). The tab's ? button also 404s: `App.vue:143` maps it
to help slug `stories`, and `docs/stories.md` does not exist.
OPEN: the copy decision, then either write `docs/stories.md` + restore its
`toc.json` entry, or remove the tab and leave both out.
GO: needed. (User docs were corrected 2026-08-04 to stop sending podcasters there.)

### Design rationale that exists only as code comments

STATE: FINDING — the comments verified present 2026-08-08; whether
`design-decisions.md` already covers each one is **not** verified.
WHY: a comment does not survive the next refactor of the file it sits in.
OPEN: write these into `design-decisions.md` — why Stories is gated
(`StoriesView.vue:3-15`, belongs in §5) · the backup schema-v1 / 4 GB design ·
why settings folded from JSON into SQLite (`storage/settings_store.py:4-8`) · the
"no hardcoded operator-tunable values" law and how engine source overrides
implement it · corrections used as few-shot examples.
GO: needed.

### The `screenshots` npm script is broken two independent ways

STATE: FINDING — hit live 2026-08-08 (left unfixed: no go was given to edit it).
BUILT: nothing. `scripts/smoke_gui.js` hardcodes `127.0.0.1:17497` and ignores
`JV_BASE` (CLAUDE.md's "JV_BASE overrides the base URL" is true of `smoke.js`
only), and even on the right port it times out waiting for a
`getByRole('button', { name: 'Engines' })` that no longer resolves.
OPEN: fix the port to honor `JV_BASE` and update the stale selectors — or
retire the script into the deferred harness decision (it is browser-driven,
the banned acceptance class).
GO: needed.

### §3 wording tension: "speaker attribution = JW" vs "JV does its own casting"

STATE: OPEN — observed 2026-08-08 during the contract-rows work, **unverified**
which reading is right.
WHY it matters: `design-decisions.md:105` lists speaker attribution under JW's
data ownership, while CLAUDE.md says "JW hands over the prose, JV does its own
casting and narration" and JV's extraction pipeline computes attribution.
Possibly ownership-of-data vs where-computation-runs — but the two sentences
read as contradicting each other and one page should say which.
OPEN: reconcile the §3 wording (one look at what JW actually exports).
GO: needed.

### The JW→JV book-format contract has no lock on the JustWrite side

STATE: OPEN — your call, and the concrete successor to the "book-zip import
format" item §3 records as a future decision. Became real 2026-08-08 when the
`justwrite` adapter started parsing JW's actual `book.json`.
WHY: JV's own fixture test catches JV regressions but cannot catch JW CHANGING
the shape — a rename of `scenes[].body` or a re-nesting of `parts[].chapters[]`
would break JV silently, and the two repos share no code by design (see the
zip-import item's NOT list).
OPEN: a shape-lock test in JW's suite asserting `book_io.assemble()` still emits
the exact key paths JV reads, naming JustVoice in its failure message. Lives in
`../justwrite-app/docs/dev/TASKS.md` once you take it — JW work belongs there.
GO: needed.

### ElevenLabs import: build it or drop it — the research says it is small

STATE: OPEN — your call. Its picker row was removed 2026-08-08 (a 501 in a menu),
but the module's own docstring is WRONG about why it was never built.
WHY: `imports/adapters/elevenlabs.py` claimed the mapping needs "an account-side
voice manifest" or a hand-mapping step and is "out of scope". JustVoice's own
research doc contradicts it — `docs/dev/external-import-formats.md` says the
Studio export is a ZIP of `manifest.json` (name, `voice_assignments`, chapters) +
per-chapter HTML with `<span data-speaker>` turns, maps "directly to Project /
Scene / Block", and rates the importer effort **Small**. The same doc surveys
Resemble, Speechify, Murf, Coqui and OpenVoice the same way.
OPEN: build it from the research doc (it also unlocks the four other tools), or
decide the whole external-tool import family is not wanted and retire the
research doc's claim. Either way the stub is gone — git holds it.
GO: needed.

## Known deviations, recorded so they aren't re-litigated

- **No real-webview end-to-end harness** — deferred by your word above. When it
  is picked up, docgen's harness is the donor, and `scripts/shots.js`,
  `scripts/verify_all.js` and `scripts/e2e.js` retire or get replaced with it:
  they are browser-driven, which was banned as an acceptance surface on
  2026-08-02.
- **`capture.llm_model` is a dormant settings field** — decided KEEP. Its UI
  picker is gone but the field stays (`models.py:330`).
