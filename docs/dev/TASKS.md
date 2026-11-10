# TASKS — open work (JustVoice)

> **This is JustVoice's live tracker.** One item per piece of open work, written
> so it can be read cold. **Close = delete** — git keeps the history, so nothing
> finished stays on this page. **An item lives where the code that closes it
> lives** — JustVoice work here; shared-kit and shared-server work in
> `../just-core/docs/dev/TASKS.md`; JustWrite work in
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
> **A closed item is in git.** The finished, stale and rule-holding items were deleted on
> 2026-11-05 (their rules moved to AGENTS.md, `design-decisions.md`, `design-law.md` and
> RESEARCH §10): a citation of a TASKS item by a title no longer here points at git —
> `git log -S "<the title>" -- docs/dev/TASKS.md`.
>
> **Nothing points into an archive.** If an item needs detail, that detail is
> either written here or lives in a live doc named on the item's own line.
>
> **The order of work (the user's ruling, 2026-07-26):** *"completely finish JW
> and all AI stuff, then we will work on JV."* Everything here is parked behind
> that unless the user says otherwise, and every item needs its own go.
>
> **GitHub Actions stay off (user ruling, re-issued 2026-08-05: "i asked you to
> turn off github actions when yo commit jv you ignored this fix it").** `CI` and
> `CodeQL` are `disabled_manually` on the remote; `Release` was enabled on
> 2026-11-08 for the family release (its D3, mine under the go) and made v0.1.0.
> All three run by hand only (`workflow_dispatch`), so a push builds nothing. A
> repo setting (`gh workflow disable|enable <file>`), not a file edit. It was
> ignored once and three pushes each triggered failing runs. **Before pushing
> JustVoice, confirm `gh workflow list --all` still shows CI and CodeQL disabled.**

## The next build

Nothing open. JustVoice v0.1.0 was released on 2026-11-10 (tag `ac1d03ee`; our audio.cpp fork's v0.9.4-jv.7;
kit `ae6f09a7`). The items that led to it are closed: the latest models and the two picks marked
(`docs/plans/2026-11-08-latest-models.md`), the commercial engine first, one-click's stop at the cast, the
close-out list A–D, the fork's release (`docs/plans/2026-11-09-fork-release-test.md`), the character voices, the
kit's fifteenth-review changes and Discover's names. Their decisions, with the user's words, are in git:
`git log -S "<the title>" -- docs/dev/TASKS.md`. The ideas held back for the release are in `IDEAS.md` again.

## Known deviations, recorded so they aren't re-litigated

- **The deep exhaustive audit is deferred by your word** (2026-08-06): *"for now we are not doing jv
  harness or deep audit i want to finish all features and complete the jv llm runner conversion."* The
  harness half is built (`e2e/`, 2026-10-29); the audit stays deferred.

- **`capture.llm_model` is a dormant settings field** — decided KEEP. Its UI
  picker is gone but the field stays (`models.py:366`; its default still names
  `qwen3-llm-0.6b`, an engine that no longer exists).
- **Discover lists named people who never speak as New, with 0 lines** — decided
  LEAVE IT 2026-10-06 ("fix go", on the lean as shown: "Lean: leave it, since the 0 in
  Lines already says so."). Seen in the end-to-end run after a reset: the courier, the
  Warden, a Concern clerk (`docs/plans/2026-10-05-second-look-test.md`).
- **The kit's outline (secondary) button style stays as it is** — decided LEAVE IT 2026-10-06 (the user:
  "leave it", to: "Every other outline button in all three apps has the same faint look … Should I make the
  outline style itself easier to see, with a darker border and darker text?"). Only Script's ✓ Looks right
  went solid ("Script's ✓ Looks right buttons are solid").
