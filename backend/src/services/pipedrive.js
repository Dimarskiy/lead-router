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

// ── Deal field options cache (resolves set/enum IDs → labels) ─────────
let _fieldOptionsCache = null;
let _fieldOptionsCacheTime = 0;
const FIELD_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function getDealFieldOptions() {
  if (_fieldOptionsCache && Date.now() - _fieldOptionsCacheTime < FIELD_CACHE_TTL) {
    return _fieldOptionsCache;
  }
  try {
    const { data } = await pd.get('/dealFields', { params: { api_token: TOKEN, limit: 500 } });
    const map = {}; // fieldKey → { name, options: { "optionId": "label" } }
    for (const f of (data.data || [])) {
      if (f.options?.length) {
        map[f.key] = {
          name: (f.name || '').toLowerCase().trim(),
          options: Object.fromEntries(f.options.map(o => [String(o.id), o.label])),
        };
      }
    }
    _fieldOptionsCache = map;
    _fieldOptionsCacheTime = Date.now();
    console.log(`[Pipedrive] Cached ${Object.keys(map).length} deal fields with options`);
    return map;
  } catch (err) {
    console.error('[Pipedrive] getDealFieldOptions failed:', err.message);
    return _fieldOptionsCache || {};
  }
}

async function getLead(leadId) {
  const numeric = extractDealId(leadId);
  if (!numeric || !/^\d+$/.test(numeric)) return null;
  try {
    const { data } = await pd.get(`/deals/${numeric}`, { params: { api_token: TOKEN } });
    const d = data.data;
    if (!d) return null;
    // Start with all scalar fields from the deal
    const base = {};
    Object.entries(d).forEach(([k, v]) => {
      if (typeof v !== 'object' || v === null) base[k] = v;
    });
    // Resolve custom set/enum field IDs → labels and map by field name
    const fieldOptions = await getDealFieldOptions();
    for (const [key, meta] of Object.entries(fieldOptions)) {
      if (base[key] != null && base[key] !== '') {
        const labels = String(base[key]).split(',')
          .map(id => meta.options[id.trim()] || id.trim())
          .join(',');
        base[key] = labels;
        if (meta.name) base[meta.name] = labels;
      }
    }
    return {
      ...base,
      id: `deal_${d.id}`,
      _deal_id: d.id,
      title: d.title,
      value: d.value,
      pipeline_id: d.pipeline_id,
      stage_id: d.stage_id,
      source_name: d.origin || d.source_name || '',
      channel: d.channel || '',
      person_name: d.person_name || (typeof d.person_id === 'object' ? d.person_id?.name : '') || '',
      organization_name: d.org_name || (typeof d.org_id === 'object' ? d.org_id?.name : '') || '',
    };
  } catch { return null; }
}

async function getUsers() {
  const { data } = await pd.get('/users', { params: { api_token: TOKEN } });
  return (data.data || []).map(u => ({ id: u.id, name: u.name, email: u.email }));
}

async function getProducts() {
  // Returns unique options from the "Product" custom set field + Pipedrive catalog
  const all = [];
  const seen = new Set();

  // 1. Custom "Product" field options (primary source for this setup)
  try {
    const fieldOptions = await getDealFieldOptions();
    for (const meta of Object.values(fieldOptions)) {
      if (meta.name === 'product') {
        for (const label of Object.values(meta.options)) {
          if (!seen.has(label.toLowerCase())) {
            seen.add(label.toLowerCase());
            all.push({ id: label, name: label, code: '' });
          }
        }
        break;
      }
    }
  } catch (err) {
    console.error('[Pipedrive] getProducts (custom field) failed:', err.message);
  }

  // 2. Pipedrive Products catalog (fallback / additional items)
  let start = 0;
  try {
    while (true) {
      const { data } = await pd.get('/products', {
        params: { api_token: TOKEN, limit: 500, start },
      });
      const items = data.data || [];
      items.forEach(p => {
        if (p.name && !seen.has(p.name.toLowerCase())) {
          seen.add(p.name.toLowerCase());
          all.push({ id: p.id, name: p.name, code: p.code });
        }
      });
      if (!data.additional_data?.pagination?.more_items_in_collection) break;
      start += items.length;
    }
  } catch (err) {
    console.error('[Pipedrive] getProducts (catalog) failed:', err.message);
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

module.exports = {
  assignDealToUser, hasTouchSince, getLead, getUsers,
  getProducts, getDealProducts, getDealFieldOptions, extractDealId,
};
