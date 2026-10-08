# Run modes

## Desktop

The normal double-click app: a window over a local server it starts and owns.
By default, closing the window quits everything — window, tray, and server. With the **keep-server-running** setting on, closing the window leaves
the tray and the server running (headless without a terminal); the
[system tray](system-tray.md) offers Show/Hide window, Start/Stop/Restart
server, and Quit.

## Headless

The same server, no window. On Windows the installer puts a command called
**`justvoice-server`** beside JustVoice in the install folder. From that folder:

    justvoice-server serve --host 127.0.0.1 --port 17494 --data-dir <path> --log-level info

It is the same server the desktop app runs, on the same data folder — only without the
window. On macOS and Linux there is no separate command yet: run the app's own program
with the environment variable `ELECTRON_RUN_AS_NODE=1`, followed by the path to
`resources/app.asar/server/src/serve.js` inside the installed app (`Contents/Resources/…`
in the macOS app bundle) and the same options. From a copy of the source code,
`npm run server` does it for you (options go after `--`).

The full UI is served at `http://<host>:17494/ui/` — any browser works, which is
how you run JustVoice on a remote GPU box and drive it from a laptop. The usual
flags have `JUSTVOICE_*` environment-variable twins for service managers. Add
bearer tokens (Settings → auth) before exposing a host beyond loopback; loopback
requests are exempt unless you require otherwise. Even then, closing the desktop
app still shuts its server down cleanly: its shutdown request answers from this
machine without a token (it never does from anywhere else).

Dev utilities live on the domain CLI, not the server command — from a copy of the
source code, `node scripts/node24.js server/src/cli.js default-settings` (print the full
settings document with defaults) · `self-test` (quick health run).

## Admin operations

- **Logs** — Settings → logs offers tail and download (`/v1/logs/tail`).
- **Factory reset** — wipes the server state back to first-run; confirm-gated.
  [Back up](backups-and-data.md) first.
- **Bulk-delete generations** — clears old audio en masse; the API's
  `confirm=false` dry-run shows what WOULD be deleted first, and at least one
  filter is required so "delete everything" can't happen by accident.
- **Cache clear** — per-scope clears of the render cache (Settings → cache).
