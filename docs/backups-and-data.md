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

1. **Settings → Storage → Change folder** (desktop app) — pick a folder;
   JustVoice moves the existing data there and remembers the choice.
2. **`JUSTVOICE_DATA_DIR`** — an environment variable, for scripted or
   headless setups.
3. **`justvoice-server serve --data-dir <path>`** — per-run, headless.

The only time JustVoice picks for you is when the install directory can't be
written to (installed under `Program Files`, or run from read-only media). It
then falls back to the standard per-user app-data folder for your OS so the
app still starts. Settings → Storage always shows the folder actually in use.

**Moving the data.** Change folder copies everything to the new location,
switches over, and only then removes the old copy — if anything fails, the app
keeps using the old folder. Your library keeps working afterwards: takes,
captures and renders are recorded relative to the data folder, so they're
found wherever it ends up (and a backup restored on another machine or drive
resolves the same way).

**Moving the app.** The install folder is self-contained — move it to another
drive or a USB stick and it keeps working, because everything inside it is
relative. One exception: the speech engines run in Python environments that
record their own location internally and can't be relocated. JustVoice notices
this and shows the affected engines as **not installed** with an Install
button, rather than failing when you try to load one. Reinstalling rebuilds
the environment; your downloaded models and all your work are untouched.

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
- **Speech models** — every downloaded TTS/STT model, counted across every
  place they can live: the speech cache *and* the older per-engine folders
  models downloaded before 2026-08-14 sit in. One number, one Clear — the
  catalog keeps every model and each re-downloads when next loaded. Refuses
  while a speech engine is loaded.
- **Render cache** — cached renders; an identical render computes again
  instead of returning instantly. Labs → Cache offers scoped clears (by age)
  when you don't want to drop everything.

Engine spawn logs get the same per-row Clear; database, server logs, and
engine builds are shown for the full picture.

## Backup

**Export backup…** downloads one ZIP: the database (every project, take,
persona, lexicon, setting) plus your content folders — voices, personas,
lexicons, project files, generated audio, training data, and dictation
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

## Reset

**Reset…** on the same page is the factory reset: every project, persona,
voice, lexicon, capture, and setting returns to a fresh install (the server
address is kept so the app stays reachable). Downloaded engine models stay on
disk — remove those from the AI page if you want the space back. Take a backup
first.

## When to use which

- Moving to a new machine, or before risky surgery → **backup**.
- Sending one audiobook to a collaborator → **project export ZIP**
  ([Export](import-and-export.md)), which travels a single project with its audio.
