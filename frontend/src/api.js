const BASE = (import.meta.env.VITE_API_URL || '') + '/api';
async function req(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) { const err = await res.json().catch(() => ({ error: res.statusText })); throw new Error(err.error || 'Request failed'); }
  return res.json();
}
export const api = {
  getManagers: () => req('GET', '/managers'),
  createManager: (data) => req('POST', '/managers', data),
  updateManager: (id, data) => req('PUT', `/managers/${id}`, data),
  deleteManager: (id) => req('DELETE', `/managers/${id}`),
  reorderManagers: (order) => req('POST', '/managers/reorder', { order }),
  getPipedriveUsers: () => req('GET', '/managers/pipedrive-users'),
  getProducts: () => req('GET', '/products'),
  getRules: () => req('GET', '/rules'),
  createRule: (data) => req('POST', '/rules', data),
  updateRule: (id, data) => req('PUT', `/rules/${id}`, data),
  deleteRule: (id) => req('DELETE', `/rules/${id}`),
  getAssignments: (params = {}) => { const qs = new URLSearchParams(params).toString(); return req('GET', `/assignments${qs ? '?' + qs : ''}`); },
  getStats: () => req('GET', '/assignments/stats'),
  getSettings: () => req('GET', '/settings'),
  updateSettings: (data) => req('PUT', '/settings', data),
};
