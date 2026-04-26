const cron = require('node-cron');
const db = require('../db');
const pipedrive = require('../services/pipedrive');
const slack = require('../services/slack');
const { assignLead } = require('../services/router');

let isRunning = false;

async function checkTimeouts() {
  if (isRunning) return;
  isRunning = true;

  try {
    const now = new Date().toISOString();

    // Get all overdue pending assignments
    const overdue = db.prepare(`
      SELECT a.*, m.name as manager_name, m.slack_user_id, m.pipedrive_user_id
      FROM assignments a
      JOIN managers m ON a.manager_id = m.id
      WHERE a.status = 'pending' AND a.deadline_at < ? AND COALESCE(a.is_manual_distribution, 0) = 0
    `).all(now);

    console.log(`[Worker] Checking timeouts: ${overdue.length} overdue assignments`);

    for (const assignment of overdue) {
      await processOverdueAssignment(assignment);
    }
  } catch (err) {
    console.error('[Worker] Error in checkTimeouts:', err);
  } finally {
    isRunning = false;
  }
}

async function processOverdueAssignment(assignment) {
  const leadId = assignment.lead_id;

  try {
    // Check if lead was actually touched in Pipedrive
    const touchResult = await pipedrive.hasTouchSince(leadId, assignment.assigned_at);

    if (touchResult.touched) {
      // Mark as touched — lead stays with this manager
      db.prepare(`
        UPDATE assignments SET status = 'touched', touched_at = ? WHERE id = ?
      `).run(touchResult.at || new Date().toISOString(), assignment.id);
      console.log(`[Worker] Lead ${leadId} was touched (${touchResult.type}), keeping with ${assignment.manager_name}`);
      return;
    }

    // No touch — mark as timed_out and reassign
    db.prepare(`UPDATE assignments SET status = 'timed_out' WHERE id = ?`).run(assignment.id);
    console.log(`[Worker] Lead ${leadId} timed out for ${assignment.manager_name}, reassigning...`);

    // Get all previously assigned managers for this lead to exclude them
    const previousManagers = db.prepare(`
      SELECT DISTINCT manager_id FROM assignments WHERE lead_id = ? AND status IN ('timed_out', 'reassigned')
    `).all(leadId).map(r => r.manager_id);

    // Get basic lead data — try fresh fetch so rules have fields to match on
    let leadData = { id: leadId, title: assignment.lead_title };
    try {
      const fresh = await pipedrive.getLead(leadId);
      if (fresh) leadData = fresh;
    } catch (err) {
      console.error(`[Worker] getLead failed for ${leadId}:`, err.message);
    }

    const currentManager = {
      name: assignment.manager_name,
      slack_user_id: assignment.slack_user_id,
    };

    // Reassign to next manager
    const nextManager = await assignLead(leadId, leadData, true, previousManagers);

    if (nextManager) {
      await slack.notifyTimeout({ manager: currentManager, lead: leadData, nextManager });
    }
  } catch (err) {
    console.error(`[Worker] Failed to process assignment ${assignment.id}:`, err.message);
  }
}

// ── Auto-resume managers whose pause expired ──────────────────────────
async function checkPauses() {
  try {
    const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'manager_pause_%'").all();
    const now = Date.now();
    for (const r of rows) {
      if (!r.value) continue;
      const until = new Date(r.value).getTime();
      if (isNaN(until) || until > now) continue;
      const id = parseInt(r.key.replace('manager_pause_', ''), 10);
      if (!Number.isInteger(id)) continue;
      db.prepare('UPDATE managers SET is_active = 1 WHERE id = ?').run(id);
      db.prepare('DELETE FROM settings WHERE key = ?').run(r.key);
      const m = db.prepare('SELECT * FROM managers WHERE id = ?').get(id);
      console.log(`[Worker] Auto-resumed manager ${m?.name || id}`);
      if (m?.slack_user_id) {
        slack.sendDm(m.slack_user_id, '▶️ Пауза закончилась, ты снова в очереди.').catch(() => {});
      }
    }
  } catch (err) { console.error('[Worker] checkPauses failed:', err.message); }
}

// ── SLA breach alerts ─────────────────────────────────────────────────
async function checkSla() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'sla_hours'").get();
    const slaHours = parseFloat(row?.value ?? '2');
    if (!slaHours || slaHours <= 0) return;
    const channel = (db.prepare("SELECT value FROM settings WHERE key = 'sla_alert_channel'").get()?.value) || '';

    const cutoff = new Date(Date.now() - slaHours * 60 * 60 * 1000).toISOString();
    const breached = db.prepare(`
      SELECT a.*, m.name AS manager_name, m.slack_user_id, m.pipedrive_user_id
      FROM assignments a
      LEFT JOIN managers m ON a.manager_id = m.id
      WHERE a.status = 'pending'
        AND a.assigned_at < ?
        AND COALESCE(a.sla_alerted, 0) = 0
    `).all(cutoff);

    if (breached.length === 0) return;
    console.log(`[SLA] ${breached.length} breached lead(s) detected`);

    for (const a of breached) {
      const lead = { id: a.lead_id, title: a.lead_title, _deal_id: pipedrive.extractDealId(a.lead_id) };
      const manager = { name: a.manager_name, slack_user_id: a.slack_user_id };
      try {
        await slack.notifySlaBreach({ assignment: a, manager, lead, hours: slaHours, channel });
        db.prepare('UPDATE assignments SET sla_alerted = 1 WHERE id = ?').run(a.id);
      } catch (err) {
        console.error(`[SLA] notify failed for ${a.lead_id}:`, err.message);
      }
    }
  } catch (err) { console.error('[Worker] checkSla failed:', err.message); }
}

let slaTickCounter = 0;
async function tick() {
  await checkPauses();
  await checkTimeouts();
  // SLA every ~5 minutes
  if (slaTickCounter++ % 5 === 0) await checkSla();
}

function start() {
  // Run every 60 seconds
  cron.schedule('* * * * *', tick);
  console.log('[Worker] Timeout worker started (timeouts/pauses every 60s, SLA every 5m)');

  // Also run immediately on startup
  setTimeout(tick, 3000);
}

module.exports = { start, checkTimeouts, checkPauses, checkSla };
