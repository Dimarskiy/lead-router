import { useEffect, useState } from 'react';
import { api } from '../api.js';

const OPERATORS = [
  { value: 'equals',       label: '= равно' },
  { value: 'not_equals',   label: '≠ не равно' },
  { value: 'contains',     label: '⊃ содержит' },
  { value: 'not_contains', label: '⊅ не содержит' },
  { value: 'starts_with',  label: '▷ начинается с' },
  { value: 'greater_than', label: '> больше' },
  { value: 'less_than',    label: '< меньше' },
  { value: 'is_empty',     label: '∅ пустое' },
  { value: 'is_not_empty', label: '∃ не пустое' },
];

const COMMON_FIELDS = [
  { value: 'product',           label: 'Продукт (product)' },
  { value: 'source_name',       label: 'Источник лида (source_name)' },
  { value: 'channel',           label: 'Канал (channel)' },
  { value: 'title',             label: 'Название лида (title)' },
  { value: 'value',             label: 'Сумма сделки (value)' },
  { value: 'pipeline_id',       label: 'Воронка (pipeline_id)' },
  { value: 'stage_id',          label: 'Стадия (stage_id)' },
  { value: 'person_name',       label: 'Имя контакта (person_name)' },
  { value: 'organization_name', label: 'Организация (organization_name)' },
];

const NEEDS_VALUE = ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'greater_than', 'less_than'];

function ConditionRow({ cond, products, onChange, onRemove, canRemove }) {
  const isCustom = cond.field && !COMMON_FIELDS.find(f => f.value === cond.field);
  const needsValue = NEEDS_VALUE.includes(cond.operator);
  const isProduct = cond.field === 'product';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1.4fr auto', gap: 8, alignItems: 'start', marginBottom: 8 }}>
      <div>
        <select className="select" value={isCustom ? '__custom' : cond.field}
          onChange={e => {
            if (e.target.value === '__custom') onChange({ ...cond, field: 'custom_field' });
            else onChange({ ...cond, field: e.target.value });
          }}>
          {COMMON_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          <option value="__custom">✎ Своё поле…</option>
        </select>
        {isCustom && (
          <input className="input" style={{ marginTop: 6 }} value={cond.field}
            onChange={e => onChange({ ...cond, field: e.target.value })}
            placeholder="ключ поля" />
        )}
      </div>

      <select className="select" value={cond.operator}
        onChange={e => onChange({ ...cond, operator: e.target.value })}>
        {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      {needsValue ? (
        isProduct && products.length > 0 ? (
          <select className="select" value={cond.value}
            onChange={e => onChange({ ...cond, value: e.target.value })}>
            <option value="">— выбери продукт —</option>
            {products.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
        ) : (
          <input className="input" value={cond.value}
            onChange={e => onChange({ ...cond, value: e.target.value })}
            placeholder={isProduct ? 'Название продукта' : 'Значение'} />
        )
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text3)', alignSelf: 'center' }}>— без значения —</div>
      )}

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={onRemove}
        disabled={!canRemove}
        title={canRemove ? 'Удалить условие' : 'Минимум одно условие'}
        style={{ color: canRemove ? 'var(--red)' : 'var(--text3)' }}
      >✕</button>
    </div>
  );
}

function RuleModal({ rule, managers, products, onClose, onSave }) {
  const [form, setForm] = useState({
    name: rule?.name || '',
    conditions: rule?.conditions?.length ? rule.conditions : [{ field: 'product', operator: 'equals', value: '' }],
    manager_ids: rule?.manager_ids || [],
    priority: rule?.priority ?? 0,
  });
  const [saving, setSaving] = useState(false);

  function updateCondition(idx, next) {
    setForm(f => ({ ...f, conditions: f.conditions.map((c, i) => i === idx ? next : c) }));
  }
  function addCondition() {
    setForm(f => ({ ...f, conditions: [...f.conditions, { field: 'source_name', operator: 'equals', value: '' }] }));
  }
  function removeCondition(idx) {
    setForm(f => ({ ...f, conditions: f.conditions.filter((_, i) => i !== idx) }));
  }
  function toggleManager(id) {
    setForm(f => ({
      ...f,
      manager_ids: f.manager_ids.includes(id)
        ? f.manager_ids.filter(x => x !== id)
        : [...f.manager_ids, id],
    }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        conditions: form.conditions,
        manager_ids: form.manager_ids,
        priority: form.priority,
      };
      if (rule?.id) await api.updateRule(rule.id, payload);
      else await api.createRule(payload);
      onSave();
    } finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <h3>{rule ? 'Редактировать правило' : 'Новое правило'}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Название правила *</label>
            <input className="input" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Продукт X из Instagram" />
          </div>

          <div className="field">
            <label>Условия <span style={{ color: 'var(--text3)', fontWeight: 400 }}>— все должны совпасть (AND)</span></label>
            {form.conditions.map((c, idx) => (
              <ConditionRow
                key={idx}
                cond={c}
                products={products}
                onChange={next => updateCondition(idx, next)}
                onRemove={() => removeCondition(idx)}
                canRemove={form.conditions.length > 1}
              />
            ))}
            <button type="button" className="btn btn-ghost btn-sm" onClick={addCondition} style={{ marginTop: 4 }}>
              + Добавить условие
            </button>
          </div>

          <div className="field">
            <label>Приоритет</label>
            <input className="input" type="number" value={form.priority}
              onChange={e => setForm(f => ({ ...f, priority: parseInt(e.target.value) || 0 }))}
              style={{ maxWidth: 120 }} />
            <p style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 4 }}>Больше = проверяется первым</p>
          </div>

          <div className="field">
            <label>Назначать менеджерам (пусто = все)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              {managers.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleManager(m.id)}
                  style={{
                    padding: '5px 12px', borderRadius: 99, fontSize: 12.5, fontWeight: 500,
                    border: '1px solid',
                    borderColor: form.manager_ids.includes(m.id) ? 'var(--accent)' : 'var(--border2)',
                    background: form.manager_ids.includes(m.id) ? 'rgba(79,142,247,.12)' : 'transparent',
                    color: form.manager_ids.includes(m.id) ? 'var(--accent)' : 'var(--text2)',
                    cursor: 'pointer',
                  }}
                >
                  {form.manager_ids.includes(m.id) ? '✓ ' : ''}{m.name}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.name}>
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Rules() {
  const [rules, setRules] = useState([]);
  const [managers, setManagers] = useState([]);
  const [products, setProducts] = useState([]);
  const [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () =>
    Promise.all([api.getRules(), api.getManagers(), api.getProducts().catch(() => [])])
      .then(([r, m, p]) => { setRules(r); setManagers(m); setProducts(p); })
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  async function toggleRule(r) {
    await api.updateRule(r.id, { is_active: r.is_active ? 0 : 1 });
    load();
  }

  async function deleteRule(id) {
    if (!confirm('Удалить правило?')) return;
    await api.deleteRule(id);
    load();
  }

  function managerNames(ids) {
    if (!ids || ids.length === 0) return <span className="badge badge-gray">все менеджеры</span>;
    return ids.map(id => {
      const m = managers.find(m => m.id === id);
      return m ? <span key={id} className="badge badge-blue" style={{ marginRight: 4 }}>{m.name}</span> : null;
    });
  }

  function renderCondition(c, idx) {
    const op = OPERATORS.find(o => o.value === c.operator)?.label || c.operator;
    return (
      <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--bg4)', padding: '2px 7px', borderRadius: 4, color: 'var(--text2)' }}>{c.field}</span>
        <span className="op-tag">{op}</span>
        {NEEDS_VALUE.includes(c.operator) && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--bg4)', padding: '2px 7px', borderRadius: 4, color: 'var(--amber)' }}>"{c.value}"</span>
        )}
      </span>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Правила распределения</h2>
          <p>Правила с высоким приоритетом проверяются первыми. Условия в правиле объединяются через AND.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal('add')}>+ Добавить правило</button>
      </div>
      <div className="page-body">
        {loading && <div style={{ color: 'var(--text3)' }}>Загрузка…</div>}
        {!loading && rules.length === 0 && (
          <div className="card empty">
            <div className="icon">◧</div>
            <p>Правил нет. Без правил все лиды распределяются по всем менеджерам round-robin.</p>
          </div>
        )}

        {rules.map(r => (
          <div key={r.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 500 }}>{r.name}</span>
                {r.is_active
                  ? <span className="badge badge-green">активно</span>
                  : <span className="badge badge-gray">выключено</span>}
                <span style={{ fontSize: 11.5, color: 'var(--text3)', marginLeft: 4 }}>приоритет {r.priority}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, flexWrap: 'wrap' }}>
                {(r.conditions || []).map((c, i) => (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {renderCondition(c, i)}
                    {i < r.conditions.length - 1 && (
                      <span style={{ color: 'var(--text3)', fontSize: 11, fontWeight: 600 }}>AND</span>
                    )}
                  </span>
                ))}
                <span style={{ color: 'var(--text3)', margin: '0 4px' }}>→</span>
                {managerNames(r.manager_ids)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label className="toggle">
                <input type="checkbox" checked={!!r.is_active} onChange={() => toggleRule(r)} />
                <span className="toggle-slider" />
              </label>
              <button className="btn btn-ghost btn-sm" onClick={() => setModal(r)}>Изменить</button>
              <button className="btn btn-danger btn-sm" onClick={() => deleteRule(r.id)}>Удалить</button>
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <RuleModal
          rule={modal === 'add' ? null : modal}
          managers={managers}
          products={products}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); load(); }}
        />
      )}
    </>
  );
}
