"""RFC 7807 problem-details error envelope.

FastAPI handlers raise these via HTTPException(status_code=..., detail=...);
the exception handler converts to the application/problem+json shape.
"""

from __future__ import annotations

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse


class ApiError(HTTPException):
    """HTTPException variant that flags the slug for RFC 7807 type uri.

    `extra` fields are merged top-level into the problem+json body —
    machine-readable context beyond the human `detail` string (e.g. the
    engine-swap-required contract's from/to engine ids).
    """

    def __init__(
        self,
        status_code: int,
        slug: str,
        title: str,
        detail: str,
        extra: dict | None = None,
    ):
        super().__init__(status_code=status_code, detail=detail)
        self.slug = slug
        self.title = title
        self.extra = extra or {}


def bad_request(detail: str) -> ApiError:
    return ApiError(400, "bad-request", "Bad Request", detail)


def unauthorized(detail: str = "Authentication required") -> ApiError:
    return ApiError(401, "unauthorized", "Unauthorized", detail)


def forbidden(detail: str = "Token not accepted") -> ApiError:
    return ApiError(403, "forbidden", "Forbidden", detail)


def not_found(detail: str) -> ApiError:
    return ApiError(404, "not-found", "Not Found", detail)


def conflict(detail: str) -> ApiError:
    return ApiError(409, "conflict", "Conflict", detail)


def engine_swap_required(
    detail: str,
    *,
    from_engine: str | None,
    to_engine: str,
    to_variant: str | None,
    est_seconds: int | None,
    weights_on_disk: bool,
) -> ApiError:
    """409 contract for swap-at-render (plan WS2): the resolved voice needs
    an engine that isn't in its kind slot, and neither the request's
    allow_engine_swap flag nor settings.generation.auto_engine_swap granted
    the swap. The client catches code "engine-swap-required", prompts, and
    retries with allow_engine_swap=true."""
    return ApiError(
        409,
        "engine-swap-required",
        "Engine Swap Required",
        detail,
        extra={
            "code": "engine-swap-required",
            "from_engine": from_engine,
            "to_engine": to_engine,
            "to_variant": to_variant,
            "est_seconds": est_seconds,
            "weights_on_disk": weights_on_disk,
        },
    )


def not_implemented(detail: str) -> ApiError:
    return ApiError(501, "not-implemented", "Not Implemented", detail)


def service_unavailable(detail: str) -> ApiError:
    return ApiError(503, "service-unavailable", "Service Unavailable", detail)


def internal(detail: str = "An internal error occurred. See server logs for details.") -> ApiError:
    return ApiError(500, "internal", "Internal Server Error", detail)


async def api_exception_handler(request: Request, exc: ApiError):
    body = {
        "type": f"https://justvoice.dev/errors/{exc.slug}",
        "title": exc.title,
        "status": exc.status_code,
        "detail": exc.detail,
        "instance": request.url.path,
    }
    if exc.extra:
        body.update(exc.extra)
    return JSONResponse(
        status_code=exc.status_code,
        content=body,
        media_type="application/problem+json",
    )


async def http_exception_handler(request: Request, exc: HTTPException):
    # Plain HTTPException (without our slug) — synthesize a reasonable one.
    slug = "error"
    title = "Error"
    if exc.status_code == 404:
        slug, title = "not-found", "Not Found"
    elif exc.status_code == 400:
        slug, title = "bad-request", "Bad Request"
    elif exc.status_code == 401:
        slug, title = "unauthorized", "Unauthorized"
    elif exc.status_code == 422:
        slug, title = "validation-error", "Validation Error"
    body = {
        "type": f"https://justvoice.dev/errors/{slug}",
        "title": title,
        "status": exc.status_code,
        "detail": str(exc.detail),
        "instance": request.url.path,
    }
    return JSONResponse(
        status_code=exc.status_code,
        content=body,
        media_type="application/problem+json",
    )
