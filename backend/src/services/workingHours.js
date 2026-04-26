const db = require('../db');

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value ?? fallback;
}

function currentHM(tz) {
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const hh = parts.find(p => p.type === 'hour')?.value ?? '00';
    const mm = parts.find(p => p.type === 'minute')?.value ?? '00';
    return `${hh === '24' ? '00' : hh}:${mm}`;
  } catch {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

function currentWeekday(tz) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
    const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[fmt.format(new Date())] ?? new Date().getDay();
  } catch {
    return new Date().getDay();
  }
}

function timeInRange(hm, s, e) {
  if (!s || !e) return true;
  if (s === e) return true;
  if (s < e) return hm >= s && hm < e;
  return hm >= s || hm < e;
}

/**
 * Returns true if "now" falls inside configured business hours.
 * If work_hours_enabled = 'false' → always true (queueing disabled).
 */
function isWorkingHours() {
  if (getSetting('work_hours_enabled', 'false') !== 'true') return true;

  const tz = getSetting('timezone', 'Europe/Moscow');
  const start = getSetting('work_start', '09:00');
  const end   = getSetting('work_end',   '20:00');
  const daysCsv = getSetting('work_days', '1,2,3,4,5');
  const allowedDays = daysCsv.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));

  const wd = currentWeekday(tz);
  if (!allowedDays.includes(wd)) return false;

  const hm = currentHM(tz);
  return timeInRange(hm, start, end);
}

module.exports = { isWorkingHours };
