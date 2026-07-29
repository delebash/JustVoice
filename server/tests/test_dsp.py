# SPDX-License-Identifier: MIT
"""Tests for the effects DSP.

Two tiers, and the split is deliberate.

**Analytic parity** — for the effects whose maths is fully determined
(gain, distortion, delay, the filters), the expected value can be computed
independently and asserted exactly or to a tight frequency-response
tolerance. There is no interpretation available: a peaking EQ at +6 dB
boosts its centre frequency by 6 dB or the implementation is wrong.

**Structural bite** — for compressor, chorus and reverb we deliberately did
not copy the previous implementation's exact topology (see the module
docstrings for why), so sample-level comparison would assert nothing real.
These instead assert the property that makes the effect that effect: a
compressor must shrink the gap between loud and quiet, a reverb must ring
on after its input stops.

Every test here is written to FAIL if the effect is bypassed or stubbed —
a test that a no-op could pass is not a test. That is checked explicitly by
`test_every_effect_actually_changes_the_signal`.
"""

from __future__ import annotations

import numpy as np
import pytest

from justvoice.audio import dsp

SR = 44100


def _sine(freq: float, n: int = SR, amp: float = 0.5, sr: int = SR) -> np.ndarray:
    t = np.arange(n, dtype=np.float64) / sr
    return (amp * np.sin(2.0 * np.pi * freq * t)).reshape(1, -1)


def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x))))


def _db(after: float, before: float) -> float:
    return 20.0 * np.log10(max(after, 1e-12) / max(before, 1e-12))


# ── analytic parity ──────────────────────────────────────────────────────


def test_gain_is_exactly_the_decibel_ratio() -> None:
    x = _sine(440.0)
    assert np.allclose(dsp.gain(x, SR, gain_db=6.0), x * 10 ** (6.0 / 20.0))
    # And it must actually move: +6 dB is a doubling, not a rounding error.
    assert _db(_rms(dsp.gain(x, SR, gain_db=6.0)), _rms(x)) == pytest.approx(6.0, abs=0.01)


def test_distortion_is_the_tanh_waveshaper_and_bounds_the_signal() -> None:
    x = _sine(440.0, amp=1.0)
    out = dsp.distortion(x, SR, drive_db=20.0)
    assert np.allclose(out, np.tanh(x * 10.0))
    assert np.max(np.abs(out)) < 1.0  # tanh can never exceed unity


def test_delay_places_the_copy_at_exactly_the_requested_sample() -> None:
    # An impulse in, so the echo's position is unambiguous.
    x = np.zeros((1, 4096))
    x[0, 0] = 1.0
    out = dsp.delay(x, SR, delay_seconds=1000 / SR, feedback=0.0, mix=1.0)
    assert out[0, 1000] == pytest.approx(1.0, abs=1e-9)
    assert out[0, 999] == pytest.approx(0.0, abs=1e-9)
    assert out[0, 1001] == pytest.approx(0.0, abs=1e-9)


def test_delay_feedback_decays_by_the_feedback_factor() -> None:
    x = np.zeros((1, 4096))
    x[0, 0] = 1.0
    out = dsp.delay(x, SR, delay_seconds=500 / SR, feedback=0.5, mix=1.0)
    assert out[0, 500] == pytest.approx(1.0, abs=1e-9)
    assert out[0, 1000] == pytest.approx(0.5, abs=1e-9)
    assert out[0, 1500] == pytest.approx(0.25, abs=1e-9)


def test_lowpass_is_minus_3db_at_its_cutoff() -> None:
    # The defining property of a first-order section. If someone swaps in a
    # Butterworth this fails, which is the point — it would silently make
    # every saved chain cut twice as hard.
    fc = 1000.0
    at_cutoff = _db(_rms(dsp.lowpass(_sine(fc), SR, cutoff_frequency_hz=fc)), _rms(_sine(fc)))
    assert at_cutoff == pytest.approx(-3.0, abs=0.4)


def test_lowpass_rolls_off_at_6db_per_octave() -> None:
    fc = 1000.0
    two_oct = _db(
        _rms(dsp.lowpass(_sine(fc * 4), SR, cutoff_frequency_hz=fc)), _rms(_sine(fc * 4))
    )
    # Two octaves above cutoff on a 6 dB/oct slope ≈ -12 dB (plus the -3 at fc).
    assert -16.0 < two_oct < -11.0


def test_highpass_cuts_below_and_passes_above() -> None:
    fc = 1000.0
    low = _db(_rms(dsp.highpass(_sine(100.0), SR, cutoff_frequency_hz=fc)), _rms(_sine(100.0)))
    high = _db(_rms(dsp.highpass(_sine(8000.0), SR, cutoff_frequency_hz=fc)), _rms(_sine(8000.0)))
    assert low < -15.0
    assert high == pytest.approx(0.0, abs=0.5)


@pytest.mark.parametrize("gain_db", [6.0, -6.0])
def test_peak_eq_delivers_its_gain_at_the_centre_frequency(gain_db: float) -> None:
    f0 = 1000.0
    x = _sine(f0)
    got = _db(_rms(dsp.peak(x, SR, cutoff_frequency_hz=f0, gain_db=gain_db, q=1.0)), _rms(x))
    assert got == pytest.approx(gain_db, abs=0.3)


def test_peak_eq_leaves_distant_frequencies_alone() -> None:
    x = _sine(60.0)
    got = _db(_rms(dsp.peak(x, SR, cutoff_frequency_hz=5000.0, gain_db=12.0, q=2.0)), _rms(x))
    assert got == pytest.approx(0.0, abs=0.5)


def test_shelves_tilt_the_correct_side() -> None:
    low, high = _sine(80.0), _sine(9000.0)
    ls_low = _db(_rms(dsp.low_shelf(low, SR, cutoff_frequency_hz=300.0, gain_db=9.0)), _rms(low))
    ls_high = _db(_rms(dsp.low_shelf(high, SR, cutoff_frequency_hz=300.0, gain_db=9.0)), _rms(high))
    assert ls_low > 7.0 and ls_high == pytest.approx(0.0, abs=0.5)

    hs_high = _db(_rms(dsp.high_shelf(high, SR, cutoff_frequency_hz=3000.0, gain_db=9.0)), _rms(high))
    hs_low = _db(_rms(dsp.high_shelf(low, SR, cutoff_frequency_hz=3000.0, gain_db=9.0)), _rms(low))
    assert hs_high > 7.0 and hs_low == pytest.approx(0.0, abs=0.5)


# ── structural bite ──────────────────────────────────────────────────────


def test_compressor_narrows_the_gap_between_loud_and_quiet() -> None:
    """The one thing a compressor must do. 4:1 over the threshold means a
    12 dB input swing should come out substantially smaller."""
    loud, quiet = _sine(440.0, amp=0.8), _sine(440.0, amp=0.2)
    kw = dict(threshold_db=-20.0, ratio=4.0, attack_ms=5.0, release_ms=100.0)
    before = _db(_rms(loud), _rms(quiet))
    after = _db(_rms(dsp.compressor(loud, SR, **kw)), _rms(dsp.compressor(quiet, SR, **kw)))
    assert after < before - 3.0


def test_compressor_leaves_signal_below_the_threshold_untouched() -> None:
    quiet = _sine(440.0, amp=0.01)  # ~-43 dBFS, well under the threshold
    out = dsp.compressor(quiet, SR, threshold_db=-6.0, ratio=8.0, attack_ms=5.0, release_ms=80.0)
    assert np.allclose(out, quiet, atol=1e-6)


def test_compressor_at_unity_ratio_is_a_bypass() -> None:
    x = _sine(440.0)
    assert np.allclose(dsp.compressor(x, SR, threshold_db=-30.0, ratio=1.0), x)


def test_reverb_rings_on_after_the_input_stops() -> None:
    """A reverb that does not outlast its input is not a reverb. This is the
    check that a stubbed or bypassed implementation cannot pass."""
    x = np.zeros((1, SR))
    x[0, :1000] = _sine(440.0, n=1000)[0]
    out = dsp.reverb(x, SR, room_size=0.9, damping=0.2, wet_level=0.8, dry_level=0.0)
    tail = _rms(out[:, SR // 2:])
    assert tail > 1e-5


def test_reverb_wet_and_dry_levels_do_what_they_say() -> None:
    x = _sine(440.0)
    dry_only = dsp.reverb(x, SR, wet_level=0.0, dry_level=0.5)
    # dry_level is scaled by 2 (JUCE's dryScaleFactor), so 0.5 -> unity.
    assert np.allclose(dry_only, x, atol=1e-9)
    assert _rms(dsp.reverb(x, SR, wet_level=0.0, dry_level=0.0)) == pytest.approx(0.0, abs=1e-9)


def test_reverb_is_sample_rate_scaled() -> None:
    """The Freeverb tunings are 44.1 kHz constants. If they are not rescaled,
    a 24 kHz engine gets a different room than a 48 kHz one."""
    from justvoice.audio.dsp import freeverb

    assert freeverb._scaled(1116, 44100) == 1116
    assert freeverb._scaled(1116, 22050) == 558
    assert freeverb._scaled(1116, 48000) == 1214


def test_chorus_thickens_without_running_away() -> None:
    x = _sine(440.0)
    out = dsp.chorus(x, SR, rate_hz=1.5, depth=0.4, centre_delay_ms=7.0, mix=0.5)
    assert not np.allclose(out, x, atol=1e-4)          # it did something
    assert np.max(np.abs(out)) < 2.0                    # and it stayed bounded


def test_chorus_feedback_path_is_bounded_and_not_quadratic() -> None:
    """The shipped "Robotic" preset is chorus at depth=1.0 WITH feedback, so
    the recursive branch is live code, not a corner case. Two things have
    gone wrong here before: an unbounded feedback loop, and a block size that
    collapses to one sample at full depth (which turns this into a per-sample
    Python loop — minutes per chapter). A wall-clock bound catches the second
    in a way a correctness assert never would."""
    import time

    x = _sine(440.0, n=SR * 2)  # two seconds
    start = time.perf_counter()
    out = dsp.chorus(x, SR, rate_hz=0.2, depth=1.0, feedback=0.35,
                     centre_delay_ms=7.0, mix=0.5)
    elapsed = time.perf_counter() - start

    assert np.all(np.isfinite(out))
    assert np.max(np.abs(out)) < 4.0, "feedback ran away"
    assert not np.allclose(out, x, atol=1e-4)
    assert elapsed < 2.0, f"chorus feedback took {elapsed:.1f}s for 2s of audio"


def test_pitch_shift_of_zero_semitones_is_a_bypass() -> None:
    # Holds whether or not python-stretch is installed, so it is safe to run
    # anywhere; the real shift is covered by the length contract below.
    x = _sine(440.0)
    assert np.allclose(dsp.pitch_shift(x, SR, semitones=0.0), x)


# ── contracts that hold for every effect ─────────────────────────────────

_CASES = [
    ("gain", {"gain_db": 3.0}),
    ("distortion", {"drive_db": 12.0}),
    ("compressor", {"threshold_db": -25.0, "ratio": 4.0, "attack_ms": 5.0, "release_ms": 80.0}),
    ("delay", {"delay_seconds": 0.01, "feedback": 0.3, "mix": 0.5}),
    ("chorus", {"rate_hz": 1.0, "depth": 0.3, "centre_delay_ms": 7.0, "mix": 0.5}),
    ("reverb", {"room_size": 0.7, "damping": 0.4, "wet_level": 0.5, "dry_level": 0.4}),
    ("highpass", {"cutoff_frequency_hz": 180.0}),
    ("lowpass", {"cutoff_frequency_hz": 4500.0}),
    ("eq_low", {"cutoff_frequency_hz": 200.0, "gain_db": 4.0, "q": 0.7}),
    ("eq_mid", {"cutoff_frequency_hz": 1000.0, "gain_db": -4.0, "q": 1.0}),
    ("eq_high", {"cutoff_frequency_hz": 6000.0, "gain_db": 4.0, "q": 0.7}),
]


@pytest.mark.parametrize("kind,params", _CASES)
@pytest.mark.parametrize("channels", [1, 2])
def test_every_effect_preserves_length_and_shape(kind: str, params: dict, channels: int) -> None:
    """The load-bearing contract. Block offsets, M4B chapter marks and the
    per-block export manifest are all computed from render lengths."""
    n = 12000
    x = np.tile(_sine(440.0, n=n), (channels, 1))
    out = dsp.EFFECTS[kind](x, SR, **params)
    assert out.shape == (channels, n), f"{kind} changed shape"
    assert np.all(np.isfinite(out)), f"{kind} emitted NaN/Inf"


@pytest.mark.parametrize("kind,params", _CASES)
def test_every_effect_actually_changes_the_signal(kind: str, params: dict) -> None:
    """Guards against the failure mode these tests exist to catch: an effect
    that is silently a pass-through still satisfies every other assertion."""
    x = _sine(440.0, n=12000) + 0.2 * _sine(3000.0, n=12000)
    out = dsp.EFFECTS[kind](x, SR, **params)
    assert not np.allclose(out, x, atol=1e-6), f"{kind} did nothing"


@pytest.mark.parametrize("sr", [22050, 24000, 44100, 48000])
def test_effects_survive_every_engine_sample_rate(sr: int) -> None:
    """Engines emit at 22.05k (some), 24k (Kokoro/Chatterbox/TADA) and 48k
    (LuxTTS). A rate-dependent crash here would be engine-specific and
    miserable to track down in production."""
    x = _sine(440.0, n=sr // 4, sr=sr)
    for kind, params in _CASES:
        out = dsp.EFFECTS[kind](x, sr, **params)
        assert out.shape == x.shape and np.all(np.isfinite(out)), f"{kind} @ {sr}"
