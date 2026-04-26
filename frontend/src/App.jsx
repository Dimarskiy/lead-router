import { useState, useEffect } from 'react';
import { useAuth, LoginPage } from './Auth.jsx';
import { api } from './api.js';
import Dashboard from './pages/Dashboard.jsx';
import Managers from './pages/Managers.jsx';
import Schedule from './pages/Schedule.jsx';
import Rules from './pages/Rules.jsx';
import Queue from './pages/Queue.jsx';
import Assignments from './pages/Assignments.jsx';
import Analytics from './pages/Analytics.jsx';
import Settings from './pages/Settings.jsx';

const PAGES = [
  { id: 'dashboard',   label: 'Дашборд',    icon: '◈' },
  { id: 'managers',    label: 'Менеджеры',  icon: '◉' },
  { id: 'schedule',    label: 'Расписание', icon: '◴' },
  { id: 'rules',       label: 'Правила',    icon: '◧' },
  { id: 'queue',       label: 'Очередь',    icon: '◫' },
  { id: 'assignments', label: 'Назначения', icon: '◪' },
  { id: 'analytics',   label: 'Аналитика',  icon: '◑' },
  { id: 'settings',    label: 'Настройки',  icon: '◎' },
];

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [queueCount, setQueueCount] = useState(0);
  const { authed, login, logout } = useAuth();

  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    const tick = () => api.getQueue()
      .then(q => { if (!cancelled) setQueueCount(q.count || 0); })
      .catch(() => {});
    tick();
    const id = setInterval(tick, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [authed, page]);

  if (!authed) return <LoginPage onLogin={login} />;
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo"><h1>Lead Router</h1><span>Pipedrive · Slack</span></div>
        <nav>
          {PAGES.map(p => (
            <button key={p.id} className={`nav-item${page === p.id ? ' active' : ''}`} onClick={() => setPage(p.id)}>
              <span className="icon">{p.icon}</span>
              <span style={{ flex: 1, textAlign: 'left' }}>{p.label}</span>
              {p.id === 'queue' && queueCount > 0 && (
                <span style={{
                  background: '#e54d4d', color: '#fff', borderRadius: 99,
                  fontSize: 11, fontWeight: 600, padding: '2px 7px', minWidth: 18, textAlign: 'center',
                }}>{queueCount}</span>
              )}
            </button>
          ))}
        </nav>
        <div style={{ padding:'12px 8px', borderTop:'1px solid var(--border)' }}>
          <button className="nav-item" onClick={logout} style={{ width:'100%', color:'var(--text3)' }}>
            <span className="icon">⏻</span>Выйти
          </button>
        </div>
      </aside>
      <main className="main">
        {page === 'dashboard'   && <Dashboard />}
        {page === 'managers'    && <Managers />}
        {page === 'schedule'    && <Schedule />}
        {page === 'rules'       && <Rules />}
        {page === 'queue'       && <Queue />}
        {page === 'assignments' && <Assignments />}
        {page === 'analytics'   && <Analytics />}
        {page === 'settings'    && <Settings />}
      </main>
    </div>
  );
}
