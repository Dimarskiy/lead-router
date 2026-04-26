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

function managerOnShift(manager, schedule, hm) {
  if (schedule) {
    if (schedule.is_day_off) return false;
    if (schedule.shift_start && schedule.shift_end) {
      return timeInRange(hm, schedule.shift_start, schedule.shift_end);
    }
    return true; // row exists with no times → 24h
  }
  if (!manager.shift_start || !manager.shift_end) return true; // 24/7
  return timeInRange(hm, manager.shift_start, manager.shift_end);
}

/**
 * Working hours = any active manager is currently on shift
 * (per-weekday schedule, or their fallback shift in the manager card).
 * If nobody is on shift → off-hours → leads should be queued.
 *
 * If queue_when_off_shift = 'false' (default), queueing is disabled and
 * the system always treats the moment as working hours.
 */
function isWorkingHours() {
  if (getSetting('queue_when_off_shift', 'false') !== 'true') return true;

  const tz = getSetting('timezone', 'Europe/Moscow');
  const hm = currentHM(tz);
  const wd = currentWeekday(tz);

  const managers = db.prepare('SELECT * FROM managers WHERE is_active = 1').all();
  if (managers.length === 0) return true; // no managers — let normal "no manager" path notify

  const ids = managers.map(m => m.id);
  const placeholders = ids.map(() => '?').join(',');
  const schedRows = db.prepare(
    `SELECT * FROM manager_schedules WHERE manager_id IN (${placeholders}) AND weekday = ?`
  ).all(...ids, wd);
  const schedMap = {};
  schedRows.forEach(s => { schedMap[s.manager_id] = s; });

  return managers.some(m => managerOnShift(m, schedMap[m.id], hm));
}

module.exports = { isWorkingHours };
