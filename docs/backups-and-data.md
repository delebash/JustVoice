# Backup and restore

**Backup = whole-server disaster recovery. Project export = per-project
handoff.** Different jobs; this page is the first one.

Backups live under **Settings → Backups**.

## Where your data lives

Everything JustVoice stores — the database, voices, personas, projects,
generated audio, downloaded speech models, the render cache, logs — lives
under one **data folder**, and **you decide where that is**. Nothing is ever
written to a hidden per-user location you didn't pick.

**By default it sits with the app**: a `data` folder inside the JustVoice
install directory, next to the program itself. That makes an install
self-contained — copy the folder to another drive or a USB stick and your
whole library goes with it, and uninstalling means deleting one folder.

To put it somewhere else, in order of precedence:

1. **Settings → Storage → Change folder** (desktop app) — pick where it goes;
   JustVoice copies the data into a new *JustVoice* folder there, restarts on
   it and remembers the choice.
2. **`JUSTVOICE_DATA_DIR`** — an environment variable, for scripted or
   headless setups.
3. **`justvoice-server serve --data-dir <path>`** — per-run, headless.

The folder you name with 2 or 3 must already exist — JustVoice says it's missing
rather than making it where a typo pointed.

The only time JustVoice picks for you is when the install directory can't be
written to (installed under `Program Files`, or run from read-only media). It
then falls back to the standard per-user app-data folder for your OS so the
app still starts. Settings → Storage always shows the folder actually in use.

**Moving the data.** Change folder copies everything to the new location and
switches over — if anything fails, the app keeps using the old folder. The old
folder keeps its copy until you remove it: Settings → Storage lists it with its
size and **Remove the old copy** (only what the move copied goes). While the data
is away from the default folder, **Move back to the default folder** brings it
back; if the folder it was moved to can't be used at a start, JustVoice starts on
the default folder and Storage offers **Use the default folder from now on**.
While `JUSTVOICE_DATA_DIR` names the folder, Storage says so and offers no move.
Your library keeps working afterwards: takes,
captures and renders are recorded relative to the data folder, so they're
found wherever it ends up (and a backup restored on another machine or drive
resolves the same way).

**Moving the app.** The install folder is self-contained — move it to another
drive or a USB stick and it keeps working, because everything inside it is
relative. That includes the speech runtime every voice engine runs on: it
needs no fixed location, and JustVoice writes its configuration afresh, with
the current paths, every time it starts it.

JustWrite follows the identical rule, so both apps behave the same way.

Installs from before 2026-08-14 kept data in a per-user app-data folder
(`%APPDATA%\justvoice\justvoice` on Windows). Pre-release there is no
automatic migration: point `JUSTVOICE_DATA_DIR` at the old folder to keep
using it, or start fresh — models re-download, and a [backup](#backup)
carries everything else across.

## Disk usage

**Settings → Storage → Disk usage** shows where the data folder's space goes,
with a **Clear** verb per reclaimable store — all three follow the same rule:
*clearing loses nothing permanently, it only trades disk for a later re-download
or re-render*:

- **AI models cache** — the language models behind Compose, attribution, and
  friends. Cleared models re-download on demand; refuses while a model is
  loaded (unload first).
- **Speech models** — every downloaded TTS/STT model, in the speech cache
  (`speech-cache/` in the data folder). One number, one Clear — the catalog
  keeps every model and each re-downloads when next loaded. Refuses while a
  speech model is loaded. Models downloaded before the 2026-10-01 switch to
  the speech runtime are a format it can't use; they still sit in the speech
  cache, are counted here, and go with Clear — the engines' new models
  download fresh. (Older still: models from before 2026-08-14 lived in
  per-engine folders, which are no longer counted.)
- **Render cache** — cached renders; an identical render computes again
  instead of returning instantly. Settings → Cache offers scoped clears (by age)
  when you don't want to drop everything.

Engine spawn logs get the same per-row Clear; database, server logs, and
engine builds are shown for the full picture.

## Backup

**Export backup…** downloads one ZIP: the database (every project, take,
persona, lexicon, setting) plus your content folders — voices, personas,
lexicons, project files, generated audio, and dictation
recordings. Untick **Include generated audio** to leave out the renders and
dictation recordings — the backup shrinks to structure and library only, which
matters when generated audio runs to many gigabytes.

For scripts, the same backup streams from `GET /v1/data/backup`
(`?exclude=generations,captures` matches the unticked box).

## Restore

**Import backup…** replaces the current data with the backup's contents and
reloads the app — no restart step. Restore is whole-state: it is the
disaster-recovery path, not a merge. A backup made without generated audio
restores everything else and leaves whatever audio is currently on disk in
place. Loaded speech engines are unloaded during a restore; load one again from
the AI page when you need it.

A restore is all or nothing: the backup's folders are swapped in whole, then its
tables, and if anything fails the old folders go back and nothing has changed.
While it runs:

- what was working on your files stops first — a book being made into an
  audiobook, a chapter rendering, an export — and a take or capture that is
  playing stops;
- a change saved from another window is refused (*A backup is being restored —
  your change wasn't saved …*) instead of landing half-way; the app shows the
  restored data a moment later.

If another program holds a file inside the data folder open (an audio editor, a
backup or sync tool), the restore is refused and says which folder — close that
program and import the backup again.

On a computer that syncs, a restore keeps your other computers' newer work, and
this computer keeps its own sync settings; a backup from another sync library
is refused while this computer syncs — see [Sync](sync.md#good-to-know).

## Reset

**Reset…** on the same page is the factory reset: every project, persona,
voice, lexicon, capture, and setting returns to a fresh install (the server
address is kept so the app stays reachable). Downloaded engine models stay on
disk — remove those from the AI page if you want the space back. Take a backup
first.

A folder you linked into the data folder (a junction or a symbolic link to
somewhere else) is removed as a link by the reset and by **Clear** on Settings →
Storage: what it points to keeps its files.

## When to use which

- Moving to a new machine, or before risky surgery → **backup**.
- Sending one audiobook to a collaborator → **project export ZIP**
  ([Export](import-and-export.md)), which travels a single project with its audio.
