# TASKS — open work (JustVoice)

> **This is JustVoice's live tracker.** One item per piece of open work, written
> so it can be read cold. **Close = delete** — git keeps the history, so nothing
> finished stays on this page. **An item lives where the code that closes it
> lives** — JustVoice work here; shared-kit and shared-server work in
> `../just-llm-runner/docs/dev/TASKS.md`; JustWrite work in
> `../justwrite-app/docs/dev/TASKS.md`. Unscheduled ideas go in `IDEAS.md`;
> adding an idea is never starting it.
>
> **A line here is a claim, not evidence — verify against the code before acting
> on it.** Every item below was code-verified on 2026-08-07 by a sweep that
> emptied this file of finished work: the token-cap ruling, the thinking-gate
> removal, the routing cleanup, the Auto simplification, the speaker-attribution
> restore, both QC-find batches, the shared-stack convergence and the docs
> disposition sweep were all confirmed built in the code and deleted from here.
> Each surviving item names the file and line its claim rests on.
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

Four things are built or measured and cannot move without a word from you.

### The lint gate is unpassable — pin it, narrow it, or fix it

`CLAUDE.md` says `cd server && ruff check .` must pass before a commit. It does
not pass. Measured 2026-08-07: **502 findings**, 272 of them auto-fixable. None
come from recent work — this is old baseline debt that has been accumulating.

Why it got worse on its own: the dev pin floats. `server/pyproject.toml:74` asks
for `ruff>=0.7` and now resolves **ruff 0.16.0**, whose default rule set is far
wider than the version the gate was written against. It is not purely a
version-drift story though — **6 findings survive even under the old classic
defaults** (`E4,E7,E9,F`), in files no recent change touched: `voices_api.py`
five `E402`s, `shared_venv.py` one `F401`. One of the six is auto-fixable.

Three ways out: **pin ruff to a specific version** · **declare an explicit
`[tool.ruff.lint] select` so the gate means one fixed thing forever** · **fix
the 502**. Pick one and the gate becomes honest again.

### JustWrite's help docs never explain what happens when a model can't think

JustWrite already documents the thinking control itself —
`justwrite-app/docs/models.md:209-224` covers the three states (Off · Model
default · a named level), how the budget resolves through its layers, and how
cloud providers behave.

What no JustWrite doc mentions is the behavior that landed when the capability
gate was removed on 2026-08-06: a request now goes out exactly as the preset
asks, and if the provider refuses, the user sees that provider's own error plus
one sentence naming the fix. JustVoice explains this at
`docs/ai-features.md:279-282`. JustWrite explains it nowhere, and it is the same
machinery. It needs writing in JustWrite's own words, in JustWrite's repo.

### Two calls I made on your behalf during the unattended build — ratify or reverse

1. **The Lab's tuning controls are real, not hidden.** The plan left "hide them
   or make them work" open and I made them work — Reasoning, Max tok, Top-p and
   the sampler rows all pass through to the run. Verified still true:
   `server/justvoice/api/extraction_api.py:211` carries the per-column
   overrides, and `docs/ai-features.md:162` documents "The tunables are real."
2. **The dictation cleanup card kept its four piece panes.** The instruction was
   "piece rows go compact" and I read that as *add* the composed-prompt pane
   while leaving the four individual piece panes working. I did not strip them.
   If compact meant less, say so.

### How the dictation cleanup card should look

Open since the 2026-08-06 QC walk: you flagged the bare engine-preset pane and
the full-size piece cards as wrong. A proposal is owed to you before anything is
built. The decision underneath is settled and is *not* being reopened — dictation
cleanup stays one feature, one call, four texts as sections.

## The next build

**Deferred by your word (2026-08-06):** the real-webview test harness and the
deep exhaustive audit — *"for now we are not doing jv harness or deep audit i
want to finish all features and complete the jv llm runner conversion."*

So there is exactly one item of committed build work left in the conversion:

### Make TTS engine loading reserve VRAM through the shared arbiter

The decision was made 2026-07-04 and has not changed: **one shared VRAM budget
for the whole family, and JustVoice runs an LLM or TTS — never both on the GPU
at once.** The arbiter that enforces it is already built in the runner
(`runner/arbiter.py`). Only JustVoice's half of the wiring is missing:
`EngineManager.load()` does not reserve or release against it.

This is costing something visible right now. `server/justvoice/app.py:253` keeps
a GPU setting shipped **off** with the comment "the GPU until F4's VRAM arbiter;
the user can flip it on" — verified 2026-08-07. Users have to flip it by hand
and there is nothing stopping an LLM and a TTS engine from colliding when they
do.

Sized medium. One correction rides along: the design doc calls JustVoice's
engines in-process, and they are OS subprocesses.

## Features the docs promise and the code does not do

Each of these was verified 2026-08-07. Each needs its own plan and its own go.

### The effects chain never runs on a chapter or batch render

`server/justvoice/render_core.py` contains **zero** effects code.
`apply_effects_chain` is called only from single-line paths in
`generate_api.py` (lines 276, 296, 371, 388). So a user who builds an effects
chain hears it on a one-off generate and loses it on the render that matters.

Worse, the render cache key does not include the chain's hash — editing the
chain does not invalidate the cache, so even wiring it up naively would serve
stale audio.

### Nothing is mastered by project kind

Choosing a project kind sets no mastering preset. The only place `acx` is ever
assigned is audiobook *import* (`api/projects_api.py:643`). Studio's render
sends no master at all, which means **the ACX QC column is measuring unmastered
audio** — it can pass a file that would fail on delivery. The podcast −16 LUFS
default the docs describe does not exist anywhere.

The per-project picker *does* exist (`src/views/ProjectsView.vue:562`), so the
surface is there and only the wiring and defaults are missing. Decide: wire real
per-kind defaults plus a mastered render and QC path, or cut the promise out of
the docs.

### `chapter.md` documents a page that doesn't exist and audio that isn't mastered

`docs/chapter.md:5` links `stories.md`, which does not exist. Lines 32 and 81
link `profiles.md`, which does not exist either. Line 3 repeats the "render the
whole chapter as a single mastered WAV" claim that the item above shows is not
true today.

A rewrite has to wait on the mastering decision. `docs/export.md`'s "Chapter
render → mastered WAV" section is the same suspect class and is still
unverified — the earlier sweep only code-checked the voicelines manifest and
sidecar claims.

## Docs and repo debt

### The Stories tab advertises a feature that isn't built

`src/App.vue:46` sells the tab as "Multi-track timeline editor. For podcasting,
game-dialogue assembly, and per-chapter multi-voice arrangement." Clicking it
lands on `src/views/StoriesView.vue`, deliberately inert since 2026-06-13
because `/v1/stories` has never existed server-side.

App copy is code, so this is your call: reword the lede, or hide the tab until
the timeline is real. (The user docs were already corrected on 2026-08-04 to
stop sending podcasters there.)

### `docs/stories.md` is missing and its index entry was pulled

The file does not exist, and `docs/toc.json` has no `stories` entry — it was
removed on 2026-08-04 because it 404'd in the app. Writing the page and
restoring the entry are one job, and both wait on the Stories decision above.

### A contract test suite is cited but was never written

The archived contract doc cites `server/justvoice/openapi.json` and
`server/tests/test_contract.py` as the enforcement mechanism. **Neither file
exists.** Build them or strike the claim.

### Two false rows in the archived contract doc

`docs/plans/archive/CONTRACT.md:89` says speaker attribution is "computed in
JustWrite's `services/speakerAttribution.js`" and `:95` describes personality as
a render-time LLM rewrite. Both are false and both are still there. Either
correct them in place or extend the stale-table note in
`docs/dev/design-decisions.md` §3 to name them by line.

### The runner still ships model pinning that JustVoice no longer uses

JustVoice is fully off pins. The runner still exports `resolve_pin`
(`llm/dispatch.py:138`, re-exported from `llm/__init__.py`) and its
`docs/feature-model-system.md:29-31` declares pins deliberately kept. Retiring
it was decided 2026-07-15 as post-integration cleanup and never done. (The
pins' `tier` field is already gone — it died with the routing cleanup.)

### Design rationale that exists only as code comments

Worth writing into `design-decisions.md` when convenient, so it survives the
next refactor:

- **Why Stories is gated** — the reasoning lives only in
  `src/views/StoriesView.vue:3-15`. Belongs in §5.
- **The backup schema-v1 / 4 GB design.**
- **Why settings folded from JSON into SQLite** — the rationale is the module
  docstring at `server/justvoice/storage/settings_store.py:4-8`.
- **The "no hardcoded operator-tunable values" law** and how engine source
  overrides implement it.
- **Corrections used as few-shot examples.**

## Known deviations, recorded so they aren't re-litigated

- **The console script is `justvoice.cli`, not the family-standard
  `<package>.serve`** — grandfathered, same class as JustWrite's recorded
  exception. Verified 2026-08-07 in `package.json`'s `server` script.
- **No real-webview end-to-end harness** — deferred by your word above. When it
  is picked up, docgen's harness is the donor, and `scripts/shots.js`,
  `scripts/verify_all.js` and `scripts/e2e.js` retire or get replaced with it:
  they are browser-driven, which was banned as an acceptance surface on
  2026-08-02. A `screenshots` npm script is also missing.
- **`capture.llm_model` is a dormant settings field** — decided KEEP. Its UI
  picker is gone but the field stays.
