# SPDX-License-Identifier: MIT
"""Variant wiring contract — the audit found every engine ignored the
`variant` arg, making the Engines-tab model dropdown cosmetic. These tests
pin the catalog ids to the engine-side maps so the wiring can't silently
drift again. (Engines import torch lazily inside load(), so the modules
are importable without ML deps.)
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ENGINES = Path(__file__).resolve().parents[1] / "justvoice" / "engines"
# The plugin shim normally comes from the engine venv; point at the in-repo
# copy for direct imports.
PLUGIN_DIR = str(Path(__file__).resolve().parents[1] / "justvoice_plugin")


def _load_engine_module(name: str):
    """Import an engine.py outside the package (they self-insert the plugin
    shim path, mirroring how the subprocess runs them)."""
    if PLUGIN_DIR not in sys.path:
        sys.path.insert(0, PLUGIN_DIR)
    spec = importlib.util.spec_from_file_location(
        f"_audit_{name}", ENGINES / name / "engine.py"
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_qwen3_catalog_ids_match_engine_map() -> None:
    """models_for is OS-filtered (the -mlx rows are macOS-only), so the
    visible catalog is a SUBSET of the engine map — while the manifest's
    full row set must still equal the map exactly, or a row exists no OS
    can load (or a loadable variant no OS can see)."""
    from justvoice.engines.manager import discover_engines
    from justvoice.engines.model_catalog import models_for

    engine_mod = _load_engine_module("qwen3")
    catalog_ids = {v.id for v in models_for("qwen3")}
    assert catalog_ids <= set(engine_mod.QWEN_VARIANT_REPOS), (
        "qwen3 catalog shows a variant the engine cannot load"
    )
    all_ids = {r["id"] for r in discover_engines()["qwen3"].module.VARIANTS}
    assert all_ids == set(engine_mod.QWEN_VARIANT_REPOS), (
        "qwen3 manifest VARIANTS and engine QWEN_VARIANT_REPOS diverged"
    )
    assert engine_mod.DEFAULT_VARIANT in engine_mod.QWEN_VARIANT_REPOS


def test_qwen3_catalog_repos_match_engine_repos() -> None:
    from justvoice.engines.model_catalog import models_for

    engine_mod = _load_engine_module("qwen3")
    for v in models_for("qwen3"):
        expected = engine_mod.QWEN_VARIANT_REPOS[v.id]
        assert v.hf_repo == expected, (
            f"catalog variant {v.id} points at {v.hf_repo}, engine loads {expected}"
        )


def test_qwen3_mlx_rows_are_macos_gated() -> None:
    """The -mlx rows (mlx-community 8-bit exports via mlx-audio, 2026-08-19)
    exist only on macOS; the torch rows only on Windows/Linux. This pins
    both directions so a Mac never sees a CUDA checkpoint and this machine
    never offers an MLX one."""
    from justvoice.engines.manager import discover_engines

    for r in discover_engines()["qwen3"].module.VARIANTS:
        if r["id"].endswith("-mlx"):
            assert r["oses"] == ["macos"], r["id"]
            assert r["sources"][0]["hf_repo"].startswith("mlx-community/"), r["id"]
        else:
            assert r["oses"] == ["windows", "linux"], r["id"]


# ─── Qwen3 catalog FACTS (2026-08-15) ─────────────────────────────────
# The manifest claimed every Qwen variant clones and spoke 17 languages.
# Both were fiction: CustomVoice ships 9 preset timbres + the instruct field
# and cannot clone (model card), Base clones and has no presets, and the
# family speaks exactly 10 languages. The Cloning filter and the language
# chip read these fields, so pin them.

_QWEN_LANGS_10 = ["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"]


def test_qwen3_cloning_flag_is_per_checkpoint_family() -> None:
    from justvoice.engines.model_catalog import models_for

    by_id = {v.id: v for v in models_for("qwen3")}
    for cv in ("qwen3-cv-1.7b", "qwen3-cv-0.6b"):
        assert by_id[cv].voice_cloning is False, (
            f"{cv}: CustomVoice cannot clone — only the Base checkpoints do"
        )
        assert by_id[cv].preset_voices == 9
    for base in ("qwen3-base-1.7b", "qwen3-base-0.6b"):
        assert by_id[base].voice_cloning is True
        assert by_id[base].preset_voices == 0


def test_qwen3_languages_are_the_ten_supported() -> None:
    from justvoice.engines.model_catalog import models_for

    for v in models_for("qwen3"):
        assert v.languages == _QWEN_LANGS_10, f"{v.id} language list drifted"


def test_qwen3_manifest_languages_match_the_engine_lang_map() -> None:
    """The manifest and the engine's BCP-47 → Qwen language-name map are two
    copies of one fact. When they disagree the catalog offers a language the
    engine silently sends as "auto"."""
    from justvoice.engines.model_catalog import models_for

    engine_mod = _load_engine_module("qwen3")
    assert set(models_for("qwen3")[0].languages) == set(engine_mod._LANG_NAME)


def test_qwen3_voice_design_claim_is_backed() -> None:
    """The engine may claim voice_design ONLY while something real backs it.

    Until 2026-08-19 this test asserted the opposite (`is False`), because
    the flag had been claimed with no checkpoint and no design call behind
    it — the catalog's design filter listed qwen3 with nothing there. The
    VoiceDesign variant + generate_voice_design branch shipped; the claim
    is true again, and this pins the PAIRING so the flag can never outlive
    its backing a second time.
    """
    from justvoice.engines.manager import discover_engines
    from justvoice.engines.model_catalog import models_for

    m = discover_engines()["qwen3"]
    assert m.capabilities.get("voice_design") is True
    # 1) A design-capable variant row exists in the catalog…
    design_variants = [v for v in models_for("qwen3") if getattr(v, "voice_design", False)]
    assert design_variants, "voice_design claimed but no variant row backs it"
    # 2) …its id reaches the adapter's repo map…
    engine_mod = _load_engine_module("qwen3")
    for v in design_variants:
        assert v.id in engine_mod.QWEN_VARIANT_REPOS
    # 3) …and the adapter actually has the design call.
    src = (Path(engine_mod.__file__)).read_text(encoding="utf-8")
    assert "generate_voice_design" in src


def test_chatterbox_catalog_has_only_verified_variants() -> None:
    from justvoice.engines.model_catalog import models_for

    ids = {v.id for v in models_for("chatterbox")}
    # v2 + turbo were the 0.1.7-loadable set; v3 + nano arrived with the
    # move to upstream master @ 5de7a54 (2026-08-19), whose loaders map
    # them. ("chatterbox-original-v1" was an unverified placeholder
    # removed by the parity audit.)
    assert ids == {
        "chatterbox-multilingual-v2", "chatterbox-multilingual-v3",
        "chatterbox-turbo-v1", "chatterbox-nano-v1",
    }
    repos = {v.hf_repo for v in models_for("chatterbox")}
    assert repos == {
        "ResembleAI/chatterbox", "ResembleAI/chatterbox-turbo",
        "ResembleAI/chatterbox-nano",
    }


def test_chatterbox_variants_pin_the_weights_the_pinned_lib_loads() -> None:
    """Each catalog row must name exactly the t3 its loader opens.

    Until 2026-08-19 this asserted v2-only, because PyPI 0.1.7's from_local
    could not open the v3 weight and a v3 row would have downloaded 2 GB
    the engine could not read. The install then moved to upstream master
    @ 5de7a54, whose MULTILINGUAL_T3_MODELS maps v2 AND v3 and whose Turbo
    class takes nano=True — so the rule generalises: row ↔ loader, one t3
    per row, and the INSTALL step must actually pin that master SHA."""
    import importlib

    from justvoice.engines.model_catalog import sources_for

    def files_of(variant):
        return {f for s in sources_for("chatterbox", variant)
                for f in s.get("files", [])}

    v2 = files_of("chatterbox-multilingual-v2")
    assert "t3_mtl23ls_v2.safetensors" in v2 and not any("v3" in f for f in v2)
    v3 = files_of("chatterbox-multilingual-v3")
    assert "t3_mtl23ls_v3.safetensors" in v3 and not any(
        f == "t3_mtl23ls_v2.safetensors" for f in v3)
    nano = files_of("chatterbox-nano-v1")
    assert "t3_nano_v1.safetensors" in nano

    # The rows above are only loadable because the install pins master.
    man = importlib.import_module("justvoice.engines.chatterbox.manifest")
    git_steps = [s for s in man.INSTALL
                 if s.get("kind") == "pip-git" and "resemble-ai/chatterbox" in s.get("url", "")]
    assert git_steps and git_steps[0].get("ref", "").startswith("5de7a54")
    assert git_steps[0].get("no_deps") is True


def test_cloning_claims_are_wired_in_the_adapter() -> None:
    """A manifest that claims `voice_cloning` must have an adapter that
    actually reads the reference clip.

    Dia claimed it for months while its adapter built the processor input
    from text alone: every cloned voice pointed at Dia rendered in the
    stock voice with nothing said (engine dropped 2026-08-17; the check it
    motivated stays). The check is textual on
    purpose — it needs no ML deps and it fails on the exact thing that went
    wrong, an adapter that never looks at `audio_prompt_path`.
    """
    for manifest_path in sorted(ENGINES.glob("*/manifest.py")):
        src = manifest_path.read_text(encoding="utf-8")
        claims = '"voice_cloning": True' in src
        if not claims:
            continue
        engine_src = (manifest_path.parent / "engine.py").read_text(encoding="utf-8")
        body = "\n".join(
            ln for ln in engine_src.splitlines() if not ln.lstrip().startswith("#")
        )
        assert "req.audio_prompt_path" in body, (
            f"{manifest_path.parent.name}: manifest claims voice_cloning but "
            f"engine.py never reads req.audio_prompt_path"
        )


def test_manifest_default_variants_exist_in_catalog() -> None:
    """Every manifest DEFAULT_VARIANT_ID must be a real catalog variant."""
    from justvoice.engines.manager import discover_engines
    from justvoice.engines.model_catalog import models_for

    # IMPORT the manifests rather than slicing the file text: qwen3's
    # default is a platform conditional, and the old line-parse swallowed
    # the whole expression as the "value" (found 2026-08-21). The imported
    # attribute is the real default this machine would use.
    for engine_id, manifest in sorted(discover_engines().items()):
        default = getattr(manifest.module, "DEFAULT_VARIANT_ID", None)
        if default is None:
            continue
        catalog_ids = {v.id for v in models_for(engine_id)}
        assert default in catalog_ids, (
            f"{engine_id}: DEFAULT_VARIANT_ID {default!r} "
            f"not in catalog {sorted(catalog_ids)}"
        )


def test_whisper_catalog_ids_match_engine_map() -> None:
    from justvoice.engines.model_catalog import models_for

    engine_mod = _load_engine_module("whisper")
    catalog_ids = {v.id for v in models_for("whisper")}
    assert catalog_ids == set(engine_mod.WHISPER_VARIANT_REPOS)
    for v in models_for("whisper"):
        assert v.hf_repo == engine_mod.WHISPER_VARIANT_REPOS[v.id]
    assert engine_mod.DEFAULT_VARIANT in engine_mod.WHISPER_VARIANT_REPOS


def test_hf_sources_pin_a_commit_not_a_branch() -> None:
    """Every variant row carries byte-exact sizes and a file list. Those are
    facts about a COMMIT. `"revision": "main"` names a moving target, so
    upstream can re-upload weights under the same filenames and the next
    machine to install fetches different bytes with nothing to notice it.

    Deprecated engines are exempt: they are hidden, never offered, and frozen
    at whatever they last declared (2026-08-22). Un-deprecating one means
    pinning it — run server/scripts/harvest_revisions.py.
    """
    import re

    from justvoice.engines.manager import discover_engines

    loose: list[str] = []
    for eid, m in discover_engines().items():
        if (m.deprecated or "").strip():
            continue
        for variant in getattr(m.module, "VARIANTS", []) or []:
            for src in variant.get("sources") or []:
                if not src.get("hf_repo"):
                    continue  # URL sources (kokoro) are pinned by the URL
                rev = str(src.get("revision") or "")
                if not re.fullmatch(r"[0-9a-f]{40}", rev):
                    loose.append(f"{eid}/{variant.get('id')}: {rev!r}")
    assert not loose, (
        "these HF sources do not pin a full commit sha: "
        f"{loose}. Harvest with server/scripts/harvest_revisions.py."
    )


def test_new_engine_kinds_discovered() -> None:
    from justvoice.engines.manager import discover_engines

    kinds = {k: m.kind for k, m in discover_engines().items()}
    assert kinds.get("whisper") == "stt"
    # The qwen3-llm engine died with F1 Phase 2 — the shared stack's bundled
    # runner is THE local LLM; no "llm"-kind managed engine remains.
    assert "qwen3-llm" not in kinds


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


class _FakeProc:
    def __init__(self, manifest):
        self.manifest = manifest

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
    isolation = "venv"
    is_installed = True
    default_variant_id = "fake-default-v1"


def _fake_manager(monkeypatch):
    from justvoice.engines import manager as mgr_mod

    monkeypatch.setattr(mgr_mod, "EngineProcess", _FakeProc)
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


def test_load_no_manifest_default_records_on_disk_variant(monkeypatch, tmp_path) -> None:
    """An engine with no DEFAULT_VARIANT_ID loads whatever is on disk —
    the manager must record the on-disk variant, not "" (user-hit round 2:
    the first fix recorded empty for kokoro, so the Engines page STILL
    couldn't highlight the loaded row after a restart).

    (Kokoro declares a default since the 2026-08-19 runtime swap, so this
    pins the no-default behaviour with its default forced off.)"""
    mgr = _fake_manager(monkeypatch)
    fake = _FakeManifest()
    fake.id = "kokoro"  # real catalog id → real variant list
    fake.default_variant_id = None
    fake.models_dir = tmp_path
    (tmp_path / "kokoro-v1.0-int8").mkdir()
    (tmp_path / "kokoro-v1.0-int8" / "kokoro-v1.0.int8.onnx").write_bytes(b"x")
    mgr._manifests["kokoro"] = fake
    mgr.load("kokoro", device="auto")
    assert mgr.current_variant_id("kokoro") == "kokoro-v1.0-int8"


def test_load_no_manifest_default_no_disk_falls_back_to_catalog_first(
    monkeypatch, tmp_path
) -> None:
    mgr = _fake_manager(monkeypatch)
    fake = _FakeManifest()
    fake.id = "kokoro"
    fake.default_variant_id = None
    fake.models_dir = tmp_path  # empty — nothing on disk
    mgr._manifests["kokoro"] = fake
    mgr.load("kokoro", device="auto")
    assert mgr.current_variant_id("kokoro") == "kokoro-v1.0"


def test_all_multi_variant_engines_resolve_a_real_variant() -> None:
    """Every discovered engine must resolve a non-empty, catalog-valid
    variant id for a no-variant load — pins luxtts/moss-tts/tada's
    new DEFAULT_VARIANT_IDs and kokoro's disk-probe fallback.

    (Instance call since the parity batch: resolution now consults the user's
    Set-as-default override first — absent here, so manifest order is what
    this pins.)"""
    from justvoice.engines.manager import get_manager, discover_engines
    from justvoice.engines.model_catalog import models_for

    for engine_id, m in discover_engines().items():
        resolved = get_manager()._resolved_default_variant(m)
        catalog_ids = {v.id for v in models_for(engine_id)}
        if not catalog_ids:
            continue
        assert resolved in catalog_ids, (
            f"{engine_id}: no-variant load resolves to {resolved!r}, "
            f"not in catalog {sorted(catalog_ids)}"
        )


def test_already_loaded_reload_keeps_resolved_variant(monkeypatch) -> None:
    mgr = _fake_manager(monkeypatch)
    mgr.load("fake-tts", device="auto", variant="fake-other-v2")
    # Re-load with no variant (Voices preview path) must NOT clobber the
    # explicit variant back to default, and must never store None.
    mgr.load("fake-tts", device="auto")
    assert mgr.current_variant_id("fake-tts") == "fake-other-v2"
    mgr.load("fake-tts", device="auto", variant="fake-default-v1")
    assert mgr.current_variant_id("fake-tts") == "fake-default-v1"
