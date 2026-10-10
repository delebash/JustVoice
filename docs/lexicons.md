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
   persona. It is read only on the lines that persona speaks, so persona Old Crow's street slang is never applied when the narrator reads the same word.

**When both have the same word, the book's wins.** A name belongs to the book,
not to a voice you reuse across books. On an engine that takes IPA that holds
whatever kind of entry each one is — a book's IPA pronunciation beats a
persona's respelling of the same word.

An entry that can't do anything on the line's engine decides nothing, and the
persona's is used instead:

- a **blank row** — the book's lexicon only lists the name;
- an **IPA-only entry** on an engine that can't take IPA — every engine but
  Kokoro (see [IPA entries reach the audio](#ipa-entries-reach-the-audio)).

A respelling matches its exact spelling, so the book's "worcester" leaves
"Worcester" to the persona's entry. A longer entry wins over a word inside it,
as it does within one lexicon: a persona's respelling of "Mara Vance" is used
for the whole name even when the book has an IPA entry for "Vance".

The same two lexicons are read everywhere a line is rendered: the chapter audio
on Render, the M4B, the ACX check, captions, a game's **↻** on Lines, a render
job and the voice-line export. A line sounds the same wherever it is rendered.
A persona's **Hear it** reads that persona's lexicon — not a book's, because a
line there belongs to no book.

**A book-scoped lexicon that isn't chosen on Overview does nothing.** When you
make one for a book that has none chosen yet — here, or by importing a
`.justlex.json` — it becomes that book's lexicon, as an import's does. A book
that already has one keeps it; the new one waits until you choose it on
Overview.

**Used by** in the list shows who reads each lexicon: the books that chose it
(with the book's kind icon, 📖 for an audiobook) and the personas that carry it
(🎭). A lexicon nothing reads says **— not in use —**.

### What goes stale when you change one

Only the lines a lexicon actually changes. Choosing a lexicon on Overview,
adding an entry or editing a pronunciation makes the lines that contain that
word [stale](studio.md#stale-lines) in Studio · Render: they keep playing their
take in use until you render them again, and every other line stays as it was. Take
the lexicon off again and those lines are no longer stale.

## Make a lexicon and add entries

**+ New lexicon** opens the editor. Each box says under it what it is for;
the ones marked *required* must be filled before **Save** works:

- **Name** *(required)* — what the lexicon is called where you choose one: a
  book's Overview, a persona's page.
- **Scope** — what it is made for (see [Scopes](#scopes)). A book-scoped
  lexicon needs its book picked, a persona-scoped one its persona. The scope
  can't change once the lexicon is saved.
- **Live preview text** — optional; see [Live preview](#live-preview). Nothing
  typed here is saved.

An **entry** is a word and a way to say it. In **Add entry**:

- **Word** *(required)* — exactly as the text spells it.
- **IPA** — the sounds in the phonetic alphabet. Only some models speak IPA;
  the hint under the box names them (see
  [IPA entries reach the audio](#ipa-entries-reach-the-audio)).
- **Phonetic spelling** — the word spelled the way it sounds. Every voice model
  reads this.

Give the word an IPA pronunciation, a phonetic spelling or both, then **+ Add
entry** puts it in the list. **Save** keeps the whole lexicon — and takes along
an entry still typed in the form, so nothing you typed is dropped. An entry
typed only halfway (a word with no way to say it, or a pronunciation with no
word) stops Save: the footer says what is missing, and Save works again once
you finish the entry or clear it. Rows added by the
[name scan](#find-the-names-before-you-hear-them-wrong) start blank on purpose.

Entries can be:

- **IPA**: `Beauchamp` → `/ˈbiːtʃəm/` (most precise; requires you to know IPA).
- **Phonetic**: `Worcestershire` → `WUS-tə-shər` (write what you'd say aloud; JustVoice converts to engine input).
- **Letter-by-letter**: `NYPD` → `en-why-pee-dee` (spell out acronyms).

## Live preview

The lexicon editor includes a preview text field. Type a sentence; JustVoice shows which entries would apply and how the preprocessed text looks before it hits the engine. Useful when checking edge cases ("Beauchamp's" → "BEE-chum's" — does the possessive carry through?).

## Hear it before you render

A saved lexicon's editor lets you listen to it:

- **▶ beside an entry** — the word as it will be said: the persona chosen under
  **Try a word**, reading this lexicon. It plays what is saved, so the ▶ of an
  entry added or changed since is greyed out until you **Save**.
- **Try a word** — pick a persona, type a word or a short line, then **▶ Before**
  hears it without this lexicon and **▶ After** with its saved entries. The
  persona list holds the personas that read this lexicon — the one that carries
  it, and the ones cast in a book that chose it — so you hear it in the voice
  that will say it. For a lexicon nothing reads yet it lists every persona.
- **Affects** — how many lines contain one of the lexicon's words, counting only
  the lines the render reads it for (see
  [Which lexicons a line is read with](#which-lexicons-a-line-is-read-with)).
  Editing an entry makes those lines [stale](#what-goes-stale-when-you-change-one)
  on Render; nothing renders again until you choose to. A lexicon nothing reads
  says so, and where to choose it.

When the persona's voice model isn't loaded, ▶ asks first — **Load & play** —
unless you chose **Always auto-load**. A new lexicon has none of this until its
first Save.

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

**Kokoro takes phonemes.** An entry's IPA reaches Kokoro as the word's own
pronunciation, everything around it unchanged (since v0.9.0-jv.4 of the speech
runtime; between the 2026-10-01 switch and then, no engine did). Every other
engine reads an entry's **respelling**: give the names that matter a respelling
("Beauchamp" → "BEE-chum") as well as their IPA, so they come out right on any
voice. An IPA-only entry changes nothing on an engine without phonemes.

The live preview marks both: respellings replace the word, pronunciations
show as 「/…/」 after it, with a line under the preview saying which models
speak IPA — *「/…/」 is IPA — Kokoro only.* The entries table says the same in
its Kind column (*IPA · Kokoro only*; hover it for the rest), and the note under
the table spells it out — *Spoken as IPA by Kokoro. Every other model reads the
respelling — an entry with only IPA does nothing there.* All of them read the
installed models' capabilities, so they follow the speech runtime you have.
On a persona's page, the count of word replacements under **Lexicon** leaves
out an IPA-only entry when the voice's model can't take IPA.

## Import + export

Lexicons round-trip as `.justlex.json` files. Import a JustWrite character lexicon, an Audacity word-list, or a CSV via the lexicon editor's import button.

## Pronunciation engines + lexicons

Different engines respect lexicons differently:

- **Kokoro** reads text through eSpeak NG, a phoneme front-end, so respellings
  steer it well, and it takes IPA entries directly — again since v0.9.0-jv.4 of
  the speech runtime (see above).
- **Chatterbox** is end-to-end neural; lexicons are applied as text-substitutions ("Beauchamp" → "BEE-chum") before tokenization.
- **Qwen3-TTS** takes respellings only, like Chatterbox.

JustVoice routes each entry through the engine's preferred path automatically.
