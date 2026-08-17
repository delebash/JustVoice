# The voice-workflow redesign mock

<!-- SPDX-License-Identifier: MIT -->

**The mock is the design.** The redesign is being worked out here rather than
in prose — `../2026-08-15-voice-workflow-redesign.md` §8 is the written record
of every ruling made while walking it, and §8.18 is its exact state.

Lived in a session scratchpad until 2026-08-17 and would have died with the
session. Moved here so it survives.

## Open it

`workbench-mock.html` — a single self-contained file. Open it in a browser; no
server, no build step. It is also published (private) at
`https://claude.ai/code/artifact/534a16a2-af40-438b-a64d-34baaf31f838`.

## Change it

```bash
cd docs/plans/mock
# edit a screen: _s2.html (Script), _s4.html (Render), _new_discover.html, …
python build_mock.py .        # regenerates workbench-mock.html
python validate.py .          # structure · routes · dead controls
```

Then republish to the **existing** artifact URL — passing it as `url`, or a
second artifact appears instead of the first updating.

## What each file is

| File | Role |
|---|---|
| `build_mock.py` | assembles everything into `workbench-mock.html`. **Run after any edit.** Owns `ROUTES` (a screen is unreachable until it is listed there), `steps()`, `inject_steps()`, `linkify()`, `RAIL`, `MODEBAR` and the page script |
| `_head.html` | `<title>` + the whole `<style>` block; tokens copied from `src/styles/tokens.css` |
| `_s1`–`_s13.html` | the original screen stashes, addressed as `stash(n)` |
| `_new_*.html` | the newer route screens — home, projects, chapters, lines, discover |
| `_interactions.py` | modal/toast CSS, the modal markup, and the page JS (`openModal`, `toast`, `pickChip`, `selectAllCh`, `recalcAnalyze`, …) |
| `wire.py`, `wire2.py`, `wire3.py` | the three sweeps that got it to zero dead controls. `wire3.py` is the backstop — it gives any remaining `<button>` without `onclick`/`disabled` a real action |
| `validate.py` | tag structure · every route reachable · no dangling `nav()` target · dead-button count |

## Traps that have already cost time

- **Publishing without rebuilding.** Editing a screen and republishing does
  nothing — `build_mock.py` has to run first.
- **cp1252 print trap.** Printing an emoji from Python crashes *after* the file
  writes have succeeded, so a script half-runs and looks like it failed. Use
  `.encode("ascii", "replace").decode()` in every `print`.
- **Regex edits eat tags.** A `re.sub` removing a card once swallowed a closing
  `</div>`. Re-run `validate.py` after any regex edit.
- **Heredoc quoting.** Apostrophes in Python passed through a shell heredoc
  break it — write the script to a file instead.

## The standard it is held to

From `CLAUDE.md`: *a mock is production minus the plumbing.* Production copy
only — no design commentary — working nav and controls, enum values verified in
the code, real states including empty/blocked/stale, counts consistent across
screens, no leftovers, the app's own tokens.

**Known gap** (§8.21 item 6): every screen is populated at whatever count
flatters the layout. The honest states — one project, 500 NPCs, a 3,000-line
chapter, nothing rendered yet — are not built.
