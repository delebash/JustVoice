# SPDX-License-Identifier: MIT
"""Every declared knob must be a knob an adapter actually forwards.

The 2026-08-17 audit found 13 knobs declared in `capability_details` that no
engine adapter read, and 7 the adapters read that nothing declared. Both
directions are user-visible lies: a slider that moves nothing, or a control
that exists but cannot be reached. These tests pin the wiring so the two
files cannot drift apart again silently.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from justvoice.delivery_merge import nest_engine_keys
from justvoice.engines.capability_details import CAPABILITY_DETAILS, lookup
from justvoice.models import Delivery


ENGINES_DIR = Path(__file__).resolve().parents[1] / "justvoice" / "engines"

# Capability-map key → the adapter file that has to consume its knobs.
# Variant rows share their base engine's adapter.
ADAPTER_FOR = {
    "kokoro": "kokoro",
    "chatterbox": "chatterbox",
    "chatterbox-turbo": "chatterbox",
    "chatterbox-nano": "chatterbox",
    "chatterbox-multilingual": "chatterbox",
    "qwen3": "qwen3",
    # The qwen3 checkpoint families (2026-08-19) share the qwen3 adapter;
    # their rows differ in capability, not knobs.
    "qwen3-cv": "qwen3",
    "qwen3-base": "qwen3",
    "qwen3-vd": "qwen3",
    # The macOS MLX Base rows — full-id keys that pre-empt the suffix walk
    # to drop training (see the bottom of capability_details.py).
    "qwen3-base-1.7b-mlx": "qwen3",
    "qwen3-base-0.6b-mlx": "qwen3",
    "luxtts": "luxtts",
    "moss-tts": "moss_tts",
    "tada": "tada",
    # Alias rows for the two families whose variant ids diverge from their
    # engine id (see the bottom of capability_details.py). Same object, so
    # these re-check the same content — cheap, and it keeps the parametrised
    # tests total over CAPABILITY_DETAILS rather than a hand-kept subset.
    "moss-ttsd": "moss_tts",
}

# Knobs satisfied by a canonical Delivery field or by host-side handling
# rather than by an `engine_overrides.get(...)` read in the adapter.
HOST_HANDLED = {
    "seed",        # render_core resolves it; adapters call torch.manual_seed
    "speed",       # canonical Delivery field, read as delivery["speed"]
    "temperature",  # canonical Delivery field, adapters read it top-level
}


def _adapter_source(engine: str) -> str:
    path = ENGINES_DIR / engine / "engine.py"
    return path.read_text(encoding="utf-8") if path.is_file() else ""


@pytest.mark.parametrize("cap_id", sorted(CAPABILITY_DETAILS))
def test_every_declared_knob_is_read_by_its_adapter(cap_id: str) -> None:
    """No slider may exist that the engine never receives."""
    detail = CAPABILITY_DETAILS[cap_id]
    src = _adapter_source(ADAPTER_FOR[cap_id])
    assert src, f"no adapter source for {cap_id}"
    for knob in detail.knobs:
        if knob.key in HOST_HANDLED:
            continue
        assert re.search(rf'["\']{re.escape(knob.key)}["\']', src), (
            f"{cap_id}: knob {knob.key!r} is declared but "
            f"{ADAPTER_FOR[cap_id]}/engine.py never reads it"
        )


@pytest.mark.parametrize("engine", sorted(set(ADAPTER_FOR.values())))
def test_every_override_the_adapter_reads_is_declared(engine: str) -> None:
    """No engine control may exist that no UI can reach."""
    src = _adapter_source(engine)
    read = set(re.findall(r'engine_overrides\.get\(\s*["\'](\w+)["\']', src))
    declared: set[str] = set()
    for cap_id, adapter in ADAPTER_FOR.items():
        if adapter == engine:
            declared |= {k.key for k in CAPABILITY_DETAILS[cap_id].knobs}
    # Non-numeric overrides that ride the same subdict but cannot be KnobSpecs
    # (which are slider + number only), so they are surfaced another way:
    #   instruct — qwen3's textarea, gated by supports_instruct_freeform
    #   prefix_speaker_2 was dia2's second reference-clip PATH; it went with
    #     the engine on 2026-08-17.
    declared |= {"instruct"}
    missing = read - declared
    assert not missing, (
        f"{engine}/engine.py reads {sorted(missing)} from delivery.engine "
        f"but capability_details declares no knob for them — unreachable"
    )


def test_variant_lookup_walks_suffixes_not_just_the_base() -> None:
    """`chatterbox-turbo-v1` must reach Turbo's row, not the base engine's.

    The old `split("-")[0]` jumped straight to "chatterbox", which serves
    Multilingual's exaggeration / cfg_weight and hides Turbo's tags.
    """
    turbo = lookup("chatterbox-turbo-v1")
    assert turbo is not None and turbo.engine_id == "chatterbox-turbo"
    multi = lookup("chatterbox-multilingual-v2")
    assert multi is not None and multi.engine_id == "chatterbox-multilingual"
    # A bare engine id still resolves to itself.
    assert lookup("chatterbox").engine_id == "chatterbox"
    # An unrelated id with a tail falls through to nothing, not to a wrong row.
    assert lookup("totally-unknown-engine") is None


def test_every_manifest_variant_resolves_to_a_row() -> None:
    """A variant the catalog offers must reach a capability row.

    `GET /v1/engines/{variant_id}/capabilities` 404'd for `moss-ttsd-v0`
    because the family is named differently from its engine id and the
    suffix walk never reaches it.
    A 404 here means the Generate UI silently falls back to the engine's row —
    or to nothing.
    """
    import importlib

    unresolved = []
    for engine_dir in sorted(p.name for p in ENGINES_DIR.iterdir() if p.is_dir()):
        if engine_dir.startswith(".") or not (ENGINES_DIR / engine_dir / "manifest.py").is_file():
            continue
        mod = importlib.import_module(f"justvoice.engines.{engine_dir}.manifest")
        # Speech-to-text engines (whisper) have no TTS capability row by
        # design — nothing to tune, nothing to look up.
        if lookup(getattr(mod, "ID", engine_dir)) is None:
            continue
        for variant in getattr(mod, "VARIANTS", []) or []:
            vid = variant.get("id")
            if vid and lookup(vid) is None:
                unresolved.append(f"{engine_dir}:{vid}")
    assert not unresolved, (
        f"variant ids that reach no capability row: {unresolved} — add an alias "
        f"in capability_details.py or rename the variant"
    )


def test_the_divergent_family_aliases_point_at_the_right_engines() -> None:
    assert lookup("moss-ttsd-v0").engine_id == "moss-tts"


def test_nest_engine_keys_moves_private_knobs_under_engine() -> None:
    """Flat capability keys — the shape every UI saves — become nested."""
    out = nest_engine_keys(
        {"speed": 1.1, "gain_db": -2.0, "exaggeration": 0.7, "cfg_weight": 0.3}
    )
    assert out["speed"] == 1.1
    assert out["gain_db"] == -2.0
    assert out["engine"] == {"exaggeration": 0.7, "cfg_weight": 0.3}


def test_nest_engine_keys_keeps_an_explicit_nested_value() -> None:
    """A key written deliberately under `engine` beats the flat one."""
    out = nest_engine_keys({"exaggeration": 0.7, "engine": {"exaggeration": 0.2}})
    assert out["engine"]["exaggeration"] == 0.2


def test_nest_engine_keys_is_idempotent_and_empty_safe() -> None:
    once = nest_engine_keys({"exaggeration": 0.7, "speed": 1.0})
    assert nest_engine_keys(once) == once
    assert nest_engine_keys({}) == {}
    assert nest_engine_keys(None) == {}


def test_canonical_delivery_fields_are_never_nested() -> None:
    """Everything Delivery declares stays top-level, or engines lose it."""
    flat = {k: 1 for k in Delivery.model_fields if k != "engine"}
    out = nest_engine_keys(flat)
    assert "engine" not in out
    assert set(out) == set(flat)
