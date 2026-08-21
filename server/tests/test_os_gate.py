# SPDX-License-Identifier: MIT
"""The OS gate must be declared honestly and must actually fire.

The 2026-08-17 audit found the gate inert in every case:

  * `shared_venv.py:199` held the only `supports_current_os()` call, and it
    sat behind `if m.isolation != "shared": continue` — so it could never
    reach MOSS-TTSD or (then) Dia — the ONLY engines that declared one.
  * Every engine it did evaluate declared all three OSes and passed.
  * Three TTS engines (luxtts, qwen3, tada) plus whisper declared nothing at
    all and inherited the manager's all-three default. qwen3's inherited
    claim included macOS while its REQUIREMENTS said `cuda` only.
  * `manager.supported_oses`'s docstring promised a catalog filter by
    `sys.platform`. No such filter existed.
  * `engines_api` served `supported_oses` to the client and no UI read it.

These tests pin both halves of the fix: every manifest declares explicitly,
and `install_engine()` refuses regardless of isolation mode.
"""

from __future__ import annotations

import pytest

from justvoice.engines import manager as mgr_mod
from justvoice.engines.manager import InstallError, discover_engines


VALID_OS_LABELS = {"windows", "linux", "macos"}


def _manifests():
    return sorted(discover_engines().items())


# ── The declarations ──────────────────────────────────────────────────────


@pytest.mark.parametrize("engine_id", [eid for eid, _ in _manifests()])
def test_every_manifest_declares_supported_oses_explicitly(engine_id):
    """No engine may rely on the all-three default.

    The default still exists (a third-party plugin manifest should not hard
    fail for omitting it), but nothing WE ship may lean on it — an inherited
    platform claim is a claim nobody made, which is exactly how qwen3 came to
    advertise macOS support for a CUDA-only engine.
    """
    m = discover_engines()[engine_id]
    assert hasattr(m.module, "SUPPORTED_OSES"), (
        f"{engine_id}/manifest.py does not declare SUPPORTED_OSES, so it "
        f"inherits {m.supported_oses!r} by default. Declare it explicitly and "
        f"record the grounds in a comment — see qwen3/manifest.py."
    )


@pytest.mark.parametrize("engine_id", [eid for eid, _ in _manifests()])
def test_declared_oses_are_valid_and_sane(engine_id):
    m = discover_engines()[engine_id]
    declared = m.supported_oses
    assert declared, f"{engine_id} declares an empty SUPPORTED_OSES"
    unknown = set(declared) - VALID_OS_LABELS
    assert not unknown, (
        f"{engine_id} declares unknown OS label(s) {sorted(unknown)}; "
        f"valid labels are {sorted(VALID_OS_LABELS)}. `_current_os_label()` "
        f"only ever returns one of those three, so an unknown value can never "
        f"match and silently blocks the engine everywhere."
    )
    assert len(set(declared)) == len(declared), f"{engine_id} repeats an OS label"


@pytest.mark.parametrize("engine_id", [eid for eid, _ in _manifests()])
def test_supports_current_os_agrees_with_the_declaration(engine_id):
    m = discover_engines()[engine_id]
    expected = mgr_mod._current_os_label() in m.supported_oses
    assert m.supports_current_os() is expected


def test_the_restricted_engine_still_restricts():
    """Regression pin for the engine the old gate could not reach.

    MOSS-TTSD is `ISOLATION = "venv"`, which is precisely why the
    shared-venv check skipped it. If it ever silently gains macOS, the
    flash-attn reasoning in its manifest has been lost. (Dia was the other
    one; the engine was dropped 2026-08-17.)
    """
    manifests = discover_engines()
    for engine_id in ("moss-tts",):
        assert "macos" not in manifests[engine_id].supported_oses, (
            f"{engine_id} now claims macOS. Its manifest excluded macOS for a "
            f"recorded reason; if that changed, update the reason too."
        )
        assert manifests[engine_id].isolation == "venv", (
            f"{engine_id} is no longer venv-isolated — re-check that the OS "
            f"gate in install_engine still covers it."
        )  # since 2026-08-22 this holds for every engine, which is the point


# ── The gate ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize("engine_id", ["moss-tts", "tada"])
def test_install_engine_refuses_an_unsupported_os(engine_id, monkeypatch):
    """The gate fires before any install work, for every engine.

    It used to matter that these two were `venv` while others were `shared`:
    the OLD gate lived in the shared-venv builder and could not see them. The
    gate has sat above the install split since 2026-08-17 and there is no
    split left to sit above, but the case is kept — both engines exclude
    macOS, so a regression here has something real to fail on. qwen3 LEFT
    this list 2026-08-21: it genuinely supports macOS now (the MLX arm), so
    refusing it on a Mac would pin a stale fact.
    """
    monkeypatch.setattr(mgr_mod, "_current_os_label", lambda: "macos")
    m = discover_engines()[engine_id]
    assert not m.supports_current_os()

    with pytest.raises(InstallError) as excinfo:
        mgr_mod.install_engine(m)

    msg = str(excinfo.value)
    assert engine_id in msg
    assert "macos" in msg
    # The message names what IS supported, so the user can act on it.
    for declared in m.supported_oses:
        assert declared in msg


def test_the_gate_runs_before_any_install_work(monkeypatch):
    """Refusal must happen before the install path is entered.

    Guards against a future refactor that moves the check down into the
    installer — the exact shape of the original bug, where the only OS check
    sat inside the shared-venv builder and never saw these two engines.
    """
    called: list[str] = []
    monkeypatch.setattr(mgr_mod, "_current_os_label", lambda: "macos")
    monkeypatch.setattr(
        mgr_mod, "_install_engine_isolated",
        lambda *a, **k: called.append("isolated"),
    )

    # tada (venv) + moss-tts (venv) — the two that still exclude macOS.
    for engine_id in ("tada", "moss-tts"):
        with pytest.raises(InstallError):
            mgr_mod.install_engine(discover_engines()[engine_id])

    assert called == [], f"install work ran despite the OS gate: {called}"


def test_a_supported_os_passes_the_gate(monkeypatch):
    """The gate must not block the happy path.

    Kokoro declares all three OSes, so it passes whatever the host claims to
    be, and the install runs. There is one install arm to stub: since
    2026-08-22 every engine builds its own venv, so the shared arm this test
    used to also stub no longer exists.
    """
    called: list[str] = []
    monkeypatch.setattr(mgr_mod, "_current_os_label", lambda: "macos")
    monkeypatch.setattr(
        mgr_mod, "_install_engine_isolated",
        lambda *a, **k: called.append("isolated"),
    )

    mgr_mod.install_engine(discover_engines()["kokoro"])
    assert called == ["isolated"]


# ── The wire ──────────────────────────────────────────────────────────────


def test_the_catalog_serves_the_verdict_not_just_the_list():
    """`supported_on_this_os` must reach the client.

    The renderer must never re-derive this: it can be a browser on a
    different machine than the server, so only the server knows the platform
    the engine would actually install on.
    """
    from fastapi.testclient import TestClient

    from justvoice.app import create_app

    with TestClient(create_app()) as client:
        body = client.get("/v1/engines").json()

    managed = {e["id"]: e for e in body["engines"] if e.get("supported_oses")}
    assert managed, "no engine served a supported_oses list"

    manifests = discover_engines()
    for engine_id, served in managed.items():
        assert "supported_on_this_os" in served, (
            f"{engine_id} served supported_oses without the verdict"
        )
        assert served["supported_on_this_os"] is manifests[engine_id].supports_current_os()
