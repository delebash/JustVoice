<!-- SPDX-License-Identifier: MIT -->
# A project's pronunciation lexicon reaches the audio

**Decided 2026-09-30** — the user asked "what do you think on 5 think on it a few times" (the
Lexicon-on-Overview question, open since 2026-09-28: `docs/dev/TASKS.md`, "Build the mock's
Studio in the app"); the answer below was presented; then "ok mark that as to be wired". That
decides a–e. **Built the same day** on "1 go ahead with the lexicon" — §3 is the build plan with
its blast radius, §4 what was built and checked, §5 what it found and did not build. The tracker
item is `docs/dev/TASKS.md` "A project's pronunciation lexicon reaches the audio".

## 1. The answer as presented (verbatim)

My view: wire it, and put the row on Overview as the mock shows. I checked the code from several angles, and one check corrected a claim I was about to make.

**What's there today** (all checked in code)
- A project has a lexicon slot (`projects.default_lexicon_id`), and a lexicon can belong to one project.
- **Import creates one.** An import makes "<book> (imported)", lists every character's name as an empty row to fill in, and sets it as the project's lexicon (`projects_api.py:746-813`). JustWrite books carry no pronunciations, so it starts as just that list of names.
- **The Lexicons page's "Scan a book"** treats names in the project's lexicons as already handled (`pronunciation_api.py:52-59`).
- **The .justvoice.zip export** includes it.
- **The mock** has an Overview row, "Pronunciation lexicon" (None or a lexicon, plus "Open ➜"). The mock's Lexicons page says a project lexicon "applies before TTS, on every line in scope".
- **The render never reads it.** Chapter audio, the M4B and the ACX check use only the personas' lexicons (`render_chapter_api.py:177`).
- **Your data has no lexicons at all.** The Ninth Facet has none, although an import normally creates one; I didn't find why.

**Why wire it rather than leave it off**
1. **It fails silently.** You'd write "Worcester → Wooster" in the book's lexicon, the scan would say the name is handled, and the audiobook would still say it wrong. The app refuses that kind of silent failure elsewhere; it won't drop a line without a speaker, for example.
2. **The mock includes it.**
3. **Leaving it off properly would mean removing it everywhere:** import, the scan, the export and the "project" scope. That is more work than wiring it, and it loses something real. A book's names belong to the book, not to a voice you reuse across books.

**How I'd do it**
- **a. The Overview row, as in the mock:** "Pronunciation lexicon", with None, this book's lexicons and your general ones, plus "Open ➜" to the Lexicons page.
- **b. Everywhere a line is rendered:** chapter audio, M4B, the ACX check and captions all go through one function. The two single-line paths also get it: a game's Lines render and the voiceline export. A line then sounds the same wherever it's rendered.
- **c. When two lexicons disagree, the book's wins.** Today they're kept as an unordered set, so the winner can change between restarts. The book's own name is the most specific fact, so it goes first, then the personas' lexicons.
- **d. The scan counts exactly what the render applies:** the book's chosen lexicon plus the cast's persona lexicons. "Handled" then really means the audio says it that way.
- **e. The render cache.** It's keyed on which lexicons are attached, so choosing one on Overview would re-render every line of the book once, even lines it doesn't touch. I'd key on what the lexicons actually change in each line. Choosing a lexicon then re-renders only the lines containing its words.
  - Your current cache is unaffected, since you have no lexicons.
  - The correction: I first thought editing an IPA pronunciation doesn't reach the cache. It does. But every IPA entry is attached to every line, so on Kokoro any IPA edit re-renders the whole chapter. The same change to the cache key fixes that.

**Found along the way, not part of item 5, your call:**
- **A persona's lexicon affects every line in the chapter**, not just that persona's lines. That's harmless for names, but wrong for an entry meant for one voice: an accent spelling for one character also reaches the narrator. Fixing it means giving each line its own lexicons in the render.

**When:** before Slice 4, since Slice 4 rebuilds Render on top of the same function. It's a moderate change, with tests and docs.

Say go on a–e, or name the parts you want.

## 2. Added the same day — f, per-line lexicons

The user, mid-turn: "and also do you fix on lexicon the found along the way". Answered: the
finding joins this item — **each line gets its own speaker's persona lexicon plus the book's,
instead of every persona's lexicon on every line** — built with a–e, under the same go.

## 3. The build — go given 2026-09-30 ("1 go ahead with the lexicon")

### 3.1 The pieces

| # | Piece | Where |
|---|---|---|
| f | A line carries its own lexicons, in order: the book's, then its speaker's persona's. `ChapterLine.lexicons`; `_resolve_scene_to_lines` returns the lines only (the scene-wide list is gone). | `models.py`, `render_core.line_lexicons`, `api/render_chapter_api.py` |
| b | Every caller of the resolver passes each line's own list: chapter render, cache-stats, `render_scene_to_wav` (M4B, ACX check, captions), the whole-book warm. The single-line door (`_render_block_production`: Lines ↻, render jobs, the voiceline export) adds the book's lexicon. | `api/render_chapter_api.py`, `export_audiobook.py`, `export_voicelines.py`, `api/align_api.py`, `api/projects_api.py` |
| c | `_apply_lexicons`: the first entry that acts on a word wins, whether it is a respelling or an IPA pronunciation — so the book's, listed first, beats the persona's. | `render_core.py` |
| e | The cache key drops the attached lexicon ids. What the lexicons change is already in it: the respelt text, and the IPA map — now only the words this line contains. `CacheKeyBuilder.with_lexicons` deleted. | `render_core.py`, `cache.py` |
| d | The scan reads each line with the lexicons the render gives it (the rule in f), not every project-scoped lexicon. `scan_names` takes `(text, covered)` per line. | `pronunciation.py`, `api/pronunciation_api.py` |
| a | Overview row "Pronunciation lexicon": None, this book's lexicons, the reusable ones; "Open ➜" to the Lexicons page. `PATCH /v1/projects/{id}` clears the lexicon on a sent null and refuses an unknown id. | `components/StudioOverview.vue`, `api/projects_api.py` |
| — | Docs: `lexicons.md`, `studio.md`, `personas.md`, `chapter.md`, `import-and-export.md`, `whats-new.md`, `dev/code-map.md`. | `docs/` |

### 3.2 Blast radius (greps pasted 2026-09-30, before the first edit)

**`_resolve_scene_to_lines` — return changes from `(lines, lexicon_ids)` to `lines`**
```
server\justvoice\api\align_api.py:108:    lines, _lexicons = _resolve_scene_to_lines(scene_id, None, st, strict=False)
server\justvoice\api\projects_api.py:1002:            _resolve_scene_to_lines(scene_id, None, st, strict=True)
server\justvoice\api\render_chapter_api.py:415:            lines, scene_lexicons = _resolve_scene_to_lines(scene.id, None, st)
server\justvoice\api\render_chapter_api.py:454:        lines, scene_lexicons = _resolve_scene_to_lines(
server\justvoice\api\render_chapter_api.py:585:    lines, scene_lexicons = _resolve_scene_to_lines(scene_id, None, st, strict=strict)
server\justvoice\export_audiobook.py:145:            lines, lexicons = _resolve_scene_to_lines(
server\tests\test_pause_between_lines.py:32:    monkeypatch.setattr(render_chapter_api, "_resolve_scene_to_lines",
server\tests\test_render_truth.py:213 · :236 · :250      lines, _lex = …
server\tests\test_voice_instruct.py:82:    lines, _lexicons = …
server\tests\test_render_chapter_scene_mode.py  — 22 call sites (:101 … :571)
```

**`render_line` / `probe_line_cached` — who passes `lexicons`**
```
server\justvoice\api\render_chapter_api.py:428:                lexicons=scene_lexicons,      (cache-stats probe)
server\justvoice\api\render_chapter_api.py:457:        merged_lexicons = list({*req.lexicons, *scene_lexicons})   (an unordered set — the c defect)
server\justvoice\api\render_chapter_api.py:465:        merged_lexicons = req.lexicons        (direct mode — kept)
server\justvoice\api\render_chapter_api.py:502:            lexicons=merged_lexicons,
server\justvoice\api\render_chapter_api.py:595:            lexicons=scene_lexicons,          (render_scene_to_wav)
server\justvoice\export_audiobook.py:160:                    lexicons=lexicons,             (whole-book warm)
server\justvoice\export_voicelines.py:144:        lexicons=lexicons,                       (single line)
server\justvoice\synth_scheduler.py:250:        specs.append((engine_id, lambda kw=kw: render_line(state, **kw)))
```
`/v1/generate` reads no lexicons at all (`grep -i lexicon api/generate_api.py` → nothing), though
GenerateView sends them (`GenerateView.vue:487`). Out of this build — a finding (§5).

**The single-line door — `_render_block_production(state, persona, block)`, signature unchanged**
```
server\justvoice\export_voicelines.py:62:        render_block_fn = _render_block_production
server\justvoice\export_voicelines.py:187:                    (engine_id, lambda p=persona, b=block: _render_block_production(state, p, b))
server\justvoice\render_jobs.py:358:                [(engine_id, lambda p=persona, b=block: _render_block_production(state, p, b))]
server\justvoice\api\takes_api.py:312:        [(engine_id, lambda: _render_block_production(state, persona, block))],
server\tests\test_export_voicelines.py:55 · test_render_jobs.py:92 · :125 · :150 · :182 · :233   (3-argument fakes)
```

**The cache key — `with_lexicons` and `_apply_lexicons`**
```
server\justvoice\cache.py:67:    def with_lexicons(self, lexicon_ids: list[str]) -> "CacheKeyBuilder":
server\justvoice\render_core.py:486:        .with_lexicons(lexicons)      (probe_line_cached)
server\justvoice\render_core.py:574:        .with_lexicons(lexicons)      (render_line)
server\justvoice\render_core.py:466 · :553      _apply_lexicons(…)  (the two key derivations, kept in lockstep)
server\tests\test_lora_alexandria_parity.py:326 · :334   _apply_lexicons(…)
server\tests\test_emotion_wiring.py:217:    for transform in ("performable_text", "_apply_lexicons", "_apply_emotion_tag"):
```
The only writer of the cache is `render_core.py:707` (`cache.put`). A line rendered with no
lexicon attached keeps its key (`with_lexicons([])` hashed nothing). A line rendered with one
attached gets a new key once. The live data has no lexicons (`select count(*) from lexicons` → 0,
2026-09-30), so nothing re-renders there.

**The scan — `scan_names`**
```
server\justvoice\api\pronunciation_api.py:69:    words = scan_names(texts, covered)
server\tests\test_c_features.py:122 · :134 · :146 · :154
src\views\LexiconsView.vue:260:      `/v1/projects/${draft.value.project_id}/pronunciation-report`,
```
`covered_count` in the response is read by nothing in `src/`.

**`default_lexicon_id` — readers and writers**
```
server\justvoice\api\projects_api.py:248:        default_lexicon_id=body.default_lexicon_id,      (create)
server\justvoice\api\projects_api.py:280:    if body.default_lexicon_id is not None:               (PATCH — cannot clear)
server\justvoice\api\projects_api.py:812:    project.default_lexicon_id = lex_id                   (import)
server\justvoice\api\pronunciation_api.py:58:    if project.default_lexicon_id:
server\justvoice\api\project_export_api.py:64 · :81                                                (.justvoice.zip)
src\views\ChapterView.vue:359:      if (project?.default_lexicon_id) {                            (old Chapters regen, direct mode)
src\components\StudioOverview.vue:109:    await projectsService.update(props.project.id, body);   (the only PATCH sender)
```
Deleting a lexicon clears it from the project and from personas in the database itself
(`ondelete=SET NULL`, `PRAGMA foreign_keys=ON` at `database/session.py:73`).

### 3.3 Choices the decision text did not name

- **d is per line.** d says "the book's chosen lexicon plus the cast's persona lexicons"; with f a
  persona's lexicon reaches only that persona's lines. So a name counts as handled on a line only
  when that line's own lexicons have it — "counts exactly what the render applies".
- **A row counts as handled even when it is blank**, as today (the scan's job is "which names have
  no row yet"; `docs/lexicons.md`). Only *which lexicons* count changed.
- **What "the same word" means for c.** An entry claims only what it can match: an IPA entry the
  word in any case (that is how the engine matches it), a respelling its exact spelling (that is
  how the text is replaced). So the book's IPA for "Worcester" silences a persona's respelling of
  it, while the book's respelling of lowercase "worcester" — which does nothing to "Worcester" —
  does not silence the persona's entry that does. A blank row claims nothing, and neither does an
  IPA-only entry on an engine that can't take IPA (every engine but Kokoro) — the persona's
  respelling is then what gets said. A longer entry beats a word inside it, as within one lexicon
  and as the engine's own matcher does: a persona's respelling of "Mara Vance" wins the whole name
  over the book's IPA for "Vance". Words are compared lowercased (`lower()`, as both matchers do —
  not `casefold()`, which merged "Maße" into "Masse").
- **A request's own `lexicons`** (direct mode, the old Chapters regen) still apply to every line
  of that request, after the line's own.
- **The Overview row has no hint**, as in the mock. If the project points at a lexicon outside the
  two groups (a zip import can), it is listed too, so the select never shows a blank for a live one.

## 4. Built 2026-09-30 — what, where, and what the checks showed

**Server**
- `render_core.line_lexicons(book, persona)` — the one rule (book's, then the persona's). Called by
  the chapter resolver, the single-line door and the scan.
- `render_core._apply_lexicons` — first entry that acts on a word wins (§3.3); `ipa_map` cut to the
  words the line contains (`_ipa_words`, the engine's own whole-word rule).
- The cache key no longer holds lexicon ids (`render_line`, `probe_line_cached`);
  `CacheKeyBuilder.with_lexicons` deleted.
- `ChapterLine.lexicons`; `_resolve_scene_to_lines` returns the lines only, each with its own
  list; `_lexicons_for(line, request_lexicons)` is what every chapter door passes to `render_line`.
- `export_voicelines._render_block_production` reads the book's lexicon (`_book_lexicon_id`, its
  own short session) before the persona's.
- `pronunciation.scan_names(lines)` takes `(text, covered)` per line; `pronunciation_api` builds
  each line's covered set from its own lexicons.
- `PATCH /v1/projects/{id}`: a sent null clears `default_lexicon_id`; an unknown id is a 404.

**Renderer** — `StudioOverview.vue`: the row, after Mastering target, on every project kind.
`views/studioLexicon.js` (`lexiconChoices`) holds what it offers, pinned by its own test.

**Docs** — `lexicons.md` (scopes, "Which lexicons a line is read with", what re-renders, the scan),
`studio.md`, `personas.md`, `chapter.md`, `import-and-export.md`, `whats-new.md`, `dev/code-map.md`.

**A defect the build fixed on the way:** "🔎 Scan the book for names" failed on every book — the
endpoint raised `TypeError: cannot unpack non-iterable Block object` (`for (b,) in …with_entities(Block)`),
and no test called it. The new endpoint test reproduced it before the rewrite.

**Checks**
- Tests written first and watched fail: 12 of `server/tests/test_project_lexicon.py` failed on the
  old code, 3 were pins that already held. One more (`test_a_respelling_claims_only_its_own_spelling`)
  was added after its fix — not watched fail.
- Before the review: server suite 936 passed (7:46). After the review's fixes: server suite
  **938 passed** (7:53); `ruff check .` clean. Renderer unit **120 passed** (13 files); biome clean;
  `npm run build:vite` built; smoke gate **17/17, zero JS errors**, against
  `--data-dir src-tauri/target/debug/data` — run again on the final code.
- Live pass — headless Chrome against that same server and the real book (The Ninth Facet, 289
  lines, all cached), with one temp book-scoped lexicon ("Nettle" → a respelling), deleted after:
  - Overview shows the row after Mastering target. The select is 280 px at x=134, the same as
    Mastering target's; "Open ➜" sits 10 px to its right, centred on the same line; the row ends
    inside the card.
  - Choosing the lexicon in the row saves it; **289 → 274 cached: exactly the 15 lines that contain
    the word** (6 · 5 · 3 · 1 by chapter). Overview's Render row read "274 of 289 lines rendered".
    (Later runs read 289 → 275: the Keystone line rendered below was already cached with it.)
  - The Keystone rendered with it chosen (200, ACX master): its one changed line rendered, 50/50.
  - The scan answered (289 lines, top names Cael ×44, Iven ×19 …), without the lexicon's word.
  - "None" cleared it: 289/289 again. "Open ➜" landed on `#/lexicons`. No JS errors.
  - After cleanup: 0 lexicons, the project's lexicon null, 289/289 — the book as it was. (The one
    Keystone line rendered with the temp lexicon stays in the cache, unused.)
  - Both server runs shut down through `/v1/shutdown`; no engine process left, GPU back to ~700 MiB.
- **Not checked in the real app:** f and c (the real data has no persona lexicon, and touching a
  real persona to make one was not worth the risk); the single-line door (the real book has no
  Lines view); an IPA entry on Kokoro by ear. All four are covered by tests only.

**An independent review of the diff** (a fresh agent, read-only) found six things. What came of
each:
1. *Overview showed "None" for a book just imported with a lexicon.* The lexicon list is loaded
   once (Home loads it) and an import makes the book's lexicon on the server; the row could not
   find it, showed None, and "None" then sent nothing. **Fixed:** the row re-reads the list on
   every showing and whenever the project names a lexicon the list lacks; a lexicon it still can't
   find reads "(lexicon not found)", never None; the save compares with the project's own value.
   Test first (`studioLexicon.test.js`, watched fail). Live: with the page's list holding one
   lexicon, the project set to a second the way an import does it (the projects store reloaded, the
   lexicon list not) — the row showed the second by name, and None cleared it.
2. *Docs said the book's IPA always beats a persona's respelling.* Not on an engine that can't take
   IPA — there the book's IPA-only entry does nothing and the persona's respelling is said. The code
   is as intended (§3.3); **the docs were wrong and now say so** (`lexicons.md`, `studio.md`,
   `personas.md`, `whats-new.md`). Pinned: `test_an_entry_the_engine_cannot_use_decides_nothing`.
3. *A persona's respelling of "Mara Vance" beats the book's IPA for "Vance".* **Kept**: a longer
   entry beats a word inside it, as within one lexicon and as the engine's matcher does. Written into
   §3.3 and `lexicons.md`.
4. *Words were compared with `casefold()`, the matchers with `lower()`* — "Maße" and "Masse" merged.
   **Fixed** (`lower()`); test watched fail.
5. *`_ipa_words` and the engine's `splice` differed on an entry ending in punctuation* ("Dr.", "A."):
   the engine speaks one standing alone between two matches, the host dropped it. **Fixed**:
   `_ipa_words` now does what `splice` does step for step; the pin test gained those cases (watched
   fail). A 50,000-case fuzz of the two afterwards: 0 mismatches.
6. *`lexicons.md` said an unchosen book lexicon "covers nothing" in the scan*, but the scan never
   lists the open lexicon's own names. **Fixed** the wording.

## 5. Found along the way — not built, each needs the user's word

1. **`/v1/generate` reads no lexicon.** GenerateView sends the persona's lexicon
   (`GenerateView.vue:487`) and shows a lexicon preview; `api/generate_api.py` has no reader
   (`grep -i lexicon` → nothing). A line on Generate is not said the way the same persona says it
   in a chapter.
2. **Personas calls the field "Lexicon override"**, with "(none — use project default)"
   (`PersonasView.vue:627-629`). Under c it does not override: the book's wins, and the persona's
   adds its own words on its own lines. Docs now say so; the label is unchanged.
3. **A book-scoped lexicon made by hand is not chosen for its book.** Only an import sets
   `default_lexicon_id`. The Lexicons page shows nowhere whether a lexicon is in use, so a
   hand-made one does nothing until it is picked on Overview. Docs say so.
4. **A blank row still counts as handled in the scan** (kept as it was — §3.3).
5. **"Fix pronunciation" opens the first lexicon in the library**, not the book's chosen one
   (`LexiconsView.vue:431`). It lives on the old Chapters page and moves to Render's line panel in
   Slice 4.
6. **`docs/lexicons.md` "Pronunciation engines + lexicons" says Qwen3 takes inline IPA.** Only
   Kokoro declares `supports_phoneme_input` (`engines/capability_details.py:90`). Left as it was.
7. **`docs/dev/design-law.md` item 6 says the ghost button renders thin-bordered.** The kit's ghost
   has no border (`ui/src/common/styles.css:45-46`); `src/` uses it 126 times, and the mock's
   "Open ➜" is one.
8. **A book has one lexicon.** A book that wants both its own names and a reusable list has to keep
   them in one; the mock's row is a single select.

## 6. The findings, decided — 2026-09-30, "your rec on all go"

The user asked "what are your recs on found along the way"; the recs below were presented; then
"your rec on all go". Verbatim:

> **1. `/v1/generate` ignores lexicons**
> - Rec: wire it.
> - Generate has its own path to the engine, separate from the chapter render (`generate_api.py:138`, `:169`, `:182`). Put the same `_apply_lexicons` in it: the respelt text, plus the IPA the line needs.
> - Use what the page already sends: the selected persona's lexicon.
> - Don't add the book's lexicon there. Generate is scratch work, not a line of a book.
> - Small, with tests.
>
> **2. Personas' "Lexicon override" label**
> - Rec: rename the field "Lexicon" and the empty option "None".
> - Add a hint: *"Read on this persona's lines, after the book's lexicon. The book's wins on the same word."*
> - The mock's persona editor has no lexicon field, so nothing there to follow.
> - Or leave it for the persona redesign, since that page gets rebuilt anyway.
> - Lean: fix it now. It's a two-string change, and today it describes the opposite of what happens.
>
> **3. A hand-made book lexicon does nothing until chosen, and nothing shows what's in use**
> - Rec: a "Used by" column on the Lexicons page, like Personas has — the book it's chosen for, or the personas that use it, or *not in use*.
> - Plus: creating a book-scoped lexicon for a book that has none chosen chooses it, the way an import already does.
> - Lean: both. The first stops the silent failure. The second removes the usual cause of it.
>
> **4. "Fix pronunciation" opens the first lexicon in the library**
> - Rec: don't touch it now. It lives on the old Chapters page, which Slice 4 deletes.
> - Build it right in Slice 4's line panel ("📕 Pronunciation"): open the book's chosen lexicon, and create one for the book if there is none.
> - That should go into the Slice 4 plan as a line item.
>
> **5. Two doc lines the code contradicts**
> - Qwen3 "supports inline IPA" (`docs/lexicons.md`, last section). Rec: correct it. Only Kokoro takes IPA (`capability_details.py:90`). Docs-only.
> - The design law says ghost buttons have a border. They don't (kit `styles.css:45`), and the app uses them 126 times.
>   - Your 2026-06-12 decree says "no ghost buttons". The mock, which came later, uses them (`.btn.g` is borderless).
>   - Option A: the mock stands. Fix the law's text to say ghost is borderless.
>   - Option B: the decree stands. One kit CSS line gives ghost a thin border, and all 126 follow.
>   - Lean: A, since the mock is newer and you approved it. But it's your decree, so your call.
>
> **6. A book has one lexicon**
> - Rec: keep one. The mock's row is a single select.
> - Several would need an order between them. That's the same set-ordering problem c just fixed.
> - Revisit only if you really do use reusable lists alongside book names.
>
> **7. New — the mock contradicts decision c**
> - The mock's Lexicons page (`_s10.html:28`) says *"A persona-scoped lexicon beats the project's — Old Crow says 'boss' his own way."*
> - You decided the opposite on 2026-09-30: the book's wins. The Old Crow case still works, because his slang words aren't in the book's lexicon.
> - The same page also says editing an entry marks lines **stale**, "not re-rendered — you choose when to pay for it". The app re-renders the changed lines at the next render. That's a Slice 4 question too: stale vs cached.
> - Rec: correct the mock's hint to c's rule, and carry the stale-vs-re-render question into Slice 4's D4.

So: 1 wire, 2 rename now, 3 both halves, 4 a Slice 4 line item, 5 the Qwen3 line corrected and
**option A** (the design law's text follows the mock; ghost is borderless), 6 keep one, 7 the
mock's hint corrected and the stale question carried into D4.

### 6.1 Blast radius (greps pasted 2026-09-30, before the first edit)

**1 — `/v1/generate`: who builds a `GenerateRequest`, and who sends `lexicons`**
```
src\views\GenerateView.vue:487:      if (attachedLexicon.value?.id) body.lexicons = [attachedLexicon.value.id];
src\views\GenerateView.vue:491:        out = await api.request("/v1/generate", {
src\views\RenderLabView.vue:91:    const blob = await api.request("/v1/generate", {      (sends lexicons: [] — :158)
server\justvoice\api\voice_preview_api.py:840:            req = GenerateRequest(voice=voice_id, text=piece, language=audition_lang)
server\justvoice\api\voice_preview_api.py:951:    req = GenerateRequest(
server\justvoice\mcp\tools.py:201:    req = GenerateRequest(
server\tests\test_voice_row_preview.py:64 · test_voice_preview_text.py:54   (patch _generate_via_manager)
```
Only GenerateView sends any; every other caller leaves `lexicons` at `[]`, which `_apply_lexicons`
returns from untouched. The two synth paths: `generate_api._generate_via_manager` (:214) and
`_generate_via_inprocess` (:352). No render cache on this path.

**2 — the Personas field's words**
```
src\views\PersonasView.vue:627:            <span>Lexicon override</span>
src\views\PersonasView.vue:629:              :options="[{ value: '', label: '(none — use project default)' }, …
docs\personas.md:117 · docs\lexicons.md:24 · docs\dev\code-map.md:127   (name the field)
src\App.vue:55 (Personas lede "a lexicon override") · src\App.vue:56 (Lexicons lede "Per-persona
  override.") · docs\core-concepts.md:40, :43 · PersonasView.vue:22 (header comment)
```
The decision names the field and its empty option. The two ledes and `core-concepts.md` use the same
words about the concept — reported, not changed (not named).

**3 — `POST /v1/lexicons` gains "choose it for a book that has none"; Lexicons gains "Used by"**
```
server\justvoice\api\lexicons_api.py:19:@router.post("/v1/lexicons", response_model=Lexicon, status_code=201)
src\views\LexiconsView.vue:207:      await api.request("/v1/lexicons", {       (New lexicon AND a .justlex.json import — :351)
server\justvoice\api\projects_api.py:812:    project.default_lexicon_id = lex_id   (import — writes its own row, not through the API)
src\views\LexiconsView.vue:86-94   LEXICON_COLUMNS
```
The page already loads projects (with `default_lexicon_id`) and personas (with `lexicon_id`) —
`LexiconsView.vue:129-133`. Precedent for the column: Personas' "Used by" (`PersonasView.vue:52`,
`:537-540`, "— not used yet —"); for the book's icon, `ProjectsView.vue:67` `KIND_ICON`.

**5 · 7 — docs and the mock only.** `docs/lexicons.md` last section; `docs/dev/design-law.md` item 6;
`docs/plans/mock/_s10.html:28` → `build_mock.py` rebuilds `workbench-mock.html`. The published
mock artifact is not republished (not named).

### 6.2 Built 2026-09-30

1. `generate_api._read_through_lexicons` — the chapter render's own steps (drop the tags the
   engine can't perform, then `_apply_lexicons` with the request's `lexicons`); both synth paths
   use it and carry the IPA map in the delivery.
2. `PersonasView.vue`: "Lexicon", "None", the hint verbatim. Docs that named the field follow
   (`personas.md`, `lexicons.md`, `generate.md`, `dev/code-map.md`).
3. `lexicons_api._choose_for_book_with_none` after `POST /v1/lexicons`; Lexicons' "Used by" column
   (`views/lexiconUsage.js`, pinned by its test) — the books that chose it with their kind icon,
   the personas that carry it (🎭), or "— not in use —" (Personas' "— not used yet —" form).
4. Slice 4 line item: TASKS "Build the mock's Studio…" and `2026-09-30-mock-vs-app-and-slice-4.md`
   §3.4 "Also carry".
5. `lexicons.md`: Qwen3 takes respellings only. `design-law.md` item 6 rewritten to option A, the
   old text quoted in it.
6. Nothing to build.
7. `_s10.html` hint → "The project's lexicon wins on the same word. A persona-scoped lexicon adds
   its own words on that persona's lines — Old Crow says “boss” his own way."; `workbench-mock.html`
   rebuilt (the only change in it). D4 in the Slice 4 doc carries stale vs re-render.

**Checks.** Tests first, watched fail: the two Generate tests and the auto-choose test (all three
on behaviour, not setup), the Used-by unit test. Server suite **941 passed** (7:55); ruff clean; renderer
unit **122 passed** (14 files); biome clean; build; smoke gate 17/17, zero JS errors, on the real
data folder. Live on the real data (temp lexicons, all deleted; the book's lexicon back to none):
- a book-scoped lexicon made for The Ninth Facet became its lexicon; a reusable one did not;
- Lexicons' Used by read "📖 The Ninth Facet" and "— not in use —"; no sideways scroll;
- the Narrator persona's editor showed "Lexicon", "None" and the hint (opened, read, closed —
  nothing saved);
- Generate through the real Kokoro, "Nettle." with a lexicon respelling it "Zanzibar": 39,980 bytes
  without, 50,220 with, 39,980 again without — the respelling reached the audio. (Generate refuses
  a preset voice whose engine isn't loaded, as it always has; Kokoro was loaded first.)

**Not changed, and not named by the decision** — the same "override" wording elsewhere: the
Personas page lede (`App.vue:55`, "a lexicon override"), the Lexicons page lede (`App.vue:56`,
"Per-persona override."), `docs/core-concepts.md:40, :43`, the header comment
`PersonasView.vue:22`.

## 7. The closed TASKS item (closed at commit, 2026-10-01 — close = delete)

Moved here verbatim from `docs/dev/TASKS.md` when the build was committed and pushed ("commit and push").

```
### A project's pronunciation lexicon reaches the audio
STATE:  DECIDED 2026-09-30 — "ok mark that as to be wired", on the answer to "what do you think on
        5 think on it a few times". The answer, verbatim, with its evidence:
        `docs/plans/2026-09-30-project-lexicon.md` §1 — READ IT before building. a · Overview row
        "Pronunciation lexicon" (None, this book's lexicons, your general ones; "Open ➜") · b ·
        every render path applies it (the one resolver, plus the Lines render and the voiceline
        export) · c · the book's lexicon wins over the personas', in a fixed order · d · the
        pronunciation scan counts exactly what the render applies · e · the render cache keyed
        on what the lexicons change in each line, not on which lexicons are attached.
WHY:    everything around the project lexicon treats it as live — import makes one, the scan
        counts it, export carries it, the mock shows it — and the render never reads it
        (`render_chapter_api.py:177`): a fixed name is still said wrong, silently.
        f · per-line lexicons — ADDED the same day ("and also do you fix on lexicon the found
        along the way"): each line gets its own speaker's persona lexicon plus the book's, not
        every persona's lexicon on every line of the chapter.
NOT:    leaving it off (would mean removing it from import, scan, export and the scope).
BUILT:  2026-09-30, a–f, NOT COMMITTED — what, where, the blast radius and the checks: the plan
        doc §3-§4. Server suite 938 passed; unit 120; gate 17/17; live on the real book: choosing
        a lexicon on Overview took exactly the 15 lines holding its word out of the cache
        (289 → 274) and "None" put them back. An independent review found six things; four
        fixed, one doc wording fixed, one kept as designed (plan doc §4). Not checked in the
        real app (tests only): f and c (no persona lexicon in the real data), the single-line
        door, IPA on Kokoro by ear. Close (delete) at commit.
DECIDED 2026-09-30 — "your rec on all go", on the recs for what the build found (plan doc §5),
        verbatim in the plan doc §6: 1 `/v1/generate` applies the lexicons the page sends (the
        persona's; not the book's) · 2 Personas' field → "Lexicon", "None", + the hint · 3 a
        "Used by" column on Lexicons AND a new book-scoped lexicon is chosen for a book that has
        none · 4 "Fix pronunciation" is built right in Slice 4's line panel (a Slice 4 line item)
        · 5 the Qwen3-IPA doc line corrected; option A — the design law says ghost is borderless
        (the mock over the 2026-06-12 decree) · 6 a book keeps one lexicon · 7 the mock's
        persona-beats-project hint corrected to c; stale-vs-re-render carried into Slice 4's D4.
        BUILT 2026-09-30, NOT COMMITTED — plan doc §6.1 (blast radius) and §6.2 (what, checks):
        server suite 941 passed; unit 122; gate 17/17; live on the real data — Generate through
        Kokoro said the respelling, Used by and the persona field read as decided. Left as
        they were (not named): the same "override" wording in the Personas and Lexicons page
        ledes (`App.vue:55-56`), `docs/core-concepts.md:40, :43`.
GO:     given 2026-09-30 for the build — "1 go ahead with the lexicon"; and for §6 — "your rec
        on all go"
```
