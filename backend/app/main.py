import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.exceptions import HTTPException

from app.api.router import OPENAPI_TAGS, api_router
from app.core.config import Settings, get_settings
from app.core.errors import ERROR_MESSAGES, AppError, ErrorCode
from app.core.logging import configure_logging
from app.schemas.common import ErrorDetail, ErrorResponse
from app.services.container import Container

logger = logging.getLogger(__name__)

VERSION = "0.1.0"


def error_response(status: int, code: ErrorCode, message: str | None = None) -> JSONResponse:
    body = ErrorResponse(error=ErrorDetail(code=code, message=message or ERROR_MESSAGES[code]))
    return JSONResponse(status_code=status, content=body.model_dump())


async def app_error_handler(request: Request, error: Exception) -> JSONResponse:
    if not isinstance(error, AppError):
        raise TypeError("Unexpected app error handler input")
    logger.info("Request failed: %s %s -> %s", request.method, request.url.path, error.code)
    return error_response(error.status, error.code, error.message)


async def http_error_handler(request: Request, error: Exception) -> JSONResponse:
    if not isinstance(error, HTTPException):
        raise TypeError("Unexpected HTTP error handler input")
    logger.warning(
        "HTTP request failed", extra={"path": request.url.path, "status": error.status_code}
    )
    code: ErrorCode = "not_found" if error.status_code == 404 else "http_error"
    response = error_response(error.status_code, code)
    if error.headers:
        response.headers.update(error.headers)
    return response


async def validation_error_handler(request: Request, error: Exception) -> JSONResponse:
    logger.warning("Request validation failed", extra={"path": request.url.path})
    return error_response(422, "invalid_request")


async def unexpected_error_handler(request: Request, error: Exception) -> JSONResponse:
    logger.error("Unhandled request error", extra={"path": request.url.path}, exc_info=error)
    return error_response(500, "internal_error")


def mount_frontend(application: FastAPI, dist: Path | None) -> None:
    """Serve the built single-page app when frontend/dist exists (production mode)."""
    if dist is None or not (dist / "index.html").is_file():
        return
    index = dist / "index.html"

    @application.get("/{path:path}", include_in_schema=False)
    async def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(status_code=404)
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(dist):
            headers = {"Cache-Control": "public, max-age=31536000, immutable"}
            if not path.startswith("assets/"):
                headers = {"Cache-Control": "no-cache"}
            return FileResponse(candidate, headers=headers)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings)

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        container = Container.create(settings)
        application.state.container = container
        await container.start()
        try:
            yield
        finally:
            await container.stop()

    application = FastAPI(
        title=settings.app_name,
        version=VERSION,
        debug=settings.app_debug,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/api/v1/openapi.json",
        openapi_tags=OPENAPI_TAGS,
        lifespan=lifespan,
        description=(
            "RESTful wrapper around the reverse-engineered Xunlei Pan API. The site has no "
            "authentication of its own: anyone who can reach it acts as the stored Xunlei "
            "account, so bind it to trusted networks only."
        ),
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.add_exception_handler(AppError, app_error_handler)
    application.add_exception_handler(HTTPException, http_error_handler)
    application.add_exception_handler(RequestValidationError, validation_error_handler)
    application.add_exception_handler(Exception, unexpected_error_handler)
    application.include_router(api_router)
    mount_frontend(application, settings.resolved_frontend_dist)
    return application


app = create_app()
