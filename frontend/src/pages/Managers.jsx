import { useEffect, useState } from 'react';
import { api } from '../api.js';

const SHIFT_PRESETS = [
  { label: '8–16',  start: '08:00', end: '16:00' },
  { label: '9–17',  start: '09:00', end: '17:00' },
  { label: '12–20', start: '12:00', end: '20:00' },
  { label: '14–22', start: '14:00', end: '22:00' },
  { label: '24/7',  start: '',      end: ''      },
];

function matchPreset(start, end) {
  if (!start && !end) return '24/7';
  const p = SHIFT_PRESETS.find(p => p.start === start && p.end === end);
  return p ? p.label : 'custom';
}

function ManagerModal({ manager, onClose, onSave }) {
  const [form, setForm] = useState({
    name: manager?.name || '',
    slack_user_id: manager?.slack_user_id || '',
    pipedrive_user_id: manager?.pipedrive_user_id || '',
    manager_type: manager?.manager_type || 'full',
    shift_start: manager?.shift_start || '09:00',
    shift_end:   manager?.shift_end   || '17:00',
  });
  const [shiftMode, setShiftMode] = useState(() =>
    manager ? matchPreset(manager.shift_start || '', manager.shift_end || '') : '9–17'
  );
  const [pdUsers, setPdUsers] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getPipedriveUsers().then(setPdUsers).catch(() => {});
  }, []);

  function applyPreset(label) {
    setShiftMode(label);
    const p = SHIFT_PRESETS.find(p => p.label === label);
    if (p) setForm(f => ({ ...f, shift_start: p.start, shift_end: p.end }));
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        shift_start: form.shift_start || null,
        shift_end:   form.shift_end   || null,
      };
      if (manager?.id) await api.updateManager(manager.id, payload);
      else await api.createManager(payload);
      onSave();
    } finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>{manager ? 'Редактировать менеджера' : 'Добавить менеджера'}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Имя *</label>
            <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Иван Петров" />
          </div>
          <div className="field">
            <label>Slack User ID</label>
            <input className="input" value={form.slack_user_id} onChange={e => setForm(f => ({ ...f, slack_user_id: e.target.value }))} placeholder="U01ABC123 (из профиля Slack)" />
            <p style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 4 }}>Если задан — уведомление придёт лично, иначе в канал по умолчанию</p>
          </div>
          <div className="field">
            <label>Тип занятости</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { v: 'full', l: 'Фулл-таймер (100%)' },
                { v: 'part', l: 'Парт-таймер (60%)' },
              ].map(opt => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, manager_type: opt.v }))}
                  style={{
                    flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                    border: '1px solid',
                    borderColor: form.manager_type === opt.v ? 'var(--accent)' : 'var(--border2)',
                    background: form.manager_type === opt.v ? 'rgba(79,142,247,.12)' : 'transparent',
                    color: form.manager_type === opt.v ? 'var(--accent)' : 'var(--text2)',
                    cursor: 'pointer',
                  }}
                >{opt.l}</button>
              ))}
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 4 }}>
              Парт-таймеры получают лиды реже — соотношение 100/60 (настраивается в Настройках).
            </p>
          </div>

          <div className="field">
            <label>Рабочая смена</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {SHIFT_PRESETS.map(p => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPreset(p.label)}
                  style={{
                    padding: '5px 10px', borderRadius: 99, fontSize: 12, fontWeight: 500,
                    border: '1px solid',
                    borderColor: shiftMode === p.label ? 'var(--accent)' : 'var(--border2)',
                    background: shiftMode === p.label ? 'rgba(79,142,247,.12)' : 'transparent',
                    color: shiftMode === p.label ? 'var(--accent)' : 'var(--text2)',
                    cursor: 'pointer',
                  }}
                >{p.label}</button>
              ))}
              <button
                type="button"
                onClick={() => setShiftMode('custom')}
                style={{
                  padding: '5px 10px', borderRadius: 99, fontSize: 12, fontWeight: 500,
                  border: '1px solid',
                  borderColor: shiftMode === 'custom' ? 'var(--accent)' : 'var(--border2)',
                  background: shiftMode === 'custom' ? 'rgba(79,142,247,.12)' : 'transparent',
                  color: shiftMode === 'custom' ? 'var(--accent)' : 'var(--text2)',
                  cursor: 'pointer',
                }}
              >✎ свой</button>
            </div>
            {shiftMode !== '24/7' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input className="input" type="time" value={form.shift_start}
                  onChange={e => { setShiftMode('custom'); setForm(f => ({ ...f, shift_start: e.target.value })); }}
                  style={{ maxWidth: 120 }} />
                <span style={{ color: 'var(--text3)' }}>—</span>
                <input className="input" type="time" value={form.shift_end}
                  onChange={e => { setShiftMode('custom'); setForm(f => ({ ...f, shift_end: e.target.value })); }}
                  style={{ maxWidth: 120 }} />
              </div>
            )}
            <p style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 4 }}>
              Вне смены менеджер не получает лиды. 24/7 — всегда доступен.
            </p>
          </div>

          <div className="field">
            <label>Pipedrive пользователь</label>
            {pdUsers.length > 0 ? (
              <select className="select" value={form.pipedrive_user_id} onChange={e => setForm(f => ({ ...f, pipedrive_user_id: e.target.value }))}>
                <option value="">— не привязан —</option>
                {pdUsers.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
              </select>
            ) : (
              <input className="input" value={form.pipedrive_user_id} onChange={e => setForm(f => ({ ...f, pipedrive_user_id: e.target.value }))} placeholder="ID пользователя Pipedrive" />
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Сохраняем...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Managers() {
  const [managers, setManagers] = useState([]);
  const [modal, setModal] = useState(null); // null | 'add' | manager object
  const [dragging, setDragging] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => api.getManagers().then(setManagers).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  async function toggleActive(m) {
    await api.updateManager(m.id, { is_active: m.is_active ? 0 : 1 });
    load();
  }

  async function deleteManager(id) {
    if (!confirm('Удалить менеджера?')) return;
    await api.deleteManager(id);
    load();
  }

  // Drag-and-drop reorder
  function onDragStart(e, idx) {
    setDragging(idx);
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(e, idx) {
    e.preventDefault();
    if (dragging === null || dragging === idx) return;
    const reordered = [...managers];
    const [item] = reordered.splice(dragging, 1);
    reordered.splice(idx, 0, item);
    setManagers(reordered);
    setDragging(idx);
  }
  async function onDrop() {
    setDragging(null);
    await api.reorderManagers(managers.map(m => m.id));
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Менеджеры</h2>
          <p>Порядок определяет очерёдность round-robin. Перетащи для сортировки.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal('add')}>+ Добавить</button>
      </div>
      <div className="page-body">
        {loading && <div style={{ color: 'var(--text3)' }}>Загрузка...</div>}
        {!loading && managers.length === 0 && (
          <div className="card empty">
            <div className="icon">◉</div>
            <p>Менеджеры не добавлены. Добавь первого!</p>
          </div>
        )}
        {managers.map((m, idx) => (
          <div
            key={m.id}
            className="card"
            draggable
            onDragStart={e => onDragStart(e, idx)}
            onDragOver={e => onDragOver(e, idx)}
            onDrop={onDrop}
            style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'default', opacity: dragging === idx ? 0.5 : 1, transition: 'opacity .15s' }}
          >
            <span className="drag-handle" title="Перетащи для сортировки">⠿</span>

            <div style={{ width: 36, height: 36, borderRadius: '50%', background: m.is_active ? 'var(--accent)' : 'var(--bg4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600, color: m.is_active ? '#fff' : 'var(--text3)', flexShrink: 0 }}>
              {m.name[0].toUpperCase()}
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 500 }}>{m.name}</span>
                {m.is_active
                  ? <span className="badge badge-green">активен</span>
                  : <span className="badge badge-gray">выключен</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <span style={{ color: m.manager_type === 'part' ? 'var(--amber)' : 'var(--green)' }}>
                  {m.manager_type === 'part' ? '◐ парт (60%)' : '● фулл (100%)'}
                </span>
                <span>
                  {(m.shift_start && m.shift_end)
                    ? `🕐 ${m.shift_start}–${m.shift_end}`
                    : '🕐 24/7'}
                </span>
                {m.slack_user_id && <span>Slack: <span style={{ fontFamily: 'var(--mono)' }}>{m.slack_user_id}</span></span>}
                {m.pipedrive_user_id && <span>PD: {m.pipedrive_user_id}</span>}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginRight: 4 }}>
                #{idx + 1} в очереди
              </div>
              <label className="toggle" title={m.is_active ? 'Выключить' : 'Включить'}>
                <input type="checkbox" checked={!!m.is_active} onChange={() => toggleActive(m)} />
                <span className="toggle-slider" />
              </label>
              <button className="btn btn-ghost btn-sm" onClick={() => setModal(m)}>Изменить</button>
              <button className="btn btn-danger btn-sm" onClick={() => deleteManager(m.id)}>Удалить</button>
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <ManagerModal
          manager={modal === 'add' ? null : modal}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); load(); }}
        />
      )}
    </>
  );
}
