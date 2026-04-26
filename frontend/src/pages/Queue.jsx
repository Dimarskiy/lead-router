import { useEffect, useState } from 'react';
import { api } from '../api.js';

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s.endsWith('Z') ? s : s + 'Z');
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function AssignModal({ lead, managers, onClose, onAssigned }) {
  const [selected, setSelected] = useState(managers[0]?.id || null);
  const [busy, setBusy] = useState(false);

  async function handleAssign() {
    if (!selected) return;
    setBusy(true);
    try {
      await api.assignFromQueue(lead.lead_id, selected);
      onAssigned();
    } catch (err) {
      alert('Ошибка: ' + err.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>Назначить вручную</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
            Лид: <b>{lead.lead_title || lead.lead_id}</b>
          </p>
          <div className="field">
            <label>Менеджер</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {managers.map(m => (
                <label
                  key={m.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                    border: '1px solid', borderColor: selected === m.id ? 'var(--accent)' : 'var(--border2)',
                    borderRadius: 8, cursor: 'pointer',
                    background: selected === m.id ? 'rgba(79,142,247,.10)' : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    checked={selected === m.id}
                    onChange={() => setSelected(m.id)}
                    style={{ margin: 0 }}
                  />
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{m.name}</span>
                  {!m.is_active && <span className="badge badge-gray">выключен</span>}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn btn-primary" onClick={handleAssign} disabled={busy || !selected}>
            {busy ? 'Назначаем...' : 'Назначить'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Queue() {
  const [queue, setQueue] = useState([]);
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [distributing, setDistributing] = useState(false);
  const [assignFor, setAssignFor] = useState(null);

  async function load() {
    const [q, ms] = await Promise.all([api.getQueue(), api.getManagers()]);
    setQueue(q.rows || []);
    setManagers(ms.filter(m => m.is_active));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleDistribute() {
    if (queue.length === 0) return;
    if (!confirm(`Распределить ${queue.length} лидов поровну между ${managers.length} менеджерами?`)) return;
    setDistributing(true);
    try {
      const res = await api.distributeQueue();
      alert(`Распределено: ${res.distributed}`);
      await load();
    } catch (err) {
      alert('Ошибка: ' + err.message);
    } finally { setDistributing(false); }
  }

  async function handleDelete(leadId) {
    if (!confirm('Убрать лид из очереди?')) return;
    await api.deleteFromQueue(leadId);
    load();
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Очередь {queue.length > 0 && <span style={{ color: 'var(--text3)', fontWeight: 400, fontSize: 16 }}>· {queue.length}</span>}</h2>
          <p>Лиды, пришедшие вне рабочих часов. Распредели их вручную утром.</p>
        </div>
        {queue.length > 0 && (
          <button className="btn btn-primary" onClick={handleDistribute} disabled={distributing || managers.length === 0}>
            {distributing ? 'Распределяем...' : `Распределить всё равномерно (${queue.length})`}
          </button>
        )}
      </div>
      <div className="page-body">
        {loading && <div style={{ color: 'var(--text3)' }}>Загрузка...</div>}
        {!loading && queue.length === 0 && (
          <div className="card empty">
            <div className="icon">✓</div>
            <p>Очередь пуста, все лиды распределены.</p>
          </div>
        )}
        {queue.map(lead => (
          <div key={lead.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{lead.lead_title || lead.lead_id}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', display: 'flex', gap: 12 }}>
                <span>🕐 {fmtDate(lead.assigned_at)}</span>
                <span style={{ fontFamily: 'var(--mono)' }}>{lead.lead_id}</span>
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setAssignFor(lead)}>Назначить вручную</button>
            <button className="btn btn-danger btn-sm" onClick={() => handleDelete(lead.lead_id)}>Удалить</button>
          </div>
        ))}
      </div>

      {assignFor && (
        <AssignModal
          lead={assignFor}
          managers={managers}
          onClose={() => setAssignFor(null)}
          onAssigned={() => { setAssignFor(null); load(); }}
        />
      )}
    </>
  );
}
