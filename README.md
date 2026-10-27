# KBSME Business Quick Fix

Participant tool for the free 2-hour "Dah Promote. Mana Sales?" session: business profile → evidence → AI diagnosis → one Quick Fix → 7-day tracker.

The tool is **public, with no login**. Accepting the privacy notice starts a journey: the server returns a random id + secret token that the browser keeps in `localStorage` and sends with every call (`X-Journey-Id` / `X-Journey-Token`; only a hash of the token is stored). A facilitator's link `/?c=CODE` files the participant under that session; the code is optional, and an unknown or expired code offers to continue without one.

**Data lives in Google:** one Google Sheet (one row per participant, readable by the team; the Sheet *is* the trainer view) and a Shared Drive folder for uploaded evidence. The browser only ever talks to our server; the Google key and the Claude key stay server-side.

The engine follows the **v3 Business Gap AI** spec (`original/v3/KBSME_Business_Gap_AI_v3_Developer_Spec.md`): pathways `cost` (Cash Flow / Profit), `content` (Marketing), `live` (Sales) and the `missing` fallback. Deterministic rules live in `public/js/rules.mjs` and are shared by the browser and the server: cost and LIVE maths, the evidence check, the LIVE guard (never `live` without LIVE experience and real LIVE evidence) and RM198 programme fit. Programme fit is decided by these rules only, never by the model; for RM30K+ participants it shows a neutral line, and no class duration is shown anywhere.

**Departure from spec §4 (agreed):** the 7-day tracker tasks are written by the model in the same call as the diagnosis (`tasks`: 7 × `{title, proof}`, naming the participant's own product, costs, questions or LIVE numbers). The server validates them (`normalizeTasks`: exactly 7, none empty, long text shortened at a word boundary) and falls back to the v3 prototype templates (`TASK_TEMPLATES`) when they are unusable, when AI is off, when the LIVE guard changes the pathway, or when the participant picks a different pathway. Participants can edit each task and its proof in the tracker.

- **App:** Node 20+ / Express (`server/`) serving static pages (`public/`)
- **Data:** Google Sheets + Google Drive (Shared Drive) through a service account (`server/store.mjs`)
- **AI:** Claude via the Anthropic API (`server/diagnose.mjs`)
- **Hosting:** Railway, **one instance** (the server keeps the participant index in memory)

`original/` holds the v2 prototype package this was built from.

## Pages

| Path | What |
|---|---|
| `/` or `/?c=CODE` | The five-step tool, open to anyone. `?c=` files the participant under a session. `?step=5` opens the tracker. `?demo` shows sample-data buttons (always on localhost). |
| `/privacy` | Privacy notice (**draft — fill the `[ ]` placeholders and get it approved**) |

## The Google Sheet

Created by the app on first start (header rows are bold, frozen and protected with a warning):

| Tab | Who writes | What |
|---|---|---|
| **Peserta** | the app | One row per participant: session code, dates, step, business fields, issue, evidence text, Drive link to the uploaded file, cost/content/LIVE inputs, provisional balance, diagnosis, pathway, Quick Fix, the 7 tasks with status, tasks done, Day 7 metrics, next step, programme fit, marketing and privacy consent. `token_hash` and `state_json` are hidden; don't edit them. |
| **Sesi** | trainers, by hand | Session codes: `code`, `name`, `session_date`, `active_until` (blank = never expires). Re-read every minute. The link to share is `https://klinik.richworks.com/?c=CODE`. |
| **Log AI** | the app | One row per AI call: time, journey id, model, status, input/output tokens. Used for the optional daily caps. |
| **README** | the app | Column notes for the team. |

**To sort or filter Peserta, use a Filter view** (Data → Filter views), not Data → Sort. The app finds each row by its id before writing, so sorting doesn't break anything, but filter views keep the sheet tidy for everyone.

Writes are batched: the server keeps journeys in memory and writes changed rows every 5 seconds (one read + up to three writes per batch), retrying on Google's quota errors (429) with backoff. That stays within the Sheets limit of 60 requests a minute even with a full class. Participant text is written as plain text (`RAW`), never as formulas. The browser saves on each step change, after the diagnosis, on tracker status changes, 20 seconds after typing stops, and when the page is hidden or closed; it also keeps a copy locally.

"Padam data saya" (delete my data) clears the participant's row and deletes their Drive file.

## API

All participant endpoints need `X-Journey-Id` and `X-Journey-Token`, except where marked.

| Endpoint | Notes |
|---|---|
| `GET /api/config` | no key · notice version, whether AI is on |
| `GET /api/session/:code` | no key · checks a session code |
| `POST /api/journey` | no key · `{ acceptNotice, code? }` → `{ id, token, … }` |
| `GET /api/journey` | the participant's saved state, consent and file name |
| `PUT /api/journey` | `{ state, step }` |
| `POST /api/consent` | `{ kind: privacy \| marketing \| ai_processing, granted }` |
| `POST /api/upload` | raw file body, `X-File-Name` header; PNG/JPG/WEBP/PDF/TXT/CSV checked by content, max 4 MB; stored in Drive |
| `POST /api/diagnose` | diagnosis inputs + `use_file`; per-IP burst limit, optional daily caps, logged to Log AI |
| `DELETE /api/me` | clears the row and deletes the Drive file |
| `GET /healthz` | Railway health check |

## One-time setup

### 1. Google (about 15 minutes, signed in with your richworks.com Workspace account)

1. **Google Cloud project.** At [console.cloud.google.com](https://console.cloud.google.com) create a project (e.g. `kbsme-quick-fix`). Under *APIs & Services → Library*, enable **Google Sheets API** and **Google Drive API**.
2. **Service account.** *IAM & Admin → Service Accounts → Create service account*, name it `kbsme-app`, no roles needed. Open it → *Keys → Add key → Create new key → JSON*. A `.json` file downloads. **Keep it secret**; never commit it. Note the service account's email (`kbsme-app@<project>.iam.gserviceaccount.com`).
   - If your Workspace blocks key creation (policy `iam.disableServiceAccountKeyCreation`), a Workspace admin has to allow it for this project.
3. **The Sheet.** Create a blank Google Sheet (e.g. "KBSME Quick Fix"). *Share* it with the service account's email as **Editor**. Copy the Sheet ID from its URL: `docs.google.com/spreadsheets/d/`**`<SHEET_ID>`**`/edit`. Share it with your team as you like; the app creates the tabs on first start.
4. **The evidence folder, in a Shared Drive.** Service accounts have no Drive storage of their own, so uploads to a normal *My Drive* folder fail. In Google Drive: *Shared drives → New* (e.g. "KBSME"), then *Manage members* → add the service account's email as **Content manager**. Create a folder inside (e.g. "Bukti peserta") and copy its ID from the URL: `drive.google.com/drive/folders/`**`<DRIVE_FOLDER_ID>`**.
5. **Environment variables** (`.env` locally, Railway variables in production):
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: the key file's contents. Either paste the JSON on one line, or base64 it: `base64 -i key.json | tr -d '\n'`.
   - `SHEET_ID`, `DRIVE_FOLDER_ID`: from steps 3 and 4.

Without these three values the app still runs, on an **in-memory sheet** (handy for trying it out; everything is lost on restart). If the Sheet can't be opened at start-up, the server exits with a message saying what to check.

### 2. Local

```bash
cp .env.example .env   # fill in values
npm install
npm run dev            # http://localhost:3000
```

### 3. Railway

New service from this repo → set the variables from `.env.example` → health check path `/healthz` → **one replica** → add the custom domain → set `PUBLIC_URL` and `CANONICAL_HOST` to it. On redeploy, Railway's SIGTERM makes the server write any pending changes before it exits.

## Cost guard

Each diagnosis is one Claude call (`CLAUDE_MODEL`, default `claude-sonnet-5-5` at `medium` effort; Sonnet would otherwise default to `high`), about US$0.02. The site is public and the daily caps are **off by default**; set `DAILY_AI_LIMIT_PER_USER`, `DAILY_AI_LIMIT_PER_IP` and/or `DAILY_AI_LIMIT_GLOBAL` to cap calls per rolling 24 hours (the per-IP count is kept in memory only). The per-IP burst limiter always applies, sized so a whole class on one venue Wi-Fi isn't blocked. **Set a spend limit in the Anthropic console**: with no caps it is the only cost guard. Usage per call is in the Log AI tab.

## Tests

```bash
npm test                                         # rules, the Sheets/Drive store and the API, against an in-process fake Google (no network)
node --env-file=.env test/acceptance.mjs         # spec §7 T01–T12 against the real AI (~11 Claude calls; server must be running)
node --env-file=.env test/acceptance.mjs T05 T08 # a subset
node --env-file=.env test/stress.mjs             # 10 diagnoses at once: time per report; cost too when Google is configured
```

The acceptance and stress runners start journeys through the API like a participant and delete them afterwards with "Delete my data". Point the server at a real Sheet to check the full path; the rows they create are cleared again.

`test/fixtures/sample-responses.json` has example `/api/diagnose` responses per pathway and the error messages, for UI work without AI calls.

## Before the first real cohort
- Privacy notice approved, placeholders filled, retention periods decided.
- Rehearse with at least 5 different cases, including image and PDF evidence, on a phone.
- Check rows and files appear in the real Sheet and Shared Drive, and that "Padam data saya" removes them.
