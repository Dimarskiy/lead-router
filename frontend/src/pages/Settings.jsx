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
    queue_when_off_shift: 'false',
    escalation_threshold: '3',
    escalation_user_id: '',
    sla_hours: '2',
    sla_alert_channel: '',
    report_channel_id: '',
    report_recipient_user_id: '',
    report_cron: '0 9 * * 1-5',
    admin_url: '',
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

            <div className="card" style={{ marginBottom: 16 }}>
              <div className="section-label" style={{ marginBottom: 16 }}>Очередь и эскалация</div>
              <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <label className="toggle">
                  <input type="checkbox"
                    checked={settings.queue_when_off_shift === 'true'}
                    onChange={e => setSettings(s => ({ ...s, queue_when_off_shift: e.target.checked ? 'true' : 'false' }))} />
                  <span className="toggle-slider" />
                </label>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>Складывать в очередь вне рабочего времени</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>Если никто не на смене — лид попадёт во вкладку «Очередь» вместо автораспределения.</div>
                </div>
              </div>
              <div className="field">
                <label>Эскалация после N переназначений</label>
                <input className="input" type="number" min="0" max="20" style={{ maxWidth: 120 }}
                  value={settings.escalation_threshold}
                  onChange={e => setSettings(s => ({ ...s, escalation_threshold: e.target.value }))} />
                <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>0 = выкл. По умолчанию 3.</p>
              </div>
              <div className="field">
                <label>Slack ID тимлида (для эскалации)</label>
                <input className="input" placeholder="U07ABC123"
                  value={settings.escalation_user_id}
                  onChange={e => setSettings(s => ({ ...s, escalation_user_id: e.target.value }))} />
                <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>Если пусто — алерт уйдёт в SLACK_DEFAULT_CHANNEL.</p>
              </div>
              <button className="btn btn-primary" onClick={handleSave}>{saved ? '✓ Сохранено!' : 'Сохранить'}</button>
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
              <div className="section-label" style={{ marginBottom: 16 }}>SLA-алерты</div>
              <div className="field">
                <label>Часы до SLA-алерта</label>
                <input className="input" type="number" min="0" step="0.5" style={{ maxWidth: 120 }}
                  value={settings.sla_hours}
                  onChange={e => setSettings(s => ({ ...s, sla_hours: e.target.value }))} />
                <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>0 = выкл. По умолчанию 2 ч.</p>
              </div>
              <div className="field">
                <label>Канал для SLA-алертов</label>
                <input className="input" placeholder="#sales-alerts или C0ABC123"
                  value={settings.sla_alert_channel}
                  onChange={e => setSettings(s => ({ ...s, sla_alert_channel: e.target.value }))} />
              </div>
              <button className="btn btn-primary" onClick={handleSave}>{saved ? '✓ Сохранено!' : 'Сохранить'}</button>
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
              <div className="section-label" style={{ marginBottom: 16 }}>Утренний отчёт</div>
              <div className="field">
                <label>Cron расписания</label>
                <input className="input" placeholder="0 9 * * 1-5" style={{ fontFamily: 'var(--mono)' }}
                  value={settings.report_cron}
                  onChange={e => setSettings(s => ({ ...s, report_cron: e.target.value }))} />
                <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>По умолчанию Пн-Пт в 9:00 в выбранной таймзоне.</p>
              </div>
              <div className="field">
                <label>Канал отчёта</label>
                <input className="input" placeholder="#sales или C0ABC123"
                  value={settings.report_channel_id}
                  onChange={e => setSettings(s => ({ ...s, report_channel_id: e.target.value }))} />
              </div>
              <div className="field">
                <label>Slack ID получателя в личку (опционально)</label>
                <input className="input" placeholder="U07ABC123"
                  value={settings.report_recipient_user_id}
                  onChange={e => setSettings(s => ({ ...s, report_recipient_user_id: e.target.value }))} />
                <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>Если задан — отчёт идёт в личку, не в канал.</p>
              </div>
              <div className="field">
                <label>URL админки (для кнопок в Slack)</label>
                <input className="input" placeholder="https://lead-router-ui-production.up.railway.app"
                  value={settings.admin_url}
                  onChange={e => setSettings(s => ({ ...s, admin_url: e.target.value }))} />
              </div>
              <button className="btn btn-primary" onClick={handleSave}>{saved ? '✓ Сохранено!' : 'Сохранить'}</button>
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
