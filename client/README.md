# AetherCare React client

This React client follows the supplied Stitch design: a monochrome clinical dashboard with an AI voice consultation, live transcript, appointment history, and available-doctor directory. It uses live values from the existing FastAPI service. It intentionally does not display the sample design's fictional ratings, prices, patient history, or HIPAA claims because the backend does not provide or implement those features.

## Requirements

- Node.js 20 or newer and npm
- The FastAPI server running from `../server` on port `8000`
- The Pipecat voice server on port `7860` for voice calls

## Install and run

Open PowerShell in `D:\Codes\Python\Backend\DoctorsAppointmentAgent\client`:

```powershell
npm install
npm run dev
```

Open <http://127.0.0.1:5173>. Vite proxies `/api/*` requests to the REST service at `http://127.0.0.1:8000`.

Start the REST service in another terminal from `server`:

```powershell
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

For voice calls, start Pipecat in a third terminal from `server`:

```powershell
.\.venv\Scripts\Activate.ps1
python -m app.voice.bot
```

The app shows the REST API connection state in the header. Voice calls request microphone permission from the browser. The default Pipecat endpoint is `http://localhost:7860/api/offer`.

## Configure server URLs

The local defaults work with the backend in this repository. Use **Settings** in the header to override the REST API URL or Pipecat endpoint for this browser; values are stored in `localStorage`. You may also create `.env.local` from `.env.example` and set `VITE_API_BASE_URL` or `VITE_VOICE_ENDPOINT` before starting Vite.

For a Groq TTS provider, the server `.env` can set `VOICE_TTS_PROVIDER=groq`. Groq's Orpheus model requires organization terms acceptance first. ElevenLabs remains the default provider in the server. The voice screen shows the exact Pipecat error and attempts browser speech when the server returns no audio and assistant text is available.

## Features connected to the API

- **Doctors:** reads `GET /api/doctors`, filters by real specialty/name/clinic, and loads the actual open slots from `GET /api/availability` for the selected date.
- **Booking:** submits `POST /api/appointments/book` with the returned slot ID. A booking requires a phone number and explicit confirmation that it was read back to the patient.
- **Appointments:** reads `GET /api/appointments`, separates upcoming, past, and cancelled records, and displays masked phone numbers.
- **Cancellation:** submits `POST /api/appointments/cancel` with the appointment ID and the patient-confirmed phone number.
- **Voice assistant:** uses the Pipecat client over Small WebRTC; shows microphone and assistant captions, allows typed messages during a call, toggles the microphone, and exports the transcript as a text file.

The backend does not currently expose rescheduling, doctor ratings, prices, login, or a patient portal, so those controls are not presented as working features.

## Checks

```powershell
npm run test
npm run build
```

Tests cover API URL construction, error reporting, phone confirmation, booking/cancellation requests, doctor filtering, appointment tabs, and voice TTS error detection. To verify a live API manually, open <http://127.0.0.1:8000/docs> and <http://127.0.0.1:8000/api/health>.
