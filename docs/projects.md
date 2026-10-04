# Projects

The project library — every audiobook, game voiceline set, and podcast in one
table. One project is **active** at a time; the workflow tabs (Chapters, Lines,
Studio) operate on it.

**Click a project to open it.** It opens in [Studio](studio.md), on its
**Overview** — every project does, however you open it: from this list, from
Home's **Resume**, from the project switcher in the title bar, or right after
you create or import one. The project's settings live there now, not here.

## Project kinds

The kind picker at creation drives the whole app's shape: which workflow tabs
appear in the sidebar, the default mastering target (ACX for audiobooks,
−16 LUFS podcast loudness for podcasts), the export surface (M4B vs per-line
voicelines ZIP), and the terminology (chapters / quests / segments). Kinds:
`audiobook`, `game voicelines`, `podcast`, `custom`. The underlying data model
is the same for all — a project holds scenes, scenes hold blocks — so nothing is
lost if your project outgrows its kind.

## Where the settings went

The row used to expand into a detail pane. Everything it held moved:

| Was in the pane | Now |
|---|---|
| Title, author, mastering target | Studio · **Overview** |
| Description | Studio · **Overview** (new there) |
| Export ZIP, Delete | Studio · **Overview** → *Also from here* / *Delete project* |
| Cast pills and **+ Add personas** | Studio · **Cast** — the one place a book's speakers get their personas |
| Render preset | gone — render presets were removed on 2026-10-03 |
| Webhook on complete | gone — nothing ever sent it; webhooks are set up in Settings |
| The chapters subtable | the **Chapters** tab, and Studio's steps |

## Demo projects

**＋ New project → a demo project** creates a sample project of the kind you
picked, so you can click through the whole flow before importing anything of
your own. Deleting it touches nothing else.

- **Audiobook** — *The Ninth Facet*, JustWrite's own sample novel: two parts,
  four chapters, eight people and plenty of dialogue, some tagged ("said
  Threll"), some not. It is imported exactly as your own JustWrite export
  would be, so its eight people arrive as the book's speakers — with no
  personas yet, unless your library has a persona of exactly one of their
  names. It has no narrator until you add or pick one on Studio's Cast step.
  **Discover** shows the speakers it finds as *In the cast*; remove one there
  (it asks first) and its row turns *New*, ready to ＋ Add back.
- **Game voicelines** — *Emberfall VO*, five lines with stable line ids.
- **Podcast** — *Signal & Noise ep. 42*, three speakers.

The book lives in the app's `samples/` folder, the same layout JustWrite ships
(`samples/<name>/book.json`).
