# Doctor Appointment Assistant Backend

This backend follows the assignment: a browser dashboard can view doctors and slots, and a Pipecat voice agent can check availability, book, and cancel appointments.

## Stack and storage

- **FastAPI** exposes the dashboard REST API and interactive API docs.
- **Pipecat** runs the browser voice agent over WebRTC.
- **ElevenLabs** provides realtime speech-to-text and streaming text-to-speech.
- **Groq** handles conversation and appointment tool calling through Pipecat's `GroqLLMService`.
- **JSON files only** store the doctor schedule and appointments. There is no database.

The API and voice agent call the same appointment service. Appointment updates are serialized with a cross-process file lock and written using an atomic file replacement, so the API and voice server can run as separate processes against the same JSON file.

## Folder layout

```text
server/
├── app/
│   ├── api/                 # FastAPI routes and request/response schemas
│   ├── core/                # Configuration and domain errors
│   ├── domain/              # Doctor and appointment records
│   ├── repositories/        # JSON file storage
│   ├── services/            # Shared booking, cancellation, and availability logic
│   ├── voice/               # Pipecat pipeline and appointment tools
│   ├── container.py         # Shared service wiring
│   └── main.py              # FastAPI application
├── data/
│   ├── doctors.json         # Mock doctors and weekly schedules
│   └── appointments.json    # Created/updated appointment records
├── .env.example
├── requirements.txt
└── README.md
```

`doctors.json` stores working days as Python weekday numbers: Monday is `0`, Sunday is `6`. `available_times` are local times in the configured `APP_TIMEZONE`. The API generates slot IDs from each doctor's schedule; it does not need a separate slots file. `appointments.json` starts as an empty array and is updated after each booking or cancellation.

## Requirements

- Python 3.11 or newer
- Groq API key and ElevenLabs API key/voice ID to use the voice agent

## Install on Windows PowerShell

Run these commands from the `server` directory:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

The REST API works without AI keys. To run the voice agent with the default ElevenLabs TTS, edit `.env` and set `GROQ_API_KEY`, `ELEVENLABS_API_KEY`, and an `ELEVENLABS_VOICE_ID` enabled for API use on your account. `GROQ_MODEL` defaults to `openai/gpt-oss-120b`. Some free ElevenLabs accounts cannot use shared library voices through the API. The dashboard also has a browser speech fallback when a TTS response contains text but no audio.

To use Groq for speech instead, set `VOICE_TTS_PROVIDER=groq` in `.env`. The current Groq Orpheus English defaults are `GROQ_TTS_MODEL=canopylabs/orpheus-v1-english` and `GROQ_TTS_VOICE=autumn`. Before using that model, the Groq organization admin must accept its terms at <https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english>. If terms are not accepted, Groq returns `model_terms_required` and no audio is generated. Restart the Pipecat voice server after changing `.env`. Do not commit `.env` or real API keys.

## Run the REST API

In the first PowerShell terminal:

```powershell
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

On startup, the server validates `data/doctors.json` and creates `data/appointments.json` if it does not exist.

## Run the frontend dashboard

Keep the REST API running. Use VS Code Live Server on port `3000`, or open a third PowerShell terminal in the `server` directory and run:

```powershell
python -m http.server 3000
```

Open <http://127.0.0.1:3000/frontend/index.html>. The page uses port `8000` for the REST API and port `7860` for the voice call.

## Check the server

Open these URLs in a browser:

- Interactive API docs: <http://127.0.0.1:8000/docs>
- Health check: <http://127.0.0.1:8000/api/health>
- Doctors: <http://127.0.0.1:8000/api/doctors>
- Next available slots: <http://127.0.0.1:8000/api/availability>
- Appointments: <http://127.0.0.1:8000/api/appointments>

The health check should return `{"status":"ok","storage":"json"}`. Each REST response also includes `X-Response-Time-Ms` and `Server-Timing` headers. In PowerShell, inspect a response and its timing header with:

```powershell
$response = Invoke-WebRequest http://127.0.0.1:8000/api/health
$response.Content
$response.Headers['X-Response-Time-Ms']
```

To book a slot manually, first get a slot ID from `/api/availability`, then use the Swagger page at `/docs` to call `POST /api/appointments/book`. The request body is:

```json
{
  "slot_id": "doc-001__20261125T040000Z",
  "phone_number": "+919876543210",
  "phone_confirmed": true,
  "patient_name": "Aarav"
}
```

Use the actual slot ID returned by the server. `phone_confirmed` must only be true after the number has been read back and confirmed. Check `/api/appointments` to see the booking. Cancel using `POST /api/appointments/cancel` with the confirmed phone number; include `appointment_id` if more than one active appointment matches.

## Run the Pipecat voice agent

Keep the REST API running. Open a second PowerShell terminal in the same `server` directory, activate the same environment, and run:

```powershell
.\.venv\Scripts\Activate.ps1
python -m app.voice.bot
```

The Pipecat development runner starts on port `7860`. Open <http://localhost:7860/client/> to connect with its local WebRTC client. A React dashboard can connect to the same Pipecat server with the Pipecat Small WebRTC client transport, while using port `8000` for doctor/slot/appointment data.

The voice pipeline is:

```text
Browser microphone → WebRTC → ElevenLabs realtime STT → Groq tool calling
  → shared appointment service → JSON files → ElevenLabs streaming TTS → browser audio
```

`VOICE_TTS_PROVIDER=groq` swaps only the final TTS stage to Groq; STT remains ElevenLabs and LLM/tool calling remains Groq.

The required tools are `check_doctor_availability`, `book_appointment`, and `cancel_appointment`. The call also uses `set_caller_phone` and `confirm_caller_phone` so booking/cancellation cannot proceed until the caller confirms the number they said. Silero VAD handles speech turns.

## API routes

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/health` | Check API and JSON storage configuration |
| `GET` | `/api/doctors` | List doctors; optional `?specialty=cardiology` |
| `GET` | `/api/doctors/{doctor_id}` | Read a doctor and their schedule |
| `GET` | `/api/availability` | List open slots; optional `doctor_id`, `date=YYYY-MM-DD`, `specialty`, and `limit` |
| `GET` | `/api/appointments` | List appointments; optional `status=booked` or `status=cancelled` |
| `POST` | `/api/appointments/book` | Book an open slot after phone confirmation |
| `POST` | `/api/appointments/cancel` | Cancel by confirmed phone number; optionally select an appointment ID |

## Latency expectation

For this small local JSON dataset, the REST API should generally respond in tens of milliseconds; use **under 100 ms** as the initial local target and check the timing header. That is a target, not a measurement from this machine. A full spoken response takes longer because it waits on STT, Groq, TTS, and network round trips; actual voice latency must be measured with working provider keys and a browser call.

## Reset demo appointments

Stop the API and voice server, then replace the contents of `data/appointments.json` with `[]`. Keep `data/doctors.json` unchanged unless you want to edit the demo doctors/schedules.
