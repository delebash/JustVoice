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

## The next build

**Deferred by your word (2026-08-06):** the real-webview test harness and the
deep exhaustive audit — *"for now we are not doing jv harness or deep audit i
want to finish all features and complete the jv llm runner conversion."*

### Make TTS engine loading reserve VRAM through the shared arbiter

STATE: DECIDED 2026-07-04 — one shared VRAM budget for the whole family, and
JustVoice runs an LLM **or** TTS, never both on the GPU at once.
WHY: nothing else stops an LLM and a TTS engine claiming the same card.
NOT: a JustVoice-local budget — the arbiter is family-wide by design.
BUILT: the arbiter itself, in the runner (`runner/arbiter.py`).
OPEN: JustVoice's half — `EngineManager.load()` neither reserves nor releases.
Verified 2026-08-08: the string "arbiter" appears **nowhere** in `server/`.
Sized medium. One correction rides along: the design doc calls JustVoice's
engines in-process; they are OS subprocesses.
GO: needed.

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

## Known deviations, recorded so they aren't re-litigated

- **No real-webview end-to-end harness** — deferred by your word above. When it
  is picked up, docgen's harness is the donor, and `scripts/shots.js`,
  `scripts/verify_all.js` and `scripts/e2e.js` retire or get replaced with it:
  they are browser-driven, which was banned as an acceptance surface on
  2026-08-02.
- **`capture.llm_model` is a dormant settings field** — decided KEEP. Its UI
  picker is gone but the field stays (`models.py:330`).
