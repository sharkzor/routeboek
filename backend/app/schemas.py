"""Pydantic-modellen voor de API."""

from __future__ import annotations

from datetime import date, datetime, time

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models import RideType, RouteType

WIND_CODES = {"N", "O", "Z", "W"}
CATEGORY_CODES = {"beginners", "high_pace", "tourist"}

PASSWORD_MIN_LENGTH = 10


def validate_password(value: str) -> str:
    if len(value) < PASSWORD_MIN_LENGTH:
        raise ValueError(
            f"Het wachtwoord moet minimaal {PASSWORD_MIN_LENGTH} tekens lang zijn."
        )
    if value.isdigit() or value.isalpha():
        raise ValueError(
            "Gebruik een combinatie van letters en cijfers of leestekens."
        )
    return value


class Message(BaseModel):
    detail: str


# ------------------------------------------------------------------- accounts


class RegisterIn(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=2, max_length=120)
    password: str

    _check = field_validator("password")(validate_password)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ForgotPasswordIn(BaseModel):
    email: EmailStr


class ResetPasswordIn(BaseModel):
    token: str = Field(min_length=10)
    password: str

    _check = field_validator("password")(validate_password)


class VerifyEmailIn(BaseModel):
    token: str = Field(min_length=10)


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str

    _check = field_validator("new_password")(validate_password)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    display_name: str
    is_admin: bool
    is_active: bool
    email_verified_at: datetime | None
    created_at: datetime
    last_login_at: datetime | None


class UserSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    display_name: str


class SessionOut(BaseModel):
    user: UserOut
    csrf_token: str


# --------------------------------------------------------------------- routes


class RouteSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    slug: str
    name: str
    distance_km: float | None
    elevation_m: int | None
    route_type: RouteType
    wind_directions: list[str]
    wind_estimated: bool = False
    categories: list[str]
    rating: float | None
    rating_count: int
    map_url: str | None = None
    has_gpx: bool = False
    has_tcx: bool = False
    is_active: bool = True


class RouteDetail(RouteSummary):
    description_html: str
    strava_url: str | None
    coordinates: list[list[float]]
    created_at: datetime
    my_rating: int | None = None


class CommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    display_name: str
    body: str
    created_at: datetime
    is_mine: bool = False


class CommentCreateIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)

    @field_validator("body")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Een lege reactie kan niet worden geplaatst.")
        return value


class RatingIn(BaseModel):
    value: int = Field(ge=1, le=5)


class RatingOut(BaseModel):
    rating: float | None
    rating_count: int
    my_rating: int | None


class RoutePage(BaseModel):
    items: list[RouteSummary]
    total: int
    page: int
    page_size: int
    distance_min: float | None
    distance_max: float | None


def _normalize_winds(value: list[str]) -> list[str]:
    codes = [v.upper() for v in value]
    if set(codes) - WIND_CODES:
        raise ValueError("Ongeldige windrichting; gebruik N, O, Z of W.")
    return sorted(set(codes))


def _normalize_categories(value: list[str]) -> list[str]:
    codes = [v.lower() for v in value]
    if set(codes) - CATEGORY_CODES:
        raise ValueError("Ongeldige categorie.")
    return sorted(set(codes))


def _normalize_url(value: str | None) -> str | None:
    if value and not value.startswith(("http://", "https://")):
        raise ValueError("De Strava-link moet met http(s):// beginnen.")
    return value or None


class RouteCreateIn(BaseModel):
    """Velden bij het uploaden van een nieuwe route door een admin."""

    name: str = Field(min_length=2, max_length=200)
    description_html: str = ""
    route_type: RouteType = RouteType.road
    wind_directions: list[str] = Field(default_factory=list)
    categories: list[str] = Field(default_factory=list)
    strava_url: str | None = None

    @field_validator("wind_directions")
    @classmethod
    def _winds(cls, value: list[str]) -> list[str]:
        return _normalize_winds(value)

    @field_validator("categories")
    @classmethod
    def _cats(cls, value: list[str]) -> list[str]:
        return _normalize_categories(value)

    @field_validator("strava_url")
    @classmethod
    def _strava(cls, value: str | None) -> str | None:
        return _normalize_url(value)


class RouteUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    description_html: str | None = None
    route_type: RouteType | None = None
    wind_directions: list[str] | None = None
    categories: list[str] | None = None
    strava_url: str | None = None
    is_active: bool | None = None

    @field_validator("wind_directions")
    @classmethod
    def _winds(cls, value: list[str] | None) -> list[str] | None:
        return None if value is None else _normalize_winds(value)

    @field_validator("categories")
    @classmethod
    def _cats(cls, value: list[str] | None) -> list[str] | None:
        return None if value is None else _normalize_categories(value)

    @field_validator("strava_url")
    @classmethod
    def _strava(cls, value: str | None) -> str | None:
        return _normalize_url(value)


# --------------------------------------------------------------------- ritten


class RideCreateIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    owner_id: int | None = None
    ride_date: date
    ride_time: time
    route_id: int | None = None
    ride_type: RideType = RideType.race
    distance_km: float | None = Field(default=None, ge=0, le=1000)
    speed_kmh: float | None = Field(default=None, ge=0, le=60)
    max_participants: int = Field(default=10, ge=4, le=12)
    notes_html: str = ""
    is_private: bool = False


class RideUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    owner_id: int | None = None
    ride_date: date | None = None
    ride_time: time | None = None
    route_id: int | None = None
    ride_type: RideType | None = None
    distance_km: float | None = Field(default=None, ge=0, le=1000)
    speed_kmh: float | None = Field(default=None, ge=0, le=60)
    max_participants: int | None = Field(default=None, ge=4, le=12)
    notes_html: str | None = None
    is_private: bool | None = None


class RideRouteRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    slug: str
    name: str
    distance_km: float | None
    map_url: str | None = None


class RideOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    owner: UserSummary
    ride_date: date
    ride_time: time
    ride_type: RideType
    distance_km: float | None
    speed_kmh: float | None
    max_participants: int
    notes_html: str
    is_private: bool
    cancelled_at: datetime | None
    created_at: datetime
    route: RideRouteRef | None
    participants: list[UserSummary] = Field(default_factory=list)
    participant_count: int = 0
    is_joined: bool = False
    can_edit: bool = False


class RideDefaults(BaseModel):
    """Voorgestelde datum en tijd: het eerstvolgende clubmoment."""

    ride_date: date
    ride_time: time
    label: str


# ---------------------------------------------------------------- waterpunten


class WaterPointOut(BaseModel):
    lat: float
    lon: float
    name: str | None = None
    operator: str | None = None
    opening_hours: str | None = None
    website: str | None = None
    source: str
    distance_to_route_m: float
    along_route_km: float


class WaterStats(BaseModel):
    total_distance_km: float
    water_point_count: int
    average_gap_km: float | None
    longest_gap_km: float
    longest_gap_start_km: float
    warning: str | None


class WaterResult(BaseModel):
    job_id: str
    filename: str
    source: str
    radius_m: int
    stats: WaterStats
    water_points: list[WaterPointOut]


# ---------------------------------------------------------------------- admin


class AdminUserUpdateIn(BaseModel):
    is_admin: bool | None = None
    is_active: bool | None = None
    display_name: str | None = Field(default=None, min_length=2, max_length=120)
    verify_email: bool | None = None
