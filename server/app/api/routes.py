from __future__ import annotations

from datetime import date
from typing import Literal

from fastapi import APIRouter, Query

from app.api.schemas import (
    AppointmentOut,
    AvailabilityOut,
    BookingCreate,
    CancellationCreate,
    DoctorOut,
)
from app.container import appointment_service

router = APIRouter(prefix="/api")


@router.get("/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok", "storage": "json"}


@router.get("/doctors", response_model=list[DoctorOut], tags=["doctors"])
def list_doctors(specialty: str | None = None):
    return appointment_service.list_doctors(specialty)


@router.get("/doctors/{doctor_id}", response_model=DoctorOut, tags=["doctors"])
def get_doctor(doctor_id: str):
    doctor = appointment_service.get_doctor(doctor_id)
    return doctor.model_dump()


@router.get("/availability", response_model=AvailabilityOut, tags=["appointments"])
def get_availability(
    doctor_id: str | None = None,
    requested_date: date | None = Query(default=None, alias="date"),
    specialty: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
):
    return appointment_service.list_availability(
        doctor_id=doctor_id,
        requested_date=requested_date,
        specialty=specialty,
        limit=limit,
    )


@router.get("/appointments", response_model=list[AppointmentOut], tags=["appointments"])
def list_appointments(status: Literal["booked", "cancelled"] | None = None):
    return appointment_service.list_appointments(status)


@router.post(
    "/appointments/book",
    response_model=AppointmentOut,
    status_code=201,
    tags=["appointments"],
)
def book_appointment(payload: BookingCreate):
    return appointment_service.book_appointment(
        slot_id=payload.slot_id,
        phone_number=payload.phone_number,
        phone_confirmed=payload.phone_confirmed,
        patient_name=payload.patient_name,
    )


@router.post("/appointments/cancel", response_model=AppointmentOut, tags=["appointments"])
def cancel_appointment(payload: CancellationCreate):
    return appointment_service.cancel_appointment(
        phone_number=payload.phone_number,
        phone_confirmed=payload.phone_confirmed,
        appointment_id=payload.appointment_id,
    )
