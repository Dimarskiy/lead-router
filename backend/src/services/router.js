const db = require('../db');
const pipedrive = require('./pipedrive');
const slack = require('./slack');
const { isWorkingHours } = require('./workingHours');

// ── Settings helpers ─────────────────────────────────────────────────
function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value ?? fallback;
}

function getWeights() {
  return {
    full: parseFloat(getSetting('weight_full', '1.0')) || 1.0,
    part: parseFloat(getSetting('weight_part', '0.6')) || 0.6,
  };
}

function managerWeight(manager, weights) {
  const w = (manager.manager_type === 'part') ? weights.part : weights.full;
  return w > 0 ? w : 1.0;
}

// ── Shift check ──────────────────────────────────────────────────────
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

function isWithinShift(manager, hm, schedule) {
  // Per-weekday schedule wins if present
  if (schedule) {
    if (schedule.is_day_off) return false;
    if (schedule.shift_start && schedule.shift_end) {
      return timeInRange(hm, schedule.shift_start, schedule.shift_end);
    }
    // row exists with no times → treat as 24h
    return true;
  }
  // Fallback to manager's default shift
  if (!manager.shift_start || !manager.shift_end) return true;
  return timeInRange(hm, manager.shift_start, manager.shift_end);
}

// ── Rule evaluation ──────────────────────────────────────────────────
function evalCondition(cond, leadFields) {
  const fieldValue = String(leadFields[cond.field] ?? '').toLowerCase();
  const ruleValue = String(cond.value ?? '').toLowerCase();
  switch (cond.operator) {
    case 'equals': return fieldValue === ruleValue;
    case 'not_equals': return fieldValue !== ruleValue;
    case 'contains': return fieldValue.includes(ruleValue);
    case 'not_contains': return !fieldValue.includes(ruleValue);
    case 'starts_with': return fieldValue.startsWith(ruleValue);
    case 'greater_than': return parseFloat(fieldValue) > parseFloat(ruleValue);
    case 'less_than': return parseFloat(fieldValue) < parseFloat(ruleValue);
    case 'is_empty': return !fieldValue;
    case 'is_not_empty': return !!fieldValue;
    default: return false;
  }
}

function parseConditions(rule) {
  try {
    const parsed = JSON.parse(rule.conditions || '[]');
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}
  if (rule.field) return [{ field: rule.field, operator: rule.operator, value: rule.value }];
  return [];
}

function ruleMatches(rule, leadFields) {
  const conds = parseConditions(rule);
  if (conds.length === 0) return false;
  return conds.every(c => evalCondition(c, leadFields));
}

function getManagersForLead(leadFields) {
  const rules = db.prepare('SELECT * FROM rules WHERE is_active = 1 ORDER BY priority DESC').all();
  for (const rule of rules) {
    if (ruleMatches(rule, leadFields)) {
      const ids = JSON.parse(rule.manager_ids);
      if (ids.length > 0) return { ruleName: rule.name, managerIds: ids };
    }
  }
  const all = db.prepare('SELECT id FROM managers WHERE is_active = 1').all();
  return { ruleName: 'default', managerIds: all.map(m => m.id) };
}

// ── Smooth Weighted Round-Robin (nginx-style) ────────────────────────
// For each eligible manager:
//   rr_credit += weight
// Pick manager with MAX rr_credit.
// Deduct total_weight from picked manager.
function getNextManager(managerIds, excludeIds = []) {
  const available = managerIds.filter(id => !excludeIds.includes(id));
  if (available.length === 0) return null;

  const weights = getWeights();
  const tz = getSetting('timezone', 'Europe/Moscow');
  const hm = currentHM(tz);
  const weekday = currentWeekday(tz);

  const placeholders = available.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT * FROM managers WHERE id IN (${placeholders}) AND is_active = 1 ORDER BY round_robin_order ASC`
  ).all(...available);

  const schedRows = db.prepare(
    `SELECT * FROM manager_schedules WHERE manager_id IN (${placeholders}) AND weekday = ?`
  ).all(...available, weekday);
  const schedMap = {};
  schedRows.forEach(s => { schedMap[s.manager_id] = s; });

  const candidates = rows.filter(m => isWithinShift(m, hm, schedMap[m.id]));
  if (candidates.length === 0) {
    console.log(`[Router] No managers on shift at ${hm} (candidates: ${rows.map(r => r.name).join(', ')})`);
    return null;
  }

  let totalWeight = 0;
  let best = null;
  let bestCredit = -Infinity;
  const updates = [];

  for (const m of candidates) {
    const w = managerWeight(m, weights);
    const credit = (parseFloat(m.rr_credit) || 0) + w;
    totalWeight += w;
    updates.push({ id: m.id, credit });
    if (credit > bestCredit) { bestCredit = credit; best = m; }
  }

  // Persist new credits; deduct totalWeight from winner
  const upd = db.prepare('UPDATE managers SET rr_credit = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const u of updates) {
      const finalCredit = (u.id === best.id) ? (u.credit - totalWeight) : u.credit;
      upd.run(finalCredit, u.id);
    }
  });
  tx();

  return best;
}

// ── Main entry point ─────────────────────────────────────────────────
async function assignLead(leadId, leadData, isReassign = false, excludeManagerIds = []) {
  if (getSetting('distribution_enabled', 'true') === 'false') {
    console.log(`[Router] Distribution is paused, skipping lead ${leadId}`);
    return null;
  }

  // Off-hours: queue the lead for morning manual distribution.
  // Reassignments still flow through normally (worker reassigns timed-out leads).
  if (!isReassign && !isWorkingHours()) {
    const existing = db.prepare(
      "SELECT id FROM assignments WHERE lead_id = ? AND status IN ('queued','pending')"
    ).get(leadId);
    if (existing) {
      console.log(`[Router] Lead ${leadId} already queued/pending (#${existing.id}), skipping queue insert`);
      return null;
    }
    const deadlineAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      'INSERT INTO assignments (lead_id, lead_title, manager_id, deadline_at, status, reassign_count) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(leadId, leadData.title || String(leadId), 0, deadlineAt, 'queued', 0);
    console.log(`[Router] Lead ${leadId} queued (off-hours)`);
    return null;
  }

  const timeoutMinutes = parseInt(getSetting('timeout_minutes', '10'), 10);
  const leadFields = await flattenLeadFields(leadData);
  const { managerIds, ruleName } = getManagersForLead(leadFields);
  const manager = getNextManager(managerIds, excludeManagerIds);

  if (!manager) {
    console.error(`[Router] No available manager for lead ${leadId}`);
    await slack.notifyNoManagersAvailable({ lead: leadData });
    return null;
  }

  const deadlineAt = new Date(Date.now() + timeoutMinutes * 60 * 1000).toISOString();
  const existing = db.prepare("SELECT * FROM assignments WHERE lead_id = ? AND status = 'pending'").get(leadId);
  if (existing) db.prepare("UPDATE assignments SET status = 'reassigned' WHERE id = ?").run(existing.id);

  const maxPrior = db.prepare('SELECT MAX(reassign_count) as m FROM assignments WHERE lead_id = ?').get(leadId);
  const priorCount = maxPrior?.m ?? null;
  const reassignCount = isReassign
    ? (priorCount !== null ? priorCount + 1 : 1)
    : (priorCount !== null ? priorCount + 1 : 0);

  db.prepare('INSERT INTO assignments (lead_id, lead_title, manager_id, deadline_at, status, reassign_count) VALUES (?, ?, ?, ?, ?, ?)').run(
    leadId, leadData.title || String(leadId), manager.id, deadlineAt, 'pending', reassignCount
  );

  if (manager.pipedrive_user_id) {
    const dealId = leadData._deal_id || pipedrive.extractDealId(leadId);
    if (dealId && /^\d+$/.test(String(dealId))) {
      try {
        await pipedrive.assignDealToUser(dealId, manager.pipedrive_user_id);
        console.log(`[Router] Updated Pipedrive deal ${dealId} owner to ${manager.pipedrive_user_id}`);
      } catch (err) { console.error('[Router] Failed to update Pipedrive:', err.message); }
    }
  }

  await slack.notifyAssignment({ manager, lead: leadData, isReassign, reassignCount, timeoutMinutes });
  console.log(`[Router] Lead ${leadId} → ${manager.name} (rule: ${ruleName}, type: ${manager.manager_type || 'full'}, timeout: ${timeoutMinutes}m)`);
  return manager;
}

// ── Field flattening (with product fetch) ────────────────────────────
async function flattenLeadFields(leadData) {
  const flat = {};
  if (!leadData) return flat;

  Object.entries(leadData).forEach(([k, v]) => {
    if (typeof v !== 'object' || v === null) flat[k] = v;
  });

  // Enrich with products if rules reference the 'product' field
  const needsProducts = rulesReferenceField('product');
  if (needsProducts && (leadData._deal_id || leadData.id)) {
    const dealId = leadData._deal_id || pipedrive.extractDealId(leadData.id);
    if (dealId && /^\d+$/.test(String(dealId))) {
      const products = await pipedrive.getDealProducts(dealId);
      if (products.length > 0) {
        flat.product = products.map(p => p.name).filter(Boolean).join(',');
        flat.product_ids = products.map(p => p.id).join(',');
        flat.product_codes = products.map(p => p.code).filter(Boolean).join(',');
      } else {
        flat.product = '';
      }
    }
  }

  return flat;
}

function rulesReferenceField(fieldName) {
  const rules = db.prepare("SELECT conditions FROM rules WHERE is_active = 1").all();
  for (const r of rules) {
    try {
      const cs = JSON.parse(r.conditions || '[]');
      if (cs.some(c => c.field === fieldName)) return true;
    } catch {}
  }
  return false;
}

// ── Manual distribution from the queue ───────────────────────────────
// These leads are FINAL — worker never reassigns them on timeout.
async function finalizeManualAssignment(queuedRow, manager) {
  const timeoutMinutes = parseInt(getSetting('timeout_minutes', '10'), 10);
  const deadlineAt = new Date(Date.now() + timeoutMinutes * 60 * 1000).toISOString();

  // Mark old queued row as reassigned and create a fresh pending one
  db.prepare("UPDATE assignments SET status = 'reassigned' WHERE id = ?").run(queuedRow.id);

  db.prepare(`
    INSERT INTO assignments
      (lead_id, lead_title, manager_id, deadline_at, status, reassign_count, is_manual_distribution)
    VALUES (?, ?, ?, ?, 'pending', 0, 1)
  `).run(queuedRow.lead_id, queuedRow.lead_title, manager.id, deadlineAt);

  // Pipedrive owner update
  if (manager.pipedrive_user_id) {
    const dealId = pipedrive.extractDealId(queuedRow.lead_id);
    if (dealId && /^\d+$/.test(String(dealId))) {
      try {
        await pipedrive.assignDealToUser(dealId, manager.pipedrive_user_id);
        console.log(`[Router] (manual) Pipedrive deal ${dealId} → user ${manager.pipedrive_user_id}`);
      } catch (err) { console.error('[Router] Pipedrive update failed:', err.message); }
    }
  }

  // Slack notification (reuse normal path; reassignCount=0, manual lead)
  const lead = { id: queuedRow.lead_id, title: queuedRow.lead_title };
  try {
    await slack.notifyAssignment({ manager, lead, isReassign: false, reassignCount: 0, timeoutMinutes });
  } catch (err) { console.error('[Router] Slack notify failed:', err.message); }
}

async function distributeQueue() {
  const queued = db.prepare(
    "SELECT * FROM assignments WHERE status = 'queued' ORDER BY assigned_at ASC"
  ).all();
  if (queued.length === 0) return { distributed: 0 };

  const managers = db.prepare(
    'SELECT * FROM managers WHERE is_active = 1 ORDER BY round_robin_order ASC'
  ).all();
  if (managers.length === 0) {
    console.warn('[Router] distributeQueue: no active managers');
    return { distributed: 0, error: 'no_managers' };
  }

  let count = 0;
  for (let i = 0; i < queued.length; i++) {
    const manager = managers[i % managers.length];
    try {
      await finalizeManualAssignment(queued[i], manager);
      count++;
    } catch (err) {
      console.error(`[Router] distributeQueue failed for ${queued[i].lead_id}:`, err.message);
    }
  }
  console.log(`[Router] distributeQueue: ${count}/${queued.length} leads assigned`);
  return { distributed: count };
}

async function assignLeadToSpecificManager(leadId, managerId) {
  const queued = db.prepare(
    "SELECT * FROM assignments WHERE lead_id = ? AND status = 'queued'"
  ).get(leadId);
  if (!queued) throw new Error('Lead not in queue');

  const manager = db.prepare('SELECT * FROM managers WHERE id = ? AND is_active = 1').get(managerId);
  if (!manager) throw new Error('Manager not found or inactive');

  await finalizeManualAssignment(queued, manager);
  return manager;
}

module.exports = {
  assignLead,
  getManagersForLead,
  isWithinShift,
  currentHM,
  distributeQueue,
  assignLeadToSpecificManager,
};
