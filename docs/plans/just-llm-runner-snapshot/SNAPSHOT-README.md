# just-llm-runner — SNAPSHOT (durability copy)

This is a **point-in-time source snapshot** of the standalone
`just-llm-runner` package, committed into the JustVoice repo **only so a
new session (or a reclaimed sandbox) doesn't lose the code**.

## Why it's here
The package's real home is its own **private repo `delebash/just-llm-runner`**
(created, currently empty). This session's git proxy is allow-listed to
`delebash/{justvoice, justwrite-app, voicebox}` only, so I **cannot push**
to `just-llm-runner` from here (proxy returns "repository not authorized").
This snapshot is the fallback so the work survives.

## What it is
The shared local-LLM runner core (P1.1 manifest + P1.2 binary acquisition),
self-contained (own `hardware.py` + `download.py`), camelCase contract,
mountable FastAPI router. Built + tested: **11/11 pytest, ruff clean**.

## To publish it for real (do ONE)
1. **Add `just-llm-runner` to this session's allowed repos** (environment
   config) — then a session can `git push` it to `delebash/just-llm-runner`.
2. **Push from your machine**: use the tarball delivered in chat (it has the
   git commit + remote set), `git push -u origin main`.
3. From this snapshot: `cp -r just-llm-runner-snapshot ~/just-llm-runner &&
   cd ~/just-llm-runner && git init && git add -A && git commit -m init &&
   git remote add origin https://github.com/delebash/just-llm-runner.git &&
   git push -u origin main`.

## After it's published
- Each app consumes it as a **git dependency** (pinned tag) — NOT published
  to PyPI/npm. End users never install it (frozen into the bundle).
- Switch JustVoice off its in-tree pre-extraction copy
  (`server/justvoice/llm_runner/`): delete it, repoint
  `server/justvoice/api/llm_runner_api.py` import `from justvoice.llm_runner`
  → `from llm_runner`, and add the git-dep to `server/pyproject.toml`.
- **Delete this snapshot dir** — it's a stopgap, not the source of truth.

See `2026-06-16-builtin-llm-runner.md` (same folder) for the full plan.
