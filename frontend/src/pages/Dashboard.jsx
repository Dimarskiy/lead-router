import { useEffect, useState } from 'react';
import { api } from '../api.js';

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const STATUS_BADGE = {
  pending:    <span className="badge badge-amber">⏳ Ожидает</span>,
  touched:    <span className="badge badge-green">✓ Обработан</span>,
  timed_out:  <span className="badge badge-red">✗ Таймаут</span>,
  reassigned: <span className="badge badge-purple">↻ Переназначен</span>,
};

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.getStats(), api.getAssignments({ limit: 8 })]).then(([s, a]) => {
      setStats(s);
      setRecent(a.rows);
      setLoading(false);
    }).catch(() => setLoading(false));

    const t = setInterval(() => {
      api.getStats().then(setStats);
      api.getAssignments({ limit: 8 }).then(a => setRecent(a.rows));
    }, 15000);
    return () => clearInterval(t);
  }, []);

  if (loading) return (
    <div className="page-body" style={{ color: 'var(--text3)', paddingTop: 60, textAlign: 'center' }}>
      Загрузка...
    </div>
  );

  const s = stats?.stats || {};

  const conversionRate = s.total > 0
    ? Math.round((s.touched / s.total) * 100)
    : 0;

  const timeoutRate = s.total > 0
    ? Math.round((s.timed_out / s.total) * 100)
    : 0;

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Дашборд</h2>
          <p>Обновляется каждые 15 секунд</p>
        </div>
        <span className="badge badge-green">
          <span className="dot dot-green" />
          Система активна
        </span>
      </div>
      <div className="page-body">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="label">Всего лидов</div>
            <div className="value" style={{ color: 'var(--text)' }}>{s.total ?? 0}</div>
          </div>
          <div className="stat-card">
            <div className="label">Ожидают касания</div>
            <div className="value" style={{ color: 'var(--amber)' }}>{s.pending ?? 0}</div>
          </div>
          <div className="stat-card">
            <div className="label">Конверсия</div>
            <div className="value" style={{ color: 'var(--green)' }}>{conversionRate}%</div>
          </div>
          <div className="stat-card">
            <div className="label">Таймаут %</div>
            <div className="value" style={{ color: timeoutRate > 30 ? 'var(--red)' : 'var(--text)' }}>{timeoutRate}%</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* По менеджерам */}
          <div className="card">
            <div className="section-label" style={{ marginBottom: 16 }}>По менеджерам</div>
            {stats?.byManager?.length === 0 && <div className="empty"><p>Нет данных</p></div>}
            {stats?.byManager?.map(m => (
              <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--bg4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
                  {m.name[0]}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{m.name}</div>
                  <div style={{ background: 'var(--bg4)', borderRadius: 99, height: 4, marginTop: 4, overflow: 'hidden' }}>
                    <div style={{ background: 'var(--accent)', height: '100%', width: `${Math.round((m.touched / m.count) * 100)}%`, borderRadius: 99, transition: 'width .5s' }} />
                  </div>
                </div>
                <div style={{ textAlign: 'right', minWidth: 56 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{m.count}</div>
                  <div style={{ fontSize: 11, color: 'var(--green)' }}>{m.count > 0 ? Math.round((m.touched / m.count) * 100) : 0}%</div>
                </div>
              </div>
            ))}
          </div>

          {/* Последние назначения */}
          <div className="card">
            <div className="section-label" style={{ marginBottom: 12 }}>Последние назначения</div>
            {recent.length === 0 && <div className="empty"><p>Нет назначений</p></div>}
            {recent.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', paddingBottom: 10, marginBottom: 10, borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{a.lead_title || a.lead_id}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{a.manager_name} · {fmtTime(a.assigned_at)}</div>
                </div>
                <div>{STATUS_BADGE[a.status] || <span className="badge badge-gray">{a.status}</span>}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
