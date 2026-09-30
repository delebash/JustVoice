<!-- SPDX-License-Identifier: MIT -->
# A project's pronunciation lexicon reaches the audio

**Decided 2026-09-30** — the user asked "what do you think on 5 think on it a few times" (the
Lexicon-on-Overview question, open since 2026-09-28: `docs/dev/TASKS.md`, "Build the mock's
Studio in the app"); the answer below was presented; then "ok mark that as to be wired". That
decides a–e. **The build is not started and needs its own go.** The tracker item is
`docs/dev/TASKS.md` "A project's pronunciation lexicon reaches the audio".

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
