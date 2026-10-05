<!-- SPDX-License-Identifier: MIT -->
# Cast, Render, Generate and the persona's gender — the five answers (2026-10-05)

**The decision is TASKS "Cast, Render, Generate and the persona's gender — five answers"
(verbatim, "your rec on all go").** This doc is the build of the three that were fully decided
(2, 3, 5), the research the other two waited on (1, 4), and the blast radius.

## 1. Built

- **2 · Cast's ＋ Add says when to use it.** Tooltip: *"Someone Discover missed: add them, then
  Re-analyze or set their lines on Script."* (`StudioCast.vue`); `studio.md` Cast.
- **3 · Render's line panel changes who says the line**, with Script's own list
  (`scriptReview.speakerOptions` — the narrator first, then by lines in this chapter) and
  Script's own request (`PATCH /v1/blocks/{id}` with `speaker_id`, `source: "corrected"` — left
  out on a chapter Analyze never ran on, Script's rule). The line re-reads and shows *stale*
  (its persona changed); Script re-reads on `changed`. The voice stays Cast's (D2).
  `StudioRenderChapter.vue`; `studio.md` Render.
- **5 · The persona page shows its gender** — the voice's (*Female · from its voice · change it
  on Voices ➜*); a voice whose gender isn't known shows *Not known* and a warning that
  Smart-assign can't match the persona to anyone's pronouns. No new field.
  `PersonaEditorView.vue`; `personas.md`.

Then, on the nine follow-up answers ("your rec on all go", TASKS):

- **1 · ＋ New persona for the N with none** (Cast). Everyone with no persona, the narrator
  too. `services/newPersonas.js`: `splitByName` (a library persona of exactly their name casts
  them — no new one) and `voicesForBook` (installed voices that speak the book's language, all
  when it isn't set). The rest go to Smart-assign's own call with those VOICES (a kit task,
  shown on Cast); `CastNewPersonas.vue` lists speaker → voice with ▶ and a tick each before
  anything is made; Create makes a persona per ticked speaker (its name, that voice, no note)
  and casts it. `StudioCast.vue`; `studio.md` Cast.
- **6 · ✏️ Rewrite and 🎲 Compose on the persona page's Hear it** — Generate's two, with its
  preview-then-accept. They read the SAVED note (`/v1/personas/{id}/compose`, `/rewrite`), so
  they wait for a saved persona with a note and say why. Their strip shows on the page.
- **7 · The Lexicon field counts** the words it would replace in the line typed in Hear it
  (`lexiconPreview.lexiconMatches`, as Generate did).
  `PersonaEditorView.vue`; `personas.md` Hear it, Lexicon.
- **9 · Generate's removal waits** for one answer: Captures' "Speak again" opens Generate with
  the transcript filled in (`CapturesView.vue:56-63`), which the comparison below missed.

## 2. Researched (checked in code 2026-10-05)

**1 · What a new persona needs.** `CreatePersonaRequest` (`models.py:730`) requires only `name`;
`voice_id` is optional, but a persona with no voice can't speak — Render calls its lines *needs
a voice*. Persona names are unique across the library (TASKS "Persona names are unique across
the library"). Smart-assign's endpoint is generic: `POST /v1/llm/smart-assign` takes
`characters` and `voices` (id, name, gender, age, accent, tone, language) and returns
`{character_id: voice_id}` (`smart_assign_api.py:31-61`); its seeded prompt says *"Available
voices"* (`seed_feature_prompts.py:165`). So the batch can send the library's **voices** to the
same call and make a persona per answer.

**4 · Generate against the persona page** (`GenerateView.vue` vs `PersonaEditorView.vue`):

| Generate has | The persona page | Elsewhere |
|---|---|---|
| a voice with no persona | needs a persona | Voices' test line plays any voice |
| text + slash tags + 🏷️ Insert tag | Hear it: the same | — |
| ▶ Generate, ⏹ | ▶ Listen | — |
| ✏️ Rewrite, 🎲 Compose (LLM, preview then accept) | **none** | Render: ✏️ Rewrite as *speaker* |
| a one-off delivery overlay (speed, pitch, gain, temperature, seed, direction) | How it speaks + Sampling edit the persona; unsaved, they shape Listen only | — |
| the lexicon preview (*N word replacements would apply*, View applied entries) | a Lexicon field, no preview | — |
| History — takes, ★ favorites, ↻ retry, ✕ delete | **none** | — |
| Autoplay | — | — |
| download (the player) | ⤓ WAV | — |

Removing Generate today loses Compose and Rewrite on a persona, the lexicon preview, and the
History. Its page also documents the AI task strip and panel (`generate.md`).

## 3. Blast radius (greps run 2026-10-05)

| Change | Callers / producers (pasted grep) | Already on the path |
|---|---|---|
| Render sends `PATCH /v1/blocks/{id}` with a speaker | other senders: `StudioScriptChapter.vue:235` (Script's speaker), `StudioRender.vue:157` (Assign → Narrator), `StudioRenderChapter.vue:115` (⚙ override), `projects.js:63` | the server (`projects_api.py:480`): a change from one speaker to another writes a correction for Analyze to learn from (`record_correction`) unless `no_fix`; `source` "corrected" clears `prev_speaker_id` |
| `speakerOptions` gains a caller (as `castChoices`) | `StudioScriptChapter.vue:546,721` · `scriptReview.test.js:107,109` | Render had its own `speakerOptions` (the filter) — imported under another name |
| Render's `changed` | `StudioView.vue:706,714` → `onRenderChanged` (render state + `scriptVersion`) | Script re-reads on `scriptVersion` |
| the persona page reads `voiceGenderWord` | `StudioCast.vue` · `personaFacts.js` · `VoicesView.vue` · `voiceGender.test.js` | the gender Smart-assign sends (RESEARCH §7) |
| Cast's ＋ Add tooltip | copy only | — |
| Cast creates personas (`POST /v1/personas`) | other senders: `PersonaEditorView.vue:742,784` (Save, Save as new) · `PersonasView.vue:348` | persona names are unique across the library — a name the server refuses stops the batch with a toast naming how many were made |
| Smart-assign's call sent library VOICES | `StudioCast.vue:439` (Smart-assign, personas) · `:542` (the batch) | the seeded prompt reads "Available voices" (`seed_feature_prompts.py:165`) |
| `updateSpeaker(… persona_id)` from the batch | `StudioCast.vue:220,459,579,588` · `PersonaEditorView.vue:750` | Studio re-reads speakers on `changed`; the batch reloads the personas store |
| compose / rewrite get a second caller | `GenerateView.vue:404,436` · `PersonaEditorView.vue:576,597` | the endpoints read the saved note (`personas_api.py:500,542`) |
| `lexiconMatches` gets a second caller | `GenerateView.vue:331` · `PersonaEditorView.vue:536` | — |
