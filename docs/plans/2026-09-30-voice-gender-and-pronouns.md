<!-- SPDX-License-Identifier: MIT -->
# Voice gender in every voice dropdown, and speaker pronouns

**Decided 2026-09-30 as a to-do** — the user: "add that as todo possbile wehn we do the redesign of
persona per mock, for now lets move to the next slice". Nothing is built; it waits for the
Personas redesign (the mock's Personas screen) and needs its own go then. The tracker item is
`docs/dev/TASKS.md` "Voice gender in every voice dropdown, and speaker pronouns".

## 1. The questions and the answers as presented (verbatim)

The user: "in cast do you think we should add a sex dropdown to indicate if cast is male female,
would that be useful?", then "same for personal". The answer:

> I'm taking "personal" as "personas". Short answer: yes for the book's speakers, but as **pronouns** rather than a male/female choice. No for personas, because a persona already gets a gender from its voice.
>
> **Speakers (Cast, left side): add Pronouns.**
> - **It would help attribution the most.** Books say *"she said"* far more often than a name. The attribution prompt already has a slot for each speaker's pronouns and gender (`prompts.format_characters`), but it's always empty, since speakers have no such field (`_resolve_cast` sends `None`). Filling it tells the model who a "she" can be.
> - **Pronouns rather than sex**, because that is what the text actually uses: he, she, they, or blank. A creature or a ship can be "it", and a male/female dropdown can't express "they" or "it" without forcing a wrong choice.
> - **It can mostly fill itself in:**
>   - JustWrite's character sheet already has gender and pronouns. Today import only folds gender into a free-text voice hint (`justwrite.py:118-126`); I haven't checked where that hint ends up. Nothing keeps them on the speaker.
>   - Discover could also read pronouns from the text when it proposes a name.
>   - You would only correct them on Cast.
> - **Casting could use it as a hint:** suggest personas whose voice matches, never enforce it. Smart-assign already reads voice gender, though I haven't checked exactly how.
>
> **Personas: no separate field.**
> - A persona's gender is its voice's. The Cast card already shows it that way (`StudioCast.vue:383`: the persona card takes gender from its voice).
> - A second field on the persona could contradict the voice it plays with.
> - Where a voice has no gender (a cloned one, say), set it on the voice; the app already keeps per-voice gender overrides in its preferences. Every persona using that voice then gets it.
>
> **Two things I'd check before a plan:**
> - where JustWrite's gender and pronouns go today, and what Discover would need to return them;
> - how Smart-assign uses voice gender, so a speaker's pronouns plug into it rather than adding a second rule.
>
> If you want this, I'd look into those two, then bring a plan with the labels and a table of everything it touches for your go.

The user: "ok but for the voice dropdwon there is no easy indication on if the voice is male female
for easy view". The answer:

> You're right. The app already knows each voice's gender, but only the Voices page shows it.
>
> **What exists today:**
> - The Voices page works out a gender for every voice (`VoicesView.vue:60`):
>   - Kokoro voices from their id (`af_` = American female, `bm_` = British male);
>   - OpenAI voices from a built-in list;
>   - cloned voices from a first name in their name;
>   - plus your own override (click the F/M letter on that page) and an "ask the AI" button for the ones it can't tell.
> - The Voices page's own blend picker can even filter by it.
> - **Every other voice dropdown shows only the name:**
>   - Personas' voice dropdown shows "Bella (kokoro)" (`PersonasView.vue:616`);
>   - Generate shows just "Bella";
>   - Render presets too.
> - **Cast's persona card reads only the voice's stored gender field** (`StudioCast.vue:383`), not the worked-out one. So a voice can show a gender on the Voices page and none on Cast. I haven't checked which stock voices actually store one.
>
> **What I'd do:**
> 1. **Move the gender logic into one shared service** (with the overrides it reads), so every page uses the same answer. The app's rule is that two places never carry their own copies.
> 2. **Show it in every voice dropdown's label**, as a word, since a dropdown has no heading to explain a letter: "Bella · Female · Kokoro". Unknown shows "?".
> 3. **Cast's persona card uses the same answer.**
> 4. **Add a gender filter on the Personas voice dropdown only** (All / Female / Male / Neutral), like the blend picker's, because Kokoro alone has dozens of voices. The other dropdowns don't need one.
>
> This also sets up the speaker-pronouns idea: casting could later suggest voices whose gender matches the speaker.
>
> Say go and I'll bring the exact labels and the table of every dropdown and caller it touches before changing anything, or go straight to the build if you're happy with the above.

## 2. When it's picked up

Do the two checks named above first (where JustWrite's gender/pronouns land; how Smart-assign
uses voice gender), then a plan with the exact labels and the blast-radius table, for a go.

## 3. Picked up with the persona redesign (2026-10-03/04)

The voice-gender half is BUILT: one service (`src/services/voiceGender.js`, persona build P4), every
voice dropdown reads "Sohee · Female · Korean · Qwen3-TTS CustomVoice" (P6,
`personaFacts.voiceLabel`), the persona page filters by gender (P4), and Smart-assign now sends
each persona's gender from the same service and the language it really speaks (2026-10-04; it
sent the voice's stored `gender` field and the persona's saved language before).

**The two checks (code-read 2026-10-04):**

1. **Where JustWrite's gender and pronouns go today.** The JustWrite adapter
   (`imports/adapters/justwrite.py:118-126`, `_voice_hint`) folds `gender`, `age` and `role` into
   one free-text voice hint; `projects_api._materialize_standard` (`:688-698`, and the re-import
   merge at `:1207-1209`) appends it to the speaker's *Who they are* as a `Voice hint:` block.
   **`pronouns` is read nowhere** — the field in `book.json` is dropped on import.
   **Discover** returns `name`, `role_hint`, `approx_lines` and `evidence`
   (`extraction_api.py:1218-1226`, `extraction/identify.py:76-80`); to return pronouns its prompt
   (the live `speaker_discovery` row), the parser and the ＋ Add promotion would all change.
2. **How Smart-assign uses gender.** `smart_assign_api.py` already has a `pronouns` (and `gender`)
   slot per character (`:30-38`, written into the prompt at `:76-77`), and a `gender` per persona
   (`:41-49`). Cast sends characters as `{id, name, description, aliases}` only
   (`StudioCast.vue` `smartAssign`), so the slot is always empty. Attribution is the same:
   `extraction_api._resolve_cast` (`:155-173`) sends `"pronouns": None` and
   `prompts.format_characters` (`:107-108`) has the slot. **So pronouns plug into the two
   existing slots — no second rule.**

**What the build would be (for the user's go — and it needs a data reset):**

- A `pronouns` column on `speakers`: **he/him · she/her · they/them · it/its**, or not set.
- Cast's selected-speaker card gets **Pronouns** (a select) beside Also called, with the hint
  *"Read by Script's Analyze — who "she said" can be — and by Smart-assign. Never heard."*
- JustWrite import sets it from the character sheet's `pronouns` (gender stays in the hint).
- Attribution (`_resolve_cast`) and Smart-assign (Cast's request) send it into their slots.
- Not in it: Discover proposing pronouns (a live-prompt change — an idea for later).

Blast radius (greps 2026-10-04):

| Changes | Every caller / producer / reader |
|---|---|
| `database/models.py` `Speaker` (new column) | the one constructor `_speaker_helpers.ensure_speaker` (`:90-134`), called by `extraction_api.py:1512` (Discover ＋ Add), `projects_api.py:698` (import), `:1209` (re-import merge), `speakers_api.py:103` (＋ Add on Cast), `:236` (narrator) |
| `models.py` `Speaker` / `CreateSpeakerRequest` / `UpdateSpeakerRequest` (`:781-819`) | `speakers_api.py` (list, add, PATCH), `StudioCast.vue` (`projectsService.updateSpeaker`) |
| `imports/standard_schema.py` `StandardCharacter` (`:31-45`) | the adapters (`justwrite.py` the only one with pronouns), `projects_api._materialize_standard` |
| `extraction_api._resolve_cast` (`:155-173`) | attribution and Discover's known list (`prompts.format_characters :107`) |
| Cast `smartAssign` request | `smart_assign_api._format_characters :76` |

**The reset:** a new column on an existing table needs the database rebuilt (no migrations,
`no-migrations-user-resets`). It would also clear the rows the persona build left stale (the old
`render_presets` table and its prompt row, deliveries saved in the pre-P3 shape).
