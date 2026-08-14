# Backup and restore

**Backup = whole-server disaster recovery. Project export = per-project
handoff.** Different jobs; this page is the first one.

Backups live under **Settings → Backups**.

## Where your data lives

Everything JustVoice stores — the database, voices, personas, projects,
generated audio, downloaded speech models, the render cache — lives under one
**data folder**:

- **Windows** — `%LOCALAPPDATA%\JustVoice\JustVoice`
- **macOS** — `~/Library/Application Support/JustVoice`
- **Linux** — `~/.local/share/JustVoice`

(The same shape as JustWrite's data folder, one level up.) Two overrides win
over the default: the `JUSTVOICE_DATA_DIR` environment variable, and headless
`justvoice-server serve --data-dir <path>`. The desktop app also offers
**Settings → Storage → Change folder**, which moves the data and remembers the
new location.

Installs from before 2026-08-14 used `%APPDATA%\justvoice\justvoice` (Roaming).
There is no automatic migration pre-release: either point
`JUSTVOICE_DATA_DIR` at the old folder, or start fresh — models re-download,
and a [backup](#backup) carries everything else across.

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
