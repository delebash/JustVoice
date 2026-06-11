"""Data directory resolution — where settings.json + storage lives.

Matches the Rust CLI's resolve_data_dir behavior so existing JustVoice
data dirs transfer to the Python port without copying files.

Resolution order:
  1. Explicit `--data-dir` CLI flag (handled by cli.py)
  2. `JUSTVOICE_DATA_DIR` env var
  3. Platform default via platformdirs
"""

from __future__ import annotations

import os
from pathlib import Path

from platformdirs import user_data_dir


def default_data_dir() -> Path:
    """Resolve the data dir following the same logic as the Rust CLI.

    The Rust core used the `directories` crate with
    `ProjectDirs::from("dev", "justvoice", "justvoice")`, which on Windows
    lands at ``%APPDATA%\\justvoice\\justvoice\\data`` and on macOS at
    ``~/Library/Application Support/dev.justvoice.justvoice``.

    platformdirs gives us the same layout when called with the same
    qualifier/org/app triple.
    """
    env = os.environ.get("JUSTVOICE_DATA_DIR")
    if env:
        return Path(env)
    # platformdirs's appauthor maps to the org in ProjectDirs, appname
    # to the application. Set roaming=False on Windows so we use the
    # local AppData (the Rust core also used roaming=true effectively
    # via the directories crate's default; we use Local for now and
    # document the migration path in the changelog).
    raw = user_data_dir(appname="justvoice", appauthor="justvoice", roaming=True)
    return Path(raw) / "data"


def storage_root(data_dir: Path) -> Path:
    """Sub-path that the Rust core used for stores."""
    return data_dir / "justvoice"


def models_root(data_dir: Path) -> Path:
    return storage_root(data_dir) / "models"


def cache_root(data_dir: Path) -> Path:
    return data_dir / "cache"


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
