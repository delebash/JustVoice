"""Chatterbox engine plugin — Resemble AI multilingual TTS via chatterbox-tts.

Adapter for `chatterbox-tts`. It runs in its own venv, built to exactly what
`manifest.py` declares — upstream's `transformers==5.2.0` included — with the
family torch pin rather than the `torch==2.6.0` its metadata asks for. The
manifest's module docstring has the reasoning.
"""
