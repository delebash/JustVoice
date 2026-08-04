# Backup and restore

**Backup = whole-server disaster recovery. Project export = per-project
handoff.** Different jobs; this page is the first one.

## Backup

`GET /v1/backup` (Settings offers the button) downloads one ZIP: the database
(every project, take, persona, lexicon, setting), audio blobs, voice embeddings,
and training adapters. `?include_generations=false` shrinks it by leaving out
generated audio — structure and library only. The archive carries schema version
**1**; a future JustVoice restores any archive whose version it knows.

One honest limit: the ZIP is built in memory — very large libraries (past a few
GB, especially with generations included) should use `include_generations=false`
or per-project exports instead.

## Restore

`POST /v1/restore` with a backup ZIP replaces the server's state and answers
with `restart_required: true` — the server must restart before the restored data
is live (the desktop shell offers it; headless, restart the process). Restore is
whole-state: it is the disaster-recovery path, not a merge.

## When to use which

- Moving to a new machine, or before risky surgery → **backup**.
- Sending one audiobook to a collaborator → **project export ZIP**
  ([Export](export.md)), which travels a single project with its audio.
