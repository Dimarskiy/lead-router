const axios = require('axios');

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
const DEFAULT_CHANNEL = process.env.SLACK_DEFAULT_CHANNEL || '#sales';
const DOMAIN = process.env.PIPEDRIVE_COMPANY_DOMAIN || 'app';

const slack = axios.create({
  baseURL: 'https://slack.com/api',
  timeout: 8000,
  headers: { Authorization: `Bearer ${SLACK_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
});

function dealUrl(lead) {
  const dealId = lead._deal_id || (typeof lead.id === 'string' ? lead.id.replace('deal_', '') : lead.id);
  return `https://${DOMAIN}.pipedrive.com/deal/${dealId}`;
}

async function sendMessage(channel, blocks, text) {
  if (!SLACK_TOKEN) { console.warn('[Slack] No SLACK_BOT_TOKEN set'); return null; }
  if (!channel) { console.warn('[Slack] sendMessage skipped: empty channel'); return null; }
  try {
    const { data } = await slack.post('/chat.postMessage', { channel, blocks, text });
    if (!data.ok) { console.error('[Slack] postMessage error:', data.error); return null; }
    return { channel: data.channel, ts: data.ts };
  } catch (err) {
    console.error('[Slack] sendMessage failed:', err.message);
    return null;
  }
}

async function updateMessage(channel, ts, blocks, text) {
  if (!SLACK_TOKEN || !channel || !ts) return false;
  try {
    const { data } = await slack.post('/chat.update', { channel, ts, blocks, text });
    if (!data.ok) { console.error('[Slack] chat.update error:', data.error); return false; }
    return true;
  } catch (err) {
    console.error('[Slack] updateMessage failed:', err.message);
    return false;
  }
}

async function postEphemeral(channel, user, text) {
  if (!SLACK_TOKEN) return;
  try {
    await slack.post('/chat.postEphemeral', { channel, user, text });
  } catch (err) { console.error('[Slack] postEphemeral failed:', err.message); }
}

async function sendDm(userId, text) {
  if (!SLACK_TOKEN || !userId) return;
  try {
    await slack.post('/chat.postMessage', { channel: userId, text });
  } catch (err) { console.error('[Slack] sendDm failed:', err.message); }
}

// ── Assignment notification (with Accept / Reject buttons) ─────────────
async function notifyAssignment({ manager, lead, isReassign, reassignCount, timeoutMinutes, assignmentId }) {
  const channel = manager.slack_user_id ? manager.slack_user_id : DEFAULT_CHANNEL;
  const emoji = isReassign ? '🔄' : '🎯';
  const header = isReassign
    ? `${emoji} Лид переназначен вам (попытка ${reassignCount})`
    : `${emoji} Новый лид назначен вам`;
  const url = dealUrl(lead);

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: header, emoji: true } },
    { type: 'section', fields: [
      { type: 'mrkdwn', text: `*Лид:*\n${lead.title || lead.id}` },
      { type: 'mrkdwn', text: `*Менеджер:*\n${manager.name}` },
    ]},
    { type: 'section', text: { type: 'mrkdwn', text: `⏰ У вас *${timeoutMinutes} минут* на первое касание. Если касания не будет — лид уйдёт следующему менеджеру.` }},
    { type: 'actions', elements: [
      { type: 'button', text: { type: 'plain_text', text: '📋 Открыть в Pipedrive', emoji: true }, url, action_id: 'open_pipedrive' },
      ...(assignmentId ? [
        { type: 'button', text: { type: 'plain_text', text: '✅ Принял', emoji: true }, value: `accept_${assignmentId}`, action_id: 'accept_lead', style: 'primary' },
        { type: 'button', text: { type: 'plain_text', text: '❌ Не могу взять', emoji: true }, value: `reject_${assignmentId}`, action_id: 'reject_lead', style: 'danger' },
      ] : []),
    ]},
  ];
  return sendMessage(channel, blocks, header);
}

async function notifyTimeout({ manager, lead, nextManager }) {
  const channel = manager.slack_user_id ? manager.slack_user_id : DEFAULT_CHANNEL;
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '⏰ Лид передан — время вышло', emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `Лид *${lead.title || lead.id}* не получил касания вовремя и передан менеджеру *${nextManager.name}*.` }},
  ];
  await sendMessage(channel, blocks, 'Лид передан из-за таймаута');
}

async function notifyNoManagersAvailable({ lead }) {
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '🚨 Нет доступных менеджеров!', emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `Лид *${lead.title || lead.id}* не удалось назначить — нет активных менеджеров.` }},
  ];
  await sendMessage(DEFAULT_CHANNEL, blocks, 'Нет доступных менеджеров');
}

// ── Escalation: too many reassignments ─────────────────────────────────
async function notifyEscalation({ manager, lead, reassignCount, escalationUserId }) {
  const target = escalationUserId || DEFAULT_CHANNEL;
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `🚨 Лид требует внимания — ${reassignCount} переназначений`, emoji: true } },
    { type: 'section', text: { type: 'mrkdwn',
      text: `Лид *${lead.title || lead.id}* был переназначен *${reassignCount}* раз. Менеджеры подряд не берут его. Сейчас у *${manager.name}*.`,
    }},
    { type: 'actions', elements: [
      { type: 'button', text: { type: 'plain_text', text: '📋 Открыть в Pipedrive', emoji: true }, url: dealUrl(lead), style: 'primary' },
    ]},
  ];
  console.log(`[Escalation] lead ${lead.id} reassign=${reassignCount} → ${target}`);
  await sendMessage(target, blocks, `Эскалация: ${lead.title || lead.id}`);
}

// ── SLA breach ─────────────────────────────────────────────────────────
async function notifySlaBreach({ assignment, manager, lead, hours, channel }) {
  const target = channel || DEFAULT_CHANNEL;
  const tag = manager.slack_user_id ? `<@${manager.slack_user_id}>` : `*${manager.name}*`;
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '🚨 SLA нарушен!', emoji: true } },
    { type: 'section', text: { type: 'mrkdwn',
      text: `Лид *${lead.title || lead.id}* висит уже *${hours}* ч. без касания. Назначен на ${tag}.`,
    }},
    { type: 'actions', elements: [
      { type: 'button', text: { type: 'plain_text', text: '📋 Открыть в Pipedrive', emoji: true }, url: dealUrl(lead), style: 'primary' },
    ]},
  ];
  console.log(`[SLA] lead ${lead.id} breach ${hours}h → ${target}`);
  await sendMessage(target, blocks, `SLA нарушен: ${lead.title || lead.id}`);
}

module.exports = {
  notifyAssignment, notifyTimeout, notifyNoManagersAvailable,
  notifyEscalation, notifySlaBreach,
  sendMessage, updateMessage, postEphemeral, sendDm,
  dealUrl,
};
