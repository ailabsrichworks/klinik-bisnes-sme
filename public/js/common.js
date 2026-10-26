// Shared by the participant app and the trainer dashboard: config, Supabase client, auth UI, API helper.
window.KB = (() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let sb = null;
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
    cfg = await fetch('/api/config').then((r) => r.json());
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error('Server belum dikonfigurasi (Supabase).');
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    return { sb, cfg };
  }

  async function session() {
    const { data } = await sb.auth.getSession();
    return data.session;
  }

  // Calls our own server with the participant's access token.
  async function api(path, { method = 'GET', body } = {}) {
    const s = await session();
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(s ? { Authorization: `Bearer ${s.access_token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Ralat ${res.status}`);
    return data;
  }

  // Trainer email sign-in (participants have no login): magic link, plus a 6-digit code for phones
  // whose mail app opens links elsewhere. Never creates accounts; see scripts/add-trainer.mjs.
  function wireLogin({ redirectTo }) {
    const form = $('loginForm');
    let sentTo = '';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('loginBtn');
      if (sentTo) {
        const token = ($('loginCode')?.value || '').replace(/\D/g, '');
        if (token.length < 6) return message('loginMessage', 'Masukkan kod 6 digit daripada emel.', true);
        btn.disabled = true;
        const { error } = await sb.auth.verifyOtp({ email: sentTo, token, type: 'email' });
        btn.disabled = false;
        if (error) return message('loginMessage', 'Kod tidak sah atau sudah tamat tempoh. Minta kod baharu.', true);
        return; // onAuthStateChange takes over
      }
      const email = $('loginEmail').value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return message('loginMessage', 'Masukkan emel yang sah.', true);
      btn.disabled = true; btn.textContent = 'Menghantar…';
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo(), shouldCreateUser: false } });
      btn.disabled = false;
      if (error) {
        btn.textContent = 'Hantar pautan log masuk';
        const unknown = /signups? not allowed|not found/i.test(error.message || '');
        return message('loginMessage', error.status === 429 ? 'Terlalu banyak cubaan. Tunggu seminit dan cuba lagi.' : unknown ? 'Emel ini belum didaftarkan sebagai trainer. Hubungi admin.' : 'Emel gagal dihantar. Cuba lagi.', true);
      }
      sentTo = email;
      $('loginEmail').readOnly = true;
      const codeField = document.createElement('div');
      codeField.className = 'field';
      codeField.style.marginTop = '14px';
      codeField.innerHTML = '<label for="loginCode">Atau taip kod 6 digit dalam emel</label><input id="loginCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456">';
      btn.before(codeField);
      btn.textContent = 'Sahkan kod';
      message('loginMessage', `Pautan log masuk dihantar ke ${email}. Klik pautan itu, atau taip kod di atas.`);
    });
  }

  return { $, esc, message, show, init, session, api, wireLogin, get sb() { return sb; }, get cfg() { return cfg; } };
})();
