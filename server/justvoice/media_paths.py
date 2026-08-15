# SPDX-License-Identifier: MIT
"""Media paths as STORED in the database — the app-state binding.

The shape is the family's (`llm_runner.platform.data_paths`); this module
only binds it to the running data root so call sites stay one line.

The rule (user ruling 2026-08-14): a media file inside the data folder is
stored RELATIVE to it. Before this, rows held absolute paths — so Settings →
Storage → Change folder copied the files to the new location, deleted the old
root, and left every capture and generated take pointing at a path that no
longer existed. Relative rows survive the move, and survive a backup restored
onto a different machine or drive.

Files outside the data folder keep their absolute path (they are not ours to
relocate), and absolute rows written before the rule still resolve — so there
is nothing to migrate.
"""

from __future__ import annotations

from pathlib import Path

from llm_runner.platform import from_data_relative, to_data_relative

from .app_state import get_state


def store_media_path(path: Path | str) -> str:
    """The value to persist for `audio_path` and friends."""
    return to_data_relative(path, get_state().data_dir)


def media_file(stored: str) -> Path:
    """The real file a stored media path refers to."""
    return from_data_relative(stored, get_state().data_dir)
