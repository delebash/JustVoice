# Studio — Cast → Script → Render

Studio is the multi-character production environment: assign voices to
characters, attribute every line to its speaker, render the whole project. The
tab names adapt to your project kind (chapters for audiobooks, quests for game
projects, segments for podcasts) — same flow, your vocabulary.

## Cast

Every character in the project, with their voice assignment. Add a character,
open the voice params modal to tune their delivery, and **Test line** to hear a
sample before committing. **Smart assign** asks the LLM to propose voices for
the whole unassigned cast in one pass — grounded in each character's bio and
your voice library — and you accept or change per row.

## Script

**Analyze** runs LLM speaker attribution over the text: every line gets a
speaker with a confidence score. Rows the model was unsure about are the ones to
check — a row marked `floored_from` tells you the confidence was clamped up by
your floor setting, not earned. **Corrections teach the system**: when you fix a
row, that correction is remembered and fed back into future Analyze runs as a
worked example, so the same mistake stops recurring. When Analyze meets speakers
that aren't in your cast, a **discover-speakers** banner offers to promote them
to personas in one click.

## Render

Batch-render the project scene by scene. Each scene can bind a **render preset**
(see [Presets](presets.md)) so a chapter or quest keeps one locked sound;
**Suggest** proposes a preset per scene. The progress panel shows per-scene
status, and the render cache means an unchanged line costs nothing to re-render
— cache hits are reported as such.
