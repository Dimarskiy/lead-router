const express = require('express');
const axios = require('axios');
const router = express.Router();
const db = require('../db');
const slack = require('../services/slack');
const pipedrive = require('../services/pipedrive');
const { assignLead } = require('../services/router');

// Slack sends form-encoded — apply only on these routes
router.use(express.urlencoded({ extended: true, limit: '1mb' }));

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value ?? fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}
function deleteSetting(key) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

async function respondViaUrl(responseUrl, payload) {
  if (!responseUrl) return;
  try { await axios.post(responseUrl, payload, { timeout: 5000 }); }
  catch (err) { console.error('[Slack] response_url POST failed:', err.message); }
}

function fmtHM(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// ── POST /slack/interactive — button clicks ────────────────────────────
router.post('/interactive', (req, res) => {
  res.status(200).end(); // ack within 3s
  let payload;
  try { payload = JSON.parse(req.body.payload || '{}'); }
  catch { return console.error('[Slack] bad interactive payload'); }

  const action = payload.actions?.[0];
  if (!action) return;
  const actionId = action.action_id;
  const value = action.value || '';
  const user = payload.user || {};
  const channel = payload.channel?.id || payload.container?.channel_id;
  const messageTs = payload.message?.ts || payload.container?.message_ts;
  const responseUrl = payload.response_url;

  console.log(`[Slack] interactive action=${actionId} value=${value} user=${user.id}`);

  if (actionId === 'accept_lead' || actionId === 'reject_lead') {
    const id = parseInt(value.split('_')[1], 10);
    if (!Number.isInteger(id)) return;
    handleLeadAction(actionId, id, { user, channel, messageTs, responseUrl })
      .catch(err => console.error('[Slack] action handler failed:', err.message));
  }
});

async function handleLeadAction(actionId, assignmentId, ctx) {
  const a = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId);
  if (!a) {
    return respondViaUrl(ctx.responseUrl, { response_type: 'ephemeral', text: 'Назначение не найдено.' });
  }
  if (a.status !== 'pending') {
    return respondViaUrl(ctx.responseUrl, { response_type: 'ephemeral', text: `Лид уже обработан (статус: ${a.status}).` });
  }

  const manager = db.prepare('SELECT * FROM managers WHERE id = ?').get(a.manager_id);
  const channel = a.slack_channel || ctx.channel;
  const ts = a.slack_ts || ctx.messageTs;

  if (actionId === 'accept_lead') {
    db.prepare("UPDATE assignments SET status = 'accepted', touched_at = ? WHERE id = ?")
      .run(new Date().toISOString(), assignmentId);

    const blocks = [
      { type: 'header', text: { type: 'plain_text', text: '✅ Лид принят', emoji: true } },
      { type: 'section', fields: [
        { type: 'mrkdwn', text: `*Лид:*\n${a.lead_title || a.lead_id}` },
        { type: 'mrkdwn', text: `*Принял:*\n${manager?.name || '—'} в ${fmtHM(new Date())}` },
      ]},
      { type: 'actions', elements: [
        { type: 'button', text: { type: 'plain_text', text: '📋 Открыть в Pipedrive', emoji: true },
          url: slack.dealUrl({ id: a.lead_id }), action_id: 'open_pipedrive' },
      ]},
    ];
    await slack.updateMessage(channel, ts, blocks, '✅ Лид принят');
    console.log(`[Slack] assignment ${assignmentId} accepted by ${manager?.name}`);
    return;
  }

  if (actionId === 'reject_lead') {
    db.prepare("UPDATE assignments SET status = 'rejected' WHERE id = ?").run(assignmentId);

    const prev = db.prepare(
      "SELECT DISTINCT manager_id FROM assignments WHERE lead_id = ? AND status IN ('timed_out','reassigned','rejected')"
    ).all(a.lead_id).map(r => r.manager_id);

    let leadData = { id: a.lead_id, title: a.lead_title, _deal_id: pipedrive.extractDealId(a.lead_id) };
    try {
      const fresh = await pipedrive.getLead(a.lead_id);
      if (fresh) leadData = fresh;
    } catch {}

    let nextManager = null;
    try { nextManager = await assignLead(a.lead_id, leadData, true, prev); }
    catch (err) { console.error('[Slack] reject reassign failed:', err.message); }

    const tail = nextManager ? `передан *${nextManager.name}*` : 'не удалось переназначить — нет доступных менеджеров';
    const blocks = [
      { type: 'header', text: { type: 'plain_text', text: '❌ Отклонено', emoji: true } },
      { type: 'section', fields: [
        { type: 'mrkdwn', text: `*Лид:*\n${a.lead_title || a.lead_id}` },
        { type: 'mrkdwn', text: `*Отклонил:*\n${manager?.name || '—'}` },
      ]},
      { type: 'section', text: { type: 'mrkdwn', text: tail } },
    ];
    await slack.updateMessage(channel, ts, blocks, '❌ Лид отклонён');
    console.log(`[Slack] assignment ${assignmentId} rejected by ${manager?.name}, next: ${nextManager?.name || '—'}`);
  }
}

// ── POST /slack/command — slash commands ───────────────────────────────
router.post('/command', async (req, res) => {
  const { user_id, text = '', channel_id, response_url } = req.body;
  const parts = text.trim().split(/\s+/);
  const sub = (parts[0] || 'help').toLowerCase();

  // Ack within 3s — return ephemeral immediately for fast paths,
  // for slow paths use response_url.
  try {
    if (sub === 'help' || sub === '') return res.json(helpReply());
    if (sub === 'status')  return res.json(await statusReply(user_id));
    if (sub === 'pause')   return res.json(await pauseReply(user_id, parts[1]));
    if (sub === 'resume')  return res.json(await resumeReply(user_id));
    return res.json({ response_type: 'ephemeral', text: `Неизвестная команда: ${sub}. Попробуй \`/leadrouter help\`.` });
  } catch (err) {
    console.error('[Slack] /command error:', err.message);
    return res.json({ response_type: 'ephemeral', text: `Ошибка: ${err.message}` });
  }
});

function helpReply() {
  return {
    response_type: 'ephemeral',
    text: '*Lead Router — команды*',
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: '*Lead Router — команды*' }},
      { type: 'section', text: { type: 'mrkdwn',
        text: '`/leadrouter status` — твои активные лиды и статистика за сегодня\n'
            + '`/leadrouter pause [1h|30m]` — пауза (без аргумента — до конца дня)\n'
            + '`/leadrouter resume` — снова принимать лиды\n'
            + '`/leadrouter help` — эта справка',
      }},
    ],
  };
}

async function statusReply(slackUserId) {
  const m = db.prepare('SELECT * FROM managers WHERE slack_user_id = ?').get(slackUserId);
  if (!m) return { response_type: 'ephemeral', text: 'Ты не зарегистрирован как менеджер.' };

  const active = db.prepare(
    "SELECT * FROM assignments WHERE manager_id = ? AND status = 'pending' ORDER BY deadline_at ASC"
  ).all(m.id);

  // Today stats (server-local day)
  const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
  const todayIso = startOfDay.toISOString();
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status IN ('touched','accepted') THEN 1 ELSE 0 END) AS done
    FROM assignments WHERE manager_id = ? AND assigned_at >= ?
  `).get(m.id, todayIso);

  const now = Date.now();
  const lines = active.length === 0 ? '_нет активных лидов_' : active.slice(0, 10).map(a => {
    const left = Math.max(0, Math.round((new Date(a.deadline_at).getTime() - now) / 60000));
    return `• *${a.lead_title || a.lead_id}* — ${left} мин до дедлайна`;
  }).join('\n');

  const pauseUntil = getSetting(`manager_pause_${m.id}`, '');
  const pauseLine = pauseUntil ? `\n⏸ Ты на паузе до *${new Date(pauseUntil).toLocaleString('ru-RU')}*` : '';

  return {
    response_type: 'ephemeral',
    text: 'Твой статус',
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: '📊 Твой статус', emoji: true }},
      { type: 'section', fields: [
        { type: 'mrkdwn', text: `*Активные лиды:*\n${active.length}` },
        { type: 'mrkdwn', text: `*За сегодня:*\n${stats.done || 0} обработано / ${stats.total || 0} всего` },
      ]},
      { type: 'section', text: { type: 'mrkdwn', text: lines + pauseLine }},
    ],
  };
}

function parseDuration(arg) {
  if (!arg) return null;
  const m = String(arg).trim().match(/^(\d+)\s*(h|m|ч|м)?$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = (m[2] || 'm').toLowerCase();
  return (unit === 'h' || unit === 'ч') ? n * 60 : n;
}

async function pauseReply(slackUserId, durArg) {
  const m = db.prepare('SELECT * FROM managers WHERE slack_user_id = ?').get(slackUserId);
  if (!m) return { response_type: 'ephemeral', text: 'Ты не зарегистрирован как менеджер.' };

  let untilDate;
  const minutes = parseDuration(durArg);
  if (minutes && minutes > 0) {
    untilDate = new Date(Date.now() + minutes * 60 * 1000);
  } else {
    untilDate = new Date(); untilDate.setHours(23, 59, 0, 0);
  }

  setSetting(`manager_pause_${m.id}`, untilDate.toISOString());
  db.prepare('UPDATE managers SET is_active = 0 WHERE id = ?').run(m.id);
  console.log(`[Slack] manager ${m.name} paused until ${untilDate.toISOString()}`);

  return {
    response_type: 'ephemeral',
    text: `⏸ Поставил тебя на паузу до ${fmtHM(untilDate)}. Используй \`/leadrouter resume\` чтобы вернуться раньше.`,
  };
}

async function resumeReply(slackUserId) {
  const m = db.prepare('SELECT * FROM managers WHERE slack_user_id = ?').get(slackUserId);
  if (!m) return { response_type: 'ephemeral', text: 'Ты не зарегистрирован как менеджер.' };

  deleteSetting(`manager_pause_${m.id}`);
  db.prepare('UPDATE managers SET is_active = 1 WHERE id = ?').run(m.id);
  console.log(`[Slack] manager ${m.name} resumed`);

  return { response_type: 'ephemeral', text: '▶️ Готов принимать лиды!' };
}

module.exports = router;
