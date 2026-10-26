# KBSME Business Gap AI — Developer Scope & Acceptance Criteria (v3.0)

**Status:** PROPOSED technical design for management/product review — not yet approved for public deployment.

**Source priority:** Latest uploaded `DETAIL-3-PROGRAM-5JAM.pdf` (26 October 2026) defines the detailed *content and learning gaps* of three paid programmes. The existing KBSME Single Source of Truth v3 and latest confirmed management decisions control the operational baseline wherever not expressly superseded. The uploaded 26 October PDF calls these "5 jam"; existing approved class format is 4.5 hours incl. break, with an additional 30-minute pre-class readiness/registration buffer. This duration conflict requires management decision; no duration should be advertised by the AI pending that decision.

## 1. Business aim and guardrails

The planned **FREE two-hour Funnel A** helps a Malaysian business owner with an active business below RM30K monthly revenue:

`Participant inputs → one evidence-supported business gap → one small Quick Win → seven-day test → suitable next step, optionally RM198 clinic`

It must NOT operate as a compressed paid clinic and must NOT automatically sell to everyone. Sales, Marketing and Cash Flow / Profit are the three KBSME pillars; Missing Information is a fallback state, not a fourth pillar. Funnel A format/launch is a current design priority still subject to management approval.

A qualified prospective RM198 buyer must have an active business, be the owner or decision maker, fall within the below-RM30K revenue scope, have an evidenced matching pain, and show relevance/readiness. LIVE-specific fit additionally requires actual LIVE selling experience. The demo matches only reported data; it does not independently verify eligibility or payment intent.

## 2. Modules: hard scope boundaries

| Module ID | Problem to identify | Evidence required / preferred | FREE Quick Win output | Paid-programme boundary | Routing condition |
|---|---|---|---|---|---|
| `cost` (Cash Flow / Profit) | Missing cost components, uncertainty about one product's economics and fees | One product selling price; known cost amounts and unknown cost categories; seller statement/resit if available | **Cost Gap Snapshot:** show only known-input provisional balance if calculable, flag every unknown category, select ONE cost to verify against an actual source | **Kira Cost Guna AI: Lepas Ni, Kira Harga Sendiri!** builds complete cost list, identifies missing costs with AI, minimum/target prices, three pricing scenarios and written pricing decision | Evidence of price/cost uncertainty and owner fit |
| `content` (Marketing) | No repeatable content routine; high content workload; lack of planning or performance review | Posts in past 7 days, hours spent weekly, whether calendar exists, whether content data reviewed; sample post optional | **Content System Snapshot:** one relevant customer question selected for ONE small content experiment and observation | **Content Sebulan Settle! — Guna ChatGPT** builds reusable prompt, 30 ideas refined to 10, 3 completed posts, month-long schedule and review approach | Evidence of content-system gap; no promise of reach/enquiries |
| `live` (Sales) | Existing LIVE sessions have unclear structure/claim-to-paid leakage or invoice record gap | *Required:* participant has already LIVE-sold. Preferred: LIVE date/platform, unique viewers, claims, paid orders from same cohort/time cutoff and invoice timing | **LIVE Sales Leakage Snapshot:** check ONE prior LIVE's claim/paid/timestamp evidence and choose ONE follow-up data or process check | **Live Laris: Dari Viewers ke Buyers** builds LIVE rundown, item codes, scripts, claim/invoice workflow and repeatable performance tracking | `liveExperience = yes`, matching issue and general buyer fit |
| `missing` (fallback) | Evidence lacking, contradictory or unfit; cannot diagnose responsibly | What fact is missing, expected source | One fact-finding task, owner, source and deadline | None until adequately matched | No automatic programme referral |

**Critical negative route:** A normal WhatsApp enquiry that stops after the seller replies is **not** evidence of LIVE selling and must never be auto-routed to `Live Laris`.

## 3. Participant input fields (V3 prototype)

**Business context:** `business`, `product`, `customer` (optional), `channel`, `revenue`, `participant` (optional), `businessActive`, `ownerAuthority`, `pain`.

**Evidence:** pasted text; optionally one redacted image (PNG, JPG, WEBP), TXT, CSV or PDF (4MB max). Participant must confirm they can use the material and removed directly identifying customer information. Offline demo cannot visually inspect images or PDF; optional local backend can inspect images or text PDFs where supported. Scanned PDFs without extracted text need alternative input.

**Cost:** `sellingPrice`, `materialCost`, `packagingCost`, `deliveryCost`, `platformCost`, `promotionCost`, `otherCost`. Empty = unknown, explicit 0 = reported zero (must be verified if material). All amounts should refer to one consistent unit. Always label result *provisional balance from known costs*, never "net profit".

**Content:** `postsWeek`, `hoursWeek`, `hasContentPlan`, `tracksContent`. The demo reports only the supplied values. It must not diagnose algorithm performance from a caption alone.

**LIVE:** `liveExperience`, `liveViewers`, `liveClaims`, `livePaid`, `invoiceTiming`. Claims and paid orders need the same session, cohort and observation cutoff. Valid unpaid rate = `(claims − paid) / claims × 100` when `claims > 0` and `0 ≤ paid ≤ claims`. Otherwise show *not calculable / check source*.

## 4. Response schema contract

The optional AI backend returns the following JSON, **not** a full business report:

```json
{
  "pathway": "cost|content|live|missing",
  "title": "One priority issue",
  "reason": "Short preliminary assessment; no unsupported causal claim",
  "observations": ["Only directly supported data"],
  "unknowns": ["Missing or unverified facts"],
  "strength": "Bukti terhad|Ada input peserta, perlu pengesahan",
  "quickFix": "ONE small action or fact-finding step, participant-editable"
}
```

The **UI**, not the LLM, controls programme recommendations using eligibility/fit rules. The frontend generates pathway-specific, editable seven-day checklists (task, status `belum/sedang/selesai`, participant evidence note). Participant verifies diagnosis and checks output quality before proceeding.

## 5. Routing rules, in order

1. Validate that there is relevant business evidence (not just the selected programme label).
2. If evidence missing/contradictory, choose `missing` and one fact-finding action.
3. If choosing `live`, require `liveExperience=yes` and actual LIVE evidence. Non-LIVE sellers receive no `Live Laris` referral.
4. Review potential paid customer fit: active business, owner authority, monthly revenue below RM30K. Where missing, mark qualification pending; where expressly ineligible (e.g. RM30K+ or inactive), withhold automatic RM198 recommendation.
5. Match the programme to the diagnosed gap. If participant changes pathway after diagnosis, require relevant evidence and a new diagnosis before class routing.
6. Show the programme as **conditional, optional**. Collect course interest and marketing consent separately. No automatic marketing action/CRM sync in offline demo.

Do **not** hard-code unsupported real-time platform fees, claimed causal benchmarks, the 30:50:20 content formula definition (unconfirmed in uploaded research), or the paid programme class duration pending reconciliation. Market data cited in the programme document needs source verification before use in the AI.

## 6. Quick Win rubrics for review

| Module | Pass condition | Fail condition |
|---|---|---|
| `cost` | Names one product and a source for one missing cost; marks other unknowns and provisional figures honestly | Reports full profit, asserts price floor / new price, invents a fee or treats blanks as 0 |
| `content` | States one customer question to test, one post action, and what data to observe | Produces a 30-day calendar / claims a platform algorithm is the proven problem |
| `live` | Valid LIVE experience; one cohort-specific claim-paid/timestamp check; one next step | Recommends Live Laris without LIVE experience, invents an invoice-causality explanation or builds full LIVE SOP |
| `missing` | Gives one fact, source, owner and date to find it | Guesses a root cause or automatically recommends RM198 |

Across all modules: no customer PII in output, no guaranteed uplift, editable output and participant approval required, track real Day 7 application separately from simple report completion.

## 7. Acceptance-test matrix (recommended)

| ID | Test input | Expected result / safety assertion |
|---|---|---|
| T01 | Seller: price RM25, supplier cost RM12, platform fee unknown | `cost`; Cost Gap Snapshot; RM13 provisional *only from known costs*; platform fee unknown; Kira Cost potential match |
| T02 | Price RM25, material RM10, packaging RM2, other costs missing | `cost`; RM13 provisional; **NOT net profit**; unknown fees not zero |
| T03 | 1 post/week, 6 hours/week, no calendar, does not read results | `content`; content-system diagnostic; one small post test; no 30-day calendar |
| T04 | 5 posts/week, calendar exists, tracks results, but low sales | `content` only with sufficient evidence; no blanket claim that content cadence caused sales problem; may request missing info |
| T05 | Experienced LIVE seller, claims=12, paid=8, same cohort | `live`; 4 unpaid (33.3%); no assertion that invoice delay caused the difference |
| T06 | Not an existing LIVE seller, asks how to start LIVE | `missing`; no Live Laris paid-class recommendation |
| T07 | Seller only has redacted WhatsApp conversation, no LIVE history | `missing` or another relevant diagnostic with more evidence; **never LIVE from WhatsApp alone** |
| T08 | Claims=8, paid=12 | `missing`; invalid denominator, no fabricated negative drop rate |
| T09 | Only screenshot uploaded, offline demo | Explicitly notes offline image/PDF not analysed; missing facts rather than claim to have read it |
| T10 | No evidence, only selects "cost" | Block diagnosis until evidence, or fact-finding if credible narrative |
| T11 | Relevant content problem, owner reports revenue RM30K+ | Content diagnosis may be useful, but no automatic RM198 KBSME sell; route to appropriate alternative |
| T12 | Active below-RM30K, owner, matches content, opted out of marketing | No automated outreach; if the participant chooses self-action, continue tracker without sales pressure |

## 8. Pilot operating and measurement

Use one speaker plus one essential support staff; a guided self-service workflow. Proposed two-hour sequence: introduction and boundaries 0–18 min; profile 18–30; evidence + diagnosis 30–60; Quick Win 60–95; quality review 95–105; tracker 105–115; report and voluntary next step 115–120. Actual run-of-show requires rehearsal and project sign-off.

KPI: eligible/attending denominator, evidence-submission rate, diagnosis acceptance/correction rate, Quick Win rubric pass, seven-day **evidence-backed** use and Day 7 response, qualified programme interest, verified source-attributed RM198 paid seats, delivery exceptions, actual cost and acquisition contribution. Track opt-out and non-response; do not equate interest with purchase or tracker ticking with implementation.

## 9. Production blockers

The HTML demo stores text in one browser's localStorage; no login, central data, follow-up scheduling, CRM, immutable evidence records or staff dashboard. The included Python backend is an optional **local development example**, and a live provider connection has not been exercised against production credentials. It should not be deployed publicly without authentication, access control, security controls for uploads and prompt injection, user permission/consent framework, data retention/deletion policy, rate limits, monitoring, cost controls, signed privacy notice and DPIA/PDPA review as applicable.

**Management decisions still open:** confirm/free-session format and spend, paid-class 4.5h vs 5h, content 30:50:20 official definition, paid-class deliverable passing rubrics, CRM/source of truth, platform fee verification policy, funnel qualification thresholds, and data-governance owner.
