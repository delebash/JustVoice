# SPDX-License-Identifier: MIT
"""The Python half of compare-pure.mjs: run JustVoice's pure functions over the cases the
JavaScript generated and dump every answer.   python compare-pure.py <in.json> <out.json>"""

from __future__ import annotations

import difflib
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

from justvoice import captions, delivery, delivery_merge, inline_tags, pronunciation  # noqa: E402
from justvoice.alignment import align_known_text  # noqa: E402
from justvoice.cache import CacheKeyBuilder  # noqa: E402

cases = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
out = {}

out["difflib"] = []
for c in cases["difflib"]:
    sm = difflib.SequenceMatcher(None, c["a"], c["b"], autojunk=c["autojunk"])
    out["difflib"].append({
        "blocks": [list(m) for m in sm.get_matching_blocks()],
        "opcodes": [list(o) for o in sm.get_opcodes()],
        "ratio": sm.ratio(), "quick": sm.quick_ratio(), "real_quick": sm.real_quick_ratio(),
    })

out["align"] = [align_known_text(c["text"], c["hyp"], total_duration=c["total"]) for c in cases["align"]]
out["scan"] = [pronunciation.scan_names([(t, frozenset(cov)) for t, cov in c]) for c in cases["scan"]]
out["captions"] = [[captions.to_vtt(w), captions.to_srt(w), captions.group_cues(w)] for w in cases["captions"]]
out["strip"] = [inline_tags.strip(t, set(k) if k is not None else None) for t, k in cases["strip"]]
out["parse"] = [
    [[type(tok).__name__, *(vars(tok).values())] for tok in inline_tags.parse(t)] for t in cases["parse"]
]
out["canonical"] = [delivery.canonical_json(d) for d in cases["canonical"]]
out["merge"] = [delivery_merge.merge_delivery(r, p) for r, p in cases["merge"]]
out["nest"] = [delivery_merge.nest_engine_keys(d) for d in cases["nest"]]
out["compose"] = [delivery_merge.compose_instruct(*h) for h in cases["compose"]]
out["cachekey"] = [
    CacheKeyBuilder().with_engine(k[0], k[1]).with_voice(k[2]).with_text(k[3]).with_language(k[4])
    .with_seed(k[5]).with_delivery_json(k[6]).with_effects_chain(k[7]).finish()
    for k in cases["cachekey"]
]
Path(sys.argv[2]).write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
