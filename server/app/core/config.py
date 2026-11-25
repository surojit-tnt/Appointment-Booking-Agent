from __future__ import annotations

import os
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")


def _data_directory() -> Path:
    configured = Path(os.getenv("DATA_DIR", "./data"))
    return configured if configured.is_absolute() else (PROJECT_ROOT / configured).resolve()


DATA_DIR = _data_directory()
DOCTORS_FILE = DATA_DIR / "doctors.json"
APPOINTMENTS_FILE = DATA_DIR / "appointments.json"
APP_TIMEZONE_NAME = os.getenv("APP_TIMEZONE", "Asia/Kolkata")
APP_TIMEZONE = ZoneInfo(APP_TIMEZONE_NAME)
AVAILABILITY_DAYS = max(1, int(os.getenv("AVAILABILITY_DAYS", "14")))
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]
