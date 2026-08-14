"""Data directory resolution — where the database + storage lives.

Resolution order:
  1. Explicit `--data-dir` CLI flag (handled by cli.py)
  2. `JUSTVOICE_DATA_DIR` env var
  3. Platform default via platformdirs (the JW family shape)
"""

from __future__ import annotations

import os
from pathlib import Path

from platformdirs import user_data_dir

APP_NAME = "JustVoice"


def default_data_dir() -> Path:
    """The per-user data directory — the FAMILY shape (phase ④ of the
    2026-08-13 speech-catalog redesign): `platformdirs.user_data_dir("JustVoice")`,
    exactly JustWrite's `paths.py`. On Windows that is
    ``%LOCALAPPDATA%\\JustVoice\\JustVoice`` (Local, never Roaming — model
    caches and WAV renders have no business syncing through a domain
    profile); macOS ``~/Library/Application Support/JustVoice``; Linux
    ``~/.local/share/JustVoice``.

    The pre-④ default (``%APPDATA%\\justvoice\\justvoice\\data``, a Rust-core
    relic the desktop shell didn't even agree with) is not migrated —
    pre-release rule: a default change, the user resets or re-downloads.
    The desktop shell's `default_data_root` (src-tauri/src/lib.rs) mirrors
    this function and MUST stay in lockstep."""
    env = os.environ.get("JUSTVOICE_DATA_DIR")
    if env:
        return Path(env)
    return Path(user_data_dir(APP_NAME))


def storage_root(data_dir: Path) -> Path:
    """Sub-path that the Rust core used for stores."""
    return data_dir / "justvoice"


def models_root(data_dir: Path) -> Path:
    return storage_root(data_dir) / "models"


def cache_root(data_dir: Path) -> Path:
    return data_dir / "cache"


def speech_cache_root(data_dir: Path) -> Path:
    """Speech-engine model files (phase ② of the 2026-08-13 redesign):
    PLAIN files per <engine>/<variant>/ plus a files.json manifest — no HF
    cache layout, no blobs, no symlinks (the WinError-1314 class has no
    code path here). Phase ④'s data-dir convergence re-roots data_dir;
    this function is deliberately the one place the location lives."""
    return data_dir / "speech-cache"


def voices_root(data_dir: Path) -> Path:
    return data_dir / "voices"


def personas_root(data_dir: Path) -> Path:
    return data_dir / "personas"


def lexicons_root(data_dir: Path) -> Path:
    return data_dir / "lexicons"


def projects_root(data_dir: Path) -> Path:
    return data_dir / "projects"


def generations_root(data_dir: Path) -> Path:
    """Ad-hoc generation WAVs (MCP speak, future Generate-tab persistence)."""
    d = data_dir / "generations"
    d.mkdir(parents=True, exist_ok=True)
    return d


def training_root(data_dir: Path) -> Path:
    return storage_root(data_dir) / "training"


def settings_path(data_dir: Path) -> Path:
    return data_dir / "settings.json"
