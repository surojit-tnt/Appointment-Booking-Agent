from __future__ import annotations

import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import router
from app.container import json_repository
from app.core.config import CORS_ORIGINS
from app.core.errors import DomainError


@asynccontextmanager
async def lifespan(_: FastAPI):
    json_repository.ensure_files()
    yield


app = FastAPI(
    title="Doctor Appointment Assistant API",
    version="1.0.0",
    description="JSON-backed API and Pipecat voice assistant for doctor appointments.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def response_timing(request: Request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - started) * 1000
    response.headers["X-Response-Time-Ms"] = f"{elapsed_ms:.1f}"
    response.headers["Server-Timing"] = f"app;dur={elapsed_ms:.1f}"
    return response


@app.exception_handler(DomainError)
async def domain_error_response(_: Request, error: DomainError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status_code,
        content={"error": {"code": error.code, "message": error.message, **error.data}},
    )


app.include_router(router)
