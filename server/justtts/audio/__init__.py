"""Audio utilities — WAV parsing, loudness math, A/B comparison.

The pure-Python equivalent of the Rust ``audio_analyzer`` module.
Uses numpy where it speeds things up; falls back to stdlib otherwise.
"""
