# SPDX-License-Identifier: GPL-3.0-or-later
#
# Adapted from voicebox (MIT) — backend/backends/qwen_llm_backend.py
# PyTorchQwenLLMBackend at the commit pinned in voicebox-pin.txt,
# restructured for JustVoice's venv-subprocess engine protocol. Original
# copyright (c) the voicebox authors.
"""Qwen3 local LLM engine subprocess.

Single-turn chat completions via transformers. Mirrors upstream's recipe:
chat template with enable_thinking=False, few-shot examples as real chat
turns (small models echo inline system-prompt examples; structured turns
generalize), sampling only when temperature > 0, decode new tokens only.
"""

from __future__ import annotations

import sys as _sys
from pathlib import Path as _P

_sys.path.insert(0, str(_P(__file__).resolve().parent))

import logging

from justvoice_plugin import (
    EmbeddedEngine,
    EngineMeta,
    PresetVoice,
    SynthRequest,
    SynthOutput,
    serve,
)

log = logging.getLogger("justvoice.engines.qwen3_llm")

QWEN_LLM_VARIANT_REPOS = {
    "qwen3-llm-0.6b": "Qwen/Qwen3-0.6B",
    "qwen3-llm-1.7b": "Qwen/Qwen3-1.7B",
    "qwen3-llm-4b": "Qwen/Qwen3-4B",
}
DEFAULT_VARIANT = "qwen3-llm-0.6b"


def _build_messages(
    prompt: str,
    system: str | None,
    examples: list[tuple[str, str]] | None = None,
) -> list[dict]:
    messages: list[dict] = []
    if system:
        messages.append({"role": "system", "content": system})
    for user_text, assistant_text in examples or []:
        messages.append({"role": "user", "content": user_text})
        messages.append({"role": "assistant", "content": assistant_text})
    messages.append({"role": "user", "content": prompt})
    return messages


class Qwen3LLM(EmbeddedEngine):
    meta = EngineMeta(
        engine_id="qwen3-llm",
        display_name="Qwen3 LLM (local)",
        backend="pytorch",
    )

    def __init__(self, model_dir=None):
        super().__init__(model_dir)
        self.model = None
        self.tokenizer = None
        self._device = None
        self._variant = None

    def load(self, device: str = "auto", variant: str | None = None) -> None:
        if variant and variant not in QWEN_LLM_VARIANT_REPOS:
            raise RuntimeError(
                f"qwen3-llm: unknown variant {variant!r}; valid: {sorted(QWEN_LLM_VARIANT_REPOS)}"
            )
        if self.model is not None:
            if variant and variant != self._variant:
                self.unload()
            else:
                return
        device = self.pick_device(device)
        self._device = device
        self._variant = variant or DEFAULT_VARIANT
        repo = QWEN_LLM_VARIANT_REPOS[self._variant]
        log.info("loading Qwen3 LLM %s (%s) on %s …", self._variant, repo, device)

        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self.tokenizer = AutoTokenizer.from_pretrained(repo)
        dtype = torch.float16 if device in ("cuda", "mps") else torch.float32
        self.model = AutoModelForCausalLM.from_pretrained(repo, dtype=dtype)
        self.model.to(device)
        self.model.eval()
        log.info("Qwen3 LLM %s loaded on %s", self._variant, device)

    def unload(self) -> None:
        if self.model is None:
            return
        import torch

        del self.model
        del self.tokenizer
        self.model = None
        self.tokenizer = None
        if self._device == "cuda" and torch.cuda.is_available():
            torch.cuda.empty_cache()
        self._device = None

    def voices(self) -> list[PresetVoice]:
        return []

    def synth(self, req: SynthRequest) -> SynthOutput:
        raise RuntimeError("qwen3-llm is an LLM engine — use /chat, not /synth")

    def chat(
        self,
        prompt: str,
        system: str | None = None,
        max_tokens: int = 512,
        temperature: float = 0.7,
        examples: list[tuple[str, str]] | None = None,
    ) -> str:
        if self.model is None:
            raise RuntimeError("qwen3-llm: engine not loaded — call /load first")

        import torch

        messages = _build_messages(prompt, system, examples)
        text = self.tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=False,
        )
        inputs = self.tokenizer(text, return_tensors="pt").to(self._device)

        do_sample = temperature > 0
        generate_kwargs = {
            "max_new_tokens": max_tokens,
            "do_sample": do_sample,
            "pad_token_id": self.tokenizer.eos_token_id,
        }
        if do_sample:
            generate_kwargs["temperature"] = temperature
            generate_kwargs["top_p"] = 0.9

        with torch.no_grad():
            output_ids = self.model.generate(**inputs, **generate_kwargs)

        input_len = inputs["input_ids"].shape[1]
        new_tokens = output_ids[0, input_len:]
        return self.tokenizer.decode(new_tokens, skip_special_tokens=True).strip()


if __name__ == "__main__":
    serve(Qwen3LLM())
