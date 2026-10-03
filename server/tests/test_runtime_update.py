# SPDX-License-Identifier: MIT
"""Moving the speech runtime to a newer pinned release (decided 2026-10-03, TASKS "Our copy of
audio.cpp"): an installed older build keeps working, the runtime row offers "Update to <tag>",
and the update stops the old processes so the next load starts the pinned build."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from justvoice.engines.audiocpp import release, runtime


@pytest.fixture()
def tags(monkeypatch, tmp_path):
    """A pinned release "v9-new", an older "v9-old" still installed; the kit's lookup finds
    whichever tag has a folder."""
    monkeypatch.setattr(release, "TAG", "v9-new")
    monkeypatch.setattr(release, "PREVIOUS_TAGS", ("v9-old",))
    on_disk: set[str] = {"v9-old"}

    def fake_installed(cache_root, folder, build, asset):
        exe = tmp_path / build / "audiocpp_server.exe"
        if build in on_disk:
            exe.parent.mkdir(parents=True, exist_ok=True)
            exe.write_bytes(b"x")
            return exe
        return None

    import llm_runner.runner.binary as binary

    monkeypatch.setattr(binary, "installed_runtime_exe", fake_installed)
    monkeypatch.setattr(runtime, "selected_asset", lambda backend=None: SimpleNamespace(gpu="cuda12"))
    monkeypatch.setattr(runtime, "configured_backend", lambda: "cuda")
    monkeypatch.setattr(runtime, "_runtime_root", lambda: tmp_path)
    runtime.forget_installed()
    yield on_disk
    runtime.forget_installed()


def test_an_older_pinned_build_keeps_working_until_updated(tags):
    exe = runtime.installed_exe()
    assert exe is not None and exe.parent.name == "v9-old"
    assert runtime.installed_tag() == "v9-old"
    tags.add("v9-new")                      # the update lands
    runtime.forget_installed()
    assert runtime.installed_exe().parent.name == "v9-new"
    assert runtime.installed_tag() == "v9-new"


def test_nothing_installed_is_nothing(tags):
    tags.clear()
    assert runtime.installed_exe() is None and runtime.installed_tag() is None


def test_the_runtime_row_offers_the_update(tags, monkeypatch):
    from justvoice.api import speech_runtime_api

    class _Srv:
        _run = None
        pid = None

        def is_running(self):
            return False

    monkeypatch.setattr(runtime, "get_server", lambda placement="gpu": _Srv())
    monkeypatch.setattr(runtime, "available_backends", lambda: ["cuda", "cpu"])
    monkeypatch.setattr(runtime, "_hardware", lambda: SimpleNamespace(gpus=[]))
    monkeypatch.setattr(runtime, "cpu_threads", lambda: 8)
    monkeypatch.setattr(runtime, "physical_cores", lambda: 8)
    monkeypatch.setattr(runtime, "_settings", lambda: SimpleNamespace(
        backend="auto", gpu=0, cpu_threads=0, cpu_min_realtime=2.0))
    info = speech_runtime_api._info()
    assert (info.installed, info.version, info.update_to) == (True, "v9-old", "v9-new")
    tags.add("v9-new")
    runtime.forget_installed()
    info = speech_runtime_api._info()
    assert (info.version, info.update_to) == ("v9-new", None)


@pytest.mark.parametrize("was, stops", [("v9-old", True), ("v9-new", False), (None, False)])
def test_an_update_stops_the_old_processes_and_a_fresh_install_does_not(monkeypatch, was, stops):
    from justvoice.engines import manager as mgr_mod
    from justvoice.engines.audiocpp import espeak

    monkeypatch.setattr(release, "TAG", "v9-new")
    monkeypatch.setattr(runtime, "installed_tag", lambda backend=None: was)
    monkeypatch.setattr(runtime, "install", lambda **kw: Path("x"))
    monkeypatch.setattr(espeak, "install", lambda root: (Path("a"), Path("b")))
    stopped: list = []
    monkeypatch.setattr(runtime, "shutdown_server", lambda placement=None: stopped.append("server"))

    class _Mgr:
        def loaded_for(self, kind):
            return SimpleNamespace(manifest=SimpleNamespace(uses_audiocpp=True)) if kind == "tts" else None

        def unload(self, kind):
            stopped.append(f"unload {kind}")

    monkeypatch.setattr(mgr_mod, "get_manager", lambda: _Mgr())
    mgr_mod._install_audiocpp_runtime()
    assert stopped == (["unload tts", "server"] if stops else [])


def test_voxcpm2s_transcript_follows_the_pin(monkeypatch):
    """Our build 1 passes a VoxCPM2 clip's transcript on (audio.cpp 0acac2b1); upstream v0.9.0
    ignored it, so the transcript field and the row's "and its transcript" follow the pin."""
    monkeypatch.setattr(release, "TAG", "v0.9.0")
    assert release.pinned_has("voxcpm2_transcript") is False
    monkeypatch.setattr(release, "TAG", "v0.9.0-jv.1")
    assert release.pinned_has("voxcpm2_transcript") is True


def test_the_pin_is_our_build_and_upstreams_keeps_working():
    assert release.TAG == "v0.9.0-jv.1" and release.PREVIOUS_TAGS == ("v0.9.0",)
    assert all(b.asset_url.startswith("https://github.com/delebash/audio.cpp/releases/download/v0.9.0-jv.1/")
               for b in release.binaries())


# ── A clone's transcript is only what was typed (decided 2026-10-03) ─────


def _qwen_base_row():
    from justvoice.engines.manager import discover_engines

    return next(r for r in discover_engines()["qwen3"].module.VARIANTS if r["id"] == "qwen3-base-1.7b-q8")


def test_qwen3_base_clones_with_its_transcript_or_the_speaker_vector():
    from justvoice.engines.audiocpp.slot import to_speech_request

    clip = {"text": "Hi.", "audio_prompt_path": "C:/v/ref.wav"}
    req = to_speech_request(_qwen_base_row(), {**clip, "ref_text": "What the clip says."})
    assert req["reference_text"] == "What the clip says." and "x_vector_only_mode" not in req.get("options", {})
    req = to_speech_request(_qwen_base_row(), {**clip, "ref_text": "ignored", "xvector_only": True})
    assert req["options"]["x_vector_only_mode"] is True and "reference_text" not in req


def test_qwen3_base_without_either_is_refused_by_name():
    from justvoice.engines.audiocpp.slot import AudioCppError, to_speech_request

    with pytest.raises(AudioCppError, match="Qwen3 Base needs what the clip says — type the transcript, or "
                                            "tick x-vector only."):
        to_speech_request(_qwen_base_row(), {"text": "Hi.", "audio_prompt_path": "C:/v/ref.wav"})


def test_a_cloned_audition_needs_no_transcript_and_sends_none(monkeypatch, tmp_path):
    """The preview API no longer requires a transcript, so the Voices screen stops sending a
    placeholder; without one, no ref_text reaches the engine and the saved voice has none."""
    import base64

    from fastapi.testclient import TestClient

    from justvoice.app import create_app
    from justvoice.engines import manager as mgr_mod

    client = TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)
    mgr = mgr_mod.get_manager()
    sent: list[dict] = []
    monkeypatch.setattr(mgr, "current_for", lambda kind: "chatterbox")
    monkeypatch.setattr(mgr, "synth", lambda engine_id, body: sent.append(body) or
                        (bytes(4800), {"sample_rate": 24000, "channels": 1}))
    r = client.post("/v1/voices/preview", json={
        "engine": "chatterbox", "source": "cloned", "language": "en-US",
        "ref_wav_b64": base64.b64encode(b"RIFF....WAVE").decode(), "preview_text": "Hello there."})
    assert r.status_code == 200, r.text
    assert sent and "ref_text" not in sent[0] and sent[0]["audio_prompt_path"]
    saved = client.post(f"/v1/voices/preview/{r.json()['preview_id']}/save", json={"name": "No words"})
    assert saved.status_code in (200, 201), saved.text
    assert not saved.json().get("transcript")
