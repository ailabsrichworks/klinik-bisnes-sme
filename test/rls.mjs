// Access-rule checks against the real Supabase project (no AI calls):
//   node --env-file=.env test/rls.mjs
// Uses throwaway session codes and users; everything is deleted afterwards.
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: service } = process.env;
const admin = createClient(url, service, { auth: { persistSession: false } });
const client = () => createClient(url, anonKey, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const users = [], cohorts = [];

async function cohort(hoursLeft) {
  const code = `RLS-${randomUUID().slice(0, 6).toUpperCase()}`;
  const { data, error } = await admin.from('cohorts').insert({ code, name: 'RLS test', active_until: new Date(Date.now() + hoursLeft * 3600e3).toISOString() }).select().single();
  if (error) throw error;
  cohorts.push(data.id);
  return data;
}
async function emailUser(role) {
  const sb = client();
  const email = `kbsme-rls-${randomUUID().slice(0, 8)}@example.com`;
  const { data: u } = await admin.auth.admin.createUser({ email, email_confirm: true });
  users.push(u.user.id);
  if (role) await admin.from('profiles').update({ role }).eq('id', u.user.id);
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const { data } = await sb.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  return { sb, uid: data.user.id };
}

try {
  const live = await cohort(2), expired = await cohort(-1);
  const anon = client();

  // Session code lookup
  const found = await anon.rpc('cohort_by_code', { p_code: live.code.toLowerCase() });
  check('valid code found (any case, before sign-in)', found.data?.[0]?.id === live.id);
  const gone = await anon.rpc('cohort_by_code', { p_code: expired.code });
  check('expired code not found', !gone.error && gone.data.length === 0);

  // Participants cannot list sessions
  const p = await emailUser();
  const list = await p.sb.from('cohorts').select('code');
  check('participant cannot list session codes', !list.error && list.data.length === 0);

  // Journeys only inside an active session
  const bad = await p.sb.from('journeys').insert({ user_id: p.uid, cohort_id: expired.id, state: {} });
  check('journey in expired session refused', !!bad.error, bad.error?.message);
  const upBefore = await p.sb.storage.from('evidence').upload(`${p.uid}/x.txt`, new Blob(['x'], { type: 'text/plain' }));
  check('upload refused before the participant has a journey', !!upBefore.error);
  const ok = await p.sb.from('journeys').insert({ user_id: p.uid, cohort_id: live.id, state: {} }).select('id').single();
  check('journey in active session allowed', !ok.error, ok.error?.message);
  const upAfter = await p.sb.storage.from('evidence').upload(`${p.uid}/x.txt`, new Blob(['x'], { type: 'text/plain' }));
  check('upload allowed inside active session', !upAfter.error, upAfter.error?.message);
  if (!upAfter.error) await admin.storage.from('evidence').remove([`${p.uid}/x.txt`]);

  // Public use: no session code needed
  const q = await emailUser();
  const open = await q.sb.from('journeys').insert({ user_id: q.uid, cohort_id: null, state: {} }).select('id').single();
  check('journey without a session code allowed (public)', !open.error, open.error?.message);
  const upOpen = await q.sb.storage.from('evidence').upload(`${q.uid}/x.txt`, new Blob(['x'], { type: 'text/plain' }));
  check('upload allowed with a no-code journey', !upOpen.error, upOpen.error?.message);

  // Staff
  const t = await emailUser('trainer');
  const tl = await t.sb.from('cohorts').select('id').in('id', [live.id, expired.id]);
  check('trainer sees sessions incl. expired', tl.data?.length === 2);
  const tj = await t.sb.from('journeys').select('id').eq('id', ok.data?.id);
  check('trainer reads participant journey', tj.data?.length === 1);
  const pj = await p.sb.from('journeys').select('id').neq('user_id', p.uid);
  check('participant cannot read other journeys', pj.data?.length === 0);

  // Anonymous participants (needs "Allow anonymous sign-ins")
  const a = client();
  const { data: as, error: aErr } = await a.auth.signInAnonymously();
  if (aErr) {
    console.log(`SKIP anonymous checks — ${aErr.message}`);
  } else {
    users.push(as.user.id);
    const aj = await a.from('journeys').insert({ user_id: as.user.id, cohort_id: live.id, state: {} }).select('id').single();
    check('anonymous participant can join active session', !aj.error, aj.error?.message);
    const an = await a.from('journeys').insert({ user_id: as.user.id, cohort_id: null, state: {} }).select('id').single();
    check('anonymous participant can start without a code', !an.error, an.error?.message);
    // Even if an anonymous user's profile were promoted, it must never pass the staff check.
    await admin.from('profiles').update({ role: 'admin' }).eq('id', as.user.id);
    const al = await a.from('cohorts').select('id').in('id', [live.id, expired.id]);
    check('anonymous user never treated as staff', !al.error && al.data.length === 0);
    const aOthers = await a.from('journeys').select('id').neq('user_id', as.user.id);
    check('anonymous user cannot read other journeys', aOthers.data?.length === 0);
  }
} finally {
  for (const id of users) {
    const { data: f } = await admin.storage.from('evidence').list(id);
    if (f?.length) await admin.storage.from('evidence').remove(f.map((x) => `${id}/${x.name}`));
    await admin.auth.admin.deleteUser(id);
  }
  if (cohorts.length) await admin.from('cohorts').delete().in('id', cohorts);
}
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exitCode = results.every(Boolean) ? 0 : 1;
