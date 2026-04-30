const axios = require('axios');
const BASE = 'https://api.pipedrive.com/v1';
const TOKEN = process.env.PIPEDRIVE_API_TOKEN;
const pd = axios.create({ baseURL: BASE, timeout: 10000 });

function extractDealId(id) {
  if (id === undefined || id === null) return null;
  const s = String(id);
  if (s.startsWith('deal_')) return s.slice(5);
  return s;
}

async function assignDealToUser(dealId, pipedriveUserId) {
  const numeric = extractDealId(dealId);
  const { data } = await pd.put(`/deals/${numeric}`, { user_id: pipedriveUserId }, { params: { api_token: TOKEN } });
  return data.data;
}

async function hasTouchSince(dealId, sinceIso) {
  const numeric = extractDealId(dealId);
  if (!numeric || !/^\d+$/.test(numeric)) return { touched: false };
  try {
    const since = new Date(sinceIso);
    const { data: actData } = await pd.get(`/deals/${numeric}/activities`, { params: { api_token: TOKEN, limit: 50 } });
    for (const act of (actData.data || [])) {
      if (new Date(act.add_time) > since) return { touched: true, type: 'activity', at: act.add_time };
    }
    const { data: flowData } = await pd.get(`/deals/${numeric}/flow`, { params: { api_token: TOKEN, limit: 50 } });
    for (const item of (flowData.data || [])) {
      if (new Date(item.log_time || item.add_time) > since) return { touched: true, type: 'update', at: item.log_time };
    }
    return { touched: false };
  } catch { return { touched: false }; }
}

async function getLead(leadId) {
  const numeric = extractDealId(leadId);
  if (!numeric || !/^\d+$/.test(numeric)) return null;
  try {
    const { data } = await pd.get(`/deals/${numeric}`, { params: { api_token: TOKEN } });
    const d = data.data;
    if (!d) return null;
    return {
      id: `deal_${d.id}`,
      _deal_id: d.id,
      title: d.title,
      value: d.value,
      pipeline_id: d.pipeline_id,
      stage_id: d.stage_id,
      source_name: d.origin || '',
      channel: d.channel || '',
      person_name: d.person_name || d.person_id?.name,
      organization_name: d.org_name || d.org_id?.name,
    };
  } catch { return null; }
}

async function getUsers() {
  const { data } = await pd.get('/users', { params: { api_token: TOKEN } });
  return (data.data || []).map(u => ({ id: u.id, name: u.name, email: u.email }));
}

async function getProducts() {
  const all = [];
  let start = 0;
  try {
    while (true) {
      const { data } = await pd.get('/products', {
        params: { api_token: TOKEN, limit: 500, start },
      });
      const items = data.data || [];
      items.forEach(p => all.push({ id: p.id, name: p.name, code: p.code }));
      if (!data.additional_data?.pagination?.more_items_in_collection) break;
      start += items.length;
    }
  } catch (err) {
    console.error('[Pipedrive] getProducts failed:', err.message);
  }
  return all;
}

async function getDealProducts(dealId) {
  const numeric = extractDealId(dealId);
  if (!numeric || !/^\d+$/.test(numeric)) return [];
  const all = [];
  let start = 0;
  try {
    while (true) {
      const { data } = await pd.get(`/deals/${numeric}/products`, {
        params: { api_token: TOKEN, limit: 500, start },
      });
      const items = data.data || [];
      items.forEach(p => all.push({
        id: p.product_id || p.id,
        name: p.name,
        code: p.product?.code || p.code,
      }));
      if (!data.additional_data?.pagination?.more_items_in_collection) break;
      start += items.length;
    }
  } catch { }
  return all;
}

module.exports = { assignDealToUser, hasTouchSince, getLead, getUsers, getProducts, getDealProducts, extractDealId };
