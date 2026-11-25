# Doctors Appointment Agent

A local appointment dashboard and voice assistant. The React client reads doctor, availability, and appointment data from a FastAPI service. A separate Pipecat process handles browser voice calls. The server stores demo data in JSON files under `server/data`; it does not require a database.

## Requirements

- Python 3.11 or newer
- Node.js 20 or newer, with npm
- API credentials for voice calls: a Groq API key and an ElevenLabs API key. `ELEVENLABS_VOICE_ID` must be set; the voice needs API access when using ElevenLabs for speech output.

The REST API and dashboard can run without AI credentials. Credentials are required for voice calls.

## Set up the server

Open PowerShell in the repository root and run this once:

```powershell
cd server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Edit `server/.env` and set `GROQ_API_KEY`, `ELEVENLABS_API_KEY`, and `ELEVENLABS_VOICE_ID` before starting the voice service. Keep this file private; it contains secrets and should not be committed.

If PowerShell blocks virtual environment activation, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` in that terminal, then activate the environment again.

## Start the app

Run each component in its own PowerShell terminal. Keep the API running while using the dashboard or voice assistant.

### 1. REST API

In a terminal opened in `server`:

```powershell
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### 2. Voice service

In a second terminal opened in `server`:

```powershell
.\.venv\Scripts\Activate.ps1
python -m app.voice.bot
```

The voice service listens on port `7860`. The browser needs microphone permission to place a voice call.

### 3. React dashboard

In a third terminal opened in `client`:

```powershell
npm install
npm run dev
```

Open <http://127.0.0.1:5173>. Vite forwards `/api` requests to the REST API on port `8000`. The client connects to the voice service at `http://localhost:7860/api/offer` by default.

## Configuration

Server settings belong in `server/.env` (start from `server/.env.example`). Common options:

| Setting | Purpose |
| --- | --- |
| `GROQ_API_KEY` | Groq conversation model credentials; required for voice calls. |
| `ELEVENLABS_API_KEY` | ElevenLabs speech recognition credentials; required for voice calls and ElevenLabs TTS. |
| `ELEVENLABS_VOICE_ID` | API-enabled ElevenLabs voice used when `VOICE_TTS_PROVIDER=elevenlabs`. |
| `VOICE_TTS_PROVIDER` | `elevenlabs` (default) or `groq`. |
| `GROQ_TTS_MODEL`, `GROQ_TTS_VOICE` | Groq speech model and voice when using Groq TTS. The Groq organization may need to accept the model terms before it can generate audio. |
| `APP_TIMEZONE` | Time zone for appointment schedules; defaults to `Asia/Kolkata`. |
| `AVAILABILITY_DAYS` | How many days of appointment slots to offer; defaults to `14`. |
| `DATA_DIR` | JSON storage directory, relative to `server` by default (`./data`). |

The voice pipeline uses ElevenLabs for speech recognition and Groq for conversation and appointment tools. `VOICE_TTS_PROVIDER` selects only the speech output provider. Restart the voice service after changing `.env`.

The client works with the local server defaults. To change its URLs, copy `client/.env.example` to `client/.env.local` and set `VITE_API_BASE_URL` or `VITE_VOICE_ENDPOINT`, or use **Settings** in the dashboard. Leave `VITE_API_BASE_URL` empty to use Vite's local API proxy.

## Useful URLs

- Dashboard: <http://127.0.0.1:5173>
- API health: <http://127.0.0.1:8000/api/health>
- Interactive API docs: <http://127.0.0.1:8000/docs>
- Doctors: <http://127.0.0.1:8000/api/doctors>
- Availability: <http://127.0.0.1:8000/api/availability>
- Appointments: <http://127.0.0.1:8000/api/appointments>
- Pipecat development client: <http://localhost:7860/client/>

## Data and API

`server/data/doctors.json` contains the demo doctors and their weekly schedules. Created and cancelled appointments are saved in `server/data/appointments.json`. The API and voice service share this JSON storage. Appointment schedules use `APP_TIMEZONE`.

Main API routes:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Check the REST service. |
| `GET` | `/api/doctors` | List doctors. |
| `GET` | `/api/availability` | Find available appointment slots. |
| `GET` | `/api/appointments` | List appointments. |
| `POST` | `/api/appointments/book` | Book a slot after phone confirmation. |
| `POST` | `/api/appointments/cancel` | Cancel an appointment after phone confirmation. |

## Development commands

From `client`, run `npm run build` to create a production build or `npm run test` to run the client tests. The API's interactive docs at `/docs` can be used to inspect and call its endpoints.

## Troubleshooting

- **Dashboard cannot load doctors or appointments:** make sure the API is running on port `8000`, then open `/api/health`.
- **Voice call cannot connect:** make sure the voice process is running on port `7860`, allow microphone access in the browser, and check that all three voice credentials/settings are set in `server/.env`.
- **No generated speech:** check the selected TTS provider, API access for the configured voice, and the voice service logs. If using Groq's Orpheus model, its terms may need to be accepted by the Groq organization first.
- **Port is already in use:** stop the other process using that port, then restart the affected service. The Vite development server requires port `5173`.

This project is intended for local demonstration. It has no user authentication, and appointment JSON records can contain patient names and phone numbers. Use synthetic data and keep the server accessible only to trusted local users.
