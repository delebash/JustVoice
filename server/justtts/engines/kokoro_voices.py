"""Kokoro's 54-voice preset catalog + speaker_id lookup.

Mirrors the Rust ``engines::kokoro_voices``. Voice ids follow k2-fsa's
naming: `<lang><gender>_<name>` — e.g. af_heart, am_michael, bf_emma.
Speaker id is the 0-based index into this list (matches the .voices
file's tensor ordering).
"""

from __future__ import annotations

from .base import PresetVoice


def _v(id: str, name: str, language: str, gender: str | None = None) -> PresetVoice:
    return PresetVoice(id=id, name=name, language=language, gender=gender)


# 54 voices, sourced from k2-fsa's voices.bin in the Kokoro multilingual model.
# Order matches the .bin tensor stack; sid = position in this list.
_VOICES: list[PresetVoice] = [
    _v("af_alloy", "Alloy", "en-US", "female"),
    _v("af_aoede", "Aoede", "en-US", "female"),
    _v("af_bella", "Bella", "en-US", "female"),
    _v("af_heart", "Heart", "en-US", "female"),
    _v("af_jessica", "Jessica", "en-US", "female"),
    _v("af_kore", "Kore", "en-US", "female"),
    _v("af_nicole", "Nicole", "en-US", "female"),
    _v("af_nova", "Nova", "en-US", "female"),
    _v("af_river", "River", "en-US", "female"),
    _v("af_sarah", "Sarah", "en-US", "female"),
    _v("af_sky", "Sky", "en-US", "female"),
    _v("am_adam", "Adam", "en-US", "male"),
    _v("am_echo", "Echo", "en-US", "male"),
    _v("am_eric", "Eric", "en-US", "male"),
    _v("am_fenrir", "Fenrir", "en-US", "male"),
    _v("am_liam", "Liam", "en-US", "male"),
    _v("am_michael", "Michael", "en-US", "male"),
    _v("am_onyx", "Onyx", "en-US", "male"),
    _v("am_puck", "Puck", "en-US", "male"),
    _v("am_santa", "Santa", "en-US", "male"),
    _v("bf_alice", "Alice (UK)", "en-GB", "female"),
    _v("bf_emma", "Emma (UK)", "en-GB", "female"),
    _v("bf_isabella", "Isabella (UK)", "en-GB", "female"),
    _v("bf_lily", "Lily (UK)", "en-GB", "female"),
    _v("bm_daniel", "Daniel (UK)", "en-GB", "male"),
    _v("bm_fable", "Fable (UK)", "en-GB", "male"),
    _v("bm_george", "George (UK)", "en-GB", "male"),
    _v("bm_lewis", "Lewis (UK)", "en-GB", "male"),
    _v("ef_dora", "Dora (Spanish)", "es", "female"),
    _v("em_alex", "Alex (Spanish)", "es", "male"),
    _v("em_santa", "Santa (Spanish)", "es", "male"),
    _v("ff_siwis", "Siwis (French)", "fr", "female"),
    _v("hf_alpha", "Alpha (Hindi)", "hi", "female"),
    _v("hf_beta", "Beta (Hindi)", "hi", "female"),
    _v("hm_omega", "Omega (Hindi)", "hi", "male"),
    _v("hm_psi", "Psi (Hindi)", "hi", "male"),
    _v("if_sara", "Sara (Italian)", "it", "female"),
    _v("im_nicola", "Nicola (Italian)", "it", "male"),
    _v("jf_alpha", "Alpha (Japanese)", "ja", "female"),
    _v("jf_gongitsune", "Gongitsune (Japanese)", "ja", "female"),
    _v("jf_nezumi", "Nezumi (Japanese)", "ja", "female"),
    _v("jf_tebukuro", "Tebukuro (Japanese)", "ja", "female"),
    _v("jm_kumo", "Kumo (Japanese)", "ja", "male"),
    _v("pf_dora", "Dora (Portuguese)", "pt-BR", "female"),
    _v("pm_alex", "Alex (Portuguese)", "pt-BR", "male"),
    _v("pm_santa", "Santa (Portuguese)", "pt-BR", "male"),
    _v("zf_xiaobei", "Xiaobei (Mandarin)", "zh", "female"),
    _v("zf_xiaoni", "Xiaoni (Mandarin)", "zh", "female"),
    _v("zf_xiaoxiao", "Xiaoxiao (Mandarin)", "zh", "female"),
    _v("zf_xiaoyi", "Xiaoyi (Mandarin)", "zh", "female"),
    _v("zm_yunjian", "Yunjian (Mandarin)", "zh", "male"),
    _v("zm_yunxi", "Yunxi (Mandarin)", "zh", "male"),
    _v("zm_yunxia", "Yunxia (Mandarin)", "zh", "male"),
    _v("zm_yunyang", "Yunyang (Mandarin)", "zh", "male"),
]

_VOICE_INDEX: dict[str, int] = {v.id: i for i, v in enumerate(_VOICES)}


def preset_voices() -> list[PresetVoice]:
    return list(_VOICES)


def speaker_id_for(voice_id: str) -> int | None:
    return _VOICE_INDEX.get(voice_id)
