# Keyboard shortcuts

Press `?` from anywhere in the app (when no input is focused) to open the in-app shortcut cheatsheet. Press `?` again or `Esc` to dismiss.

## Universal

| Keys | Action |
|---|---|
| `?` | Open / close this cheatsheet |
| `Esc` | Close any open modal, drawer, dropdown, or this cheatsheet |

## Generate view

| Keys | Action |
|---|---|
| `/` | Open the paralinguistic / SFX tag menu (the slash menu) in the textarea |

## Studio Script — a chapter

These are an extra: everything is also a click, and **⌨ Shortcuts** on the page
lists them. They act on the selected line (click a row to select it), and do
nothing while you type or a dropdown is open.

| Keys | Action |
|---|---|
| `j` / `k` | Next / previous line |
| `n` / `Shift+N` | Next / previous line to check |
| `1`–`9` | Give the line to that speaker — this chapter's, most lines first |
| `0` | Give the line to the Narrator |
| `Enter` | This line looks right |
| `Shift+Enter` | Looks right, for every line sharing its mark |
| `Space` | Tick or untick the line |
| `[` / `]` | Previous / next chapter |
| `Ctrl+Z` | Undo your last change |
| Right-click a spoken line's text | Open the rewrite preview — the line rewritten as its speaker would say it, from their *Who they are*. Accept → replaces the line's text. Discard → the original stays |

See [Studio → Script](studio.md#a-chapter).

## Studio Cast tab

| Keys | Action |
|---|---|
| Click a persona (with a speaker selected) | Assign it to the selected speaker. Clicking the persona that already plays them takes it away |
| Click ▶ on a persona row | Play its voice's sample — a compact player opens in place |
| Click ✎ on a persona row | Open that persona on the Personas page |

See [Studio → Cast](studio.md#cast).

## Engines

| Keys | Action |
|---|---|
| Click `+ Add provider` | Register a new LLM or TTS provider inline |
| Click Edit on a provider row | Expand the row into the edit form |

## Why the in-app cheatsheet

The cheatsheet is the authoritative list — it stays in sync with the actual key handlers wired in the code. This doc reflects the cheatsheet at the time of writing. If something's bound that this doc doesn't mention, the cheatsheet is right and this doc is stale.
