"""Kokoro — 82M preset-voice TTS, run by the audio.cpp speech runtime.

The host imports `manifest.py` for discovery and the catalog; `voices.py` is the
preset voice list. The model itself runs in the shared runtime
(`engines/audiocpp/`) since the 2026-10-01 switch.
"""
