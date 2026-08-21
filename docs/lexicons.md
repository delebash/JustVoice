# Lexicons

A **lexicon** is a pronunciation dictionary. JustVoice applies it as a preprocessing pass before TTS sees the text, so "Beauchamp" → "BEE-chum" comes out consistently across every chapter, every voice.

## Scopes

- **Project-scoped** — applies to every Block in the project. Most book-specific names live here.
- **Persona-scoped** — applies only when the speaker is a given Persona. Useful for character-specific dialects (Old Crow's street slang isn't applied when the Narrator reads the same word).
- **Reusable** — domain lexicons (nautical / medical / theological / cookery) saved as their own files and attached to multiple projects.

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
| A character's surname that appears in narration AND dialogue | Project |
| A character whose speech uses street slang the narrator never uses | Persona |
| Industry terms common to medical thrillers | Reusable, attached to the project |
| One-off mispronunciation by a single character (intentional) | Persona |

## Find the names before you hear them wrong

A book-scoped lexicon has a **🔎 Scan the book for names** button. It reads
every line of the book and lists the proper nouns — character and place
names — that the lexicon doesn't cover yet, most frequent first. Click a
name to add it as a blank row; **＋ Add all** takes the whole list. A blank
row changes nothing until you give it a pronunciation, so add freely and
fill entries in as you hear problems.

The scan is deliberately conservative: a capitalized word only counts when
a sentence didn't force the capital, and a word that ever appears lowercase
is treated as ordinary. What survives is almost always a name.

Importing a book from JustWrite seeds this list for free — every character
the book hands over arrives as a blank lexicon row, so the pronunciation
worklist exists from minute one.

## IPA entries reach the audio

An entry's IPA pronunciation is spliced into the speech itself on engines
that accept phonemes (Kokoro today): the word is *pronounced* as written in
the entry, everything around it unchanged. Engines that can't take
phonemes use the entry's respelling instead; an IPA-only entry does
nothing there — a guessed pronunciation beats hearing IPA letters read
aloud. The live preview marks both: respellings replace the word,
pronunciations show as 「/…/」 after it.

## Import + export

Lexicons round-trip as `.justlex.json` files. Import a JustWrite character lexicon, an Audacity word-list, or a CSV via the lexicon editor's import button.

## Pronunciation engines + lexicons

Different engines respect lexicons differently:

- **Kokoro** uses a phoneme front-end; phonetic entries map cleanly.
- **Chatterbox** is end-to-end neural; lexicons are applied as text-substitutions ("Beauchamp" → "BEE-chum") before tokenization.
- **Qwen3-TTS** supports inline IPA tokens.

JustVoice routes each entry through the engine's preferred path automatically.
