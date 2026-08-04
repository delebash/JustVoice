# Run modes

## Desktop

The normal double-click app: a Tauri window over a local server it spawns and
owns. By default, closing the window quits everything — window, tray, and
server. With the **keep-server-running** setting on, closing the window leaves
the tray and the server running (headless without a terminal); the
[system tray](system-tray.md) offers Show/Hide window, Start/Stop/Restart
server, and Quit.

## Headless

The same server, no window:

    justvoice-server serve --host 127.0.0.1 --port 17494 --data-dir <path> --log-level info

The full UI is served at `http://<host>:17494/ui/` — any browser works, which is
how you run JustVoice on a remote GPU box and drive it from a laptop. `--no-docs`
skips serving the help pages. The usual flags have `JUSTVOICE_*` environment-variable
twins for service managers. Add bearer tokens (Settings → auth) before exposing a
host beyond loopback; loopback requests are exempt unless you require otherwise.

Utility subcommands: `justvoice-server default-settings` (print the full settings
document with defaults) · `open-api` (dump the API schema) · `self-test` (quick
health run). `python -m justvoice` works where the console script isn't on PATH.

## Admin operations

- **Logs** — Settings → logs offers tail and download (`/v1/logs/tail`).
- **Factory reset** — wipes the server state back to first-run; confirm-gated.
  [Back up](backup-restore.md) first.
- **Bulk-delete generations** — clears old audio en masse; the API's
  `confirm=false` dry-run shows what WOULD be deleted first, and at least one
  filter is required so "delete everything" can't happen by accident.
- **Cache clear** — per-scope clears of the render cache (Settings → cache).
