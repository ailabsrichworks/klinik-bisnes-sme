// Creates (or promotes) a trainer account. Trainer login never creates accounts by itself.
// Usage: node --env-file=.env scripts/add-trainer.mjs someone@example.com [trainer|admin]
import { createClient } from '@supabase/supabase-js';

const [email, role = 'trainer'] = process.argv.slice(2);
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '') || !['trainer', 'admin'].includes(role)) {
  console.error('Usage: node --env-file=.env scripts/add-trainer.mjs someone@example.com [trainer|admin]');
  process.exit(1);
}
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { error: createErr } = await admin.auth.admin.createUser({ email, email_confirm: true });
if (createErr && !/already|registered|exists/i.test(createErr.message)) throw createErr;
const { data, error } = await admin.from('profiles').update({ role }).eq('email', email).select('email, role');
if (error) throw error;
if (!data.length) throw new Error(`No profile found for ${email}`);
console.log(`${data[0].email} is now ${data[0].role}. They can sign in at /trainer.`);
