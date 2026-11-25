from app.core.config import (
    APPOINTMENTS_FILE,
    APP_TIMEZONE,
    AVAILABILITY_DAYS,
    DOCTORS_FILE,
)
from app.repositories.json_repository import JsonRepository
from app.services.appointment_service import AppointmentService

json_repository = JsonRepository(DOCTORS_FILE, APPOINTMENTS_FILE)
appointment_service = AppointmentService(
    repository=json_repository,
    timezone=APP_TIMEZONE,
    horizon_days=AVAILABILITY_DAYS,
)
