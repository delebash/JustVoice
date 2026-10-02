# SPDX-License-Identifier: MIT
"""Variant wiring contract — the audit found every engine ignored the `variant`
arg, making the Engines-tab model dropdown cosmetic. These tests pin the catalog
rows to what actually renders them so the wiring can't silently drift again.

Since the 2026-10-01 switch "what renders them" is the audio.cpp runtime: each
row's `audiocpp` block (family, task, file) and the request mapping in
`engines/audiocpp/slot.py`. (Until then it was each engine.py's repo map.)
"""

from __future__ import annotations

import json
import re

import pytest

from justvoice.engines.audiocpp import release
from justvoice.engines.audiocpp.runtime import AudioCppError
from justvoice.engines.audiocpp.slot import QWEN_LANGUAGE, to_speech_request
from justvoice.engines.manager import discover_engines
from justvoice.engines.model_catalog import models_for

_QWEN_LANGS_10 = ["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"]


def _row(engine: str, variant: str) -> dict:
    return next(r for r in discover_engines()[engine].module.VARIANTS if r["id"] == variant)


# ── Qwen3 ────────────────────────────────────────────────────────────────


def test_qwen3_catalog_is_the_three_checkpoint_families() -> None:
    ids = {v.id for v in models_for("qwen3")}
    assert ids == {"qwen3-cv-1.7b-q8", "qwen3-base-1.7b-q8", "qwen3-base-0.6b-q8", "qwen3-vd-1.7b-q8"}
    for r in discover_engines()["qwen3"].module.VARIANTS:
        spec = r["audiocpp"]
        assert spec["family"] == "qwen3_tts"
        # VoiceDesign is its own audio.cpp task; CustomVoice and Base are tts.
        assert spec["task"] == ("vdes" if r["id"].startswith("qwen3-vd") else "tts"), r["id"]


def test_qwen3_cloning_flag_is_per_checkpoint_family() -> None:
    by_id = {v.id: v for v in models_for("qwen3")}
    assert by_id["qwen3-cv-1.7b-q8"].voice_cloning is False      # presets, no clone
    assert by_id["qwen3-cv-1.7b-q8"].preset_voices == 9
    for base in ("qwen3-base-1.7b-q8", "qwen3-base-0.6b-q8"):
        assert by_id[base].voice_cloning is True
        assert by_id[base].preset_voices == 0
        assert _row("qwen3", base)["audiocpp"].get("clone") is True


def test_qwen3_languages_are_the_ten_supported() -> None:
    for v in models_for("qwen3"):
        assert v.languages == _QWEN_LANGS_10, f"{v.id} language list drifted"


def test_qwen3_manifest_languages_all_reach_a_language_name() -> None:
    """audio.cpp's Qwen3 takes a language NAME ("English"; "en" is rejected). A
    catalog language the map can't name would silently render as English."""
    assert set(models_for("qwen3")[0].languages) <= set(QWEN_LANGUAGE)


def test_qwen3_voice_design_claim_is_backed() -> None:
    """The engine may claim voice_design ONLY while something real backs it: a
    VoiceDesign row, and a mapping that sends its description as audio.cpp's
    `instructions`."""
    m = discover_engines()["qwen3"]
    assert m.capabilities.get("voice_design") is True
    design = [v for v in models_for("qwen3") if getattr(v, "voice_design", False)]
    assert [v.id for v in design] == ["qwen3-vd-1.7b-q8"]
    req = to_speech_request(_row("qwen3", "qwen3-vd-1.7b-q8"),
                            {"text": "Hi.", "delivery": {"instruct": "A gravel voice."}})
    assert req["instructions"] == "A gravel voice."


# ── Chatterbox ───────────────────────────────────────────────────────────


def test_chatterbox_catalog_is_multilingual_only_until_turbo_clones() -> None:
    """Turbo, Nano and v3 return with the gaps they wait on (switch plan §5)."""
    assert {v.id for v in models_for("chatterbox")} == {"chatterbox-multilingual-v2-q8"}
    spec = _row("chatterbox", "chatterbox-multilingual-v2-q8")["audiocpp"]
    assert spec["family"] == "chatterbox" and spec["task"] == "clon"


# ── Every engine ─────────────────────────────────────────────────────────


@pytest.mark.parametrize("engine", ["kokoro", "qwen3", "chatterbox"])
def test_cloning_claims_are_wired_in_the_mapping(engine: str) -> None:
    """A row that claims `voice_cloning` must send the reference clip.

    Dia claimed it for months while its adapter built the input from text alone:
    every cloned voice rendered in the stock voice (engine dropped 2026-08-17;
    the check it motivated stays)."""
    for v in models_for(engine):
        if not v.voice_cloning:
            continue
        req = to_speech_request(_row(engine, v.id), {"text": "Hi.", "audio_prompt_path": "C:\\v\\ref.wav"})
        assert req["voice_ref"] == "C:/v/ref.wav", v.id
        with pytest.raises(AudioCppError):
            to_speech_request(_row(engine, v.id), {"text": "Hi.", "voice_id": "x"})


def test_manifest_default_variants_exist_in_catalog() -> None:
    """Every manifest DEFAULT_VARIANT_ID must be a real catalog variant."""
    for engine_id, manifest in sorted(discover_engines().items()):
        default = getattr(manifest.module, "DEFAULT_VARIANT_ID", None)
        if default is None:
            continue
        catalog_ids = {v.id for v in models_for(engine_id)}
        assert default in catalog_ids, f"{engine_id}: {default!r} not in {sorted(catalog_ids)}"


def test_speech_recognition_carries_its_aligner() -> None:
    v = models_for("asr")
    assert [x.id for x in v] == ["qwen3-asr-1.7b-q8"]
    spec = _row("asr", "qwen3-asr-1.7b-q8")["audiocpp"]
    assert spec["family"] == "qwen3_asr" and spec["task"] == "asr"
    assert [c["role"] for c in spec["companions"]] == ["aligner"]


def test_hf_sources_pin_a_commit_not_a_branch() -> None:
    """Every variant row carries byte-exact sizes and a file list. Those are
    facts about a COMMIT. `"revision": "main"` names a moving target, so
    upstream can re-upload weights under the same filenames and the next
    machine to install fetches different bytes with nothing to notice it."""
    loose: list[str] = []
    for eid, m in discover_engines().items():
        for variant in getattr(m.module, "VARIANTS", []) or []:
            for src in variant.get("sources") or []:
                rev = str(src.get("revision") or "")
                if not re.fullmatch(r"[0-9a-f]{40}", rev):
                    loose.append(f"{eid}/{variant.get('id')}: {rev!r}")
                assert src.get("hf_repo") == release.MODEL_REPO, variant["id"]
    assert not loose, f"these HF sources do not pin a full commit sha: {loose}"


def test_engine_kinds() -> None:
    kinds = {k: m.kind for k, m in discover_engines().items()}
    assert kinds == {"kokoro": "tts", "qwen3": "tts", "chatterbox": "tts", "asr": "stt",
                     "kitten": "tts", "pocket": "tts"}


# ─── current_variant_id recording (user-hit 2026-06-12) ────────────────
# Loading via the Voices ask-before-load path passes variant=None; the
# manager must record the RESOLVED default variant id, never None/"auto",
# or the Engines page can't tell which model row is loaded (both rows
# said "Load model" while the info box said loaded).


class _FakeResp:
    def __init__(self, payload):
        self.status_code = 200
        self._payload = payload
        self.text = ""

    def json(self):
        return self._payload


class _FakeSlot:
    def __init__(self, manifest, placement="gpu"):
        self.manifest = manifest
        self.placement = placement

    def spawn(self):
        pass

    def is_alive(self):
        return True

    def terminate(self):
        pass

    def post(self, path, json=None):
        return _FakeResp({"ok": True})

    def get(self, path):
        return _FakeResp({"voices": []})


class _FakeManifest:
    id = "fake-tts"
    kind = "tts"
    is_installed = True
    default_variant_id = "fake-default-v1"


def _fake_manager(monkeypatch):
    from justvoice.engines import manager as mgr_mod

    monkeypatch.setattr(mgr_mod, "_new_slot", _FakeSlot)
    monkeypatch.setattr(mgr_mod.EngineManager, "_resolve_device", lambda self, m, requested: "cpu")
    # Never a real model fetch from a test (a cold load downloads what it needs).
    monkeypatch.setattr(mgr_mod.EngineManager, "_ensure_variant_local",
                        lambda self, m, v, p, c: None)
    mgr = mgr_mod.EngineManager()
    mgr._manifests["fake-tts"] = _FakeManifest()
    return mgr


def test_load_without_variant_records_default(monkeypatch) -> None:
    mgr = _fake_manager(monkeypatch)
    mgr.load("fake-tts", device="auto")  # the voice_preview_api call shape
    assert mgr.current_variant_id("fake-tts") == "fake-default-v1"


def test_load_with_auto_variant_records_default(monkeypatch) -> None:
    mgr = _fake_manager(monkeypatch)
    mgr.load("fake-tts", device="auto", variant="auto")
    assert mgr.current_variant_id("fake-tts") == "fake-default-v1"


def test_load_with_explicit_variant_records_it(monkeypatch) -> None:
    mgr = _fake_manager(monkeypatch)
    mgr.load("fake-tts", device="auto", variant="fake-other-v2")
    assert mgr.current_variant_id("fake-tts") == "fake-other-v2"


@pytest.fixture
def app(tmp_path):
    from justvoice.app import create_app

    return create_app(data_dir=tmp_path)


def test_no_manifest_default_records_the_downloaded_variant(monkeypatch, app) -> None:
    """An engine with no DEFAULT_VARIANT_ID loads what is downloaded — the manager
    must record that variant, not "" (user-hit 2026-06-12: the Engines page could
    not highlight the loaded row after a restart). Qwen3 stands in, its default
    forced off."""
    from justvoice import speech_cache
    from justvoice.app_state import get_state

    mgr = _fake_manager(monkeypatch)
    fake = _FakeManifest()
    fake.id = "qwen3"  # real catalog id → real variant list
    fake.default_variant_id = None
    mgr._manifests["qwen3"] = fake
    vdir = speech_cache.variant_dir(get_state().data_dir, "qwen3", "qwen3-base-0.6b-q8")
    vdir.mkdir(parents=True)
    (vdir / "m.gguf").write_bytes(b"x")
    (vdir / speech_cache.MANIFEST_NAME).write_text(json.dumps(
        {"sources": [], "files": [{"path": "m.gguf", "size": 1, "oid": ""}]}), encoding="utf-8")
    mgr.load("qwen3", device="auto")
    assert mgr.current_variant_id("qwen3") == "qwen3-base-0.6b-q8"


def test_no_manifest_default_and_nothing_downloaded_takes_the_catalogs_first(monkeypatch, app) -> None:
    mgr = _fake_manager(monkeypatch)
    fake = _FakeManifest()
    fake.id = "qwen3"
    fake.default_variant_id = None
    mgr._manifests["qwen3"] = fake
    mgr.load("qwen3", device="auto")
    assert mgr.current_variant_id("qwen3") == models_for("qwen3")[0].id


def test_all_multi_variant_engines_resolve_a_real_variant() -> None:
    """Every discovered engine must resolve a non-empty, catalog-valid variant
    id for a no-variant load (the user's Set-as-default override is consulted
    first — absent here, so manifest order is what this pins)."""
    from justvoice.engines.manager import get_manager

    for engine_id, m in discover_engines().items():
        resolved = get_manager()._resolved_default_variant(m)
        catalog_ids = {v.id for v in models_for(engine_id)}
        if not catalog_ids:
            continue
        assert resolved in catalog_ids, f"{engine_id}: {resolved!r} not in {sorted(catalog_ids)}"


def test_already_loaded_reload_keeps_resolved_variant(monkeypatch) -> None:
    mgr = _fake_manager(monkeypatch)
    mgr.load("fake-tts", device="auto", variant="fake-other-v2")
    # Re-load with no variant (Voices preview path) must NOT clobber the
    # explicit variant back to default, and must never store None.
    mgr.load("fake-tts", device="auto")
    assert mgr.current_variant_id("fake-tts") == "fake-other-v2"
    mgr.load("fake-tts", device="auto", variant="fake-default-v1")
    assert mgr.current_variant_id("fake-tts") == "fake-default-v1"


def test_the_card_names_what_loaded_not_a_stale_request(monkeypatch) -> None:
    """A stored request can name a model the catalog no longer has (the
    dictation setting still saying "whisper-turbo" after the 2026-10-01 switch);
    the slot loads its default instead and says which — that is what the card
    must show."""
    from justvoice.engines import manager as mgr_mod

    class _ResolvingSlot(_FakeSlot):
        def post(self, path, json=None):
            return _FakeResp({"ok": True, "variant": "fake-default-v1"})

    mgr = _fake_manager(monkeypatch)
    monkeypatch.setattr(mgr_mod, "_new_slot", _ResolvingSlot)
    mgr.load("fake-tts", device="auto", variant="whisper-turbo")
    assert mgr.current_variant_id("fake-tts") == "fake-default-v1"
