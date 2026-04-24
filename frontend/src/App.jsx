import { useState } from 'react';
import { useAuth, LoginPage } from './Auth.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Managers from './pages/Managers.jsx';
import Schedule from './pages/Schedule.jsx';
import Rules from './pages/Rules.jsx';
import Assignments from './pages/Assignments.jsx';
import Analytics from './pages/Analytics.jsx';
import Settings from './pages/Settings.jsx';

const PAGES = [
  { id: 'dashboard',   label: 'Дашборд',    icon: '◈' },
  { id: 'managers',    label: 'Менеджеры',  icon: '◉' },
  { id: 'schedule',    label: 'Расписание', icon: '◴' },
  { id: 'rules',       label: 'Правила',    icon: '◧' },
  { id: 'assignments', label: 'Назначения', icon: '◫' },
  { id: 'analytics',   label: 'Аналитика',  icon: '◑' },
  { id: 'settings',    label: 'Настройки',  icon: '◎' },
];

export default function App() {
  const [page, setPage] = useState('dashboard');
  const { authed, login, logout } = useAuth();
  if (!authed) return <LoginPage onLogin={login} />;
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo"><h1>Lead Router</h1><span>Pipedrive · Slack</span></div>
        <nav>
          {PAGES.map(p => (
            <button key={p.id} className={`nav-item${page === p.id ? ' active' : ''}`} onClick={() => setPage(p.id)}>
              <span className="icon">{p.icon}</span>{p.label}
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
        {page === 'assignments' && <Assignments />}
        {page === 'analytics'   && <Analytics />}
        {page === 'settings'    && <Settings />}
      </main>
    </div>
  );
}
