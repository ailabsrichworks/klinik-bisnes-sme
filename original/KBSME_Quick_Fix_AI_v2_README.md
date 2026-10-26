# KBSME Business Quick Fix AI — Prototype v2

**Audience:** Active Malaysian business owners below RM30,000/month, FREE 2-hour Funnel A pilot. Working product concept, not a management-approved or deployed service.

## Files

- `KBSME_Quick_Fix_AI_v2_Prototype.html` — single-file, mobile-friendly participant application. Double-click it to explore five screens; no installation or API key required.
- `kbsme_ai_server.py` — optional local-development API that connects the same application to OpenAI Responses API if an API key is provided **server-side**. Requires `fastapi`, `uvicorn`, `requests`, `pypdf`. Never enter API keys into HTML or participant devices.

## Participant journey

1. **Bisnes Anda** — business context and chosen concern.
2. **Bukti Sebenar** — paste text, attach screenshot/PDF/TXT/CSV, or enter unit costs.
3. **Diagnosis Awal** — evidence observations, unknowns and suggested priority; participant confirms/corrects.
4. **Quick Fix** — one editable output, three quality checks.
5. **Tracker 7 Hari** — seven action statuses, evidence notes, simple Day 7 results, participant report and save/print.

## Demo and live AI behavior

- Opening the `.html` file directly runs an **explicitly labelled rule-based demo**, not an LLM. It can use typed/pasted text or numbers to present sample diagnosis paths; **it cannot visually read uploaded images or PDFs**.
- Screenshot and PDF analysis requires the optional backend; text PDFs are extracted from the first five pages, but scanned-image PDFs without selectable text are not OCR'd. Send only data the participant is permitted to share.
- Even in live AI mode, any output is **preliminary**, must be reviewed by the participant, and must not promise sales uplift.
- Missing direct-cost inputs remain **unknown**, not RM0. Provisional balance is not net profit.
- In demo, progress is saved in the **same browser's localStorage**. Export JSON or Print/Save PDF for a copy. File bytes are not persisted to localStorage; refresh requires reattaching the file.
- There is **no participant authentication, central database, Day 7 messaging automation, trainer dashboard, or consent collection backend** in this prototype. The consent UI records only in the participant's browser.

## Optional live AI local setup

```bash
python -m pip install fastapi uvicorn requests pypdf
export OPENAI_API_KEY='your-server-side-key'
export OPENAI_MODEL='gpt-4.1-mini'    # replace with a supported model available to your API account
uvicorn kbsme_ai_server:app --host 127.0.0.1 --port 8000
```

Then open `http://127.0.0.1:8000/`. When `/api/status` reports an API key, the screen label becomes **AI LIVE**. Uploaded evidence is only sent by clicking **Jana Diagnosis** after the participant confirms the privacy notice. The example backend does not persist inputs and asks the API to avoid storing the response, but provider processing and retention policies still apply; verify the privacy requirements before real use.

**Do not deploy this demonstration backend directly to the public Internet.** Add account/session authentication, CSRF/origin controls, per-user data isolation, rate-limiting and cost controls, server-side consent/evidence policies, upload security review, encrypted persistent tracker storage, deletion/export rights, KPI instrumentation, incident handling, and an approved privacy notice before a production pilot.

## Two-hour suggested facilitator checkpoints

| Minute | Facilitator checkpoint | Participant output |
|---|---|---|
| 0–18 | Explain single pain / evidence, privacy and three bottlenecks | One concern |
| 18–30 | Guide business profile | Step 1 complete |
| 30–50 | Input evidence, run early diagnosis | Step 2 + initial finding |
| 50–60 | Participant validates one priority | Step 3 complete |
| 60–95 | Guided Build; facilitator checks examples | One Quick Fix |
| 95–105 | Self-review and quality pass | Usable output |
| 105–115 | Generate tracker and select first implementation action | 7-day plan |
| 115–120 | Export report, feedback and optional relevant clinic next step | Saved output |

Designed to be facilitated by **one speaker and one essential support staff**. Test with at least five diverse cases and rehearse image upload, PDF failure paths, smartphone usability, offline fallback and participant privacy before the first group.

## Pilot measurement specification (proposal, not actual performance)

Measure: evidence input success, diagnosis acceptance/correction, completed Quick Fix with passing quality checklist, Day 7 response rate, evidence-backed actual implementation, and relevant attributed RM198 purchase. Preserve denominators and consent. Funnel A is the free session; the RM198 clinics remain deeper, separate guided outputs. Activate broader delivery only after the review gate.
