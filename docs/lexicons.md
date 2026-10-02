# Lexicons

A **lexicon** is a pronunciation dictionary. JustVoice applies it as a preprocessing pass before TTS sees the text, so "Beauchamp" → "BEE-chum" comes out consistently across every chapter, every voice.

## Scopes

A lexicon's scope says what it was made for. It does not switch the lexicon on —
a lexicon is read once a book or a persona points at it (the next section).

- **Book** — one book's own names. Most book-specific names live here.
- **Persona** — one persona's way of saying things: a speaker's own dialect, in
  every book that persona plays in.
- **Reusable** — domain lexicons (nautical / medical / theological / cookery)
  you can choose for any book.

## Which lexicons a line is read with

Every line is read with up to two lexicons, in this order:

1. **The book's lexicon** — the one chosen in **Studio → Overview →
   Pronunciation lexicon**. It is read on every line of the book, whoever says
   it. The list there offers **None**, this book's own lexicons, then your
   reusable ones; **Open ➜** goes to this page.
2. **The lexicon of the persona that speaks the line** — **Lexicon** on the
   persona. It is read only on the lines that persona speaks, so Old Crow's
   street slang is never applied when the narrator reads the same word.

**When both have the same word, the book's wins.** A name belongs to the book,
not to a voice you reuse across books. On an engine that takes IPA that holds
whatever kind of entry each one is — a book's IPA pronunciation beats a
persona's respelling of the same word.

An entry that can't do anything on the line's engine decides nothing, and the
persona's is used instead:

- a **blank row** — the book's lexicon only lists the name;
- an **IPA-only entry** on an engine that can't take IPA — which is every
  engine today (see [IPA entries reach the audio](#ipa-entries-reach-the-audio)).

A respelling matches its exact spelling, so the book's "worcester" leaves
"Worcester" to the persona's entry. A longer entry wins over a word inside it,
as it does within one lexicon: a persona's respelling of "Mara Vance" is used
for the whole name even when the book has an IPA entry for "Vance".

The same two lexicons are read everywhere a line is rendered: the chapter audio
on Render, the M4B, the ACX check, captions, a game's **↻** on Lines, a render
job and the voice-line export. A line sounds the same wherever it is rendered.
**Generate** reads the lexicon of the persona you pick there — not a book's,
because a line on Generate belongs to no book.

**A book-scoped lexicon that isn't chosen on Overview does nothing.** When you
make one for a book that has none chosen yet — here, or by importing a
`.justlex.json` — it becomes that book's lexicon, as an import's does. A book
that already has one keeps it; the new one waits until you choose it on
Overview.

**Used by** in the list shows who reads each lexicon: the books that chose it
(with the book's kind icon, 📖 for an audiobook) and the personas that carry it
(🎭). A lexicon nothing reads says **— not in use —**.

### What re-renders when you change one

Only the lines a lexicon actually changes. Choosing a lexicon on Overview,
adding an entry or editing a pronunciation re-renders the lines that contain
that word; every other line stays as it was rendered. Take the lexicon off
again and the earlier audio is still there.

## Entry shapes

Entries can be:

- **IPA**: `Beauchamp` → `/ˈbiːtʃəm/` (most precise; requires you to know IPA).
- **Phonetic**: `Worcestershire` → `WUS-tə-shər` (write what you'd say aloud; JustVoice converts to engine input).
- **Letter-by-letter**: `NYPD` → `en-why-pee-dee` (spell out acronyms).

Each entry has an optional **note** (where the word appears in the manuscript, what the variant pronunciation means) for editorial review.

## Live preview

The lexicon editor includes a preview text field. Type a sentence; JustVoice shows which entries would apply and how the preprocessed text looks before it hits the engine. Useful when checking edge cases ("Beauchamp's" → "BEE-chum's" — does the possessive carry through?).

## When to use which scope

| Case | Scope |
|---|---|
| A speaker's surname that appears in narration AND dialogue | Book, chosen on Overview |
| A speaker whose speech uses street slang the narrator never uses | Persona (the one that plays them) |
| Industry terms common to medical thrillers | Reusable, chosen on Overview |
| One-off mispronunciation by a single speaker (intentional) | Persona (the one that plays them) |

A book has one lexicon, so a book that needs both its own names and a reusable
list keeps them in one: add the names to the list you chose.

## Find the names before you hear them wrong

A book-scoped lexicon has a **🔎 Scan the book for names** button. It reads
every line of the book and lists the proper nouns — people's and place
names — that have no row yet, most frequent first. Click a name to add it as
a blank row; **＋ Add all** takes the whole list. A blank row changes nothing
until you give it a pronunciation, so add freely and fill entries in as you
hear problems.

A name counts as already having a row only where the render would read it:
in the lexicon chosen on Overview, or — for the lines one persona speaks — in
that persona's lexicon. So a name that only Old Crow's lexicon holds is still
listed, with the number of times someone else says it; and the rows of another
book-scoped lexicon that isn't chosen on Overview don't count. The names
already in the lexicon you have open are never listed.

The scan is deliberately conservative: a capitalized word only counts when
a sentence didn't force the capital, and a word that ever appears lowercase
is treated as ordinary. What survives is almost always a name.

Importing a book from JustWrite seeds this list for free — every person
the book hands over arrives as a blank lexicon row, so the pronunciation
worklist exists from minute one.

## IPA entries reach the audio

On an engine that accepts phonemes, an entry's IPA pronunciation is spliced
into the speech itself: the word is *pronounced* as written in the entry,
everything around it unchanged. Engines that can't take phonemes use the
entry's respelling instead; an IPA-only entry does nothing there — a guessed
pronunciation beats hearing IPA letters read aloud.

**No engine takes phonemes today.** Kokoro did until the 2026-10-01 switch to
the speech runtime, which cannot yet splice IPA into a line (see
[Engines → Not available yet](engines.md#not-available-yet)). Until it can,
every engine reads an entry's **respelling**: give the names that matter a
respelling ("Beauchamp" → "BEE-chum") as well as their IPA. The IPA stays
stored with the entry; an IPA-only entry changes nothing on today's engines.

The live preview marks both: respellings replace the word, pronunciations
show as 「/…/」 after it — the preview shows the IPA you've entered even
though no engine speaks it yet.

## Import + export

Lexicons round-trip as `.justlex.json` files. Import a JustWrite character lexicon, an Audacity word-list, or a CSV via the lexicon editor's import button.

## Pronunciation engines + lexicons

Different engines respect lexicons differently:

- **Kokoro** reads text through eSpeak NG, a phoneme front-end, so respellings
  steer it well. It took IPA entries directly before the 2026-10-01 switch (see
  above).
- **Chatterbox** is end-to-end neural; lexicons are applied as text-substitutions ("Beauchamp" → "BEE-chum") before tokenization.
- **Qwen3-TTS** takes respellings only, like Chatterbox.

JustVoice routes each entry through the engine's preferred path automatically.
