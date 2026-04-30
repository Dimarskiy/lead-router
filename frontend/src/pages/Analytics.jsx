import { useEffect, useState } from 'react';
import { api } from '../api.js';

function parseUTC(iso) {
  if (!iso) return null;
  // SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" without timezone —
  // browsers interpret that as local time, but it's actually UTC. Force UTC.
  return new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
}

function fmtDate(iso) {
  if (!iso) return '—';
  return parseUTC(iso).toLocaleDateString('ru', { day: '2-digit', month: '2-digit' });
}

function avgMinutes(rows) {
  const touched = rows.filter(r => r.touched_at && r.assigned_at);
  if (!touched.length) return null;
  const avg = touched.reduce((sum, r) => sum + (parseUTC(r.touched_at) - parseUTC(r.assigned_at)) / 60000, 0) / touched.length;
  return Math.round(avg);
}

export default function Analytics() {
  const [assignments, setAssignments] = useState([]);
  const [period, setPeriod] = useState('7');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAssignments({ limit: 500 }).then(a => { setAssignments(a.rows); setLoading(false); });
  }, []);

  if (loading) return <div className="page-body" style={{ color: 'var(--text3)' }}>Загрузка...</div>;

  const days = parseInt(period);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const filtered = assignments.filter(a => parseUTC(a.assigned_at) > since);

  const total = filtered.length;
  const touched = filtered.filter(a => a.status === 'touched').length;
  const timedOut = filtered.filter(a => a.status === 'timed_out').length;
  const convRate = total > 0 ? Math.round((touched / total) * 100) : 0;
  const avgTime = avgMinutes(filtered);

  const byManager = {};
  filtered.forEach(a => {
    if (!byManager[a.manager_name]) byManager[a.manager_name] = { total: 0, touched: 0, timed_out: 0, times: [] };
    byManager[a.manager_name].total++;
    if (a.status === 'touched') {
      byManager[a.manager_name].touched++;
      if (a.touched_at && a.assigned_at) byManager[a.manager_name].times.push((parseUTC(a.touched_at) - parseUTC(a.assigned_at)) / 60000);
    }
    if (a.status === 'timed_out') byManager[a.manager_name].timed_out++;
  });

  const dailyData = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const dayStr = fmtDate(day.toISOString());
    const dayRows = filtered.filter(a => fmtDate(a.assigned_at) === dayStr);
    dailyData.push({ day: dayStr, total: dayRows.length, touched: dayRows.filter(a => a.status === 'touched').length });
  }
  const maxDaily = Math.max(...dailyData.map(d => d.total), 1);

  return (
    <>
      <div className="page-header">
        <div><h2>Аналитика</h2><p>Статистика распределения лидов</p></div>
        <select className="select" style={{ width: 180 }} value={period} onChange={e => setPeriod(e.target.value)}>
          <option value="7">Последние 7 дней</option>
          <option value="14">Последние 14 дней</option>
          <option value="30">Последние 30 дней</option>
        </select>
      </div>
      <div className="page-body">
        <div className="stats-grid" style={{ marginBottom: 24 }}>
          <div className="stat-card">
            <div className="label">Лидов за период</div>
            <div className="value" style={{ color: 'var(--text)' }}>{total}</div>
          </div>
          <div className="stat-card">
            <div className="label">Конверсия</div>
            <div className="value" style={{ color: convRate > 50 ? 'var(--green)' : 'var(--amber)' }}>{convRate}%</div>
          </div>
          <div className="stat-card">
            <div className="label">Среднее время касания</div>
            <div className="value" style={{ color: 'var(--accent)', fontSize: 22 }}>{avgTime !== null ? `${avgTime} мин` : '—'}</div>
          </div>
          <div className="stat-card">
            <div className="label">Таймаутов</div>
            <div className="value" style={{ color: timedOut > 0 ? 'var(--red)' : 'var(--text)' }}>{timedOut}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div className="card">
            <div className="section-label" style={{ marginBottom: 16 }}>Лиды по дням</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }}>
              {dailyData.map((d, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: 100, gap: 1 }}>
                    <div style={{ background: 'var(--green)', height: `${(d.touched / maxDaily) * 100}%`, borderRadius: '2px 2px 0 0', minHeight: d.touched > 0 ? 3 : 0, opacity: 0.8 }} />
                    <div style={{ background: 'var(--accent)', height: `${((d.total - d.touched) / maxDaily) * 100}%`, minHeight: (d.total - d.touched) > 0 ? 3 : 0, opacity: 0.4 }} />
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{d.day}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text3)' }}>
                <div style={{ width: 10, height: 10, background: 'var(--green)', borderRadius: 2 }} /> Обработано
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text3)' }}>
                <div style={{ width: 10, height: 10, background: 'var(--accent)', borderRadius: 2, opacity: 0.4 }} /> Не обработано
              </div>
            </div>
          </div>

          <div className="card">
            <div className="section-label" style={{ marginBottom: 16 }}>По менеджерам</div>
            {Object.keys(byManager).length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13 }}>Нет данных за период</div>}
            {Object.entries(byManager).sort((a, b) => b[1].total - a[1].total).map(([name, data]) => {
              const conv = data.total > 0 ? Math.round((data.touched / data.total) * 100) : 0;
              const avgT = data.times.length > 0 ? Math.round(data.times.reduce((a, b) => a + b, 0) / data.times.length) : null;
              return (
                <div key={name} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: '#fff' }}>{name[0]?.toUpperCase()}</div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{data.total} лидов · {avgT !== null ? `avg ${avgT} мин` : 'нет касаний'}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 16, fontWeight: 600, fontFamily: 'var(--mono)', color: conv > 50 ? 'var(--green)' : 'var(--amber)' }}>{conv}%</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{data.timed_out} таймаутов</div>
                    </div>
                  </div>
                  <div style={{ background: 'var(--bg4)', borderRadius: 99, height: 5, overflow: 'hidden' }}>
                    <div style={{ background: conv > 50 ? 'var(--green)' : 'var(--amber)', height: '100%', width: `${conv}%`, borderRadius: 99 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="section-label" style={{ marginBottom: 16 }}>🏆 Рейтинг менеджеров</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>#</th><th>Менеджер</th><th>Лидов</th><th>Обработано</th><th>Таймаутов</th><th>Конверсия</th><th>Avg время</th></tr>
              </thead>
              <tbody>
                {Object.entries(byManager).sort((a, b) => (b[1].total > 0 ? b[1].touched/b[1].total : 0) - (a[1].total > 0 ? a[1].touched/a[1].total : 0)).map(([name, data], idx) => {
                  const conv = data.total > 0 ? Math.round((data.touched / data.total) * 100) : 0;
                  const avgT = data.times.length > 0 ? Math.round(data.times.reduce((a, b) => a + b, 0) / data.times.length) : null;
                  const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`;
                  return (
                    <tr key={name}>
                      <td style={{ fontSize: 16 }}>{medal}</td>
                      <td style={{ fontWeight: 500 }}>{name}</td>
                      <td style={{ fontFamily: 'var(--mono)' }}>{data.total}</td>
                      <td style={{ fontFamily: 'var(--mono)', color: 'var(--green)' }}>{data.touched}</td>
                      <td style={{ fontFamily: 'var(--mono)', color: data.timed_out > 0 ? 'var(--red)' : 'var(--text3)' }}>{data.timed_out}</td>
                      <td><span className={`badge ${conv > 60 ? 'badge-green' : conv > 30 ? 'badge-amber' : 'badge-red'}`}>{conv}%</span></td>
                      <td style={{ color: 'var(--text2)', fontSize: 13 }}>{avgT !== null ? `${avgT} мин` : '—'}</td>
                    </tr>
                  );
                })}
                {Object.keys(byManager).length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text3)', padding: 32 }}>Нет данных за выбранный период</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
