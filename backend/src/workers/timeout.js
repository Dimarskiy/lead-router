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
      WHERE a.status = 'pending' AND a.deadline_at < ?
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

function start() {
  // Run every 60 seconds
  cron.schedule('* * * * *', checkTimeouts);
  console.log('[Worker] Timeout worker started (checking every 60s)');

  // Also run immediately on startup
  setTimeout(checkTimeouts, 3000);
}

module.exports = { start, checkTimeouts };
