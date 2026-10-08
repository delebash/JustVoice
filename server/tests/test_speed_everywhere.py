# SPDX-License-Identifier: MIT
"""Speed on every engine — switch plan §5, gap 8
(docs/plans/2026-10-02-gap-8-speed.md).

Kokoro and KittenTTS pace themselves. Every other engine renders at its own
pace and the server time-stretches the finished line. Generate goes through
the chapter render's own function, so its Speed, Pitch and Gain — none of
which reached the audio there until 2026-10-02 — sound the same from both.
"""

from __future__ import annotations

from types import SimpleNamespace

import math
from array import array

import pytest
from fastapi.testclient import TestClient

import justvoice.engines.manager as manager_module
from justvoice.app import create_app
from justvoice.audio import dsp_client
from justvoice.audio.effects import apply_effects_chain, effects_chain_hash
from justvoice.audio.wav import parse_wav_header, write_wav_container
from justvoice.cache import CacheKeyBuilder, pack_pcm_with_format
from justvoice.delivery import canonical_json
from justvoice.engines.external_openai import ExternalOpenAiTtsBackend
from justvoice.engines.registry import EngineRegistry
from justvoice.render_core import apply_line_delivery, probe_line_cached, render_line, speed_native
from justvoice.version import VERSION

SR = 16000
N = SR  # one second


def _tone_pcm(n: int = N, amp: float = 0.3, channels: int = 1) -> bytes:
    return array("h", [int(amp * math.sin(2 * math.pi * 220.0 * (i // channels) / SR) * 32767)
                       for i in range(n * channels)]).tobytes()


TONE = _tone_pcm()


def _rms(pcm: bytes) -> float:
    s = array("h", pcm)
    return math.sqrt(sum(v * v for v in s) / len(s))


# ── the stretch itself (in audiocpp_dsp since 2026-10-07) ───────────────


@pytest.mark.parametrize("factor", [0.8, 1.25, 2.0])
def test_the_stretch_is_n_over_factor_long(factor: float) -> None:
    assert len(dsp_client.shape(TONE, SR, 1, stretch_factor=factor)) // 2 == round(N / factor)


def test_a_speed_outside_the_range_is_clamped_to_it() -> None:
    silence = b"\x00\x00" * N
    assert len(dsp_client.shape(silence, SR, 1, stretch_factor=3.0)) // 2 == N // 2
    assert len(dsp_client.shape(silence, SR, 1, stretch_factor=0.25)) // 2 == N * 2


def test_a_speed_of_one_never_reaches_the_stretch_and_stereo_keeps_both_channels() -> None:
    assert apply_line_delivery(TONE, SR, 1, {"speed": 1.0}, speed_native=False) == TONE
    stereo = _tone_pcm(channels=2)
    assert len(dsp_client.shape(stereo, SR, 2, stretch_factor=1.25)) // 4 == round(N / 1.25)


def test_the_stretch_is_not_an_effect() -> None:
    """Effects promise the length they were given; a stretch cannot — a chain entry naming
    it is skipped like any unknown effect."""
    wav = write_wav_container(TONE, SR, 1)
    assert apply_effects_chain(wav, [{"type": "time_stretch", "params": {"factor": 2.0}}]) == wav


# ── which engines pace themselves ───────────────────────────────────────


def test_kokoro_and_kitten_pace_themselves_and_the_rest_do_not() -> None:
    st = SimpleNamespace(engines=EngineRegistry())
    assert speed_native(st, "kokoro") and speed_native(st, "kitten")
    for engine_id in ("qwen3", "chatterbox", "pocket", "an-engine-with-no-row"):
        assert not speed_native(st, engine_id), engine_id


def test_the_openai_compatible_provider_paces_itself() -> None:
    registry = EngineRegistry()
    registry.register(ExternalOpenAiTtsBackend(
        id="oai", name="OAI", base_url="http://127.0.0.1:1", api_key=None, model="m", voices=["v"],
    ))
    assert speed_native(SimpleNamespace(engines=registry), "oai")


# ── a chapter line ──────────────────────────────────────────────────────


class _Cache:
    def __init__(self):
        self.d = {}

    def has(self, scope, key):
        return (scope, key) in self.d

    def get(self, scope, key):
        return self.d.get((scope, key))

    def put(self, scope, key, data):
        self.d[(scope, key)] = data


class _Manifest:
    def __init__(self, engine_id, voice_id):
        self.id = engine_id
        self.kind = "tts"
        self.capabilities = {"paralinguistic_tags": False}
        self.static_voices = [{"id": voice_id, "name": voice_id}]


class _Manager:
    """One engine without its own speed (mock-tts) and Kokoro. Both return
    one second of tone whatever they are asked — the server's stretch is
    the only thing that can change the length."""

    def __init__(self, current: str = "mock-tts"):
        self._m = {"mock-tts": _Manifest("mock-tts", "mv_1"), "kokoro": _Manifest("kokoro", "af_heart")}
        self._voice = {"mock-tts": "mv_1", "kokoro": "af_heart"}
        self.synths = []
        self.current = {"tts": current}

    def get_manifest(self, engine_id):
        return self._m.get(engine_id)

    def manifests(self):
        return dict(self._m)

    def current_for(self, kind):
        return self.current.get(kind)

    def current_id(self):
        return self.current.get("tts")

    def voices(self, engine_id):
        return [{"id": self._voice[engine_id], "name": "V"}]

    def load(self, engine_id, device="auto", **kw):
        self.current["tts"] = engine_id
        return {}

    def synth(self, engine_id, body):
        self.synths.append((engine_id, dict(body)))
        return TONE, {"sample_rate": SR, "channels": 1, "is_wav_container": False}


@pytest.fixture()
def mgr(monkeypatch):
    m = _Manager()
    monkeypatch.setattr(manager_module, "get_manager", lambda: m)
    return m


def _state(cache):
    settings = SimpleNamespace(
        limits=SimpleNamespace(text_max_chars=5000),
        cache=SimpleNamespace(enabled=True),
        generation=SimpleNamespace(max_chunk_chars=800, crossfade_ms=50),
    )
    st = SimpleNamespace(
        settings=SimpleNamespace(get=lambda: settings),
        engines=EngineRegistry(),
        voices=SimpleNamespace(get=lambda vid: None),
        lexicons=SimpleNamespace(get=lambda lid: None),
    )
    st._render_cache = cache
    return st


def _pre_gap_8_key(engine_id: str, voice: str, delivery: dict) -> str:
    """The key a line had before gap 8 — the delivery hashed as it stood."""
    return (
        CacheKeyBuilder()
        .with_engine(engine_id, VERSION)
        .with_voice(voice)
        .with_text("Hi")
        .with_language(None)
        .with_seed(None)
        .with_delivery_json(canonical_json(delivery))
        .with_effects_chain(effects_chain_hash([]))
        .finish()
    )


def test_a_line_on_an_engine_without_speed_is_stretched(mgr):
    st = _state(_Cache())
    dry = render_line(st, voice="mv_1", text="Hi", cache_scope="s")
    slow = render_line(st, voice="mv_1", text="Hi", delivery={"speed": 0.5}, cache_scope="s")
    assert len(dry.pcm) // 2 == N
    assert len(slow.pcm) // 2 == 2 * N


def test_a_kokoro_line_is_paced_by_the_model_not_stretched(mgr):
    st = _state(_Cache())
    fast = render_line(st, voice="af_heart", text="Hi", delivery={"speed": 1.25}, cache_scope="s")
    assert len(fast.pcm) // 2 == N, "the server stretched a line the model already paced"
    assert mgr.synths[-1][1]["delivery"]["speed"] == 1.25


def test_a_line_cached_while_speed_was_ignored_renders_again(mgr):
    cache = _Cache()
    st = _state(cache)
    cache.put("s", _pre_gap_8_key("mock-tts", "mv_1", {"speed": 1.25}), pack_pcm_with_format(TONE, SR, 1))
    line = render_line(st, voice="mv_1", text="Hi", delivery={"speed": 1.25}, cache_scope="s")
    assert len(mgr.synths) == 1, "the unstretched entry from before gap 8 was served"
    assert len(line.pcm) // 2 == round(N / 1.25)
    # The new entry is the one the probe reports and the next render serves.
    assert probe_line_cached(st, "mv_1", "Hi", delivery={"speed": 1.25}, cache_scope="s") is True
    render_line(st, voice="mv_1", text="Hi", delivery={"speed": 1.25}, cache_scope="s")
    assert len(mgr.synths) == 1


def test_kokoro_lines_and_lines_at_their_own_pace_keep_their_cache_entries(mgr):
    cache = _Cache()
    st = _state(cache)
    cache.put("s", _pre_gap_8_key("kokoro", "af_heart", {"speed": 1.25}), pack_pcm_with_format(TONE, SR, 1))
    cache.put("s", _pre_gap_8_key("mock-tts", "mv_1", {"speed": 1.0}), pack_pcm_with_format(TONE, SR, 1))
    render_line(st, voice="af_heart", text="Hi", delivery={"speed": 1.25}, cache_scope="s")
    render_line(st, voice="mv_1", text="Hi", delivery={"speed": 1.0}, cache_scope="s")
    assert mgr.synths == []


# ── what the server does to a finished line ─────────────────────────────


def test_gain_and_pitch_reach_the_audio_and_keep_its_length() -> None:
    louder = apply_line_delivery(TONE, SR, 1, {"gain_db": 6.0}, speed_native=False)
    assert len(louder) == len(TONE)
    assert _rms(louder) / _rms(TONE) == pytest.approx(10 ** (6 / 20), rel=0.01)
    higher = apply_line_delivery(TONE, SR, 1, {"pitch": 3}, speed_native=False)
    assert len(higher) == len(TONE) and higher != TONE


def test_a_speed_the_model_took_is_not_applied_twice() -> None:
    assert apply_line_delivery(TONE, SR, 1, {"speed": 1.5}, speed_native=True) == TONE


# ── Generate ────────────────────────────────────────────────────────────


class _NowScheduler:
    def submit(self, specs, interactive=False):
        result = specs[0][1]()
        return SimpleNamespace(
            items=[SimpleNamespace(result=result, error=None)],
            wait_async=_no_wait, raise_if_failed=lambda: None,
        )


async def _no_wait():
    return None


@pytest.fixture()
def gen(monkeypatch, mgr):
    import justvoice.synth_scheduler as scheduler_module
    from justvoice.api import generate_api

    monkeypatch.setattr(generate_api, "get_manager", lambda: mgr)
    monkeypatch.setattr(scheduler_module, "get_scheduler", lambda: _NowScheduler())
    return mgr


@pytest.fixture()
def client(tmp_path):
    return TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)


def _generate(client, voice: str, delivery: dict) -> tuple[int, bytes]:
    r = client.post("/v1/generate", json={"voice": voice, "text": "Hi.", "delivery": delivery})
    assert r.status_code == 200, r.text
    fmt, offset, size = parse_wav_header(r.content)
    return fmt.sample_count, r.content[offset:offset + size]


def test_generate_stretches_a_line_on_an_engine_without_speed(client, gen):
    samples, _ = _generate(client, "mv_1", {"speed": 0.5})
    assert samples == 2 * N


def test_generate_leaves_kokoros_pacing_to_kokoro(client, gen):
    gen.current["tts"] = "kokoro"
    samples, _ = _generate(client, "af_heart", {"speed": 1.25})
    assert samples == N
    assert gen.synths[-1][1]["delivery"]["speed"] == 1.25


def test_generate_applies_gain_and_pitch(client, gen):
    _, louder = _generate(client, "mv_1", {"gain_db": 6.0})
    assert _rms(louder) / _rms(TONE) == pytest.approx(10 ** (6 / 20), rel=0.01)
    _, higher = _generate(client, "mv_1", {"pitch": 3})
    assert len(higher) == len(TONE) and higher != TONE
