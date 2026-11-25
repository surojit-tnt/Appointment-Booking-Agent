import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from './App.jsx';
import { isTtsFailure } from './pages/VoiceAgent.jsx';
import * as api from './api.js';

vi.mock('./api.js', async () => {
  const actual = await vi.importActual('./api.js');
  return {
    ...actual,
    getHealth: vi.fn(),
    getDoctors: vi.fn(),
    getAvailability: vi.fn(),
    getAppointments: vi.fn(),
    bookAppointment: vi.fn(),
    cancelAppointment: vi.fn(),
  };
});

const doctors = [
  { id: 'doc-001', name: 'Dr. Asha Mehta', specialty: 'Cardiology', location: 'North Clinic', working_days: [0, 1, 2, 3, 4, 5], available_times: ['09:30'], slot_minutes: 30 },
  { id: 'doc-002', name: 'Dr. Rohan Iyer', specialty: 'Dermatology', location: 'Central Clinic', working_days: [0, 1, 2, 3, 4, 5], available_times: ['10:00'], slot_minutes: 30 },
];
const slots = [
  { id: 'doc-001__20261126T040000Z', doctor_id: 'doc-001', doctor_name: 'Dr. Asha Mehta', specialty: 'Cardiology', location: 'North Clinic', starts_at: '2026-11-26T09:30:00+05:30', duration_minutes: 30, is_available: true },
  { id: 'doc-002__20261126T043000Z', doctor_id: 'doc-002', doctor_name: 'Dr. Rohan Iyer', specialty: 'Dermatology', location: 'Central Clinic', starts_at: '2026-11-26T10:00:00+05:30', duration_minutes: 30, is_available: true },
];
const appointments = [
  { id: 'appt-upcoming', slot_id: slots[0].id, doctor_id: 'doc-001', doctor_name: 'Dr. Asha Mehta', specialty: 'Cardiology', location: 'North Clinic', starts_at: '2027-01-10T09:30:00+05:30', phone_number: '+911234567890', patient_name: 'Sam Patient', status: 'booked', created_at: '2026-11-24T10:00:00Z', cancelled_at: null },
  { id: 'appt-cancelled', slot_id: slots[1].id, doctor_id: 'doc-002', doctor_name: 'Dr. Rohan Iyer', specialty: 'Dermatology', location: 'Central Clinic', starts_at: '2027-01-11T10:00:00+05:30', phone_number: '+911234567891', patient_name: null, status: 'cancelled', created_at: '2026-11-24T11:00:00Z', cancelled_at: '2026-11-24T12:00:00Z' },
];

function renderApp(path = '/assistant') {
  return render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App /></MemoryRouter>);
}

describe('AetherCare client screens', () => {
  beforeEach(() => {
    localStorage.clear();
    api.getHealth.mockResolvedValue({ status: 'ok', storage: 'json' });
    api.getDoctors.mockResolvedValue(doctors);
    api.getAvailability.mockResolvedValue({ date: '2026-11-26', timezone: 'Asia/Kolkata', slots });
    api.getAppointments.mockResolvedValue(appointments);
    api.bookAppointment.mockResolvedValue({ id: 'appt-new', status: 'booked' });
    api.cancelAppointment.mockResolvedValue({ id: 'appt-upcoming', status: 'cancelled' });
  });

  it('renders the consultation screen and API health badge', async () => {
    renderApp();
    expect(await screen.findByText('API Online')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Talk through an appointment.' })).toBeInTheDocument();
    expect(screen.getByText('Your conversation will appear here')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start call/ })).toBeEnabled();
  });

  it('shows doctors from the API and filters by specialty', async () => {
    const user = userEvent.setup();
    renderApp('/doctors');
    expect(await screen.findByRole('heading', { name: 'Dr. Asha Mehta' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dr. Rohan Iyer' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cardiology' }));
    expect(screen.getByRole('heading', { name: 'Dr. Asha Mehta' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Dr. Rohan Iyer' })).not.toBeInTheDocument();
  });

  it('validates and submits a confirmed booking from a doctor slot', async () => {
    const user = userEvent.setup();
    renderApp('/doctors');
    const doctorCard = (await screen.findByRole('heading', { name: 'Dr. Asha Mehta' })).closest('.doctor-card');
    const bookButton = within(doctorCard).getByRole('button', { name: /Book/ });
    await user.click(bookButton);
    expect(await screen.findByRole('dialog', { name: 'Book an appointment' })).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('Patient name'), 'Sam');
    await user.type(screen.getByPlaceholderText('+1 555 123 4567'), '+911234567890');
    const confirm = screen.getByRole('button', { name: 'Confirm booking' });
    expect(confirm).toBeDisabled();
    await user.click(screen.getByText('I read the complete phone number back and the patient confirmed it.'));
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(api.bookAppointment).toHaveBeenCalledWith(expect.objectContaining({
      slot_id: slots[0].id,
      phone_number: '+911234567890',
      phone_confirmed: true,
      patient_name: 'Sam',
    })));
    expect(await screen.findByText('Appointment booked successfully.')).toBeInTheDocument();
  });

  it('switches appointment status tabs and shows matching records', async () => {
    const user = userEvent.setup();
    renderApp('/appointments');
    expect(await screen.findByText('Dr. Asha Mehta')).toBeInTheDocument();
    expect(screen.getByText('Patient: Sam Patient')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Cancelled/ }));
    expect(screen.getByText('Dr. Rohan Iyer')).toBeInTheDocument();
    expect(screen.queryByText('Patient: Sam Patient')).not.toBeInTheDocument();
  });

  it('requires patient confirmation and sends cancellation for the chosen appointment', async () => {
    const user = userEvent.setup();
    renderApp('/appointments');
    await screen.findByText('Dr. Asha Mehta');
    const upcomingRow = screen.getByText('Patient: Sam Patient').closest('.appointment-row');
    await user.click(within(upcomingRow).getByRole('button', { name: 'Cancel' }));
    await user.type(screen.getByPlaceholderText('Enter the confirmed number'), '+911234567890');
    const cancelButton = screen.getByRole('button', { name: 'Confirm cancellation' });
    expect(cancelButton).toBeDisabled();
    await user.click(screen.getByText('I read the complete number back and the patient confirmed it.'));
    await user.click(cancelButton);
    await waitFor(() => expect(api.cancelAppointment).toHaveBeenCalledWith({
      phone_number: '+911234567890', phone_confirmed: true, appointment_id: 'appt-upcoming',
    }));
    expect(await screen.findByText('Appointment cancelled.')).toBeInTheDocument();
  });

  it('recognizes no-audio and provider access errors for the voice fallback', () => {
    expect(isTtsFailure('3 consecutive TTS contexts completed with no audio')).toBe(true);
    expect(isTtsFailure('model_terms_required: terms acceptance required')).toBe(true);
    expect(isTtsFailure('Groq LLM returned a rate limit error')).toBe(false);
  });
});
