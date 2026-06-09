# JustTTS reference GUI

A single-file Vue 3 SPA for browsing voices, managing personas, generating audio, inspecting the cache, and tuning settings. No build step.

## Run

Just open `index.html` in a browser. By default it talks to `http://127.0.0.1:17494` — change the Server URL at the bottom of the sidebar to point elsewhere.

For non-loopback servers with auth enabled, paste a Bearer token into the token field.

## Why no build step?

This is the minimum viable reference GUI — proof that everything the server exposes is API-accessible. A production GUI would be a real build (Vite + Vue + TypeScript + a real component library), served from the Rust binary via `rust-embed` at `--ui`. That lands in Phase 4.6.

## Features

- **Overview**: server health, engine readiness, catalog summary
- **Generate**: pick voice, type text, render, play
- **Voices**: catalog browser
- **Personas**: full CRUD
- **Cache**: per-scope stats and clear actions
- **Settings**: cache budgets, request limits, save back to settings.json

## Not yet wired

- Voice cloning / design / import UIs
- Lexicon editor with IPA picker
- Render Chapter (multi-line)
- Mastering preview with loudness meter
- WebSocket streaming visualization
