# System tray

JustVoice lives in the system tray when the main window is closed (configurable). The tray icon's color indicates server status, left-click toggles the window, and right-click opens the full menu.

## Close-to-tray

Settings → Lifecycle → "Keep server running when app closes" controls what happens when you hit the X button:

- **On** (default): main window hides, server stays running, tray icon stays green. Render jobs continue. MCP server stays available. Dictation hotkey stays armed.
- **Off**: hitting X quits everything.

Useful when you want background renders to finish, or when an agent is hitting the MCP server from another app.

## Status indicator

The tray icon's tint mirrors server state:

- 🟢 **Green** — server running, no issues.
- 🟡 **Yellow** — server running but a model is loading or a render is in-flight.
- 🔴 **Red** — server crashed or unreachable. Right-click → Restart server to recover.

## Menu items

| Item | What it does |
|---|---|
| 📺 Show window / 🪟 Hide window | Toggle main window visibility. |
| ▶️ Start server | Launch the Python sidecar if it isn't running. |
| ⏹ Stop server | Gracefully stop the sidecar. In-flight renders finish first. |
| 🔄 Restart server | Stop + start. Useful after settings changes that need a restart. |
| 🎙️ Start dictation | Trigger the dictation pill without needing the global hotkey. |
| 🎚️ MCP server toggle | Quick on/off for the MCP HTTP server. |
| ⚙️ Open settings | Open the main window directly to Settings. |
| 📋 Copy server URL | Copy `http://localhost:17494` (or the configured URL) to clipboard. Handy when connecting from another machine via the headless web UI. |
| 📜 Open log file | Open the JustVoice log in the OS default text editor. |
| ℹ️ About | Version + license info. |
| 🚪 Quit JustVoice | Full quit. Even if close-to-tray is on, this exits everything. |

## Left-click

Single left-click on the tray icon toggles the main window. Hidden → shows. Visible → hides (same as the close button when close-to-tray is on).

## Background renders

If you start a render and minimize to tray, the render continues. JustVoice updates the tray badge with progress (a small numeric overlay shows "N renders in flight" when applicable). When all renders complete, the badge clears.

The webhook system (see [webhooks.md](webhooks.md)) can notify external receivers when renders finish, useful for "ping me on Slack when chapter 4 is done."

## Launch at login

Settings → Lifecycle → "Launch at login". When on, JustVoice starts hidden in the tray on OS login. Useful if you use dictation often (the hotkey is always armed) or if you want MCP available without manually launching.

## Per-OS notes

- **Windows**: tray icon in the notification area. Right-click menu native.
- **macOS**: menu bar icon (top-right). Click behavior same as Windows.
- **Linux**: tray icon via the freedesktop StatusNotifierItem protocol. Most desktops (GNOME, KDE, XFCE) support it; some (vanilla Wayland) require an extension.
