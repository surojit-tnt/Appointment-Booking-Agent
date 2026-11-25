import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock3, MapPin, Search, Stethoscope } from 'lucide-react';
import { getAvailability, getDoctors } from '../api.js';
import BookingDialog from '../components/BookingDialog.jsx';
import { usePageTools } from '../App.jsx';
import { formatTime, getInitials, todayInTimezone } from '../utils.js';

export default function Doctors() {
  const { notify } = usePageTools();
  const [doctors, setDoctors] = useState([]);
  const [availability, setAvailability] = useState({ slots: [], timezone: 'Asia/Kolkata' });
  const [date, setDate] = useState(() => todayInTimezone());
  const [specialty, setSpecialty] = useState('');
  const [search, setSearch] = useState('');
  const [selectedSlotIds, setSelectedSlotIds] = useState({});
  const [bookingSlot, setBookingSlot] = useState(null);
  const [loadingDoctors, setLoadingDoctors] = useState(true);
  const [loadingAvailability, setLoadingAvailability] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getDoctors().then((result) => { if (active) setDoctors(result); })
      .catch((requestError) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoadingDoctors(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setLoadingAvailability(true);
    getAvailability({ date, specialty, limit: 200 })
      .then((result) => { if (active) { setAvailability(result); setError(''); setSelectedSlotIds({}); } })
      .catch((requestError) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoadingAvailability(false); });
    return () => { active = false; };
  }, [date, specialty]);

  const specialties = useMemo(() => [...new Set(doctors.map((doctor) => doctor.specialty))].sort(), [doctors]);
  const visibleDoctors = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return doctors.filter((doctor) => (!specialty || doctor.specialty === specialty)
      && (!query || `${doctor.name} ${doctor.specialty} ${doctor.location}`.toLocaleLowerCase().includes(query)));
  }, [doctors, search, specialty]);
  const slotsByDoctor = useMemo(() => availability.slots.reduce((groups, slot) => {
    (groups[slot.doctor_id] ||= []).push(slot);
    return groups;
  }, {}), [availability]);

  async function refreshAvailability() {
    const next = await getAvailability({ date, specialty, limit: 200 });
    setAvailability(next);
    setSelectedSlotIds({});
  }

  return (
    <section className="page-section">
      <div className="page-heading directory-heading">
        <div><p className="eyebrow">Clinical directory · 03</p><h1>Available doctors</h1><p className="page-subtitle">Browse the doctors and real open times returned by your clinic schedule.</p></div>
        <label className="search-field"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, specialty, or clinic" aria-label="Search doctors" /></label>
      </div>

      <div className="directory-filters" aria-label="Filter by specialty">
        <button className={`filter-chip ${specialty === '' ? 'selected' : ''}`} type="button" onClick={() => setSpecialty('')}>All specialties</button>
        {specialties.map((item) => <button key={item} className={`filter-chip ${specialty === item ? 'selected' : ''}`} type="button" onClick={() => setSpecialty(specialty === item ? '' : item)}>{item}</button>)}
        <label className="date-filter"><CalendarDays size={15} /><span>Date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Availability date" /></label>
      </div>

      <div className="directory-summary"><span>{loadingDoctors ? 'Loading doctors…' : `${visibleDoctors.length} ${visibleDoctors.length === 1 ? 'doctor' : 'doctors'}`}</span><span>{loadingAvailability ? 'Checking open times…' : `${availability.slots.length} open ${availability.slots.length === 1 ? 'time' : 'times'} · ${availability.timezone || 'clinic local time'}`}</span></div>
      {error && <div className="error-panel" role="alert"><strong>Could not load the doctor schedule</strong><span>{error}</span></div>}
      {loadingDoctors ? <div className="loading-panel">Loading doctors from the clinic API…</div> : visibleDoctors.length ? (
        <div className="doctor-grid">
          {visibleDoctors.map((doctor) => {
            const slots = slotsByDoctor[doctor.id] || [];
            const selected = slots.find((slot) => slot.id === selectedSlotIds[doctor.id]) || slots[0];
            return (
              <article className="doctor-card" key={doctor.id}>
                <div className="doctor-card-top"><div className="doctor-identity"><span className="doctor-avatar">{getInitials(doctor.name)}</span><div><h2>{doctor.name}</h2><p>{doctor.specialty}</p></div></div><span className={`availability-chip ${slots.length ? 'available' : 'unavailable'}`}><i />{slots.length ? 'Open times' : 'No times'}</span></div>
                <div className="doctor-meta"><span><MapPin size={14} />{doctor.location}</span><span><Clock3 size={14} />{doctor.slot_minutes} min visits</span></div>
                <div className="doctor-schedule">
                  <div className="schedule-label"><span>OPEN TIMES</span>{slots.length > 3 && <span>{slots.length} available</span>}</div>
                  {loadingAvailability ? <p className="muted">Checking schedule…</p> : slots.length ? <div className="time-options">{slots.slice(0, 4).map((slot) => <button key={slot.id} type="button" className={`time-option ${selected?.id === slot.id ? 'selected' : ''}`} onClick={() => setSelectedSlotIds((current) => ({ ...current, [doctor.id]: slot.id }))}>{formatTime(slot.starts_at, availability.timezone)}</button>)}</div> : <p className="muted">No open appointments for this date.</p>}
                </div>
                <button className="button button-primary doctor-book" type="button" disabled={!selected || loadingAvailability} onClick={() => setBookingSlot(selected || null)}><CalendarDays size={16} />{selected ? `Book ${formatTime(selected.starts_at, availability.timezone)}` : 'No time to book'}</button>
                <div className="doctor-card-footer"><Stethoscope size={14} /><span>Times are read from the live clinic schedule</span></div>
              </article>
            );
          })}
        </div>
      ) : <div className="empty-state"><span className="empty-icon"><Stethoscope size={22} /></span><h2>No doctors match these filters</h2><p>Try another name or specialty.</p><button className="button button-secondary" type="button" onClick={() => { setSearch(''); setSpecialty(''); }}>Clear filters</button></div>}

      {bookingSlot && <BookingDialog initialSlot={bookingSlot} doctors={doctors} notify={notify} onClose={() => setBookingSlot(null)} onBooked={async () => { setBookingSlot(null); await refreshAvailability(); }} />}
    </section>
  );
}
