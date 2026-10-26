import { config } from './config.mjs';
import { admin } from './supabase.mjs';

const DAY = 24 * 60 * 60 * 1000;
const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sendEmail({ to, subject, html, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.emailFrom, to, subject, html, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

function reminderEmail({ name, business, link }) {
  const hello = name ? `Hai ${name},` : 'Hai,';
  const text = `${hello}

Sudah tujuh hari sejak anda mula menguji Quick Fix untuk ${business || 'bisnes anda'}.

Luangkan 5 minit untuk rekod apa yang benar-benar berlaku — tindakan yang dibuat, angka atau dokumen yang disemak, dan apa langkah seterusnya. Angka kecil atau "belum buat" pun berguna.

Isi hasil Hari 7: ${link}

Klinik Bisnes SME`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#172b3a;max-width:520px">
<p>${escape(hello)}</p>
<p>Sudah tujuh hari sejak anda mula menguji Quick Fix untuk <b>${escape(business || 'bisnes anda')}</b>.</p>
<p>Luangkan 5 minit untuk rekod apa yang benar-benar berlaku — tindakan yang dibuat, angka atau dokumen yang disemak, dan apa langkah seterusnya. Angka kecil atau "belum buat" pun berguna.</p>
<p><a href="${escape(link)}" style="display:inline-block;background:#c8553d;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Isi hasil Hari 7</a></p>
<p style="color:#637581;font-size:13px">Klinik Bisnes SME</p></div>`;
  return { subject: 'Hari 7: apa yang berlaku selepas Quick Fix anda?', html, text };
}

export async function sendDueReminders() {
  if (!admin || !config.resendKey || !config.emailFrom || !config.publicUrl) return { skipped: true };
  const cutoff = new Date(Date.now() - 7 * DAY).toISOString();
  const { data: due, error } = await admin.from('journeys')
    .select('id, business_name, profiles!inner(email, full_name)')
    .lte('tracker_started_at', cutoff)
    .is('day7_reminder_sent_at', null)
    .limit(50);
  if (error) { console.error('[reminders] query failed', error.message); return { error: error.message }; }

  let sent = 0;
  for (const j of due) {
    if (!j.profiles?.email) continue;
    try {
      await sendEmail({ to: j.profiles.email, ...reminderEmail({ name: j.profiles.full_name, business: j.business_name, link: `${config.publicUrl}/?step=5` }) });
      await admin.from('journeys').update({ day7_reminder_sent_at: new Date().toISOString() }).eq('id', j.id);
      sent++;
    } catch (err) {
      console.error('[reminders] send failed for journey', j.id, err.message);
    }
  }
  if (sent) console.log(`[reminders] sent ${sent} Day 7 reminder(s)`);
  return { sent };
}

// Checks hourly. Fine for a single instance; with several replicas, move this to a Railway cron service.
export function startReminderLoop() {
  const run = () => sendDueReminders().catch((e) => console.error('[reminders]', e));
  setTimeout(run, 30_000);
  setInterval(run, 60 * 60 * 1000).unref();
}
