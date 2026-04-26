const express = require('express');
const router = express.Router();
const db = require('../db');
const pipedrive = require('../services/pipedrive');
const { distributeQueue, assignLeadToSpecificManager } = require('../services/router');

// ─── Managers ──────────────────────────────────────────────────────────────

router.get('/managers', (req, res) => {
  const managers = db.prepare('SELECT * FROM managers ORDER BY round_robin_order ASC').all();
  res.json(managers);
});

router.post('/managers', (req, res) => {
  const { name, slack_user_id, pipedrive_user_id, manager_type, shift_start, shift_end } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const maxOrder = db.prepare('SELECT MAX(round_robin_order) as m FROM managers').get().m ?? -1;
  const result = db.prepare(
    `INSERT INTO managers (name, slack_user_id, pipedrive_user_id, round_robin_order, manager_type, shift_start, shift_end)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    name,
    slack_user_id || null,
    pipedrive_user_id || null,
    maxOrder + 1,
    manager_type === 'part' ? 'part' : 'full',
    shift_start || null,
    shift_end || null,
  );

  res.json(db.prepare('SELECT * FROM managers WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/managers/:id', (req, res) => {
  const {
    name, slack_user_id, pipedrive_user_id, is_active, round_robin_order,
    manager_type, shift_start, shift_end,
  } = req.body;
  db.prepare(`
    UPDATE managers SET
      name = COALESCE(?, name),
      slack_user_id = COALESCE(?, slack_user_id),
      pipedrive_user_id = COALESCE(?, pipedrive_user_id),
      is_active = COALESCE(?, is_active),
      round_robin_order = COALESCE(?, round_robin_order),
      manager_type = COALESCE(?, manager_type),
      shift_start = COALESCE(?, shift_start),
      shift_end = COALESCE(?, shift_end)
    WHERE id = ?
  `).run(
    name, slack_user_id, pipedrive_user_id, is_active, round_robin_order,
    manager_type, shift_start, shift_end, req.params.id
  );

  res.json(db.prepare('SELECT * FROM managers WHERE id = ?').get(req.params.id));
});

router.delete('/managers/:id', (req, res) => {
  db.prepare('DELETE FROM managers WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/managers/reorder', (req, res) => {
  const { order } = req.body;
  const update = db.prepare('UPDATE managers SET round_robin_order = ? WHERE id = ?');
  const tx = db.transaction(() => {
    order.forEach((id, idx) => update.run(idx, id));
  });
  tx();
  res.json({ ok: true });
});

router.get('/managers/pipedrive-users', async (req, res) => {
  try {
    const users = await pipedrive.getUsers();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Manager schedules (per-weekday) ───────────────────────────────────────

router.get('/schedules', (req, res) => {
  const rows = db.prepare('SELECT * FROM manager_schedules').all();
  res.json(rows);
});

router.put('/schedules/:manager_id', (req, res) => {
  const managerId = parseInt(req.params.manager_id, 10);
  const days = Array.isArray(req.body?.days) ? req.body.days : [];

  const del = db.prepare('DELETE FROM manager_schedules WHERE manager_id = ? AND weekday = ?');
  const ins = db.prepare(`
    INSERT INTO manager_schedules (manager_id, weekday, shift_start, shift_end, is_day_off)
    VALUES (?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    for (const d of days) {
      const wd = parseInt(d.weekday, 10);
      if (!Number.isInteger(wd) || wd < 0 || wd > 6) continue;
      del.run(managerId, wd);
      ins.run(
        managerId,
        wd,
        d.shift_start || null,
        d.shift_end || null,
        d.is_day_off ? 1 : 0,
      );
    }
  });
  tx();

  const rows = db.prepare('SELECT * FROM manager_schedules WHERE manager_id = ?').all(managerId);
  res.json(rows);
});

// ─── Products (for rule builder) ───────────────────────────────────────────

router.get('/products', async (req, res) => {
  try {
    const products = await pipedrive.getProducts();
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Rules ─────────────────────────────────────────────────────────────────

function normalizeRule(r) {
  let conditions = [];
  try { conditions = JSON.parse(r.conditions || '[]'); } catch {}
  if ((!conditions || conditions.length === 0) && r.field) {
    conditions = [{ field: r.field, operator: r.operator, value: r.value || '' }];
  }
  return {
    ...r,
    conditions,
    manager_ids: JSON.parse(r.manager_ids || '[]'),
  };
}

router.get('/rules', (req, res) => {
  const rules = db.prepare('SELECT * FROM rules ORDER BY priority DESC').all();
  res.json(rules.map(normalizeRule));
});

router.post('/rules', (req, res) => {
  const { name, conditions, manager_ids, priority } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const conds = Array.isArray(conditions) ? conditions : [];
  if (conds.length === 0) return res.status(400).json({ error: 'at least one condition required' });

  // Fill legacy columns from first condition for back-compat
  const first = conds[0];
  const result = db.prepare(`
    INSERT INTO rules (name, field, operator, value, manager_ids, priority, conditions)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    first.field || '',
    first.operator || 'equals',
    first.value || '',
    JSON.stringify(manager_ids || []),
    priority || 0,
    JSON.stringify(conds),
  );

  const rule = db.prepare('SELECT * FROM rules WHERE id = ?').get(result.lastInsertRowid);
  res.json(normalizeRule(rule));
});

router.put('/rules/:id', (req, res) => {
  const { name, conditions, manager_ids, priority, is_active } = req.body;

  let condsJson = null;
  let legacyField = null, legacyOp = null, legacyVal = null;
  if (Array.isArray(conditions)) {
    condsJson = JSON.stringify(conditions);
    if (conditions.length > 0) {
      legacyField = conditions[0].field || '';
      legacyOp = conditions[0].operator || 'equals';
      legacyVal = conditions[0].value || '';
    }
  }

  db.prepare(`
    UPDATE rules SET
      name = COALESCE(?, name),
      field = COALESCE(?, field),
      operator = COALESCE(?, operator),
      value = COALESCE(?, value),
      manager_ids = COALESCE(?, manager_ids),
      priority = COALESCE(?, priority),
      is_active = COALESCE(?, is_active),
      conditions = COALESCE(?, conditions)
    WHERE id = ?
  `).run(
    name, legacyField, legacyOp, legacyVal,
    manager_ids ? JSON.stringify(manager_ids) : null,
    priority, is_active, condsJson,
    req.params.id
  );

  const rule = db.prepare('SELECT * FROM rules WHERE id = ?').get(req.params.id);
  res.json(normalizeRule(rule));
});

router.delete('/rules/:id', (req, res) => {
  db.prepare('DELETE FROM rules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Assignments ───────────────────────────────────────────────────────────

router.get('/assignments', (req, res) => {
  const { status, limit = 50, offset = 0 } = req.query;
  let query = `
    SELECT a.*, m.name as manager_name
    FROM assignments a
    LEFT JOIN managers m ON a.manager_id = m.id
  `;
  const params = [];
  if (status) { query += ' WHERE a.status = ?'; params.push(status); }
  query += ' ORDER BY a.assigned_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const rows = db.prepare(query).all(...params);
  const total = db.prepare(`SELECT COUNT(*) as c FROM assignments${status ? ' WHERE status = ?' : ''}`).get(...(status ? [status] : [])).c;
  res.json({ rows, total });
});

router.get('/assignments/stats', (req, res) => {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'touched' THEN 1 ELSE 0 END) as touched,
      SUM(CASE WHEN status = 'timed_out' THEN 1 ELSE 0 END) as timed_out,
      SUM(CASE WHEN status = 'reassigned' THEN 1 ELSE 0 END) as reassigned
    FROM assignments
  `).get();

  const byManager = db.prepare(`
    SELECT m.name, COUNT(*) as count, SUM(CASE WHEN a.status = 'touched' THEN 1 ELSE 0 END) as touched
    FROM assignments a
    JOIN managers m ON a.manager_id = m.id
    GROUP BY m.id
    ORDER BY count DESC
  `).all();

  res.json({ stats, byManager });
});

// ─── Queue (off-hours leads) ───────────────────────────────────────────────

router.get('/queue', (req, res) => {
  const rows = db.prepare(
    "SELECT * FROM assignments WHERE status = 'queued' ORDER BY assigned_at ASC"
  ).all();
  res.json({ rows, count: rows.length });
});

router.post('/queue/distribute', async (req, res) => {
  try {
    const result = await distributeQueue();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/queue/assign', async (req, res) => {
  const { lead_id, manager_id } = req.body || {};
  if (!lead_id || !manager_id) return res.status(400).json({ error: 'lead_id and manager_id required' });
  try {
    const manager = await assignLeadToSpecificManager(lead_id, parseInt(manager_id, 10));
    res.json({ ok: true, manager: { id: manager.id, name: manager.name } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/queue/:lead_id', (req, res) => {
  const result = db.prepare(
    "UPDATE assignments SET status = 'cancelled' WHERE lead_id = ? AND status = 'queued'"
  ).run(req.params.lead_id);
  res.json({ ok: true });
});

// ─── Settings ──────────────────────────────────────────────────────────────

router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  res.json(settings);
});

router.put('/settings', (req, res) => {
  const tx = db.transaction(() => {
    Object.entries(req.body).forEach(([key, value]) => {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
    });
  });
  tx();
  res.json({ ok: true });
});

module.exports = router;
