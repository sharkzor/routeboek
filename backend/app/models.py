"""Databasemodellen."""

from __future__ import annotations

import enum
from datetime import date, datetime, time, timezone

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class RouteType(str, enum.Enum):
    road = "road"
    road_gravel = "road_gravel"
    gravel = "gravel"


class RouteOrigin(str, enum.Enum):
    #: Overgenomen uit routeboek.cc of door een beheerder toegevoegd.
    official = "official"
    #: Door een lid geüpload; staat in "Community routes" tot een beheerder
    #: het promoveert naar het officiële routeboek.
    community = "community"


class RideType(str, enum.Enum):
    race = "race"
    race_gravel = "race_gravel"
    gravel = "gravel"


class TokenPurpose(str, enum.Enum):
    verify_email = "verify_email"
    reset_password = "reset_password"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failed_logins: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    sessions: Mapped[list["UserSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def is_verified(self) -> bool:
        return self.email_verified_at is not None


class UserSession(Base):
    """Serverside sessie; de cookie bevat alleen een willekeurig token."""

    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(255))
    ip_address: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="sessions")


class EmailToken(Base):
    """Eenmalig token voor e-mailverificatie of wachtwoordherstel."""

    __tablename__ = "email_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    purpose: Mapped[TokenPurpose] = mapped_column(
        Enum(TokenPurpose, name="token_purpose"), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    user: Mapped[User] = relationship()


class Route(Base):
    __tablename__ = "routes"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    description_html: Mapped[str] = mapped_column(Text, default="", nullable=False)

    distance_km: Mapped[float | None] = mapped_column(Float, index=True)
    elevation_m: Mapped[int | None] = mapped_column(Integer, index=True)
    route_type: Mapped[RouteType] = mapped_column(
        Enum(RouteType, name="route_type"), default=RouteType.road, nullable=False
    )

    # Windrichtingen waarvoor de route geschikt is: N, O, Z, W.
    wind_directions: Mapped[list[str]] = mapped_column(
        ARRAY(String(1)), default=list, nullable=False
    )
    # True als wind_directions automatisch is ingeschat uit de geometrie
    # (geen bron-data), zodat admins dit nog kunnen corrigeren.
    wind_estimated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # beginners | high_pace | tourist
    categories: Mapped[list[str]] = mapped_column(
        ARRAY(String(20)), default=list, nullable=False
    )

    rating: Mapped[float | None] = mapped_column(Float, index=True)
    rating_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Bevroren waardering zoals overgenomen uit het oude routeboek.cc (anoniem,
    # zonder gebruikers-koppeling). Blijft meetellen in het gewogen gemiddelde
    # samen met de echte RouteRating-rijen van ingelogde leden.
    legacy_rating: Mapped[float | None] = mapped_column(Float)
    legacy_rating_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    strava_url: Mapped[str | None] = mapped_column(String(500))
    gpx_file: Mapped[str | None] = mapped_column(String(255))
    tcx_file: Mapped[str | None] = mapped_column(String(255))
    map_file: Mapped[str | None] = mapped_column(String(255))

    # [[lat, lon], ...] voor het tekenen van de kaart en waterpuntanalyse.
    coordinates: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)

    source_id: Mapped[int | None] = mapped_column(Integer, unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    origin: Mapped[RouteOrigin] = mapped_column(
        Enum(RouteOrigin, name="route_origin"), default=RouteOrigin.official, nullable=False
    )
    # Aantal upvotes van leden op een community-route (denormaliseerd, zie RouteUpvote).
    upvote_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    created_by: Mapped[User | None] = relationship()

    __table_args__ = (Index("ix_routes_active_distance", "is_active", "distance_km"),)


class Ride(Base):
    __tablename__ = "rides"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    route_id: Mapped[int | None] = mapped_column(
        ForeignKey("routes.id", ondelete="SET NULL"), index=True
    )
    ride_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    ride_time: Mapped[time] = mapped_column(Time, nullable=False)
    ride_type: Mapped[RideType] = mapped_column(
        Enum(RideType, name="ride_type"), default=RideType.race, nullable=False
    )
    distance_km: Mapped[float | None] = mapped_column(Float)
    speed_kmh: Mapped[float | None] = mapped_column(Float)
    max_participants: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    notes_html: Mapped[str] = mapped_column(Text, default="", nullable=False)
    is_private: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    owner: Mapped[User] = relationship(foreign_keys=[owner_id])
    created_by: Mapped[User | None] = relationship(foreign_keys=[created_by_id])
    route: Mapped[Route | None] = relationship()
    participants: Mapped[list["RideParticipant"]] = relationship(
        back_populates="ride", cascade="all, delete-orphan"
    )


class RideParticipant(Base):
    __tablename__ = "ride_participants"

    id: Mapped[int] = mapped_column(primary_key=True)
    ride_id: Mapped[int] = mapped_column(
        ForeignKey("rides.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    ride: Mapped[Ride] = relationship(back_populates="participants")
    user: Mapped[User] = relationship()

    __table_args__ = (UniqueConstraint("ride_id", "user_id", name="uq_ride_user"),)


class RouteRating(Base):
    """Waardering (1-5) van een ingelogd lid voor een route, hooguit één per lid."""

    __tablename__ = "route_ratings"

    id: Mapped[int] = mapped_column(primary_key=True)
    route_id: Mapped[int] = mapped_column(
        ForeignKey("routes.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    value: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    user: Mapped[User] = relationship()

    __table_args__ = (UniqueConstraint("route_id", "user_id", name="uq_route_rating_user"),)


class RouteComment(Base):
    """Reactie van een lid onder een route. Admins mogen elke reactie verwijderen."""

    __tablename__ = "route_comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    route_id: Mapped[int] = mapped_column(
        ForeignKey("routes.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False, index=True
    )

    user: Mapped[User] = relationship()


class RouteUpvote(Base):
    """Stem van een lid vóór een community-route, hooguit één per lid."""

    __tablename__ = "route_upvotes"

    id: Mapped[int] = mapped_column(primary_key=True)
    route_id: Mapped[int] = mapped_column(
        ForeignKey("routes.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    user: Mapped[User] = relationship()

    __table_args__ = (UniqueConstraint("route_id", "user_id", name="uq_route_upvote_user"),)
