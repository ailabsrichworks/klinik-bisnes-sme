// Shared helpers for the participant app: config, DOM helpers, and the API client.
// The participant is identified by a random journey id + secret token kept in this browser (no login).
window.KB = (() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const KEY = 'kbsme_journey_v1';
  let cfg = null;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function message(id, text, error = false) {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'message' + (text ? ' show' : '') + (error ? ' error' : '');
  }

  function show(id, on) { const el = $(id); if (el) el.hidden = !on; }

  async function init() {
    cfg = await fetch('api/config').then((r) => r.json());
    return { cfg };
  }

  const getKey = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
  const setKey = (k) => { try { k ? localStorage.setItem(KEY, JSON.stringify(k)) : localStorage.removeItem(KEY); } catch {} };

  // Calls our server. `raw` sends a file body as-is. `keepalive` lets a save finish while the page closes.
  async function api(path, { method = 'GET', body, raw, headers = {}, keepalive = false } = {}) {
    const k = getKey();
    const res = await fetch(path, {
      method,
      keepalive,
      headers: {
        ...(raw ? {} : { 'Content-Type': 'application/json' }),
        ...(k ? { 'X-Journey-Id': k.id, 'X-Journey-Token': k.token } : {}),
        ...headers,
      },
      body: raw || (body ? JSON.stringify(body) : undefined),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || `Ralat ${res.status}`); e.status = res.status; throw e; }
    return data;
  }

  return { $, esc, message, show, init, api, getKey, setKey, get cfg() { return cfg; } };
})();
