const express = require('express');
const router = express.Router();
const db = require('../db');
const { assignLead } = require('../services/router');

router.post('/pipedrive', async (req, res) => {
  res.status(200).json({ ok: true });
  const body = req.body;
  try {
    let action, entity, dealData;
    if (body.meta && body.meta.action) {
      action = body.meta.action;
      entity = body.meta.entity;
      dealData = body.data;
    } else if (body.event) {
      const parts = body.event.split('.');
      action = parts[0];
      entity = parts[1];
      dealData = body.data?.current || body.data;
    } else { return; }
    console.log(`[Webhook] action=${action} entity=${entity} id=${dealData?.id} title=${dealData?.title}`);
    if (!dealData || !dealData.id) return;
    if ((action === 'create' || action === 'added') && (entity === 'deal' || entity === 'lead')) {
      const leadId = `deal_${dealData.id}`;
      const existing = db.prepare(
        "SELECT id FROM assignments WHERE lead_id = ? AND status IN ('pending','touched')"
      ).get(leadId);
      if (existing) {
        console.log(`[Webhook] Skipping ${leadId}: already has active assignment #${existing.id}`);
        return;
      }
      // Wait for Pipedrive to finish writing products before fetching them
      await new Promise(r => setTimeout(r, 3000));
      const leadLike = {
        ...dealData,
        id: leadId,
        _deal_id: dealData.id,
        title: dealData.title || String(dealData.id),
        source_name: dealData.origin || dealData.source_name || '',
        // Normalize field names to match rule builder field names
        person_name: dealData.person_name || (typeof dealData.person_id === 'object' ? dealData.person_id?.name : '') || '',
        organization_name: dealData.org_name || (typeof dealData.org_id === 'object' ? dealData.org_id?.name : '') || '',
      };
      console.log('[Webhook] Processing:', leadLike.title);
      await assignLead(leadLike.id, leadLike, false, []);
    }
  } catch (err) {
    console.error('[Webhook] Error:', err.message);
  }
});

router.post('/trigger', async (req, res) => {
  const leadLike = { id: `test_${Date.now()}`, title: req.body.title || 'Test', value: 0, pipeline_id: 1, stage_id: 1 };
  try {
    const manager = await assignLead(leadLike.id, leadLike, false, []);
    res.json({ ok: true, assigned_to: manager?.name || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
