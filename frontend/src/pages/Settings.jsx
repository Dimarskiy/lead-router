import { useEffect, useState } from 'react';
import { api } from '../api.js';

const TIMEZONES = [
  'Europe/Moscow', 'Europe/Kaliningrad', 'Europe/Samara', 'Asia/Yekaterinburg',
  'Asia/Omsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Yakutsk',
  'Asia/Vladivostok', 'Asia/Magadan', 'Asia/Kamchatka',
  'Europe/Kyiv', 'Europe/Minsk', 'Asia/Almaty', 'Asia/Tbilisi', 'UTC',
];

export default function Settings() {
  const [settings, setSettings] = useState({
    timeout_minutes: '10',
    distribution_enabled: 'true',
    timezone: 'Europe/Moscow',
    weight_full: '1.0',
    weight_part: '0.6',
  });
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getSettings().then(s => {
      setSettings(prev => ({ ...prev, ...s }));
      setLoading(false);
    });
  }, []);

  async function handleSave() {
    await api.updateSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function toggleDistribution() {
    const newVal = settings.distribution_enabled === 'true' ? 'false' : 'true';
    const updated = { ...settings, distribution_enabled: newVal };
    setSettings(updated);
    await api.updateSettings({ distribution_enabled: newVal });
  }

  const isEnabled = settings.distribution_enabled === 'true';

  return (
    <>
      <div className="page-header">
        <div><h2>Настройки</h2><p>Конфигурация сервиса</p></div>
      </div>
      <div className="page-body" style={{ maxWidth: 560 }}>
        {loading ? <div style={{ color: 'var(--text3)' }}>Загрузка...</div> : (
          <>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="section-label" style={{ marginBottom: 16 }}>Распределение лидов</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>
                    {isEnabled ? '🟢 Распределение включено' : '🔴 Распределение выключено'}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>
                    {isEnabled ? 'Новые лиды автоматически назначаются менеджерам' : 'Новые лиды НЕ назначаются — включи когда команда готова'}
                  </div>
                </div>
                <label className="toggle" style={{ transform: 'scale(1.4)', marginLeft: 24, flexShrink: 0 }}>
                  <input type="checkbox" checked={isEnabled} onChange={toggleDistribution} />
                  <span className="toggle-slider" />
                </label>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
              <div className="section-label" style={{ marginBottom: 16 }}>Таймер и таймзона</div>
              <div className="field">
                <label>Время до переназначения (минуты)</label>
                <input className="input" type="number" min="1" max="1440"
                  value={settings.timeout_minutes}
                  onChange={e => setSettings(s => ({ ...s, timeout_minutes: e.target.value }))}
                  style={{ maxWidth: 120 }} />
                <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>
                  Если менеджер не сделал касание за это время — лид уходит следующему.
                </p>
              </div>
              <div className="field">
                <label>Таймзона для смен</label>
                <select className="select" style={{ maxWidth: 260 }}
                  value={settings.timezone || 'Europe/Moscow'}
                  onChange={e => setSettings(s => ({ ...s, timezone: e.target.value }))}>
                  {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                </select>
                <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>
                  Рабочие смены менеджеров считаются в этой таймзоне.
                </p>
              </div>
              <button className="btn btn-primary" onClick={handleSave}>
                {saved ? '✓ Сохранено!' : 'Сохранить'}
              </button>
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
              <div className="section-label" style={{ marginBottom: 16 }}>Веса распределения</div>
              <p style={{ fontSize: 12.5, color: 'var(--text3)', marginBottom: 12 }}>
                Во сколько раз фулл-таймер получает лидов чаще парт-таймера. По умолчанию 1.0 / 0.6 (ровно 1.6×).
              </p>
              <div style={{ display: 'flex', gap: 12 }}>
                <div className="field" style={{ flex: 1 }}>
                  <label>Фулл-таймер</label>
                  <input className="input" type="number" step="0.1" min="0.1" max="10"
                    value={settings.weight_full}
                    onChange={e => setSettings(s => ({ ...s, weight_full: e.target.value }))} />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>Парт-таймер</label>
                  <input className="input" type="number" step="0.1" min="0.1" max="10"
                    value={settings.weight_part}
                    onChange={e => setSettings(s => ({ ...s, weight_part: e.target.value }))} />
                </div>
              </div>
              <button className="btn btn-primary" onClick={handleSave}>
                {saved ? '✓ Сохранено!' : 'Сохранить'}
              </button>
            </div>

            <div className="card">
              <div className="section-label" style={{ marginBottom: 12 }}>Webhook URL для Pipedrive</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" readOnly
                  value="https://lead-router-production-b428.up.railway.app/webhook/pipedrive"
                  style={{ fontFamily: 'var(--mono)', fontSize: 12 }} />
                <button className="btn btn-ghost"
                  onClick={() => navigator.clipboard.writeText('https://lead-router-production-b428.up.railway.app/webhook/pipedrive')}>
                  Копировать
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
