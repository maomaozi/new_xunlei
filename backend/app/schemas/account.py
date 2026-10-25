from pydantic import BaseModel, Field

from app.schemas.xunlei import Quota


class AccountStatus(BaseModel):
    logged_in: bool = Field(description="The engine has a usable access token")
    token_valid: bool = Field(description="The access token has not expired yet")
    user_id: str = ""
    device_id: str = Field(description="X-Device-Id sent with every Xunlei request")
    expires_at: float = Field(description="Access token expiry, UNIX seconds")
    has_refresh_token: bool
    source: str = Field(description="Credential source (engine)")
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
