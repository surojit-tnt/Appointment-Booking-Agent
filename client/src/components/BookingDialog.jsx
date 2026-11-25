import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, MapPin, Stethoscope } from 'lucide-react';
import { bookAppointment, getAvailability } from '../api.js';
import Dialog from './Dialog.jsx';

function formatDate(value, timezone) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeZone: timezone || 'Asia/Kolkata' }).format(new Date(value));
}

function formatTime(value, timezone) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: timezone || 'Asia/Kolkata' }).format(new Date(value));
}

export default function BookingDialog({ initialSlot, initialDoctorId = '', doctors, onClose, onBooked, notify }) {
  const [doctorId, setDoctorId] = useState(initialSlot?.doctor_id || initialDoctorId);
  const [date, setDate] = useState(initialSlot?.starts_at?.slice(0, 10) || '');
  const [availability, setAvailability] = useState(null);
  const [selectedSlotId, setSelectedSlotId] = useState(initialSlot?.id || '');
  const [patientName, setPatientName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneConfirmed, setPhoneConfirmed] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedDoctor = useMemo(() => doctors.find((doctor) => doctor.id === doctorId), [doctors, doctorId]);

  useEffect(() => {
    if (!doctorId || !date) {
      setAvailability(null);
      return undefined;
    }
    let cancelled = false;
    setLoadingSlots(true);
    setError('');
    getAvailability({ doctorId, date, limit: 200 })
      .then((result) => { if (!cancelled) setAvailability(result); })
      .catch((requestError) => { if (!cancelled) setError(requestError.message); })
      .finally(() => { if (!cancelled) setLoadingSlots(false); });
    return () => { cancelled = true; };
  }, [doctorId, date]);

  const slots = availability?.slots || [];
  const selectedSlot = slots.find((slot) => slot.id === selectedSlotId);
  const canSubmit = selectedSlot && phoneNumber.trim() && phoneConfirmed && !saving;

  async function submit(event) {
    event.preventDefault();
    if (!phoneConfirmed) {
      setError('Read the phone number back to the patient and confirm it before booking.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const appointment = await bookAppointment({
        slot_id: selectedSlotId,
        phone_number: phoneNumber.trim(),
        phone_confirmed: true,
        patient_name: patientName.trim() || null,
      });
      notify('Appointment booked successfully.', 'success');
      await onBooked(appointment);
    } catch (requestError) {
      setError(requestError.message);
      if (requestError.code === 'slot_unavailable' || requestError.code === 'slot_not_found') {
        setSelectedSlotId('');
        getAvailability({ doctorId, date, limit: 200 }).then(setAvailability).catch(() => {});
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog title="Book an appointment" eyebrow="New appointment" onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <div className="field-grid">
          <label className="field">
            <span>Doctor</span>
            <select value={doctorId} onChange={(event) => { setDoctorId(event.target.value); setSelectedSlotId(''); }} required>
              <option value="">Select a doctor</option>
              {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name} · {doctor.specialty}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Date</span>
            <input type="date" value={date} onChange={(event) => { setDate(event.target.value); setSelectedSlotId(''); }} required />
          </label>
        </div>

        {selectedDoctor && <div className="doctor-summary"><span className="avatar-initials">{selectedDoctor.name.replace(/^Dr\.?\s*/i, '').split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}</span><span><strong>{selectedDoctor.name}</strong><small><MapPin size={12} />{selectedDoctor.location} · {selectedDoctor.slot_minutes} minutes</small></span></div>}

        <fieldset className="slot-picker" disabled={!doctorId || !date || loadingSlots}>
          <legend>Available times</legend>
          {loadingSlots ? <p className="muted">Loading times…</p> : error && !slots.length ? <p className="inline-error">{error}</p> : slots.length ? (
            <div className="slot-options">
              {slots.map((slot) => <button key={slot.id} type="button" className={`slot-option ${selectedSlotId === slot.id ? 'selected' : ''}`} onClick={() => setSelectedSlotId(slot.id)}>{formatTime(slot.starts_at, availability?.timezone)}</button>)}
            </div>
          ) : <p className="muted">{doctorId && date ? 'No open times for this doctor on this date.' : 'Choose a doctor and date to load open times.'}</p>}
        </fieldset>

        {selectedSlot && <div className="selected-visit"><CalendarDays size={16} /><span>{formatDate(selectedSlot.starts_at, availability?.timezone)} at {formatTime(selectedSlot.starts_at, availability?.timezone)}</span><Stethoscope size={16} /><span>{selectedDoctor?.specialty}</span></div>}

        <div className="field-grid">
          <label className="field"><span>Patient name <small>Optional</small></span><input value={patientName} onChange={(event) => setPatientName(event.target.value)} maxLength={120} placeholder="Patient name" /></label>
          <label className="field"><span>Phone number</span><input type="tel" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} minLength={7} maxLength={30} autoComplete="tel" placeholder="+1 555 123 4567" required /></label>
        </div>
        <label className="confirmation-check"><input type="checkbox" checked={phoneConfirmed} onChange={(event) => setPhoneConfirmed(event.target.checked)} /><span>I read the complete phone number back and the patient confirmed it.</span></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={!canSubmit}>{saving ? 'Booking…' : 'Confirm booking'}</button></div>
      </form>
    </Dialog>
  );
}
