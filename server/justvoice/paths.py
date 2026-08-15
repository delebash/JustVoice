"""Data directory resolution — where the database + storage lives.

Resolution order (THE family policy — the shape lives in the kit, never
here: `llm_runner.platform.data_paths`):
  1. Explicit `--data-dir` CLI flag (handled by cli.py)
  2. `JUSTVOICE_DATA_DIR` — the user's choice; also how the desktop shell
     hands down its resolved root
  3. `data/` beside the app (the DEFAULT — portable, in the install dir)
  4. The OS app-data dir, only when the install dir is not writable
"""

from __future__ import annotations

from pathlib import Path

from llm_runner.platform import resolve_data_dir

APP_NAME = "JustVoice"

# The checkout root in a source install: server/justvoice/paths.py → repo.
# (Frozen builds ignore this — the kit uses the executable's folder.)
SOURCE_ROOT = Path(__file__).resolve().parents[2]


def default_data_dir() -> Path:
    """The app's data root, per the ONE family policy (user ruling
    2026-08-14 — *"absolutely no data ... stored anywhere but where the user
    has set the storage directory, which by default will be the install
    directory for the app"*). The desktop shell implements the identical
    ladder in Rust (`default_data_root`, src-tauri/src/lib.rs) because it
    must resolve the root before this process exists, and hands the result
    down via `JUSTVOICE_DATA_DIR`; keep the two in lock-step.

    Pre-release rule: this is a DEFAULT change, never a migration — data
    under an older default stays where it is and is reachable by setting
    `JUSTVOICE_DATA_DIR`."""
    return resolve_data_dir(
        app_name=APP_NAME,
        env_var="JUSTVOICE_DATA_DIR",
        source_root=SOURCE_ROOT,
    )


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
