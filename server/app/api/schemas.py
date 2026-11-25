from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field, field_validator


class DoctorOut(BaseModel):
    id: str
    name: str
    specialty: str
    location: str
    working_days: list[int]
    available_times: list[str]
    slot_minutes: int


class SlotOut(BaseModel):
    id: str
    doctor_id: str
    doctor_name: str
    specialty: str
    location: str
    starts_at: str
    duration_minutes: int
    is_available: bool


class AvailabilityOut(BaseModel):
    date: date | None
    timezone: str
    slots: list[SlotOut]


class AppointmentOut(BaseModel):
    id: str
    slot_id: str
    doctor_id: str
    doctor_name: str
    specialty: str
    location: str
    starts_at: str
    phone_number: str
    patient_name: str | None
    status: str
    created_at: str
    cancelled_at: str | None


class BookingCreate(BaseModel):
    slot_id: str = Field(min_length=1)
    phone_number: str = Field(min_length=7, max_length=30)
    phone_confirmed: bool = Field(
        description="True only after reading the number back and getting the caller's confirmation."
    )
    patient_name: str | None = Field(default=None, max_length=120)

    @field_validator("phone_confirmed")
    @classmethod
    def require_phone_confirmation(cls, confirmed: bool) -> bool:
        if not confirmed:
            raise ValueError("Read the phone number back and get the caller's confirmation first.")
        return confirmed


class CancellationCreate(BaseModel):
    phone_number: str = Field(min_length=7, max_length=30)
    phone_confirmed: bool = Field(
        description="True only after reading the number back and getting the caller's confirmation."
    )
    appointment_id: str | None = None

    @field_validator("phone_confirmed")
    @classmethod
    def require_phone_confirmation(cls, confirmed: bool) -> bool:
        if not confirmed:
            raise ValueError("Read the phone number back and get the caller's confirmation first.")
        return confirmed
