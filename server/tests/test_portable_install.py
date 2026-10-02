# SPDX-License-Identifier: MIT
"""The portable-install rules (user ruling 2026-08-14).

The app folder is self-contained and hand-movable; the DATA folder is the
user's and can live on another drive. Pinned here: media rows store paths
RELATIVE to the data root, so Settings → Storage → Change folder moves the
files without orphaning every capture and take.

(A second rule lived here until 2026-10-01: engine venvs bake absolute paths
into their launchers, so each was stamped with the install it was built under
and a moved app folder reported "needs reinstall". The speech runtime replaced
the venvs; its binary is relocatable and its config is rewritten, with fresh
paths, every time it starts — a moved app folder needs nothing.)
"""

from __future__ import annotations

from pathlib import Path

import pytest


# ── 1. Media paths survive a data-folder move ────────────────────────


@pytest.fixture
def app(tmp_path):
    from justvoice.app import create_app

    return create_app(data_dir=tmp_path)


def test_capture_audio_is_stored_relative_to_the_data_root(app, tmp_path):
    from justvoice.media_paths import store_media_path

    stored = store_media_path(tmp_path / "captures" / "c1.wav")
    assert stored == "captures/c1.wav"
    assert not Path(stored).is_absolute()


def test_stored_media_resolves_under_the_current_data_root(app, tmp_path):
    from justvoice.media_paths import media_file

    assert media_file("captures/c1.wav") == tmp_path / "captures" / "c1.wav"


def test_a_moved_data_folder_still_finds_its_files(tmp_path):
    """THE regression: Change-folder copies the data elsewhere and deletes
    the old root. With absolute rows every file was orphaned; relative rows
    resolve against whatever root the server booted with."""
    from justvoice.app import create_app
    from justvoice.media_paths import media_file, store_media_path

    old, new = tmp_path / "old", tmp_path / "new"
    create_app(data_dir=old)
    stored = store_media_path(old / "captures" / "c1.wav")

    # The user moves the data folder; the server reboots on the new root.
    (new / "captures").mkdir(parents=True)
    (new / "captures" / "c1.wav").write_bytes(b"RIFF")
    create_app(data_dir=new)

    assert media_file(stored) == new / "captures" / "c1.wav"
    assert media_file(stored).is_file()


def test_a_file_outside_the_data_root_keeps_its_absolute_path(app, tmp_path):
    """Not ours to relocate — rewriting it would break the reference."""
    from justvoice.media_paths import media_file, store_media_path

    outside = tmp_path.parent / "elsewhere" / "voice.wav"
    stored = store_media_path(outside)
    assert Path(stored).is_absolute()
    assert media_file(stored) == outside


def test_legacy_absolute_rows_still_resolve(app, tmp_path):
    """No migration (pre-release rule): rows written before this change are
    absolute and keep working exactly as they did."""
    from justvoice.media_paths import media_file

    legacy = tmp_path / "captures" / "old.wav"
    assert media_file(str(legacy)) == legacy
