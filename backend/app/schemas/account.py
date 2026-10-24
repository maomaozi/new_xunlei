from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.xunlei import Quota


class AccountStatus(BaseModel):
    logged_in: bool = Field(description="A usable access or refresh token is stored")
    token_valid: bool = Field(description="The access token has not expired yet")
    user_id: str = ""
    device_id: str = Field(description="X-Device-Id sent with every Xunlei request")
    expires_at: float = Field(description="Access token expiry, UNIX seconds")
    has_refresh_token: bool
    source: str = Field(description="How the credentials were obtained (import/qrcode/password)")
    updated_at: str = ""


class VipInfo(BaseModel):
    is_vip: bool = False
    level: int = 0
    vas_type: str = ""
    label: str = ""
    expire_at: str = ""
    surplus_days: int = 0
    icon: str = ""


class UserProfile(BaseModel):
    id: str
    name: str = ""
    avatar: str = ""
    email: str = ""
    phone: str = ""
    created_at: str = ""
    vip: VipInfo = Field(default_factory=VipInfo)


class AccountOverview(BaseModel):
    status: AccountStatus
    profile: UserProfile | None = None
    quota: Quota | None = None


class ImportCredentialsRequest(BaseModel):
    """Accepts the project's credentials.json format or a raw OAuth token response."""

    model_config = ConfigDict(extra="ignore")

    access_token: str = ""
    refresh_token: str = ""
    expires_at: float | None = Field(default=None, description="UNIX seconds")
    expires_in: int | None = Field(default=None, description="Seconds from now")
    user_id: str = ""
    sub: str = ""
    device_id: str | None = Field(default=None, description="Keep the current one when empty")

    @model_validator(mode="after")
    def require_token(self) -> "ImportCredentialsRequest":
        if not self.access_token and not self.refresh_token:
            raise ValueError("access_token or refresh_token is required")
        return self


class PasswordLoginRequest(BaseModel):
    username: str = Field(min_length=1, description="Phone number, email or account name")
    password: str = Field(min_length=1)


class QrLoginStart(BaseModel):
    session_id: str
    verification_url: str = Field(description="Encode as QR code for the Xunlei mobile app")
    user_code: str
    expires_in: int
    interval: int


class QrLoginPoll(BaseModel):
    status: Literal["pending", "success", "expired", "denied"]


class DeviceIdRequest(BaseModel):
    device_id: str = Field(pattern=r"^[0-9A-Za-z]{16,64}$")
