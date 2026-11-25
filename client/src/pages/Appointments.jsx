import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, Clock3, MapPin, Phone, Plus, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cancelAppointment, getAppointments } from '../api.js';
import Dialog from '../components/Dialog.jsx';
import { usePageTools } from '../App.jsx';
import { formatDateTime, getAppointmentGroup } from '../utils.js';

const tabs = [
  { id: 'upcoming', label: 'Upcoming', icon: CalendarDays },
  { id: 'past', label: 'Past', icon: Check },
  { id: 'cancelled', label: 'Cancelled', icon: XCircle },
];

function maskPhone(value = '') {
  const digits = value.replace(/\D/g, '');
  return digits ? `•••• ${digits.slice(-4)}` : 'Not provided';
}

function AppointmentDetailDialog({ appointment, onClose, onCancel }) {
  return (
    <Dialog title="Appointment details" eyebrow={appointment.status === 'cancelled' ? 'Cancelled visit' : 'Scheduled visit'} onClose={onClose}>
      <div className="detail-list">
        <div><span>Doctor</span><strong>{appointment.doctor_name}</strong></div>
        <div><span>Specialty</span><strong>{appointment.specialty}</strong></div>
        <div><span>Date and time</span><strong>{formatDateTime(appointment.starts_at)}</strong></div>
        <div><span>Clinic</span><strong>{appointment.location}</strong></div>
        <div><span>Patient</span><strong>{appointment.patient_name || 'Name not provided'}</strong></div>
        <div><span>Phone</span><strong>{maskPhone(appointment.phone_number)}</strong></div>
        <div><span>Status</span><strong className="capitalize">{getAppointmentGroup(appointment)}</strong></div>
        {appointment.cancelled_at && <div><span>Cancelled on</span><strong>{formatDateTime(appointment.cancelled_at)}</strong></div>}
      </div>
      <div className="dialog-actions"><button className="button button-secondary" type="button" onClick={onClose}>Close</button>{appointment.status === 'booked' && new Date(appointment.starts_at) > new Date() && <button className="button button-danger" type="button" onClick={onCancel}>Cancel appointment</button>}</div>
    </Dialog>
  );
}

function CancellationDialog({ appointment, onClose, onCancelled, notify }) {
  const [phone, setPhone] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (!confirmed) return setError('Read the complete phone number back and confirm it before cancellation.');
    setSaving(true);
    setError('');
    try {
      await cancelAppointment({ phone_number: phone.trim(), phone_confirmed: true, appointment_id: appointment.id });
      notify('Appointment cancelled.', 'success');
      await onCancelled();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return <Dialog title="Cancel appointment" eyebrow="Patient confirmation required" onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>
      <div className="notice-box"><strong>{appointment.doctor_name}</strong><span>{formatDateTime(appointment.starts_at)} · {appointment.location}</span><small>Enter the phone number on the appointment. The full number is not shown here.</small></div>
      <label className="field"><span>Patient phone number</span><input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} minLength={7} maxLength={30} autoComplete="tel" placeholder="Enter the confirmed number" required /></label>
      <label className="confirmation-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I read the complete number back and the patient confirmed it.</span></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button className="button button-secondary" type="button" onClick={onClose}>Keep appointment</button><button className="button button-danger" disabled={!phone.trim() || !confirmed || saving}>{saving ? 'Cancelling…' : 'Confirm cancellation'}</button></div>
    </form>
  </Dialog>;
}

export default function Appointments() {
  const { notify } = usePageTools();
  const [appointments, setAppointments] = useState([]);
  const [activeTab, setActiveTab] = useState('upcoming');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [cancelling, setCancelling] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setAppointments(await getAppointments()); }
    catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const grouped = useMemo(() => appointments.reduce((result, appointment) => {
    result[getAppointmentGroup(appointment)].push(appointment);
    return result;
  }, { upcoming: [], past: [], cancelled: [] }), [appointments]);
  const visible = [...grouped[activeTab]].sort((a, b) => {
    const difference = new Date(a.starts_at) - new Date(b.starts_at);
    return activeTab === 'upcoming' ? difference : -difference;
  });

  async function openCancel(appointment) {
    setSelected(null);
    setCancelling(appointment);
  }

  async function completeCancellation() {
    setCancelling(null);
    await refresh();
  }

  return (
    <section className="page-section">
      <div className="page-heading appointments-heading">
        <div><p className="eyebrow">01 / Clinical schedule <span className="sync-dot"><i />Live sync</span></p><h1>Appointments</h1><p className="page-subtitle">Review visits created by the appointment API and manage active bookings.</p></div>
        <Link className="button button-primary" to="/doctors"><Plus size={17} />New appointment</Link>
      </div>

      <div className="appointment-stats">
        <div className="mini-stat"><span>Upcoming</span><strong>{grouped.upcoming.length}</strong><small>Active future bookings</small></div>
        <div className="mini-stat"><span>Past</span><strong>{grouped.past.length}</strong><small>Booked visits in the past</small></div>
        <div className="mini-stat"><span>Cancelled</span><strong>{grouped.cancelled.length}</strong><small>Cancelled in the JSON records</small></div>
      </div>

      <div className="appointments-layout">
        <section className="panel appointment-list-panel">
          <div className="panel-heading"><div><p className="eyebrow">Your clinic schedule</p><h2>Appointment history</h2></div><button className="button button-small button-secondary" type="button" onClick={refresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
          <div className="segmented-tabs" role="tablist" aria-label="Appointment status">
            {tabs.map(({ id, label, icon: Icon }) => <button key={id} role="tab" aria-selected={activeTab === id} className={activeTab === id ? 'active' : ''} type="button" onClick={() => setActiveTab(id)}><Icon size={15} />{label}<span>{grouped[id].length}</span></button>)}
          </div>
          {error && <div className="error-panel" role="alert"><strong>Could not load appointments</strong><span>{error}</span></div>}
          {loading ? <div className="loading-panel">Loading appointment records…</div> : visible.length ? <div className="appointment-list">
            {visible.map((appointment) => {
              const group = getAppointmentGroup(appointment);
              return <article className="appointment-row" key={appointment.id}>
                <div className={`appointment-date-block ${group}`}><span>{new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(appointment.starts_at)).toUpperCase()}</span><strong>{new Intl.DateTimeFormat(undefined, { day: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(appointment.starts_at))}</strong><small>{formatTimeOfDay(appointment.starts_at)}</small></div>
                <div className="appointment-info"><div className="appointment-title-line"><h3>{appointment.doctor_name}</h3><span className={`status-label ${group}`}>{group}</span></div><p>{appointment.specialty} · {appointment.location}</p><div className="appointment-meta"><span><Clock3 size={13} />{formatDateTime(appointment.starts_at)}</span><span><Phone size={13} />{maskPhone(appointment.phone_number)}</span></div>{appointment.patient_name && <small className="patient-name">Patient: {appointment.patient_name}</small>}</div>
                <div className="appointment-actions"><button className="button button-small button-secondary" type="button" onClick={() => setSelected(appointment)}>Details</button>{appointment.status === 'booked' && group === 'upcoming' && <button className="text-danger" type="button" onClick={() => setCancelling(appointment)}>Cancel</button>}</div>
              </article>;
            })}
          </div> : <div className="empty-state compact"><span className="empty-icon"><CalendarDays size={22} /></span><h2>No {activeTab} appointments</h2><p>Bookings made by the voice assistant or this dashboard will appear here.</p>{activeTab === 'upcoming' && <Link className="button button-primary" to="/doctors"><Plus size={15} />Find a time</Link>}</div>}
        </section>

        <aside className="schedule-aside"><div className="panel schedule-note"><p className="eyebrow">Live data</p><h2>Connected to your JSON schedule</h2><p>The page refreshes from <code>/api/appointments</code>. New appointments appear after the server confirms the booking.</p><div className="aside-fact"><CalendarDays size={16} /><span>Clinic timezone: Asia/Kolkata</span></div><div className="aside-fact"><MapPin size={16} /><span>Locations come from doctors.json</span></div><Link to="/doctors" className="button button-secondary full-width">Browse available doctors</Link></div></aside>
      </div>

      {selected && <AppointmentDetailDialog appointment={selected} onClose={() => setSelected(null)} onCancel={() => openCancel(selected)} />}
      {cancelling && <CancellationDialog key={cancelling.id} appointment={cancelling} notify={notify} onClose={() => setCancelling(null)} onCancelled={completeCancellation} />}
    </section>
  );
}

function formatTimeOfDay(value) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(value));
}
