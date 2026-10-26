# KBSME Business Quick Fix

Participant tool for the free 2-hour "Dah Promote. Mana Sales?" session: business profile → evidence → AI diagnosis → one Quick Fix → 7-day tracker. Plus a trainer dashboard.

- **App:** Node 20+ / Express (`server/`) serving static pages (`public/`)
- **Data & login:** Supabase (Postgres + RLS, email magic link / 6-digit code, private storage bucket)
- **AI:** Claude via the Anthropic API (`server/diagnose.mjs`)
- **Email:** Resend (Supabase auth emails via SMTP, Day 7 reminders via API)
- **Hosting:** Railway

`original/` holds the v2 prototype package this was built from.

## Pages

| Path | Who | What |
|---|---|---|
| `/` or `/?c=CODE` | Participants | The five-step tool. `?c=` joins a cohort. `?step=5` opens the tracker (used in the Day 7 email). |
| `/trainer` | Trainers / admins | Cohorts, participant progress, detail view, CSV export |
| `/privacy` | Everyone | Privacy notice (**draft — fill the `[ ]` placeholders and get it approved**) |

## API

| Endpoint | Auth | Notes |
|---|---|---|
| `GET /api/config` | none | Supabase URL + anon key (public by design), notice version |
| `POST /api/diagnose` | Bearer | Per-user and site-wide daily limits, logged to `ai_calls` |
| `DELETE /api/me` | Bearer | Deletes uploads + auth user; rows cascade |
| `GET /healthz` | none | Railway health check |

## One-time setup

### 1. Supabase
1. Run `supabase/migrations/0001_init.sql` in the SQL editor.
2. **Authentication → URL configuration:** Site URL = your public URL; add `https://YOUR-DOMAIN/**` and `http://localhost:3000/**` to redirect URLs.
3. **Authentication → Emails → SMTP:** use Resend's SMTP (`smtp.resend.com`, port 465, user `resend`, password = Resend API key). The built-in sender is rate-limited and not for production.
4. **Email templates → Magic link:** include the code so phone users can type it:
   `<p>Kod log masuk anda: <b>{{ .Token }}</b></p><p><a href="{{ .ConfirmationURL }}">Atau klik untuk log masuk</a></p>`
5. Make yourself a trainer after signing in once:
   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```

### 2. Local
```bash
cp .env.example .env   # fill in values
npm install
npm run dev            # http://localhost:3000
```

### 3. Railway
New service from this repo → set the variables from `.env.example` → health check path `/healthz` → add the custom domain → set `PUBLIC_URL` and `CANONICAL_HOST` to it.

## Cost guard

Each diagnosis is one Claude call (`CLAUDE_MODEL`, default `claude-opus-5-5` at `medium` effort). `DAILY_AI_LIMIT_PER_USER` and `DAILY_AI_LIMIT_GLOBAL` cap calls per rolling 24 h. Also set a spend limit in the Anthropic console. Usage per call is in the `ai_calls` table.

## Before the first real cohort
- Privacy notice approved, placeholders filled, retention periods decided.
- Rehearse with at least 5 different cases, including image and PDF evidence, on a phone.
- Check a Day 7 email arrives (temporarily set a journey's `tracker_started_at` 8 days back).
