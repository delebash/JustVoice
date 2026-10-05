<!-- SPDX-License-Identifier: MIT -->
# Filters narrow each other — one rule, every screen (2026-10-05)

**The decision is TASKS "The persona page's Voice card: pick a voice first, filters that narrow
each other" (verbatim — "your rec on 1 and 2 … just do it go", then "your rec on all go").**
This doc is the build, the audit behind it, and the blast radius.

## 1. The rule

A list narrowed by several filters lists, for each filter, only what the OTHER filters leave,
with counts that match what the list will show. An option nothing fits drops out; the one you
chose stays with **(0)**, so you can see it and change it — which is also how a remembered
choice whose items are gone comes back. Chips (a fixed row) keep every chip and show its true
count. One helper, `src/services/facets.js` (`passesFilters`, `narrowed`, `facetOptions`,
`facetChoices`, `facetCounts`, `facetTotal`), tested in `facets.test.js`.

## 2. The audit (2026-10-05) — every filter set, and what broke

Read by an agent, the key lines re-read by hand. The root cause everywhere: a filter's options
and counts were built from the whole set, never from what the other filters leave.

| Screen | Filters | What broke |
|---|---|---|
| A persona's Voice card (`PersonaEditorView.vue`) | direction · Made by · model · gender · language | Model and language came from Made by alone (`voicesOfKind`) — Written direction + Built-in offered Kokoro (54) → empty list |
| Voices (`VoicesView.vue:166-173, 221-245, 301-306`) | engine · type · language · gender · direction · search | each counted every voice: kokoro (54) + Written direction → empty; French + Male → empty; a remembered engine with no voices → empty grid |
| Cast's persona list (`StudioCast.vue:165-180`) | model · direction · language · search | Kokoro + Written direction → "No personas match"; a remembered model → empty |
| Personas list + its mock (`PersonasView.vue:93-128`, `MockPersonasView.vue:65-100`) | model · direction · language · used · search | Kokoro + Tags → empty table; a book none of a model's personas plays in → empty |
| Blend maker + its mock (`PersonaBlendMaker.vue:57-82`, `MockBlendMaker.vue:39-58`) | language · gender | French + Male → every picker empty |
| Script's chapter page (`StudioScriptChapter.vue:133-135, 547-551`; `scriptReview.js:56-63`) | chips · speaker | No speaker + any speaker → always empty; a speaker's number was the chapter total; All N left out the scene breaks it lists |
| Render's chapter page + its mock (`StudioRenderChapter.vue:150-178`, `MockRenderChapterView.vue:43-70`) | chips · speaker | chips were chapter totals: Stale 12 + a speaker showed 2; Can't render + a speaker → empty |
| The persona page's mock (`MockPersonaEditorView.vue`) | as the page | the old code |

Consistent (one filter, or counts from the same list): Discover, Script's grid, Speech engines,
Effects, Lexicons, Captures, Projects, Lines (whose chip counts ignore the search box — search
only), the clone and design makers.

## 3. The persona page's Voice card

Built first as "Narrow the list → Voice → Or make a new one", with Made by gone as a filter; the
user found it weird, compared both side by side (`#/mock/voice-card`, deleted 2026-10-05 once A was built), and chose **A** — the
original layout (How it can be directed · Made by · Model / Gender / Voice's language · Voice ·
Version) with the synced filters and a line of words under each part (TASKS "The persona page's
Voice card goes back to its original layout…"). The type words are one set since the same day:
Built-in · Cloned · Designed · Blended.

## 4. Blast radius (greps run 2026-10-05)

| Change | Callers / readers | Already on the path |
|---|---|---|
| `services/facets.js` (new) | `PersonaEditorView.vue`, `MockPersonaEditorView.vue`, `VoicesView.vue`, `StudioCast.vue`, `PersonasView.vue`, `MockPersonasView.vue`, `PersonaBlendMaker.vue`, `MockBlendMaker.vue`, `scriptReview.js`, `StudioRenderChapter.vue`, `MockRenderChapterView.vue` | — |
| `filterCounts` counts markers in All | `StudioScriptChapter.vue:133` (the no-speaker banner, Next to check read `none`/`check`, unchanged) · `scriptReview.test.js` (the pinned test, rewritten to the new rule) | `visibleLines` already listed markers under All |
| `lineFacets` (new) | `StudioScriptChapter.vue` (chips, speaker options) | `nameOf` names a removed speaker "someone removed" |
| The persona page's `kind` / `kindOptions` / `voicesOfKind` / `kindEmptyHint` / `onKindBlocked` removed | only `PersonaEditorView.vue` (and its mock) | the makers keep `:direction` (Tags + Clone offers the tag models) |
| Voices' `directionFilterOptions` replaces the static `DIRECTION_OPTIONS` in the select | `VoicesView.vue` template | the prefs-remembered engine filter (`voicesEngineFilter`) |
| Cast's `directionOptions`, Personas' `directionOptions` / `usageOptions` | their templates | Cast's remembered `studioPersonaModelFilter` |
| Render's `inFilter` over `passesFilters` | `rows` | the server's `counts` still feed the blocked banner |

## 5. The persona page's Voice box resets (2026-10-05, later)

The decision is TASKS "The persona page's Voice box resets when a filter drops its voice; 'Any
language'" (verbatim, "your rec go"). The pin is gone — §3's build kept a picked voice in the box
when the filters hid it, so with a Kokoro voice picked, Model → KittenTTS looked like it did
nothing. Now a filter change that leaves the voice out empties the box (a `watch` on the five
filters); opening a persona and Revert set the filters so its voice is in the list
(`fitFiltersToVoice`: Type to its type, the rest to Any — the page is KeepAlive-cached, so the
last persona's filters used to carry over); the voice-change warning compares with the SAVED
voice, since the box's previous voice is now often none. Every language filter's "All languages"
is "Any language". Rejected: keeping every option greyed at (0) — the user: "that may be a big
uncesessary list"; §1's rule stands (options nothing fits stay hidden).

| Change | Callers / readers (greps run 2026-10-05) | Already on the path |
|---|---|---|
| `listedVoices` removed | `PersonaEditorView.vue:382,386` · `MockPersonaEditorView.vue:202,206` — its only uses | `docs/personas.md:229-230` (rewritten) |
| `voiceEmptyHint` loses "No other voice matches these filters." | `PersonaEditorView.vue:392,998,1011` · `MockPersonaEditorView.vue:212,634,645` | — |
| The filters fit the voice on open and Revert | `kind.value =` before: `PersonaEditorView.vue:208` (open), `:333` (the direction watch, unchanged), `:887` (Revert); the mock `:183`, `:507`, `:562` | `watch(kind)` already cleared Model; `onKept` already cleared the three dropdown filters before picking the kept voice |
| The voice-change warning compares with the saved voice | `voiceChange`: `PersonaEditorView.vue:405,421,854,886,1053-1056` (before the change) | Save (`:854`) and Revert (`:886`) clear it |
| "All languages" → "Any language" | `PersonaEditorView.vue:348` · `MockPersonaEditorView.vue:198` · `PersonasView.vue:112` · `MockPersonasView.vue:84` · `StudioCast.vue:178` · `MockVoiceCardOptions.vue:65` (deleted since) · `VoicesView.vue:233` · `PersonaBlendMaker.vue:65` · `MockBlendMaker.vue:48` | no doc or test named it (`grep -rn "All languages" docs/*.md docs/dev/*.md scripts`) |

## 6. Leaving Tags puts Type back; the voice-card mock goes (2026-10-05, later)

The decision is TASKS "Leaving Tags puts Type back; voices with no gender stay; the voice-card mock
goes" (verbatim, "your rec on both go, delete the mock"). Found by §5's live check: Tags moved
Type to Cloned (no built-in voice takes tags), and going back to Any left it there, with an empty
list. Now the direction watch remembers the Type it moved away from (`kindMove`) and moves back
when the direction lets it — unless a Type was picked in between. The 15 built-in voices with no
gender recorded stay under Any gender only (set one on Voices by clicking its letter).

| Change | Callers / writers (greps run 2026-10-05) | Already on the path |
|---|---|---|
| `watch(directionFilter)` moves Type back | every writer of `kind`: `PersonaEditorView.vue:339,344` (this watch) · `:431` (`fitFiltersToVoice`, which now clears `kindMove.from` — from open `:208` and Revert `:918`) · the Type control's `v-model="kind"` (a pick of your own); the mock `:190,195`, `:273`, `:540`, `:595` | `watch(kind)` clears Model and gives the maker a fresh key on every move; the Voice box reset (§5) empties the box when the move leaves the voice out — going back does not bring it back |
| `#/mock/voice-card` deleted | `src/mock/routes.js` (its route) · `MockVoiceCardOptions.vue` — its imports all shared (`MODEL_VERSIONS` with `MockPersonaEditorView.vue:42`; facets and personaFacts everywhere) | TASKS keeps the decision text that names it (verbatim) |
