from fastapi import APIRouter

from app.schemas.common import ErrorResponse, HealthResponse

router = APIRouter(tags=["health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Check API process health",
    description="Reports process availability without contacting Xunlei. Access: Public.",
    response_description="The API process is available.",
    responses={500: {"model": ErrorResponse, "description": "Internal server error."}},
)
async def health() -> HealthResponse:
    return HealthResponse(status="ok")
