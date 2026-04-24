const db = require('../db');
const pipedrive = require('./pipedrive');
const slack = require('./slack');

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

function isWithinShift(manager, hm) {
  if (!manager.shift_start || !manager.shift_end) return true; // no shift → always on
  const s = manager.shift_start, e = manager.shift_end;
  if (s === e) return true;
  if (s < e) return hm >= s && hm < e;
  return hm >= s || hm < e; // overnight (e.g. 22:00–06:00)
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
  const hm = currentHM(getSetting('timezone', 'Europe/Moscow'));

  const placeholders = available.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT * FROM managers WHERE id IN (${placeholders}) AND is_active = 1 ORDER BY round_robin_order ASC`
  ).all(...available);

  const candidates = rows.filter(m => isWithinShift(m, hm));
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

module.exports = { assignLead, getManagersForLead, isWithinShift, currentHM };
