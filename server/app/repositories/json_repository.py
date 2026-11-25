from __future__ import annotations

import json
import os
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path
from collections.abc import Iterator

from filelock import FileLock

from app.domain.entities import AppointmentRecord, Doctor


class JsonRepository:
    """Read doctors and persist appointments in JSON files, with cross-process write locking."""

    def __init__(self, doctors_file: Path, appointments_file: Path) -> None:
        self.doctors_file = doctors_file
        self.appointments_file = appointments_file
        self.appointments_file.parent.mkdir(parents=True, exist_ok=True)
        self._thread_lock = threading.RLock()
        self._file_lock = FileLock(str(self.appointments_file.with_suffix(".lock")))

    @contextmanager
    def locked(self) -> Iterator[None]:
        with self._thread_lock:
            with self._file_lock:
                yield

    def ensure_files(self) -> None:
        if not self.doctors_file.is_file():
            raise FileNotFoundError(f"Doctors JSON file not found: {self.doctors_file}")
        self.appointments_file.parent.mkdir(parents=True, exist_ok=True)
        with self.locked():
            if not self.appointments_file.exists():
                self._write_json(self.appointments_file, [])
        # Validate both files during startup so broken JSON fails with a useful message.
        self.list_doctors()
        self.list_appointments()

    def list_doctors(self) -> list[Doctor]:
        try:
            raw = json.loads(self.doctors_file.read_text(encoding="utf-8"))
            return [Doctor.model_validate(item) for item in raw]
        except (OSError, json.JSONDecodeError, TypeError, ValueError) as error:
            raise RuntimeError(f"Could not read valid doctor data from {self.doctors_file}: {error}") from error

    def list_appointments(self) -> list[AppointmentRecord]:
        with self.locked():
            try:
                raw = json.loads(self.appointments_file.read_text(encoding="utf-8"))
                if not isinstance(raw, list):
                    raise ValueError("appointments.json must contain a JSON array")
                return [AppointmentRecord.model_validate(item) for item in raw]
            except (OSError, json.JSONDecodeError, TypeError, ValueError) as error:
                raise RuntimeError(
                    f"Could not read valid appointment data from {self.appointments_file}: {error}"
                ) from error

    def save_appointments(self, appointments: list[AppointmentRecord]) -> None:
        document = [appointment.model_dump(mode="json") for appointment in appointments]
        with self.locked():
            self._write_json(self.appointments_file, document)

    @staticmethod
    def _write_json(path: Path, document: object) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                newline="\n",
                dir=path.parent,
                prefix=f".{path.stem}.",
                suffix=".tmp",
                delete=False,
            ) as temporary_file:
                temporary_path = Path(temporary_file.name)
                json.dump(document, temporary_file, ensure_ascii=False, indent=2)
                temporary_file.write("\n")
                temporary_file.flush()
                os.fsync(temporary_file.fileno())
            os.replace(temporary_path, path)
        finally:
            if temporary_path is not None and temporary_path.exists():
                temporary_path.unlink()
