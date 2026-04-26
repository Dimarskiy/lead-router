const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/leadrouter.db');
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

function normalizeParams(params) {
  if (params.length === 0) return [];
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params.map(p => (p === undefined ? null : p));
}

class SyncDB {
  constructor(sqlJs) {
    if (fs.existsSync(DB_PATH)) {
      this._db = new sqlJs.Database(fs.readFileSync(DB_PATH));
    } else {
      this._db = new sqlJs.Database();
    }
    this._saveTimer = null;
  }

  _save() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      fs.writeFileSync(DB_PATH, Buffer.from(this._db.export()));
    }, 200);
  }

  exec(sql) { this._db.run(sql); this._save(); return this; }
  pragma() { return this; }

  prepare(sql) {
    const db = this;
    return {
      run(...params) {
        db._db.run(sql, normalizeParams(params));
        db._save();
        const r = db._db.exec('SELECT last_insert_rowid() as id');
        return { lastInsertRowid: r[0]?.values[0]?.[0] ?? null };
      },
      get(...params) {
        const stmt = db._db.prepare(sql);
        stmt.bind(normalizeParams(params));
        if (stmt.step()) { const row = stmt.getAsObject(); stmt.free(); return row; }
        stmt.free();
        return undefined;
      },
      all(...params) {
        const results = db._db.exec(sql, normalizeParams(params));
        if (!results || results.length === 0) return [];
        const { columns, values } = results[0];
        return values.map(row => {
          const obj = {};
          columns.forEach((col, i) => { obj[col] = row[i]; });
          return obj;
        });
      },
    };
  }

  transaction(fn) {
    return (...args) => {
      this._db.run('BEGIN');
      try { const r = fn(...args); this._db.run('COMMIT'); this._save(); return r; }
      catch (e) { this._db.run('ROLLBACK'); throw e; }
    };
  }
}

let dbInstance = null;

async function initDb() {
  const SQL = await initSqlJs();
  dbInstance = new SyncDB(SQL);

  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS managers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slack_user_id TEXT,
      pipedrive_user_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      round_robin_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      field TEXT NOT NULL,
      operator TEXT NOT NULL,
      value TEXT NOT NULL,
      manager_ids TEXT NOT NULL DEFAULT '[]',
      priority INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL,
      lead_title TEXT,
      manager_id INTEGER NOT NULL,
      assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
      deadline_at TEXT NOT NULL,
      touched_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reassign_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS manager_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manager_id INTEGER NOT NULL,
      weekday INTEGER NOT NULL,
      shift_start TEXT,
      shift_end TEXT,
      is_day_off INTEGER NOT NULL DEFAULT 0,
      UNIQUE(manager_id, weekday)
    );
  `);

  // ── Migrations: add columns idempotently ─────────────────────────
  const tableCols = (table) => {
    const res = dbInstance._db.exec(`PRAGMA table_info(${table})`);
    return (res[0]?.values || []).map(r => r[1]);
  };
  const addCol = (table, col, type) => {
    if (!tableCols(table).includes(col)) {
      dbInstance.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    }
  };
  addCol('managers', 'manager_type',  "TEXT NOT NULL DEFAULT 'full'");
  addCol('managers', 'shift_start',   'TEXT'); // 'HH:MM' or NULL = 24/7
  addCol('managers', 'shift_end',     'TEXT');
  addCol('managers', 'rr_credit',     'REAL NOT NULL DEFAULT 0');
  addCol('rules',    'conditions',    "TEXT NOT NULL DEFAULT '[]'");
  addCol('assignments', 'is_manual_distribution', 'INTEGER NOT NULL DEFAULT 0');
  addCol('assignments', 'sla_alerted',  'INTEGER NOT NULL DEFAULT 0');
  addCol('assignments', 'slack_channel', 'TEXT');
  addCol('assignments', 'slack_ts',      'TEXT');

  // Migrate legacy rules (field/operator/value) → conditions JSON
  const legacyRules = dbInstance.prepare(
    "SELECT id, field, operator, value, conditions FROM rules WHERE (conditions IS NULL OR conditions = '[]' OR conditions = '') AND field IS NOT NULL AND field <> ''"
  ).all();
  for (const r of legacyRules) {
    const cond = [{ field: r.field, operator: r.operator, value: r.value || '' }];
    dbInstance.prepare('UPDATE rules SET conditions = ? WHERE id = ?').run(JSON.stringify(cond), r.id);
  }

  const upsertDefault = (key, value) => {
    if (!dbInstance.prepare('SELECT key FROM settings WHERE key = ?').get(key)) {
      dbInstance.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
    }
  };
  upsertDefault('timeout_minutes', String(process.env.TIMEOUT_MINUTES || 10));
  upsertDefault('round_robin_pointer', '0');
  upsertDefault('distribution_enabled', 'true');
  upsertDefault('timezone', process.env.TIMEZONE || 'Europe/Moscow');
  upsertDefault('weight_full', '1.0');
  upsertDefault('weight_part', '0.6');
  upsertDefault('queue_when_off_shift', 'false');
  upsertDefault('escalation_threshold', '3');
  upsertDefault('escalation_user_id',   '');
  upsertDefault('sla_hours',            '2');
  upsertDefault('sla_alert_channel',    '');
  upsertDefault('report_channel_id',    '');
  upsertDefault('report_recipient_user_id', '');
  upsertDefault('report_cron',          '0 9 * * 1-5');
  upsertDefault('admin_url',            '');

  console.log('[DB] SQLite ready at', DB_PATH);
  return dbInstance;
}

module.exports = new Proxy({}, {
  get(_, prop) {
    if (prop === 'initDb') return initDb;
    if (!dbInstance) throw new Error('DB not initialized. Await initDb() first.');
    return dbInstance[prop].bind ? dbInstance[prop].bind(dbInstance) : dbInstance[prop];
  }
});
module.exports.initDb = initDb;
