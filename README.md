# KBSME Business Quick Fix

Participant tool for the free 2-hour "Dah Promote. Mana Sales?" session: business profile → evidence → AI diagnosis → one Quick Fix → 7-day tracker. Plus a trainer dashboard.

Participants have **no login**: opening `/?c=CODE` with a valid session code signs them in anonymously (Supabase anonymous sign-in). Without a valid code they are asked for one, and `/api/diagnose` refuses callers without a journey in a valid session. Participants can look up a single code (`cohort_by_code`) but cannot list sessions. Trainers sign in with email on `/trainer` only, and the staff check never matches an anonymous user. `cohorts.active_until` exists for code expiry but is unused for now (NULL = never expires).

The engine follows the **v3 Business Gap AI** spec (`original/v3/KBSME_Business_Gap_AI_v3_Developer_Spec.md`): pathways `cost` (Cash Flow / Profit), `content` (Marketing), `live` (Sales) and the `missing` fallback. Deterministic rules live in `public/js/rules.mjs` and are shared by the browser and the server: cost and LIVE maths, the evidence check, the LIVE guard (never `live` without LIVE experience and real LIVE evidence) and RM198 programme fit. Programme fit is decided by these rules only, never by the model; for RM30K+ participants it shows a neutral line, and no class duration is shown anywhere.

**Departure from spec §4 (agreed):** the 7-day tracker tasks are written by the model in the same call as the diagnosis (`tasks`: 7 × `{title, proof}`, naming the participant's own product, costs, questions or LIVE numbers). The server validates them (`normalizeTasks`: exactly 7, none empty, long text shortened at a word boundary) and falls back to the v3 prototype templates (`TASK_TEMPLATES`) when they are unusable, when AI is off, when the LIVE guard changes the pathway, or when the participant picks a different pathway. Participants can edit each task and its proof in the tracker.

- **App:** Node 20+ / Express (`server/`) serving static pages (`public/`)
- **Data & login:** Supabase (Postgres + RLS, anonymous sign-in for participants, email magic link / 6-digit code for trainers, private storage bucket)
- **AI:** Claude via the Anthropic API (`server/diagnose.mjs`)
- **Email:** Resend (trainer login emails via Supabase SMTP; Day 7 reminders only reach participants who have an email, so none for anonymous participants)
- **Hosting:** Railway

`original/` holds the v2 prototype package this was built from.

## Pages

| Path | Who | What |
|---|---|---|
| `/?c=CODE` | Participants | The five-step tool. Without a valid code it asks for one. `?step=5` opens the tracker. |
| `/trainer` | Trainers / admins | Cohorts, participant progress, detail view, CSV export |
| `/privacy` | Everyone | Privacy notice (**draft — fill the `[ ]` placeholders and get it approved**) |

## API

| Endpoint | Auth | Notes |
|---|---|---|
| `GET /api/config` | none | Supabase URL + anon key (public by design), notice version |
| `POST /api/diagnose` | Bearer | Needs a journey in a valid session; per-user and site-wide daily limits, logged to `ai_calls` |
| `DELETE /api/me` | Bearer | Deletes uploads + auth user; rows cascade |
| `GET /healthz` | none | Railway health check |

## One-time setup

### 1. Supabase
1. Apply `supabase/migrations/` in order (`npx supabase db push`, or paste each file into the SQL editor).
2. **Authentication → Sign In / Providers:** turn on **Allow anonymous sign-ins** (participants). Keep email on (trainers).
3. **Authentication → URL configuration:** Site URL = your public URL; add `https://klinik.richworks.com/**` and `http://localhost:3000/**` to redirect URLs.
4. **Authentication → Emails → SMTP:** use Resend's SMTP (`smtp.resend.com`, port 465, user `resend`, password = Resend API key). The built-in sender is rate-limited and not for production.
5. **Email templates → Magic link:** include the code so phone users can type it:
   `<p>Kod log masuk anda: <b>{{ .Token }}</b></p><p><a href="{{ .ConfirmationURL }}">Atau klik untuk log masuk</a></p>`
6. Trainer accounts are created by an admin (trainer login never creates accounts):
   ```bash
   node --env-file=.env scripts/add-trainer.mjs you@example.com admin
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

Each diagnosis is one Claude call (`CLAUDE_MODEL`, default `claude-sonnet-5-5` at `medium` effort; Sonnet would otherwise default to `high`). `DAILY_AI_LIMIT_PER_USER` and `DAILY_AI_LIMIT_GLOBAL` cap calls per rolling 24 h. Also set a spend limit in the Anthropic console. Usage per call is in the `ai_calls` table.

## Tests

```bash
npm test                                         # deterministic rules (no network)
node --env-file=.env test/acceptance.mjs         # spec §7 T01–T12 against the real AI backend (~11 Claude calls; dev server must be running)
node --env-file=.env test/acceptance.mjs T05 T08 # a subset
```

The acceptance runner creates a throwaway session code and `@example.com` participants through the admin API (no email sent), and deletes them afterwards. `node --env-file=.env test/rls.mjs` checks the access rules (code lookup, no session listing, journeys and uploads only inside a session, anonymous users never staff).

## Before the first real cohort
- Privacy notice approved, placeholders filled, retention periods decided.
- Rehearse with at least 5 different cases, including image and PDF evidence, on a phone.
- Check a Day 7 email arrives (temporarily set a journey's `tracker_started_at` 8 days back).
