const axios = require('axios');

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
const DEFAULT_CHANNEL = process.env.SLACK_DEFAULT_CHANNEL || '#sales';
const DOMAIN = process.env.PIPEDRIVE_COMPANY_DOMAIN || 'app';

async function sendMessage(channel, blocks, text) {
  if (!SLACK_TOKEN) { console.warn('[Slack] No SLACK_BOT_TOKEN set'); return; }
  try {
    await axios.post('https://slack.com/api/chat.postMessage',
      { channel, blocks, text },
      { headers: { Authorization: `Bearer ${SLACK_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (err) { console.error('[Slack] Failed:', err.message); }
}

async function notifyAssignment({ manager, lead, isReassign, reassignCount, timeoutMinutes }) {
  const channel = manager.slack_user_id ? manager.slack_user_id : DEFAULT_CHANNEL;
  const emoji = isReassign ? '🔄' : '🎯';
  const header = isReassign ? `${emoji} Лид переназначен вам (попытка ${reassignCount})` : `${emoji} Новый лид назначен вам`;
  const dealId = lead._deal_id || lead.id?.replace('deal_', '');
  const url = `https://${DOMAIN}.pipedrive.com/deal/${dealId}`;

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: header, emoji: true } },
    { type: 'section', fields: [
      { type: 'mrkdwn', text: `*Лид:*\n${lead.title || lead.id}` },
      { type: 'mrkdwn', text: `*Менеджер:*\n${manager.name}` },
    ]},
    { type: 'section', text: { type: 'mrkdwn', text: `⏰ У вас *${timeoutMinutes} минут* на первое касание. Если касания не будет — лид уйдёт следующему менеджеру.` }},
    { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: '📋 Открыть в Pipedrive', emoji: true }, url, style: 'primary' }]},
  ];
  await sendMessage(channel, blocks, header);
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

module.exports = { notifyAssignment, notifyTimeout, notifyNoManagersAvailable };
