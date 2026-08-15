# SPDX-License-Identifier: MIT
"""The portable-install rules (user ruling 2026-08-14).

The app folder is self-contained and hand-movable; the DATA folder is the
user's and can live on another drive. Two things follow, and both are pinned
here:

1. Media rows store paths RELATIVE to the data root, so Settings → Storage →
   Change folder moves the files without orphaning every capture and take.
2. Engine venvs are stamped with the install path they were built under, so a
   moved app folder reports "needs reinstall" instead of failing inside a load
   (venvs bake absolute paths into their launchers and are not relocatable).
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


# ── 2. A moved install marks engines as needing reinstall ────────────


def test_unstamped_venv_reads_as_matching(tmp_path):
    """Venvs built before the stamp existed must not be declared dead — the
    interpreter health probe still covers genuinely broken ones."""
    from justvoice.engines.manager import venv_origin_matches

    venv = tmp_path / ".venv"
    venv.mkdir()
    assert venv_origin_matches(venv) is True


def test_stamp_round_trips_for_the_current_install(tmp_path):
    from justvoice.engines.manager import record_venv_origin, venv_origin_matches

    venv = tmp_path / ".venv"
    venv.mkdir()
    record_venv_origin(venv)
    assert venv_origin_matches(venv) is True


def test_a_venv_built_under_another_install_does_not_match(tmp_path):
    from justvoice.engines.manager import VENV_ORIGIN_FILE, venv_origin_matches

    venv = tmp_path / ".venv"
    venv.mkdir()
    (venv / VENV_ORIGIN_FILE).write_text(r"D:\some\other\install\engines", encoding="utf-8")
    assert venv_origin_matches(venv) is False


def test_isolated_engine_reports_not_installed_after_a_move(tmp_path, monkeypatch):
    """The user-visible half: the row says 'engine not installed' and offers
    Install, instead of the load failing somewhere deep."""
    from justvoice.engines import manager as mgr_mod
    from justvoice.engines.manager import VENV_ORIGIN_FILE, EngineManifest

    engine_dir = tmp_path / "myengine"
    scripts = engine_dir / ".venv" / ("Scripts" if mgr_mod.os.name == "nt" else "bin")
    scripts.mkdir(parents=True)
    (scripts / ("python.exe" if mgr_mod.os.name == "nt" else "python")).write_bytes(b"x")

    module = type("M", (), {"ID": "myengine", "ISOLATION": "venv"})
    manifest = EngineManifest(engine_dir, module)
    assert manifest.is_installed is True          # stamped for nowhere = fine

    (engine_dir / ".venv" / VENV_ORIGIN_FILE).write_text(r"D:\moved\away", encoding="utf-8")
    assert manifest.is_installed is False         # the app folder moved


def test_shared_venv_health_fails_on_a_foreign_stamp(monkeypatch, tmp_path):
    """The cheap check runs BEFORE the subprocess probe — a moved install is
    caught without paying to spawn an interpreter."""
    from justvoice.engines import manager as mgr_mod

    venv = tmp_path / ".shared-venv"
    exe = venv / ("Scripts" if mgr_mod.os.name == "nt" else "bin")
    exe.mkdir(parents=True)
    (exe / ("python.exe" if mgr_mod.os.name == "nt" else "python")).write_bytes(b"x")
    (venv / mgr_mod.VENV_ORIGIN_FILE).write_text(r"D:\moved\away", encoding="utf-8")

    monkeypatch.setattr(mgr_mod, "SHARED_VENV_DIR", venv)
    monkeypatch.setattr(mgr_mod, "shared_venv_python", lambda: exe / (
        "python.exe" if mgr_mod.os.name == "nt" else "python"))

    def _boom(*a, **kw):  # the probe must never be reached
        raise AssertionError("spawned an interpreter for a known-moved venv")

    monkeypatch.setattr(mgr_mod.subprocess, "run", _boom)
    mgr_mod.invalidate_shared_venv_health()
    assert mgr_mod.shared_venv_healthy() is False
    mgr_mod.invalidate_shared_venv_health()
