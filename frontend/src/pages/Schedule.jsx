import { useEffect, useState } from 'react';
import { api } from '../api.js';

const DAYS = [
  { wd: 1, label: 'Пн' },
  { wd: 2, label: 'Вт' },
  { wd: 3, label: 'Ср' },
  { wd: 4, label: 'Чт' },
  { wd: 5, label: 'Пт' },
  { wd: 6, label: 'Сб' },
  { wd: 0, label: 'Вс' },
];

// default per manager: inherit legacy shift_start/end or 9-17
function defaultCell(manager) {
  return {
    shift_start: manager.shift_start || '09:00',
    shift_end:   manager.shift_end   || '18:00',
    is_day_off:  0,
  };
}

export default function Schedule() {
  const [managers, setManagers] = useState([]);
  const [grid, setGrid] = useState({}); // { [managerId]: { [weekday]: {shift_start, shift_end, is_day_off} } }
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [dirty, setDirty] = useState({}); // { [managerId]: true }

  async function load() {
    setLoading(true);
    const [ms, scheds] = await Promise.all([api.getManagers(), api.getSchedules()]);
    setManagers(ms);
    const g = {};
    ms.forEach(m => { g[m.id] = {}; });
    scheds.forEach(s => {
      if (!g[s.manager_id]) g[s.manager_id] = {};
      g[s.manager_id][s.weekday] = {
        shift_start: s.shift_start || '',
        shift_end:   s.shift_end   || '',
        is_day_off:  s.is_day_off ? 1 : 0,
      };
    });
    setGrid(g);
    setLoading(false);
    setDirty({});
  }

  useEffect(() => { load(); }, []);

  function getCell(managerId, wd) {
    const m = managers.find(x => x.id === managerId);
    return grid[managerId]?.[wd] ?? defaultCell(m || {});
  }

  function updateCell(managerId, wd, patch) {
    setGrid(g => ({
      ...g,
      [managerId]: {
        ...g[managerId],
        [wd]: { ...getCell(managerId, wd), ...patch },
      },
    }));
    setDirty(d => ({ ...d, [managerId]: true }));
  }

  function toggleDayOff(managerId, wd) {
    const c = getCell(managerId, wd);
    updateCell(managerId, wd, { is_day_off: c.is_day_off ? 0 : 1 });
  }

  async function saveRow(managerId) {
    setSavingId(managerId);
    try {
      const row = grid[managerId] || {};
      const days = DAYS.map(d => {
        const c = row[d.wd] ?? defaultCell(managers.find(m => m.id === managerId) || {});
        return {
          weekday: d.wd,
          shift_start: c.is_day_off ? null : (c.shift_start || null),
          shift_end:   c.is_day_off ? null : (c.shift_end   || null),
          is_day_off:  c.is_day_off ? 1 : 0,
        };
      });
      await api.saveSchedule(managerId, days);
      setDirty(d => { const n = { ...d }; delete n[managerId]; return n; });
    } finally { setSavingId(null); }
  }

  function applyPreset(managerId, preset) {
    const presets = {
      workweek: { work: [1,2,3,4,5], off: [0,6], start: '09:00', end: '18:00' },
      everyday: { work: [0,1,2,3,4,5,6], off: [], start: '09:00', end: '18:00' },
      clear:    { work: [], off: [0,1,2,3,4,5,6], start: '', end: '' },
    }[preset];
    if (!presets) return;
    const row = {};
    DAYS.forEach(d => {
      if (presets.off.includes(d.wd)) {
        row[d.wd] = { shift_start: '', shift_end: '', is_day_off: 1 };
      } else {
        row[d.wd] = { shift_start: presets.start, shift_end: presets.end, is_day_off: 0 };
      }
    });
    setGrid(g => ({ ...g, [managerId]: row }));
    setDirty(d => ({ ...d, [managerId]: true }));
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Расписание</h2>
          <p>Смены по дням недели. Если день не задан — используется общая смена из карточки менеджера.</p>
        </div>
      </div>
      <div className="page-body">
        {loading && <div style={{ color: 'var(--text3)' }}>Загрузка...</div>}
        {!loading && managers.length === 0 && (
          <div className="card empty"><p>Сначала добавь менеджеров.</p></div>
        )}

        {managers.map(m => (
          <div key={m.id} className="card" style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{m.name}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => applyPreset(m.id, 'workweek')}>Пн-Пт 9-18</button>
                <button className="btn btn-ghost btn-sm" onClick={() => applyPreset(m.id, 'everyday')}>Каждый день 9-18</button>
                <button className="btn btn-ghost btn-sm" onClick={() => applyPreset(m.id, 'clear')}>Все выходные</button>
              </div>
              <button
                className="btn btn-primary btn-sm"
                disabled={!dirty[m.id] || savingId === m.id}
                onClick={() => saveRow(m.id)}
              >
                {savingId === m.id ? 'Сохраняем...' : dirty[m.id] ? 'Сохранить' : 'Сохранено'}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
              {DAYS.map(d => {
                const c = getCell(m.id, d.wd);
                const off = !!c.is_day_off;
                return (
                  <div
                    key={d.wd}
                    style={{
                      border: '1px solid var(--border2)',
                      borderRadius: 8,
                      padding: 8,
                      background: off ? 'rgba(255,255,255,0.02)' : 'transparent',
                      opacity: off ? 0.6 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>{d.label}</span>
                      <label style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                        <input type="checkbox" checked={off} onChange={() => toggleDayOff(m.id, d.wd)} />
                        вых
                      </label>
                    </div>
                    {!off && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <input
                          className="input"
                          type="time"
                          value={c.shift_start || ''}
                          onChange={e => updateCell(m.id, d.wd, { shift_start: e.target.value })}
                          style={{ fontSize: 12, padding: '4px 6px' }}
                        />
                        <input
                          className="input"
                          type="time"
                          value={c.shift_end || ''}
                          onChange={e => updateCell(m.id, d.wd, { shift_end: e.target.value })}
                          style={{ fontSize: 12, padding: '4px 6px' }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
