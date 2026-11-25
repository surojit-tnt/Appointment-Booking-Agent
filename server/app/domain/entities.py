from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class Doctor(BaseModel):
    id: str
    name: str
    specialty: str
    location: str
    working_days: list[int] = Field(min_length=1, max_length=7)
    available_times: list[str] = Field(min_length=1)
    slot_minutes: int = Field(default=30, ge=10, le=240)


class AppointmentRecord(BaseModel):
    id: str
    slot_id: str
    doctor_id: str
    doctor_name: str
    specialty: str
    location: str
    starts_at: datetime
    phone_number: str
    patient_name: str | None = None
    status: Literal["booked", "cancelled"]
    created_at: datetime
    cancelled_at: datetime | None = None
