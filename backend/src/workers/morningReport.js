const cron = require('node-cron');
const db = require('../db');
const slack = require('../services/slack');

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value ?? fallback;
}

function yesterdayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString(), date: start };
}

async function buildAndSend() {
  try {
    const { startIso, endIso, date } = yesterdayRange();

    const totals = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status IN ('touched','accepted') THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN status = 'timed_out' THEN 1 ELSE 0 END) AS timeouts,
        AVG(CASE
          WHEN status IN ('touched','accepted') AND touched_at IS NOT NULL
          THEN (julianday(touched_at) - julianday(assigned_at)) * 24 * 60
          ELSE NULL
        END) AS avg_minutes
      FROM assignments
      WHERE assigned_at >= ? AND assigned_at < ?
    `).get(startIso, endIso);

    const total = Number(totals?.total || 0);
    const done = Number(totals?.done || 0);
    const timeouts = Number(totals?.timeouts || 0);
    const conv = total > 0 ? Math.round((done / total) * 100) : 0;
    const avgMin = totals?.avg_minutes ? Math.round(totals.avg_minutes) : null;

    if (total === 0) {
      console.log('[MorningReport] No leads yesterday — skipping');
      return;
    }

    const top = db.prepare(`
      SELECT m.name,
        COUNT(*) AS total,
        SUM(CASE WHEN a.status IN ('touched','accepted') THEN 1 ELSE 0 END) AS done
      FROM assignments a
      JOIN managers m ON a.manager_id = m.id
      WHERE a.assigned_at >= ? AND a.assigned_at < ?
      GROUP BY m.id
      HAVING total > 0
      ORDER BY (CAST(done AS REAL) / total) DESC, total DESC
      LIMIT 3
    `).all(startIso, endIso);

    const medals = ['🥇', '🥈', '🥉'];
    const topLines = top.map((r, i) => {
      const pct = r.total > 0 ? Math.round((r.done / r.total) * 100) : 0;
      return `${medals[i]} ${r.name} — ${pct}% (${r.total} лидов)`;
    }).join('\n') || '_данных нет_';

    const dateLabel = date.toLocaleDateString('ru-RU');
    const adminUrl = getSetting('admin_url', '');
    const blocks = [
      { type: 'header', text: { type: 'plain_text', text: '🌅 Доброе утро! Отчёт за вчера', emoji: true } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `_${dateLabel}_` }] },
      { type: 'section', fields: [
        { type: 'mrkdwn', text: `*Всего лидов:*\n${total}` },
        { type: 'mrkdwn', text: `*Обработано:*\n${done} (${conv}%)` },
        { type: 'mrkdwn', text: `*Таймаутов:*\n${timeouts}` },
        { type: 'mrkdwn', text: `*Среднее время касания:*\n${avgMin !== null ? `${avgMin} мин` : '—'}` },
      ]},
      { type: 'section', text: { type: 'mrkdwn', text: `*Топ-3 по конверсии:*\n${topLines}` }},
      ...(adminUrl ? [{
        type: 'actions', elements: [
          { type: 'button', text: { type: 'plain_text', text: '📈 Открыть аналитику', emoji: true },
            url: `${adminUrl.replace(/\/$/, '')}/#analytics`, style: 'primary' },
        ],
      }] : []),
    ];

    const channel = getSetting('report_channel_id', '') || process.env.SLACK_DEFAULT_CHANNEL || '#sales';
    const recipient = getSetting('report_recipient_user_id', '');
    if (recipient) {
      await slack.sendMessage(recipient, blocks, 'Утренний отчёт');
    } else {
      await slack.sendMessage(channel, blocks, 'Утренний отчёт');
    }
    console.log(`[MorningReport] Sent: total=${total} done=${done} conv=${conv}%`);
  } catch (err) {
    console.error('[MorningReport] failed:', err.message);
  }
}

let cronTask = null;

function start() {
  const expr = getSetting('report_cron', '0 9 * * 1-5');
  const tz = getSetting('timezone', 'Europe/Moscow');
  if (!cron.validate(expr)) {
    console.warn(`[MorningReport] invalid cron "${expr}", falling back to "0 9 * * 1-5"`);
  }
  const safe = cron.validate(expr) ? expr : '0 9 * * 1-5';
  cronTask = cron.schedule(safe, buildAndSend, { timezone: tz });
  console.log(`[MorningReport] Scheduled "${safe}" in ${tz}`);
}

module.exports = { start, buildAndSend };
