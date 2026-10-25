from typing import Any

from app.schemas.common import ErrorResponse

_DESCRIPTIONS = {
    400: "Invalid request or Xunlei rejected the operation.",
    401: "No usable Xunlei credentials (auth_required / auth_failed).",
    403: "Path or operation not allowed.",
    404: "Resource not found.",
    409: "Operation not allowed in the current state.",
    422: "Request validation failed.",
    502: "Xunlei returned an unexpected error.",
    503: "Xunlei servers or the download engine are unreachable.",
}


def errors(*statuses: int) -> dict[int | str, dict[str, Any]]:
    """OpenAPI error response declarations sharing the structured error schema."""
    return {
        status: {"model": ErrorResponse, "description": _DESCRIPTIONS[status]}
        for status in statuses
    }


XUNLEI_ERRORS = errors(400, 401, 404, 502, 503)
ENGINE_ERRORS = errors(401, 409, 502, 503)
