# Projects

The project library — every audiobook, game voiceline set, and podcast in one
table. One project is **active** at a time; the workflow tabs (Chapters, Lines,
Studio) operate on it.

## Project kinds

The kind picker at creation drives the whole app's shape: which workflow tabs
appear in the sidebar, the default mastering target (ACX for audiobooks,
−16 LUFS podcast loudness for podcasts), the export surface (M4B vs per-line
voicelines ZIP), and the terminology (chapters / quests / segments). Kinds:
`audiobook`, `game voicelines`, `podcast`, `custom`. The underlying data model
is the same for all — a project holds scenes, scenes hold blocks — so nothing is
lost if your project outgrows its kind.

## The detail pane

Click a row to expand it: title, author, mastering preset, default render
preset, cast, status, webhook, plus the chapters subtable (open any chapter in
its kind's home tab). The action row does the heavy lifting: **Render all** ·
**Export M4B** · **QC report** (the ACX compliance check — loudness, peak, noise
floor, with failures named) · **Export ZIP** · **Delete**. A bulk bar appears
when you select multiple projects.

## Demo projects

`POST /v1/projects/demo` (offered in the UI on first run) creates a small sample
project per kind so you can click through the whole flow before importing
anything of your own.
