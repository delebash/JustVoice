# SPDX-License-Identifier: MIT
"""Dump every pydantic model in justvoice.models as a structural signature (field order,
type, constraints, default, extra policy) — the Python half of compare-models.mjs."""

from __future__ import annotations

import datetime
import json
import sys
import types
import typing

import annotated_types
from pydantic import BaseModel
from pydantic_core import to_jsonable_python

sys.stdout.reconfigure(encoding="utf-8")

import justvoice.models as M  # noqa: E402


def sig(ann) -> str:
    origin = typing.get_origin(ann)
    args = typing.get_args(ann)
    if ann is typing.Any:
        return "any"
    if ann is int:
        return "int"
    if ann is float:
        return "float"
    if ann is str:
        return "str"
    if ann is bool:
        return "bool"
    if ann is type(None):
        return "null"
    if ann is datetime.datetime:
        return "datetime"
    if ann is dict:
        return "dict[any]"
    if ann is list:
        return "list[any]"
    if origin is typing.Literal:
        return "lit(" + ",".join(json.dumps(a) for a in args) + ")"
    if origin in (typing.Union, types.UnionType):
        return "|".join(sig(a) for a in args)
    if origin is list:
        return f"list[{sig(args[0])}]"
    if origin is dict:
        return f"dict[{sig(args[1])}]"
    if isinstance(ann, type) and issubclass(ann, BaseModel):
        return model_sig(ann)
    return f"?{ann!r}"


def model_sig(cls) -> str:
    extra = cls.model_config.get("extra")
    fields = []
    for name, f in cls.model_fields.items():
        fields.append(field_sig(name, f))
    return ("strict" if extra == "forbid" else "") + "{" + ";".join(fields) + "}"


def field_sig(name, f) -> str:
    cons = []
    for m in f.metadata:
        for attr, label in (("ge", "ge"), ("le", "le"), ("gt", "gt"), ("lt", "lt"), ("min_length", "minlen"), ("max_length", "maxlen")):
            v = getattr(m, attr, None)
            if v is not None and isinstance(m, (annotated_types.BaseMetadata,)) or (v is not None and hasattr(m, attr)):
                if v is not None:
                    cons.append(f"{label}={v!r}")
    # constraints inside an Optional[...] annotation (Field on X | None applies to X)
    s = f"{name}:{sig(f.annotation)}"
    if cons:
        s += "[" + ",".join(sorted(set(cons))) + "]"
    if f.is_required():
        s += "!"
    return s


out = {}
for name in dir(M):
    obj = getattr(M, name)
    if isinstance(obj, type) and issubclass(obj, BaseModel) and obj is not BaseModel:
        defaults = {}
        for fname, f in obj.model_fields.items():
            if not f.is_required():
                d = f.get_default(call_default_factory=True)
                defaults[fname] = to_jsonable_python(d)
        out[name] = {"sig": model_sig(obj), "defaults": defaults}
out["__EMOTION_VALUES__"] = M.EMOTION_VALUES
print(json.dumps(out, ensure_ascii=False))
