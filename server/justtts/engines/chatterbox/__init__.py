"""Chatterbox engine plugin — Resemble AI multilingual TTS via chatterbox-tts.

Adapter ported from voicebox's `backends/chatterbox_backend.py`. Subprocess
venv isolates chatterbox-tts's pinned torch==2.6.0 / transformers==5.2.0
constraints from other engines.
"""
