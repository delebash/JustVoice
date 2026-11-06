# ROADMAP — feature horizon (JustVoice)

Created 2026-08-22 on the user's order, from a feature-parity sweep against other voice
studios and their published roadmaps. Charter: like IDEAS.md, **listing here is never
starting** — an item moves to `TASKS.md` only when the user schedules it with decision text.

**Cut to dictation for the release (decided 2026-11-06, the finish run's item 6).** Everything
else went: three of its lines were out of date (Parakeet v3 is offered, a capture can be a
cloned voice's clip, the timeline duplicated an IDEAS entry). The whole sweep:
`git show 69e00a8d:docs/dev/ROADMAP.md`.

## Dictation

- **In-app recording — built 2026-11-06.** Captures' ● Record records the microphone,
  transcribes it and cleans it up ([Dictation](../dictation.md)).
- **A global hotkey (push-to-talk, toggle) and pasting into any app — not in this release**
  (decided 2026-11-06: both need research first — a hold-to-talk key hook for Electron, whose
  `globalShortcut` reports no key-up; native key injection per OS with the clipboard put back).
  Back on the list after the release.
