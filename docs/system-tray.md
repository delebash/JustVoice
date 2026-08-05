# System tray

JustVoice lives in the system tray when the main window is closed (if you turn
that on). The tray shows the app icon; left-click toggles the window,
right-click opens the menu.

## Close-to-tray

Settings → the **Keep server running** switch controls what the X button does:

- **Off** (the default): hitting X quits everything — window and server.
- **On**: the main window hides, the server keeps serving. Render jobs
  continue. Left-click the tray icon to bring the window back, or use the
  menu's Quit to exit for real.

The switch is remembered and re-applied every launch.

## Menu items

| Item | What it does |
|---|---|
| 📺 Show window / 🔵 Hide window | Toggle main window visibility. |
| ▶️ Start server | Launch the Python sidecar if it isn't running. |
| ⏹ Stop server | Stop the sidecar. |
| 🔄 Restart server | Stop + start. Useful after settings changes that need a restart. |
| 🎙️ Start dictation | JustVoice-specific (not wired yet — coming with the dictation tray work). |
| 🎚️ MCP server: toggle | JustVoice-specific (not wired yet). |
| ⚙️ Open settings | Shows the window and opens Settings. |
| 📋 Copy server URL | Copies `http://127.0.0.1:17494` to the clipboard and says so. |
| 📜 Open log file | Opens the server's logs folder in your file manager. |
| ℹ️ About JustVoice | Shows the window and opens Settings (the About tab lives there). |
| 🚪 Quit JustVoice | Full quit — stops the server too, even with close-to-tray on. |

## Left-click

Single left-click on the tray icon toggles the main window. Hidden → shows.
Visible → hides.

## Per-OS notes

- **Windows**: tray icon in the notification area. Right-click menu native.
- **macOS**: menu bar icon (top-right). Click behavior same as Windows.
- **Linux**: tray icon via the freedesktop StatusNotifierItem protocol. Most
  desktops (GNOME, KDE, XFCE) support it; some (vanilla Wayland) require an
  extension.
