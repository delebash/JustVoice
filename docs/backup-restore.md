# Backup and restore

**Backup = whole-server disaster recovery. Project export = per-project
handoff.** Different jobs; this page is the first one.

Backups live under **Settings → Backups**.

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
  ([Export](export.md)), which travels a single project with its audio.
