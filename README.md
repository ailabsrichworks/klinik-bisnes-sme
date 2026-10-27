# KBSME Business Quick Fix

Participant tool for Klinik Bisnes SME sessions (v4): the participant tells us about their business, picks one of three challenges (**Sales (LIVE Sales)**, **Marketing**, **Urus Duit**), ticks the **3** situations out of 10 that happen most often, can optionally share an example, and gets a one-page report: diagnosis, likely cause, impact, a calculator, a Quick Fix workshop, a 7-day action plan and a reflection, downloadable as a PDF.

**No AI.** Every word of the report is fixed text per challenge, taken word for word from the v4 prototype (`original/v4/Business_Quick_Fix_Prototype.html`) into `public/js/content.mjs`, which the browser, the server (PDF, Sheet rows) and the tests share. The calculators use the prototype's fields, defaults and formulas (`calculate()`); `test/content.test.mjs` checks the text and the numbers against the prototype file. The earlier AI versions are in git history.

The tool is **public, with no login**. Saving the intake form (with the consent tick) starts a journey: the server returns a random id + secret token that the browser keeps in `localStorage` and sends with every call (`X-Journey-Id` / `X-Journey-Token`; only a hash of the token is stored). A facilitator's link `/?c=CODE` files the participant under that session; the code is optional, and an unknown or expired code offers to continue without one.

**Data lives in Google:** one Google Sheet (one row per participant, readable by the team; the Sheet *is* the trainer view) and a Drive folder for optional evidence files and report PDFs. The server reaches them through a small **Apps Script pasted into the Sheet** (`apps-script/Code.gs`, simplest: no Google Cloud project), or through the Google APIs with a service account. The browser only ever talks to our server; the script's secret stays server-side.

- **App:** Node 20+ / Express (`server/`) serving static pages (`public/`)
- **Data:** Google Sheets + Google Drive (`server/store.mjs`), via the Apps Script web app (`server/apps-script.mjs`) or a service account
- **Report PDF:** pdfkit (`server/report-pdf.mjs`), Inter + Bricolage Grotesque from `server/fonts` (OFL)
- **Hosting:** Railway, **one instance** (the server keeps the participant index in memory)

## The flow

1. **Langkah 01 · Maklumat bisnes:** full name, business name, industry, business model, years running, monthly sales, consent. "Simpan maklumat & mula" creates the participant's row.
2. **Pilih cabaran:** three pillar buttons (a side panel on desktop, buttons above the content on phones) with the profile summary and "Edit maklumat". For the chosen pillar, 10 situations; exactly 3 can be ticked (the rest lock at 3), with a counter and progress bar. "Lihat diagnosis saya" is enabled only at 3. Each pillar keeps its own answers, so switching back loses nothing.
3. **Bukti (pilihan):** paste an example and/or attach one file (PNG/JPG/WEBP/PDF/TXT/CSV, 4 MB). Stored for trainers; **not analysed**, and the screen says so.
4. **Laporan:** 01 Simptom (the 3 ticks), 02 Punca, 03 Impak, 04 calculator, 05 Quick Fix workshop (with "Lihat contoh"), 06 the 7-day plan (prefilled with the pillar's defaults), 07 Reflection. "Cetak / Simpan laporan (PDF)" downloads the PDF.

## Pages

| Path | What |
|---|---|
| `/` or `/?c=CODE` | The tool, open to anyone. `?c=` files the participant under a session. `?demo` shows sample-data buttons (always on localhost). |
| `/privacy` | Privacy notice (**draft — fill the `[ ]` placeholders and get it approved**) |

## The Google Sheet

Created by the app on first start (header rows are bold, frozen and protected with a warning):

| Tab | Who writes | What |
|---|---|---|
| **Peserta** | the app | One row per participant: session code, created/updated, step reached (`1 · Maklumat bisnes` … `4 · Laporan`), full name, business, industry, business model, years running, monthly sales, pillar, `situation_1`–`3`, evidence text + file + Drive link, calculator inputs and result, workshop output, the 4 plan fields, report link/time, when the PDF was downloaded, consent time and notice version. The report columns fill in once the participant reaches the report. `token_hash` and `state_json` are hidden; don't edit them. |
| **Sesi** | trainers, by hand | Session codes: `code`, `name`, `session_date`, `active_until` (blank = never expires). Re-read every minute. The link to share is `https://<your domain>/?c=CODE`. |
| **README** | the app | Column notes for the team. |

**Upgrading a Sheet used by the earlier AI version:** its Peserta tab is left exactly as it is, and v4 rows go to a new **Peserta v4** tab (the server logs this at start). To use the name Peserta again, rename or delete the old tab and restart. The old **Log AI** tab is no longer used.

**To sort or filter Peserta, use a Filter view** (Data → Filter views), not Data → Sort. The app finds each row by its id before writing, so sorting doesn't break anything, but filter views keep the sheet tidy for everyone.

Writes are batched: the server keeps journeys in memory and writes changed rows every 5 seconds (one read + up to two writes per batch), retrying on Google's quota errors (429) with backoff. That stays within the Sheets limit of 60 requests a minute even with a full class. Participant text is written as plain text, never as formulas (the Apps Script checks this at every start). The browser saves on each step, 20 seconds after typing stops, and when the page is hidden or closed; it also keeps a copy locally.

**Report PDFs:** when a participant reaches the report, the server builds it as a PDF and saves it in the Drive folder, linked in `report_link`. It waits 15 seconds after the last change, keeps one file per participant, and replaces it only when the report changes (calculator, workshop, plan). The participant downloads the same report with "Cetak / Simpan laporan (PDF)" (`GET /api/report.pdf`, which also records `report_downloaded_at`).

"Padam data saya" (delete my data) clears the participant's row and deletes their Drive files (evidence and report).

## API

All participant endpoints need `X-Journey-Id` and `X-Journey-Token`, except where marked.

| Endpoint | Notes |
|---|---|
| `GET /api/config` | no key · the privacy notice version |
| `GET /api/session/:code` | no key · checks a session code |
| `POST /api/journey` | no key · `{ acceptNotice, code? }` → `{ id, token, … }` |
| `GET /api/journey` | the participant's saved state, consent and evidence file name |
| `PUT /api/journey` | `{ state, step }` (step reached: 0–3) |
| `POST /api/consent` | `{ acceptNotice }` when the notice version changed |
| `POST /api/upload` | optional evidence: raw file body, `X-File-Name` header; PNG/JPG/WEBP/PDF/TXT/CSV checked by content, max 4 MB; stored in Drive |
| `DELETE /api/upload` | removes the evidence file |
| `GET /api/report.pdf` | the report as a PDF (needs 3 ticked situations) |
| `DELETE /api/me` | clears the row and deletes the Drive files |
| `GET /healthz` | Railway health check |

## One-time setup

### 1. Google: the Apps Script (about 5 minutes, recommended)

Do this signed in to the Google account that should own the data (your richworks.com account).

1. **Create the Sheet.** A blank Google Sheet, e.g. "KBSME Quick Fix". Share it with your team as you like.
2. **Paste the script.** In the Sheet: *Extensions → Apps Script*. Delete what's there and paste the whole of `apps-script/Code.local.gs` (same as `Code.gs`, with your secret already filled in; it is not committed). If you start from `Code.gs`, set `SECRET` to the value of `APPS_SCRIPT_SECRET` in `.env`. Click **Save**.
3. **Deploy it.** *Deploy → New deployment* → gear icon → **Web app**. Description: `KBSME`. **Execute as: Me**. **Who has access: Anyone**. Click **Deploy**.
4. **Allow access.** Google asks you to authorise the script (it needs your Sheets and Drive). If it shows "Google hasn't verified this app", click *Advanced → Go to … (unsafe)*: it's your own script.
5. **Copy the Web app URL** (ends in `/exec`) into `APPS_SCRIPT_URL` in `.env` (and on Railway). Opening that URL in a browser should show `{"ok":true,"app":"kbsme-quick-fix","secretSet":true}`.
6. **Start the server.** On first start it creates the tabs; the first upload creates a Drive folder "KBSME Bukti peserta" in your Drive.

Notes:
- "Anyone" means anyone with the URL can call the script, but it refuses every request without the secret. Keep the secret private; to change it, update both `Code.gs` and `APPS_SCRIPT_SECRET`.
- If "Anyone" isn't offered, your Workspace admin restricts web apps; ask them to allow it, or use option B.
- After editing the script: *Deploy → Manage deployments → ✏️ → Version: New version → Deploy* (the URL stays the same).
- "Padam data saya" moves the participant's file to the Drive bin; Google deletes it for good after 30 days.
- Apps Script adds about a second per call and allows about 30 calls at once; the server batches writes, so a full class is fine.

### 1B. Google: service account (alternative, about 15 minutes)

Faster per call, but needs a Google Cloud project.

1. **Google Cloud project.** At [console.cloud.google.com](https://console.cloud.google.com) create a project (e.g. `kbsme-quick-fix`). Under *APIs & Services → Library*, enable **Google Sheets API** and **Google Drive API**.
2. **Service account.** *IAM & Admin → Service Accounts → Create service account*, name it `kbsme-app`, no roles needed. Open it → *Keys → Add key → Create new key → JSON*. A `.json` file downloads. **Keep it secret**; never commit it. Note the service account's email (`kbsme-app@<project>.iam.gserviceaccount.com`).
   - If your Workspace blocks key creation (policy `iam.disableServiceAccountKeyCreation`), a Workspace admin has to allow it for this project.
3. **The Sheet.** Create a blank Google Sheet (e.g. "KBSME Quick Fix"). *Share* it with the service account's email as **Editor**. Copy the Sheet ID from its URL: `docs.google.com/spreadsheets/d/`**`<SHEET_ID>`**`/edit`. Share it with your team as you like; the app creates the tabs on first start.
4. **The evidence folder, in a Shared Drive.** Service accounts have no Drive storage of their own, so uploads to a normal *My Drive* folder fail. In Google Drive: *Shared drives → New* (e.g. "KBSME"), then *Manage members* → add the service account's email as **Content manager**. Create a folder inside (e.g. "Bukti peserta") and copy its ID from the URL: `drive.google.com/drive/folders/`**`<DRIVE_FOLDER_ID>`**.
5. **Environment variables** (`.env` locally, Railway variables in production):
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: the key file's contents. Either paste the JSON on one line, or base64 it: `base64 -i key.json | tr -d '\n'`.
   - `SHEET_ID`, `DRIVE_FOLDER_ID`: from steps 3 and 4.

Without either option configured the app still runs, on an **in-memory sheet** (handy for trying it out; everything is lost on restart). If the Sheet can't be opened at start-up, the server exits with a message saying what to check.

### 2. Local

```bash
cp .env.example .env   # fill in values
npm install
npm run dev            # http://localhost:3000
```

### 3. Railway

New service from this repo → set the variables from `.env.example` → health check path `/healthz` → **one replica** → add the custom domain → set `PUBLIC_URL` and `CANONICAL_HOST` to it. On redeploy, Railway's SIGTERM makes the server write any pending changes before it exits.

## Tests

```bash
npm test   # the content against the prototype, the store, the API, and Code.gs itself, against in-process stand-ins for Google (no network)
```

To check against your real Sheet, point the server at it (`APPS_SCRIPT_URL` / `APPS_SCRIPT_SECRET`) and go through the flow with `?demo`; "Padam data saya" clears the test row and files again.

## Before the first real cohort
- Privacy notice approved, placeholders filled, retention periods decided.
- Rehearse all three challenges on a phone, including image and PDF evidence and the PDF download.
- Check rows and files appear in the real Sheet and Drive folder, and that "Padam data saya" removes them.
