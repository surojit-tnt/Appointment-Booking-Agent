from __future__ import annotations

import re
from datetime import UTC, date, datetime, time, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

from app.core.errors import DomainError
from app.domain.entities import AppointmentRecord, Doctor
from app.repositories.json_repository import JsonRepository


class AppointmentService:
    def __init__(self, repository: JsonRepository, timezone: ZoneInfo, horizon_days: int) -> None:
        self.repository = repository
        self.timezone = timezone
        self.horizon_days = horizon_days

    @staticmethod
    def normalize_phone(phone_number: str) -> str:
        digits = re.sub(r"\D", "", phone_number)
        if not 7 <= len(digits) <= 15:
            raise DomainError(
                "Enter a phone number containing 7 to 15 digits.",
                code="invalid_phone_number",
                status_code=422,
            )
        return f"+{digits}"

    def list_doctors(self, specialty: str | None = None) -> list[dict[str, object]]:
        doctors = self.repository.list_doctors()
        if specialty:
            query = specialty.strip().casefold()
            doctors = [doctor for doctor in doctors if query in doctor.specialty.casefold()]
        return [doctor.model_dump() for doctor in doctors]

    def get_doctor(self, doctor_id: str) -> Doctor:
        for doctor in self.repository.list_doctors():
            if doctor.id == doctor_id:
                return doctor
        raise DomainError("Doctor not found.", code="doctor_not_found", status_code=404)

    def list_availability(
        self,
        *,
        doctor_id: str | None = None,
        requested_date: date | None = None,
        specialty: str | None = None,
        limit: int = 50,
    ) -> dict[str, object]:
        doctors = self.repository.list_doctors()
        if doctor_id is not None:
            doctors = [doctor for doctor in doctors if doctor.id == doctor_id]
            if not doctors:
                raise DomainError("Doctor not found.", code="doctor_not_found", status_code=404)
        if specialty:
            query = specialty.strip().casefold()
            doctors = [doctor for doctor in doctors if query in doctor.specialty.casefold()]

        appointments = self.repository.list_appointments()
        booked_slot_ids = {
            appointment.slot_id for appointment in appointments if appointment.status == "booked"
        }
        now = datetime.now(self.timezone)
        days = (
            [requested_date]
            if requested_date is not None
            else [now.date() + timedelta(days=offset) for offset in range(self.horizon_days)]
        )

        slots: list[dict[str, object]] = []
        for slot_date in days:
            for doctor in doctors:
                if slot_date.weekday() not in doctor.working_days:
                    continue
                for time_text in doctor.available_times:
                    try:
                        slot_time = time.fromisoformat(time_text)
                    except ValueError as error:
                        raise RuntimeError(
                            f"Invalid available time {time_text!r} for {doctor.name} in doctors.json"
                        ) from error
                    starts_at = datetime.combine(slot_date, slot_time, tzinfo=self.timezone)
                    if starts_at <= now:
                        continue
                    slot_id = self._slot_id(doctor.id, starts_at)
                    if slot_id in booked_slot_ids:
                        continue
                    slots.append(self._slot_payload(doctor, slot_id, starts_at))

        slots.sort(key=lambda slot: (str(slot["starts_at"]), str(slot["doctor_name"])))
        return {
            "date": requested_date.isoformat() if requested_date else None,
            "timezone": str(self.timezone),
            "slots": slots[: max(1, limit)],
        }

    def list_appointments(self, status: str | None = None) -> list[dict[str, object]]:
        appointments = self.repository.list_appointments()
        if status:
            appointments = [appointment for appointment in appointments if appointment.status == status]
        appointments.sort(key=lambda item: item.created_at, reverse=True)
        return [self._appointment_payload(appointment) for appointment in appointments]

    def book_appointment(
        self,
        *,
        slot_id: str,
        phone_number: str,
        phone_confirmed: bool,
        patient_name: str | None = None,
    ) -> dict[str, object]:
        if not phone_confirmed:
            raise DomainError(
                "Read the phone number back and get the caller's confirmation first.",
                code="phone_not_confirmed",
                status_code=409,
            )
        normalized_phone = self.normalize_phone(phone_number)

        with self.repository.locked():
            doctors = self.repository.list_doctors()
            appointments = self.repository.list_appointments()
            booked_slot_ids = {
                item.slot_id for item in appointments if item.status == "booked"
            }
            selected = self._find_slot(slot_id, doctors)
            if selected is None:
                raise DomainError(
                    "That slot is not part of the doctor's schedule. Refresh availability and choose another slot.",
                    code="slot_not_found",
                    status_code=404,
                )
            doctor, starts_at = selected
            if starts_at <= datetime.now(self.timezone):
                raise DomainError("That appointment time has passed.", code="slot_in_past", status_code=409)
            if slot_id in booked_slot_ids:
                raise DomainError(
                    "That slot has just been taken. Please offer another available time.",
                    code="slot_unavailable",
                    status_code=409,
                )

            appointment = AppointmentRecord(
                id=str(uuid4()),
                slot_id=slot_id,
                doctor_id=doctor.id,
                doctor_name=doctor.name,
                specialty=doctor.specialty,
                location=doctor.location,
                starts_at=starts_at,
                phone_number=normalized_phone,
                patient_name=patient_name.strip() if patient_name and patient_name.strip() else None,
                status="booked",
                created_at=datetime.now(UTC),
            )
            appointments.append(appointment)
            self.repository.save_appointments(appointments)
            return self._appointment_payload(appointment)

    def cancel_appointment(
        self,
        *,
        phone_number: str,
        phone_confirmed: bool,
        appointment_id: str | None = None,
    ) -> dict[str, object]:
        if not phone_confirmed:
            raise DomainError(
                "Read the phone number back and get the caller's confirmation first.",
                code="phone_not_confirmed",
                status_code=409,
            )
        normalized_phone = self.normalize_phone(phone_number)

        with self.repository.locked():
            appointments = self.repository.list_appointments()
            matches = [
                item
                for item in appointments
                if item.status == "booked"
                and item.phone_number == normalized_phone
                and (appointment_id is None or item.id == appointment_id)
            ]
            if not matches:
                raise DomainError(
                    "No active appointment matched that phone number.",
                    code="appointment_not_found",
                    status_code=404,
                )
            if appointment_id is None and len(matches) > 1:
                choices = [self._appointment_payload(item) for item in matches]
                raise DomainError(
                    "More than one active appointment matches this number; ask which one to cancel.",
                    code="appointment_choice_required",
                    status_code=409,
                    data={"appointments": choices},
                )

            target = matches[0]
            updated: list[AppointmentRecord] = []
            cancelled: AppointmentRecord | None = None
            now = datetime.now(UTC)
            for item in appointments:
                if item.id == target.id and item.status == "booked":
                    item = item.model_copy(update={"status": "cancelled", "cancelled_at": now})
                    cancelled = item
                updated.append(item)
            if cancelled is None:
                raise DomainError(
                    "This appointment is no longer active.",
                    code="appointment_not_active",
                    status_code=409,
                )
            self.repository.save_appointments(updated)
            return self._appointment_payload(cancelled)

    def _find_slot(self, slot_id: str, doctors: list[Doctor]) -> tuple[Doctor, datetime] | None:
        try:
            doctor_id, utc_stamp = slot_id.rsplit("__", 1)
            utc_start = datetime.strptime(utc_stamp, "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
            local_start = utc_start.astimezone(self.timezone)
        except (ValueError, TypeError):
            return None
        doctor = next((item for item in doctors if item.id == doctor_id), None)
        if doctor is None or local_start.weekday() not in doctor.working_days:
            return None
        scheduled_times = {time.fromisoformat(value) for value in doctor.available_times}
        if local_start.time().replace(tzinfo=None) not in scheduled_times:
            return None
        return doctor, local_start

    @staticmethod
    def _slot_id(doctor_id: str, starts_at: datetime) -> str:
        utc_stamp = starts_at.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")
        return f"{doctor_id}__{utc_stamp}"

    @staticmethod
    def _slot_payload(doctor: Doctor, slot_id: str, starts_at: datetime) -> dict[str, object]:
        return {
            "id": slot_id,
            "doctor_id": doctor.id,
            "doctor_name": doctor.name,
            "specialty": doctor.specialty,
            "location": doctor.location,
            "starts_at": starts_at.isoformat(timespec="minutes"),
            "duration_minutes": doctor.slot_minutes,
            "is_available": True,
        }

    @staticmethod
    def _appointment_payload(appointment: AppointmentRecord) -> dict[str, object]:
        return {
            "id": appointment.id,
            "slot_id": appointment.slot_id,
            "doctor_id": appointment.doctor_id,
            "doctor_name": appointment.doctor_name,
            "specialty": appointment.specialty,
            "location": appointment.location,
            "starts_at": appointment.starts_at.isoformat(timespec="minutes"),
            "phone_number": appointment.phone_number,
            "patient_name": appointment.patient_name,
            "status": appointment.status,
            "created_at": appointment.created_at.astimezone(UTC).isoformat(timespec="seconds"),
            "cancelled_at": (
                appointment.cancelled_at.astimezone(UTC).isoformat(timespec="seconds")
                if appointment.cancelled_at
                else None
            ),
        }
