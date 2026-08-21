# SPDX-License-Identifier: MIT
"""Voice bundles — a voice travels as one file (C4, 2026-08-21 go).

A bundle is a ZIP holding `voice.json` (the record's portable facts) and
the reference clip when the voice has one. What travels is what the voice
IS on its engine:

  * cloned / imported — the reference clip; re-clones on any
    cloning-capable engine, so the bundle carries its engine as the
    DEFAULT, not a prison.
  * designed — the description; renders on any voice-design engine.
  * blended — the mixed vector (kokoro-space numbers): meaningful only on
    the engine that mixed it, and the import refuses any other.
  * lora / preset — NOT bundled: an adapter already travels as
    `/v1/train/{job}/adapter.zip` with its own contract, and a preset
    ships with its engine — there is nothing of yours to carry.

Pure logic over a voices-store-shaped object — the API route stays thin
and the round-trip pins run against a fake store.
"""

from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime, timezone

from .models import BlendRecipe, VoiceRecord

FORMAT = "justvoice-voice-bundle/1"

_BUNDLEABLE = {"cloned", "designed", "imported", "blended"}
_MAX_BUNDLE_BYTES = 500 * 1024 * 1024  # a ref clip is capped far below this


def build_bundle(voices_store, voice_id: str) -> tuple[bytes, str]:
    """(zip bytes, suggested filename). Raises LookupError / ValueError
    with the user-facing reason."""
    rec = voices_store.get(voice_id)
    if rec is None:
        raise LookupError(f"voice '{voice_id}' not found")
    if rec.source not in _BUNDLEABLE:
        if rec.source == "lora":
            raise ValueError(
                "a LoRA voice travels as its adapter — use the adapter "
                "download on the LoRA tab instead"
            )
        raise ValueError("preset voices ship with their engine — nothing to export")

    manifest = {
        "format": FORMAT,
        "engine": rec.engine,
        "source": rec.source,
        "name": rec.name,
        "language": rec.language,
        "gender": rec.gender,
        "design_prompt": rec.design_prompt,
        "transcript": rec.transcript,
        "embedding": rec.embedding,
        "blend_recipe": rec.blend_recipe.model_dump() if rec.blend_recipe else None,
    }

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("voice.json", json.dumps(manifest, indent=2, ensure_ascii=False))
        ref = voices_store.ref_wav_path(voice_id)
        if ref.is_file():
            z.writestr("ref.wav", ref.read_bytes())

    safe = "".join(c if c.isalnum() or c in "-_ " else "_" for c in rec.name).strip() or voice_id
    return buf.getvalue(), f"{safe}.jvvoice.zip"


def import_bundle(voices_store, payload: bytes, *, known_engines: set[str]) -> VoiceRecord:
    """Recreate the voice from a bundle. Raises ValueError with the reason
    on anything unusable — a half-imported voice is worse than a refusal."""
    if len(payload) > _MAX_BUNDLE_BYTES:
        raise ValueError("bundle is larger than the 500 MB limit")
    try:
        z = zipfile.ZipFile(io.BytesIO(payload))
    except zipfile.BadZipFile:
        raise ValueError("that file is not a voice bundle (not a ZIP)")

    names = {n.split("/")[-1]: n for n in z.namelist()}
    if "voice.json" not in names:
        raise ValueError("no voice.json in the bundle — not a JustVoice voice export")
    try:
        m = json.loads(z.read(names["voice.json"]).decode("utf-8"))
    except ValueError:
        raise ValueError("the bundle's voice.json is not valid JSON")
    if m.get("format") != FORMAT:
        raise ValueError(
            f"unrecognised bundle format {m.get('format')!r} — this build "
            f"reads {FORMAT}"
        )

    source = m.get("source")
    if source not in _BUNDLEABLE:
        raise ValueError(f"bundles cannot carry a {source!r} voice")
    engine = (m.get("engine") or "").strip()
    if engine not in known_engines:
        raise ValueError(
            f"this voice belongs to engine '{engine}', which this install "
            f"doesn't have — install it first, then import again"
        )
    ref = z.read(names["ref.wav"]) if "ref.wav" in names else None
    if source in ("cloned", "imported") and not ref:
        raise ValueError("this voice is made of a reference clip, but the bundle has none")
    if source == "designed" and not (m.get("design_prompt") or "").strip():
        raise ValueError("a designed voice needs its description, and the bundle has none")
    if source == "blended" and not m.get("embedding"):
        raise ValueError("a blended voice needs its mixed vector, and the bundle has none")

    now = datetime.now(timezone.utc)
    rec = VoiceRecord(
        id="",
        engine=engine,
        source=source,
        name=m.get("name") or "Imported voice",
        language=m.get("language") or "en-US",
        gender=m.get("gender"),
        design_prompt=m.get("design_prompt"),
        transcript=m.get("transcript"),
        embedding=m.get("embedding"),
        blend_recipe=BlendRecipe(**m["blend_recipe"]) if m.get("blend_recipe") else None,
        created_at=now,
        updated_at=now,
    )
    created = voices_store.create(rec)
    if ref:
        voices_store.write_ref_wav(created.id, ref)
    return created
