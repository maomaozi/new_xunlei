from typing import Literal

from pydantic import BaseModel, Field


class ErrorDetail(BaseModel):
    code: str = Field(description="Stable machine-readable error code")
    message: str = Field(description="Operator-readable Simplified Chinese error message")


class ErrorResponse(BaseModel):
    error: ErrorDetail = Field(description="Structured error information")


class HealthResponse(BaseModel):
    status: Literal["ok"] = Field(description="API process health", examples=["ok"])


class OkResponse(BaseModel):
    ok: Literal[True] = Field(default=True, description="Operation accepted")


class TaskRefResponse(BaseModel):
    """Xunlei batch operations run asynchronously and return a server task id."""

    task_id: str = Field(default="", description="Xunlei asynchronous operation task id")
