# SPDX-License-Identifier: MIT
"""The Python half of compare-dsp.mjs — audio/dsp_client against the same audiocpp_dsp.

    python compare-dsp.py <dir>

Reads <dir>/spec.json (the operations, written by the JS side) and the input files it names
under <dir>/in, runs each operation through justvoice.audio.dsp_client, and writes each result
to <dir>/py/<n>.bin (bytes) or <dir>/py/<n>.json (a dict / list / number). JUSTVOICE_DSP_EXE
names the program (set by the caller).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")


def main(base: str) -> None:
    from justvoice.audio import dsp_client
    from justvoice.audio.analyzer import analyze, compare, noise_margin_db

    d = Path(base)
    spec = json.loads((d / "spec.json").read_text(encoding="utf-8"))
    out = d / "py"
    out.mkdir(exist_ok=True)

    def inp(name: str) -> bytes:
        return (d / "in" / name).read_bytes()

    for i, op in enumerate(spec):
        kind, a = op["op"], op.get("args", {})
        if kind == "shape":
            res = dsp_client.shape(inp(a["pcm"]), a["rate"], a["channels"], stretch_factor=a.get("stretch_factor"),
                                   gain_db=a.get("gain_db", 0.0), pitch_semitones=a.get("pitch_semitones", 0.0),
                                   effects=a.get("effects"))
        elif kind == "apply_effects":
            res = dsp_client.apply_effects(inp(a["wav"]), a["chain"])
        elif kind == "join":
            res = dsp_client.join([(inp(p), r, c) for p, r, c in a["pieces"]], a["crossfade_ms"])
        elif kind == "stream_join":
            outs, tail = [], None
            names = a["pieces"]
            for k, name in enumerate(names):
                piece, tail = dsp_client.stream_join(inp(name), tail, last=k == len(names) - 1,
                                                     crossfade_ms=a["crossfade_ms"])
                outs.append(piece)
                if tail is not None:
                    outs.append(tail)
            res = b"".join(outs)
        elif kind == "fit":
            res = dsp_client.fit(inp(a["pcm"]), a["rate"], a["channels"], a["to_rate"], a["to_channels"],
                                 trim_below_dbfs=a.get("trim_below_dbfs"), trim_keep_ms=a["trim_keep_ms"])
        elif kind == "aligner_input":
            res = dsp_client.aligner_input(inp(a["wav"]), a["rate"])
        elif kind == "loudness":
            res = {k: (None if v == float("-inf") else v) for k, v in dsp_client.loudness(inp(a["wav"])).items()}
        elif kind == "sample_diff":
            res = dsp_client.sample_diff(inp(a["a"]), inp(a["b"]))
        elif kind == "noise_margin":
            res = dsp_client.noise_margin(inp(a["wav"]))
        elif kind == "noise_margin_db":
            res = noise_margin_db(inp(a["pcm"]), a["rate"], a["channels"])
        elif kind == "vectors_mean":
            res = dsp_client.vectors_mean([inp(v) for v in a["vectors"]])
        elif kind == "vectors_blend":
            res = dsp_client.vectors_blend([inp(v) for v in a["vectors"]], a["weights"], a["normalize"])
        elif kind == "vectors_recombine":
            res = dsp_client.vectors_recombine([inp(v) for v in a["vectors"]], [tuple(s) for s in a["segments"]],
                                               a["features"])
        elif kind == "f32_roundtrip":
            res = dsp_client.f32_bytes(dsp_client.f32_list(inp(a["vector"])))
        elif kind == "analyze":
            res = analyze(inp(a["wav"])).model_dump()
            res["loudness"] = {k: (None if v == float("-inf") else v) for k, v in res["loudness"].items()}
        elif kind == "compare":
            res = compare(inp(a["a"]), inp(a["b"])).model_dump()
            for side in ("a", "b"):
                res[side]["loudness"] = {k: (None if v == float("-inf") else v) for k, v in res[side]["loudness"].items()}
        else:
            raise SystemExit(f"unknown op {kind}")
        if isinstance(res, (bytes, bytearray)):
            (out / f"{i}.bin").write_bytes(res)
        else:
            (out / f"{i}.json").write_text(json.dumps(res), encoding="utf-8")
    dsp_client.stop()


if __name__ == "__main__":
    main(*sys.argv[1:])
