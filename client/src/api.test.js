import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  bookAppointment,
  cancelAppointment,
  getAppointments,
  getAvailability,
  getDoctors,
  getHealth,
} from './api.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('clinic API client', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reads the health endpoint', async () => {
    fetch.mockResolvedValue(jsonResponse({ status: 'ok', storage: 'json' }));
    await expect(getHealth()).resolves.toEqual({ status: 'ok', storage: 'json' });
    expect(fetch).toHaveBeenCalledWith('/api/health', expect.objectContaining({ headers: expect.any(Headers) }));
  });

  it('filters doctors by specialty query', async () => {
    fetch.mockResolvedValue(jsonResponse([]));
    await getDoctors('Cardiology');
    expect(fetch.mock.calls[0][0]).toBe('/api/doctors?specialty=Cardiology');
  });

  it('builds availability query from selected doctor, date and specialty', async () => {
    fetch.mockResolvedValue(jsonResponse({ date: '2026-11-26', timezone: 'Asia/Kolkata', slots: [] }));
    await getAvailability({ doctorId: 'doc-001', specialty: 'Cardiology', date: '2026-11-26', limit: 200 });
    expect(fetch.mock.calls[0][0]).toBe('/api/availability?limit=200&doctor_id=doc-001&specialty=Cardiology&date=2026-11-26');
  });

  it('filters appointment status', async () => {
    fetch.mockResolvedValue(jsonResponse([]));
    await getAppointments('cancelled');
    expect(fetch.mock.calls[0][0]).toBe('/api/appointments?status=cancelled');
  });

  it('requires confirmation before sending a booking request', async () => {
    const payload = { slot_id: 'doc-001__20261126T040000Z', phone_number: '+911234567890', phone_confirmed: false };
    expect(() => bookAppointment(payload)).toThrow('Confirm that the phone number was read back');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('posts a confirmed appointment and patient name', async () => {
    const appointment = { id: 'appt-1', status: 'booked' };
    fetch.mockResolvedValue(jsonResponse(appointment, 201));
    const payload = { slot_id: 'doc-001__20261126T040000Z', phone_number: '+911234567890', phone_confirmed: true, patient_name: 'Sam' };
    await expect(bookAppointment(payload)).resolves.toEqual(appointment);
    expect(fetch.mock.calls[0][0]).toBe('/api/appointments/book');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(payload);
  });

  it('posts confirmed appointment cancellation with the selected ID', async () => {
    fetch.mockResolvedValue(jsonResponse({ id: 'appt-1', status: 'cancelled' }));
    await cancelAppointment({ phone_number: '+911234567890', phone_confirmed: true, appointment_id: 'appt-1' });
    expect(fetch.mock.calls[0][0]).toBe('/api/appointments/cancel');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ phone_number: '+911234567890', phone_confirmed: true, appointment_id: 'appt-1' });
  });

  it('surfaces backend domain errors with their exact message and code', async () => {
    fetch.mockResolvedValue(jsonResponse({ error: { code: 'slot_unavailable', message: 'That slot has just been taken.' } }, 409));
    await expect(getHealth()).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'slot_unavailable',
      message: 'That slot has just been taken.',
    });
  });

  it('reports network failures as an actionable API error', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(getHealth()).rejects.toBeInstanceOf(ApiError);
    await expect(getHealth()).rejects.toThrow('Check that the REST server is running');
  });
});
