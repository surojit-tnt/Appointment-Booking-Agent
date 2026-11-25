from __future__ import annotations

import asyncio
import os
import sys
from datetime import date as Date, datetime
from typing import Any

from dotenv import load_dotenv
from loguru import logger

from app.container import appointment_service, json_repository
from app.core.config import APP_TIMEZONE, APP_TIMEZONE_NAME
from app.core.errors import DomainError
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.runner.run import main
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.services.elevenlabs.stt import ElevenLabsRealtimeSTTService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.groq.llm import GroqLLMService
from pipecat.services.llm_service import FunctionCallParams
from pipecat.services.tts_service import TextAggregationMode
from pipecat.transports.base_transport import BaseTransport, TransportParams
from pipecat.utils.text.transforms import strip_markdown
from pipecat.workers.runner import WorkerRunner

load_dotenv()

SYSTEM_INSTRUCTION = """You are a warm, concise administrative assistant for a doctor's clinic.
You help callers find doctors and appointment times, book an appointment, or cancel one.
You are not a clinician and must not diagnose, recommend treatment, or interpret symptoms.

Safety and scope:
- If the caller describes a possible emergency or severe symptoms, tell them to contact local
  emergency services or go to the nearest emergency department now. Do not delay this for booking.
- Do not claim a doctor can treat a condition or provide medical advice.
- Ask only for information needed for the requested appointment task.

Grounding and conversation:
- Use tools for the live doctor list, availability, caller appointments, booking, and cancellation.
  Never invent a doctor, clinic, date, slot, appointment, or result.
- Speak in plain text only. Never use Markdown, asterisks, bullets, headings, or labels such as
  "Doctor:" and "Date:". Say details naturally in complete sentences.
- Keep replies to one short sentence whenever possible, and at most two short sentences when
  needed. Ask one short question at a time and use the caller's language when you can do so reliably.
- Greet the caller once when the session first starts. In later turns, answer directly without
  repeating the welcome unless the caller greets you again or has rejoined a new session.
- Use the current local date and time supplied in the developer message to resolve relative dates.
  Pass dates to tools as YYYY-MM-DD and clearly say the local appointment date, time, and clinic.
- When a doctor is named but you do not know that doctor's current ID, call
  check_doctor_availability with no arguments to get the current doctor catalog. Match the
  caller's name to that catalog; ask them to clarify if the match is ambiguous.

Caller identity and phone confirmation:
- Identify the caller only by the phone number they speak during this call. Do not use caller ID,
  login, OTP, or a number supplied by another source.
- When they give a number, call set_caller_phone, read the normalized number back one digit at a
  time, and ask whether it is correct.
- Call confirm_caller_phone with confirmed=true only after an explicit yes. If they correct or
  reject the number, save the corrected number and ask them to confirm it again.
- Never list, book, or cancel appointments before the caller's phone number is confirmed.

Availability and booking:
- Ask for the doctor's name or specialty and the preferred date when either is unclear.
- Check live availability and offer only returned slots. Read the doctor, date, local time, and
  clinic for each option. Let the caller choose one exact slot.
- Before booking, ask "What name should I put on the appointment?" if the patient's name has not
  already been provided. Wait for their answer and pass that name to book_appointment. If they
  explicitly decline to provide a name, pass null; never guess or use a name from another source.
- Before booking, confirm the chosen slot and the caller's confirmed phone number. Call
  book_appointment only after the caller agrees to book that exact slot.
- Use only the returned slot ID. If it was taken or the tool reports an error, explain that and
  check availability again before offering another time.
- Say a booking succeeded only after book_appointment returns a successful result.

Appointment lookup and cancellation:
- After confirming the caller's number, use find_caller_appointments to look up their active
  appointments. Read back only the returned doctor's name, date, time, and clinic.
- Ask which appointment they want cancelled and get their explicit agreement before calling
  cancel_appointment with the ID of that selected appointment.
- If there are no active appointments, say so. If several match, never choose one for the caller.
- Say a cancellation succeeded only after the tool returns a successful result. If a tool fails,
  explain the returned error plainly and do not claim the change happened.
"""

transport_params = {
    "webrtc": lambda: TransportParams(audio_in_enabled=True, audio_out_enabled=True),
}


async def _in_thread(function, *args, **kwargs):
    return await asyncio.to_thread(function, *args, **kwargs)


async def run_bot(transport: BaseTransport, runner_args: RunnerArguments) -> None:
    await _in_thread(json_repository.ensure_files)

    required = ("GROQ_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID")
    missing = [name for name in required if not os.getenv(name)]
    if missing:
        raise RuntimeError(f"Missing voice-agent environment variables: {', '.join(missing)}")

    call_state: dict[str, Any] = {"phone_number": None, "phone_confirmed": False}

    async def set_caller_phone(params: FunctionCallParams, phone_number: str):
        """Save the phone number that the caller said during this call.

        Args:
            phone_number: The phone number spoken by the caller.
        """
        call_state["phone_number"] = None
        call_state["phone_confirmed"] = False
        try:
            call_state["phone_number"] = appointment_service.normalize_phone(phone_number)
            await params.result_callback(
                {
                    "saved": True,
                    "phone_number": call_state["phone_number"],
                    "confirmed": False,
                }
            )
        except DomainError as error:
            await params.result_callback({"error": error.message, "code": error.code})

    async def confirm_caller_phone(params: FunctionCallParams, confirmed: bool):
        """Record an explicit yes or no to the phone number read back to the caller.

        Args:
            confirmed: True only if the caller explicitly said the read-back number is correct.
        """
        if not call_state["phone_number"]:
            await params.result_callback({"error": "Ask for the caller's number first."})
            return
        call_state["phone_confirmed"] = bool(confirmed)
        await params.result_callback(
            {"confirmed": call_state["phone_confirmed"], "phone_number": call_state["phone_number"]}
        )

    async def check_doctor_availability(
        params: FunctionCallParams,
        doctor_id: str | None = None,
        date: str | None = None,
        specialty: str | None = None,
    ):
        """Look up doctor slots by optional doctor, local date, or specialty.

        Args:
            doctor_id: Doctor ID from the available doctor list.
            date: Optional local date in YYYY-MM-DD format.
            specialty: Optional specialty, for example cardiology.
        """
        try:
            requested_date = Date.fromisoformat(date) if date else None
            doctors = await _in_thread(appointment_service.list_doctors, specialty)
            if doctor_id:
                doctors = [doctor for doctor in doctors if doctor["id"] == doctor_id]
            if not doctor_id and not specialty and requested_date is None:
                await params.result_callback(
                    {"doctors": doctors, "slots": [], "message": "Ask which doctor or specialty they want."}
                )
                return
            result = await _in_thread(
                appointment_service.list_availability,
                doctor_id=doctor_id,
                requested_date=requested_date,
                specialty=specialty,
                limit=8,
            )
            await params.result_callback({"doctors": doctors, **result})
        except (ValueError, DomainError) as error:
            if isinstance(error, DomainError):
                await params.result_callback({"error": error.message, "code": error.code})
            else:
                await params.result_callback({"error": "Use a date in YYYY-MM-DD format."})

    async def book_appointment(
        params: FunctionCallParams,
        slot_id: str,
        patient_name: str | None,
    ):
        """Book a returned slot for this caller after phone confirmation and name collection.

        Args:
            slot_id: Slot ID returned by check_doctor_availability.
            patient_name: Name the caller gave, or null only if they explicitly declined to provide it.
        """
        if not call_state["phone_confirmed"] or not call_state["phone_number"]:
            await params.result_callback({"error": "Confirm the caller's read-back number first."})
            return
        try:
            result = await _in_thread(
                appointment_service.book_appointment,
                slot_id=slot_id,
                phone_number=call_state["phone_number"],
                phone_confirmed=True,
                patient_name=patient_name,
            )
            await params.result_callback(result)
        except DomainError as error:
            await params.result_callback({"error": error.message, "code": error.code, **error.data})

    async def find_caller_appointments(params: FunctionCallParams):
        """Find this confirmed caller's active appointments without changing them."""
        if not call_state["phone_confirmed"] or not call_state["phone_number"]:
            await params.result_callback({"error": "Confirm the caller's read-back number first."})
            return
        appointments = await _in_thread(appointment_service.list_appointments, "booked")
        matches = [
            {
                "appointment_id": item["id"],
                "doctor_name": item["doctor_name"],
                "specialty": item["specialty"],
                "location": item["location"],
                "starts_at": item["starts_at"],
            }
            for item in appointments
            if item["phone_number"] == call_state["phone_number"]
        ]
        await params.result_callback({"appointments": matches})

    async def cancel_appointment(params: FunctionCallParams, appointment_id: str):
        """Cancel this caller's appointment after phone confirmation.

        Args:
            appointment_id: ID of the appointment the caller explicitly chose to cancel.
        """
        if not call_state["phone_confirmed"] or not call_state["phone_number"]:
            await params.result_callback({"error": "Confirm the caller's read-back number first."})
            return
        if not appointment_id:
            await params.result_callback(
                {"error": "Look up active appointments, ask the caller which one to cancel, then pass its ID."}
            )
            return
        try:
            result = await _in_thread(
                appointment_service.cancel_appointment,
                phone_number=call_state["phone_number"],
                phone_confirmed=True,
                appointment_id=appointment_id,
            )
            await params.result_callback(result)
        except DomainError as error:
            await params.result_callback({"error": error.message, "code": error.code, **error.data})

    stt = ElevenLabsRealtimeSTTService(api_key=os.environ["ELEVENLABS_API_KEY"])
    llm = GroqLLMService(
        api_key=os.environ["GROQ_API_KEY"],
        settings=GroqLLMService.Settings(
            model=os.getenv("GROQ_MODEL", "openai/gpt-oss-120b"),
            system_instruction=SYSTEM_INSTRUCTION,
        ),
    )
    tts_provider = os.getenv("VOICE_TTS_PROVIDER", "elevenlabs").strip().lower()
    if tts_provider == "elevenlabs":
        tts = ElevenLabsTTSService(
            api_key=os.environ["ELEVENLABS_API_KEY"],
            settings=ElevenLabsTTSService.Settings(
                voice=os.environ["ELEVENLABS_VOICE_ID"],
                model="eleven_flash_v2_5",
            ),
            # Send complete sentences as soon as the LLM closes them. This keeps
            # ElevenLabs' low-latency auto mode enabled without sending fragments.
            text_aggregation_mode=TextAggregationMode.SENTENCE,
            auto_mode=True,
            text_transforms=[("*", strip_markdown)],
        )
    elif tts_provider == "groq":
        from pipecat.services.groq.tts import GroqTTSService

        tts = GroqTTSService(
            api_key=os.environ["GROQ_API_KEY"],
            settings=GroqTTSService.Settings(
                model=os.getenv("GROQ_TTS_MODEL", "canopylabs/orpheus-v1-english"),
                voice=os.getenv("GROQ_TTS_VOICE", "autumn"),
            ),
            # Synthesize each short, completed sentence as soon as it arrives
            # instead of waiting for the LLM's entire response.
            text_aggregation_mode=TextAggregationMode.SENTENCE,
            text_transforms=[("*", strip_markdown)],
        )
    else:
        raise RuntimeError("VOICE_TTS_PROVIDER must be 'elevenlabs' or 'groq'.")
    logger.info("Voice TTS provider selected: {}", tts_provider)

    context = LLMContext(
        tools=[
            set_caller_phone,
            confirm_caller_phone,
            check_doctor_availability,
            book_appointment,
            find_caller_appointments,
            cancel_appointment,
        ]
    )
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),
    )
    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_aggregator,
            llm,
            tts,
            transport.output(),
            assistant_aggregator,
        ]
    )
    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
        idle_timeout_secs=runner_args.pipeline_idle_timeout_secs,
    )
    runner = WorkerRunner(handle_sigint=runner_args.handle_sigint)
    await runner.add_workers(worker)

    @transport.event_handler("on_client_connected")
    async def on_client_connected(_, client):
        logger.info("Appointment caller connected: {}", client)
        now = datetime.now(APP_TIMEZONE).strftime("%A, %B %d, %Y at %I:%M %p")
        context.add_message(
            {
                "role": "developer",
                "content": (
                    f"Current local date and time: {now} ({APP_TIMEZONE_NAME}). "
                    "Greet the caller and resolve relative dates using this time."
                ),
            }
        )
        await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(_, client):
        logger.info("Appointment caller disconnected: {}", client)
        await runner.cancel()

    await runner.run()


async def bot(runner_args: RunnerArguments) -> None:
    transport = await create_transport(runner_args, transport_params)
    await run_bot(transport, runner_args)


if __name__ == "__main__":
    # Pipecat's development runner prints Unicode box-drawing characters in its
    # startup banner. Windows consoles may default to cp1252 and crash before
    # the voice server starts, so use UTF-8 for runner output on this entrypoint.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    main()
