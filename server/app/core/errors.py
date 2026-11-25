from __future__ import annotations


class DomainError(Exception):
    def __init__(
        self,
        message: str,
        *,
        code: str,
        status_code: int,
        data: dict[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.data = data or {}
