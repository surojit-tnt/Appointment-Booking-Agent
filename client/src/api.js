export class ApiError extends Error {
  constructor(message, { status = 0, code = '', details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getApiBaseUrl() {
  const saved = typeof localStorage !== 'undefined' && localStorage.getItem('aethercare-api-base');
  const configured = saved || import.meta.env.VITE_API_BASE_URL || '';
  return configured.replace(/\/+$/, '');
}

export function getVoiceEndpoint() {
  const saved = typeof localStorage !== 'undefined' && localStorage.getItem('aethercare-voice-endpoint');
  return saved || import.meta.env.VITE_VOICE_ENDPOINT || 'http://localhost:7860/api/offer';
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, { ...options, headers });
  } catch (cause) {
    throw new ApiError(`Could not reach the API at ${getApiBaseUrl() || 'the configured API origin'}. Check that the REST server is running.`, { details: cause });
  }

  const contentType = response.headers.get('content-type') || '';
  let payload;
  if (contentType.includes('json')) {
    payload = await response.json().catch(() => null);
  } else {
    payload = await response.text().catch(() => '');
  }
  if (!response.ok) {
    const error = payload?.error;
    throw new ApiError(error?.message || payload?.detail || `Request failed with HTTP ${response.status}.`, {
      status: response.status,
      code: error?.code || '',
      details: payload,
    });
  }
  return payload;
}

export const getHealth = () => request('/api/health');
export const getDoctors = (specialty = '') => {
  const query = new URLSearchParams();
  if (specialty) query.set('specialty', specialty);
  return request(`/api/doctors${query.size ? `?${query}` : ''}`);
};
export const getAvailability = ({ doctorId = '', specialty = '', date = '', limit = 200 } = {}) => {
  const query = new URLSearchParams({ limit: String(limit) });
  if (doctorId) query.set('doctor_id', doctorId);
  if (specialty) query.set('specialty', specialty);
  if (date) query.set('date', date);
  return request(`/api/availability?${query}`);
};
export const getAppointments = (status = '') => {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return request(`/api/appointments${query}`);
};
export const bookAppointment = (appointment) => {
  if (appointment.phone_confirmed !== true) {
    throw new ApiError('Confirm that the phone number was read back to the patient before booking.', { code: 'phone_not_confirmed' });
  }
  return request('/api/appointments/book', {
    method: 'POST',
    body: JSON.stringify(appointment),
  });
};
export const cancelAppointment = (appointment) => {
  if (appointment.phone_confirmed !== true) {
    throw new ApiError('Confirm the phone number before cancelling an appointment.', { code: 'phone_not_confirmed' });
  }
  return request('/api/appointments/cancel', {
    method: 'POST',
    body: JSON.stringify(appointment),
  });
};
