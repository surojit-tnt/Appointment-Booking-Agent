import { createContext, useContext, useEffect, useState } from 'react';
import { Activity, CalendarDays, CircleHelp, Settings2, Stethoscope, X } from 'lucide-react';
import { Link, NavLink, Outlet, Route, Routes, Navigate, useOutletContext } from 'react-router-dom';
import { getApiBaseUrl, getHealth, getVoiceEndpoint } from './api.js';
import Dialog from './components/Dialog.jsx';
import VoiceAgent from './pages/VoiceAgent.jsx';
import Appointments from './pages/Appointments.jsx';
import Doctors from './pages/Doctors.jsx';
import './styles.css';

const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);
export const usePageTools = () => useOutletContext();

function SettingsDialog({ onClose }) {
  const [apiUrl, setApiUrl] = useState(getApiBaseUrl());
  const [voiceEndpoint, setVoiceEndpoint] = useState(getVoiceEndpoint());
  const [saved, setSaved] = useState(false);

  function save(event) {
    event.preventDefault();
    if (apiUrl.trim()) localStorage.setItem('aethercare-api-base', apiUrl.trim().replace(/\/+$/, ''));
    else localStorage.removeItem('aethercare-api-base');
    localStorage.setItem('aethercare-voice-endpoint', voiceEndpoint.trim() || 'http://localhost:7860/api/offer');
    setSaved(true);
    window.setTimeout(() => window.location.reload(), 350);
  }

  return (
    <Dialog title="Connection settings" eyebrow="Local development" onClose={onClose}>
      <form className="form-stack" onSubmit={save}>
        <p className="muted">These values are saved in this browser only. Leave the API URL blank to use the local Vite proxy to port 8000.</p>
        <label className="field"><span>REST API base URL</span><input value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} placeholder="Blank uses /api via the Vite proxy" /></label>
        <label className="field"><span>Pipecat WebRTC endpoint</span><input value={voiceEndpoint} onChange={(event) => setVoiceEndpoint(event.target.value)} placeholder="http://localhost:7860/api/offer" /></label>
        <div className="dialog-actions"><button className="button button-secondary" type="button" onClick={onClose}>Close</button><button className="button button-primary" type="submit">{saved ? 'Saved' : 'Save settings'}</button></div>
      </form>
    </Dialog>
  );
}

function AppShell() {
  const [apiState, setApiState] = useState('checking');
  const [showSettings, setShowSettings] = useState(false);
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    let live = true;
    let inFlight = false;
    const check = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const health = await getHealth();
        if (live) setApiState(health?.status === 'ok' ? 'online' : 'offline');
      } catch {
        if (live) setApiState('offline');
      } finally {
        inFlight = false;
      }
    };
    check();
    const timer = window.setInterval(check, 15000);
    return () => { live = false; window.clearInterval(timer); };
  }, []);

  function notify(message, type = 'success') {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current, { id, message, type }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4500);
  }

  return (
    <ToastContext.Provider value={notify}>
      <div className="app-frame">
        <header className="topbar">
          <Link className="brand" to="/assistant" aria-label="AetherCare home">
            <span className="brand-mark"><Activity size={18} strokeWidth={2.4} /></span>
            <span>AetherCare</span>
          </Link>
          <nav className="main-nav" aria-label="Main navigation">
            <NavLink to="/assistant" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}><Activity size={16} />AI Agent</NavLink>
            <NavLink to="/appointments" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}><CalendarDays size={16} />Appointments</NavLink>
            <NavLink to="/doctors" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}><Stethoscope size={16} />Available Doctors</NavLink>
          </nav>
          <div className="top-actions">
            <span className={`system-status ${apiState}`} title={apiState === 'online' ? 'REST API is responding' : apiState === 'checking' ? 'Checking REST API' : 'REST API cannot be reached'}>
              <i />{apiState === 'online' ? 'API Online' : apiState === 'checking' ? 'Checking' : 'API Offline'}
            </span>
            <button className="header-tool" type="button" onClick={() => setShowSettings(true)}><Settings2 size={15} /> Settings</button>
            <span className="account-mark" aria-label="Clinic admin">CA</span>
          </div>
        </header>

        <main className="main-content"><Outlet context={{ notify, apiState }} /></main>
        <footer className="site-footer"><span>© {new Date().getFullYear()} AetherCare · Local appointment assistant</span><span><CircleHelp size={13} /> JSON-backed demo · No patient portal or authentication is configured</span></footer>
        {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
        <div className="toast-stack" aria-live="polite">{toasts.map((toast) => <div key={toast.id} className={`toast toast-${toast.type}`}><span>{toast.message}</span><button type="button" aria-label="Dismiss notification" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}><X size={14} /></button></div>)}</div>
      </div>
    </ToastContext.Provider>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/assistant" replace />} />
        <Route path="/assistant" element={<VoiceAgent />} />
        <Route path="/appointments" element={<Appointments />} />
        <Route path="/doctors" element={<Doctors />} />
        <Route path="*" element={<section className="empty-page"><h1>Page not found</h1><Link className="button button-primary" to="/assistant">Go to voice assistant</Link></section>} />
      </Route>
    </Routes>
  );
}
