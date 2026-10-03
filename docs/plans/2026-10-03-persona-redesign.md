# The Personas redesign — design check before any code

**Status:** research in progress (2026-10-03). No code until the review in this doc is shown and
approved. Tracker: docs/dev/TASKS.md, FINDING "a persona's pace, pitch and gain can't be edited
anywhere in the app".

## 1. What is decided

- **Order** (2026-10-03): "we need to do the persona first that is before slice 4, why do you keep
  forgeting this?" — the Personas work comes before Studio Slice 4 (D8 in
  `2026-09-30-mock-vs-app-and-slice-4.md` answered).
- **Scope** (2026-10-03): "whole redesign per mock" — the Personas index (mock `_s9`) and the persona
  editor (mock `workbench` / `_s7`), carrying "Voice gender in every voice dropdown, and speaker
  pronouns" (`2026-09-30-voice-gender-and-pronouns.md`).
- **The check asked for first** (2026-10-03): "did we rethink on the persona to make sure we have it
  designed correctly whihc it changing options on engine nad model selection, think on the desing
  nad make sure it is correct and accounts for voice desing clone, regular and models that take
  direction like qwen and thos that take workds like chatterbox, think on it several times".
- **Save it** (2026-10-03): "make sure yyou save thsi info i thought we have already run these
  checks".

## 2. The facts (being gathered)

Four read-only research passes, each with file:line citations:
- 2.1 what the mock says a persona is and how its editor behaves;
- 2.2 what a persona is in the code today and which fields reach the audio;
- 2.3 what each engine and each model accepts (voice kinds, direction text, word tags, knobs,
  language, lexicon);
- 2.4 every earlier ruling that constrains the redesign, and whether an earlier design check
  already covered engine- and model-dependent options.

## 3. The design passes

To come — each pass takes a new angle (the items; their interactions; my own claims; the checker;
the neighbours not touched).

## 4. Questions for the user

To come.
