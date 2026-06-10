"""POST /v1/analyze + /v1/compare — WAV format + loudness + A/B."""

from __future__ import annotations

import base64

from fastapi import APIRouter

from ..audio.analyzer import analyze, compare
from ..errors import bad_request
from ..models import AnalyzeRequest, AudioAnalysis, CompareRequest, ComparisonReport

router = APIRouter(tags=["compare"])


@router.post("/v1/analyze", response_model=AudioAnalysis)
async def analyze_endpoint(req: AnalyzeRequest) -> AudioAnalysis:
    try:
        bytes_ = base64.b64decode(req.wav_b64)
    except Exception as e:
        raise bad_request(f"invalid base64: {e}")
    try:
        return analyze(bytes_)
    except ValueError as e:
        raise bad_request(str(e))


@router.post("/v1/compare", response_model=ComparisonReport)
async def compare_endpoint(req: CompareRequest) -> ComparisonReport:
    try:
        a = base64.b64decode(req.a_wav_b64)
        b = base64.b64decode(req.b_wav_b64)
    except Exception as e:
        raise bad_request(f"invalid base64: {e}")
    try:
        report = compare(a, b)
    except ValueError as e:
        raise bad_request(str(e))
    report.a_label = req.a_label
    report.b_label = req.b_label
    return report
