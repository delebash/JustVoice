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

*Narrow the list* (How it can be directed · Model · Gender · Voice's language, a count, Clear) →
**Voice** (every voice, made ones too; the label names the model, how it can be directed and, if
made, how) → *Or make a new one:* Clone · Design · Blend (open the maker on the right; the same
button closes it; the direction filter goes with it). *Made by* is gone as a filter. The page's
mock is the same.

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
