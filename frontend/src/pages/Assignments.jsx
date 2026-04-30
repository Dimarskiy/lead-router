import { useEffect, useState } from 'react';
import { api } from '../api.js';

const STATUS_OPTS = [
  { value: '', label: 'Все статусы' },
  { value: 'pending', label: '⏳ Ожидает' },
  { value: 'touched', label: '✓ Обработан' },
  { value: 'timed_out', label: '✗ Таймаут' },
  { value: 'reassigned', label: '↻ Переназначен' },
];

const STATUS_BADGE = {
  pending:    <span className="badge badge-amber">⏳ Ожидает</span>,
  touched:    <span className="badge badge-green">✓ Обработан</span>,
  timed_out:  <span className="badge badge-red">✗ Таймаут</span>,
  reassigned: <span className="badge badge-purple">↻ Переназначен</span>,
};

function parseUTC(iso) {
  if (!iso) return null;
  // SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" without timezone —
  // browsers interpret that as local time, but it's actually UTC. Force UTC.
  return new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
}

function fmtTime(iso) {
  if (!iso) return '—';
  return parseUTC(iso).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function timeLeft(deadlineIso) {
  const diff = parseUTC(deadlineIso) - Date.now();
  if (diff <= 0) return <span style={{ color: 'var(--red)', fontSize: 12 }}>просрочен</span>;
  const mins = Math.ceil(diff / 60000);
  return <span style={{ color: 'var(--amber)', fontSize: 12 }}>{mins} мин</span>;
}

export default function Assignments() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const LIMIT = 20;

  const load = (s, p) =>
    api.getAssignments({ status: s, limit: LIMIT, offset: p * LIMIT })
      .then(res => { setRows(res.rows); setTotal(res.total); });

  useEffect(() => { load(status, page); }, [status, page]);
  useEffect(() => { const t = setInterval(() => load(status, page), 15000); return () => clearInterval(t); }, [status, page]);

  function onStatusChange(v) { setStatus(v); setPage(0); }

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Журнал назначений</h2>
          <p>Обновляется каждые 15 секунд</p>
        </div>
        <select className="select" style={{ width: 180 }} value={status} onChange={e => onStatusChange(e.target.value)}>
          {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div className="page-body">
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Лид</th>
                  <th>Менеджер</th>
                  <th>Назначен</th>
                  <th>Дедлайн</th>
                  <th>Переназначений</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text3)', padding: '32px' }}>Нет записей</td></tr>
                )}
                {rows.map(r => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{r.lead_title || r.lead_id}</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>{r.lead_id}</div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: '#fff', flexShrink: 0 }}>
                          {(r.manager_name || '?')[0].toUpperCase()}
                        </div>
                        <span>{r.manager_name || '—'}</span>
                      </div>
                    </td>
                    <td style={{ color: 'var(--text2)', fontSize: 13 }}>{fmtTime(r.assigned_at)}</td>
                    <td>
                      {r.status === 'pending' ? timeLeft(r.deadline_at) : <span style={{ color: 'var(--text3)', fontSize: 12 }}>{fmtTime(r.deadline_at)}</span>}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {r.reassign_count > 0
                        ? <span className="badge badge-purple">{r.reassign_count}×</span>
                        : <span style={{ color: 'var(--text3)' }}>—</span>}
                    </td>
                    <td>{STATUS_BADGE[r.status] || <span className="badge badge-gray">{r.status}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {total > LIMIT && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>
                {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} из {total}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Назад</button>
                <button className="btn btn-ghost btn-sm" disabled={(page + 1) * LIMIT >= total} onClick={() => setPage(p => p + 1)}>Вперёд →</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
