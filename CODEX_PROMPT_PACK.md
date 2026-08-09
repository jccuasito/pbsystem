# Codex Prompt Pack — DJA Payroll & Billing System

## Paano gamitin ito
1. I-save mo itong file sa root ng project mo bilang `CODEX_PROMPT_PACK.md` (o `docs/CODEX_PROMPT_PACK.md`).
2. Sa **bawat bagong Codex session**, i-refer/paste mo lang yung **MASTER CONTEXT** section (isang beses lang, hindi na paulit-ulit ang buong explanation) tapos yung specific **PHASE prompt** na gagawin mo.
3. Isang phase = isang session. Huwag pagsabayin. Kapag tapos na yung backend ng isang module, saka mo lang ikonekta yung frontend page nito — huwag lahat ng module i-wire sa isang tawag.
4. Habang tumatakbo, palaging papasukin mo sa dulo ng prompt: *"Update `docs/API_MAP.md` with the new endpoints, tables touched, and frontend files wired."* — ito yung mapping/routing na hihingin mo. Sa ganitong paraan, may laging updated na "peta" ka ng system kahit hindi mo na babasahin ulit lahat ng code.
5. Bago mag-code, laging sabihin: *"Scan lang ang mga related files/folders na kailangan mo, huwag i-load lahat ng repo."* — pinipigilan nito na mag-ubos ng malaking context/credits sa pag-scan ng buong project every time.

---

## MASTER CONTEXT (i-paste ito una sa bawat bagong session)

```
Project: DJA Group of Companies — Payroll & Billing System
Stack: Nuxt 3 (Vue 3, <script setup lang="ts">), Nitro server routes (/server/api),
       MySQL (schema: pbsystem, script sa /database/auth-migration.sql or /database/*.sql)
Auth: KUMPLETO NA — huwag na ito ipagawa muli. Existing files:
  - server/connection/dbconnect.ts — shared mysql2 pool (import this everywhere, never make a
    new pool)
  - server/utils/auth.ts — hashPassword, passwordMatches, assertPassword, setSession,
    clearSession, requireSession(event) [PALAGING GAMITIN ITO para sa auth guard sa bagong
    endpoints], safeUser, normalizeEmail, hashToken/randomToken/randomVerificationCode
  - server/utils/jwt.ts — signToken/verifyToken (named exports, HINDI default export)
  - server/utils/googleAuth.ts — verifyGoogleToken, verifyGoogleAuthorizationCode (named
    exports, HINDI default export)
  - server/utils/mailer.ts — sendVerificationEmail, sendPasswordResetEmail (Gmail SMTP)
  - server/api/auth/: login.post.ts, register.post.ts, logout.post.ts, me.get.ts,
    forgot-password.post.ts, reset-password.post.ts, verify-email.get.ts, verify-email.post.ts,
    verify-reset-token.get.ts, resend-verification.post.ts, update-profile.post.ts,
    upload-avatar.post.ts, departments.get.ts, google-code.post.ts (ito ang TAMANG Google flow)
  - KNOWN ISSUE: server/api/auth/google.post.ts ay SIRA/duplicate — mali ang imports (gumagamit
    ng default import sa named exports), gumagamit ng pool na hindi na-import, at nagse-set ng
    ibang cookie name (`auth_token`) kaysa sa totoong session system (`pbs_session` via
    setSession()). I-DELETE o i-deprecate ito, huwag gamitin, huwag ayusin — ang
    google-code.post.ts na lang ang gagamitin para sa Google login/signup.
  - Session pattern na dapat sundin sa LAHAT ng bagong protected endpoint:
    `const session = requireSession(event)` sa taas, tapos gamitin ang `session.sub` bilang
    UserID. Huwag gagawa ng bagong auth check pattern.

app/middleware/auth.global.ts, app/pages/loginscreen, app/pages/signupscreen,
app/pages/forgotpass — existing frontend, huwag na rin galawin maliban kung sinabi ko.

Rules:
- Sundin ang existing DB schema EXACTLY (table/column names, ENUMs, FKs) — huwag gagawa ng
  bagong column/table maliban kung sasabihin ko.
- Gamitin ang existing na components/pages kung meron na (hal. app/pages/dashboard/index.vue,
  components/alertmessage/logoutalert.vue, components/AppButton.vue) — i-extend, huwag i-rewrite
  from scratch maliban kung sinabi kong palitan.
- Server routes: /server/api/<module>/<resource>.<method>.ts (Nitro convention), gumamit ng
  parameterized queries (mysql2), never raw string concatenation ng SQL.
- Lahat ng bagong endpoint dapat naka-guard ng existing auth middleware/session check.
- Frontend: palitan lang yung mock/hardcoded arrays (may TODO comments na) ng totoong $fetch
  papunta sa bagong endpoint — ingatan yung existing markup/CSS classes, huwag baguhin ang
  disenyo maliban kung kailangan para sa bagong data shape.
- Bawat bagong route/endpoint, isulat sa docs/API_MAP.md: {method, path, tables used,
  which .vue file/component calls it, request/response shape}.
- Wag mo munang galawin ang mga module na wala sa saklaw ng phase na ito.
```

---

## Roadmap (7 Phases — sunod-sunod, isa-isa)

| Phase | Module | Core Tables | Frontend na ico-connect |
|---|---|---|---|
| 1 | Auth check + Dashboard shell | `user`, `department`, `user_history` | `dashboard/index.vue` (currentUser, stats cards) |
| 2 | Organization | `agency`, `agency_position`, `position`, `client`, `client_policy`, `site`, `site_policy`, `site_shift`, `region`, `shift_code` | `organization/agency`, `position`, `client`, `site` |
| 3 | Rates | `payroll_rate`, `billing_rate`, `client_rate` | `rates/payroll`, `rates/billing` |
| 4 | Employee & Deployment | `employee`, `employee_profile`, `government`, `education`, `license`, `training`, `clearance`, `bank`, `insurance`, `employee_deployment`, `employee_agency_history` | `employees` (list), `employees/deployment-history`, `employees/documents` |
| 5 | Attendance & Holiday | `attendance`, `holiday`, view `vw_effective_site_policy`, `sp_dtr_summary` | `attendance` page |
| 6 | Payroll, Deductions, Loans, 13th Month | `payroll`, `payroll_detail`, `payroll_deduction`, `deduction_type`, `employee_deduction`, `loan_type`, `employee_loan`, `thirteenth_month_pay`, `sp_compute_13th_month` | `payroll/processing`, `payroll/payslip`, `payroll/history`, `deductions-loans/*` |
| 7 | Billing & Reports | `billing`, `billing_detail` | `billing/generate`, `billing/history`, `reports` |

---

## PHASE 1 — Dashboard stats endpoints (Backend + wire)

```
Context: Master context above applies. Focus lang dito sa Phase 1.

Ang buong Auth module ay KUMPLETO NA (see Master Context) — huwag mo na siyang galawin,
i-reuse lang. Dalawang bagay lang ang gagawin dito:

0. I-delete ang server/api/auth/google.post.ts — sirang duplicate ito (mali ang imports,
   hindi tugma sa session system). Ang google-code.post.ts na ang gagamitin. Kumpirmahin mo
   muna sa akin bago mo i-delete kung may reference pa ba dito sa frontend (grep for
   "/api/auth/google" sa buong app/ folder, hindi "/api/auth/google-code").
1. Gumawa ng /server/api/dashboard/stats.get.ts na nagre-return ng totoong values (hindi mock).
   Gamitin ang `const session = requireSession(event)` pattern mula sa server/utils/auth.ts
   para protected ito, tulad ng ginawa sa me.get.ts:
   - Total Employees: COUNT(*) FROM employee WHERE Status='Active'
   - Present Today: COUNT DISTINCT attendance WHERE AttendanceDate=CURDATE() AND
     AttendanceStatus='Present'
   - Pending Payroll: COUNT FROM payroll WHERE Status='For Approval'
   - This Month's Billing: SUM(TotalAmount) FROM billing WHERE MONTH(BillingDate)=MONTH(CURDATE())
   - Active Deployments: COUNT FROM employee_deployment WHERE EndDate IS NULL OR EndDate >= CURDATE()
   - Active Loans: COUNT FROM employee_loan WHERE Status='Active'
   Match the exact shape na inaasahan ng `stats` ref sa dashboard/index.vue (label, value,
   trend, trendType, icon) — huwag baguhin ang icon keys, gamitin lang yung existing set
   ('user','clock','peso','file-text','building').
2. Gumawa ng /server/api/dashboard/recent-payroll.get.ts (LIMIT 5, latest payroll runs,
   JOIN employee para sa pangalan) at /server/api/dashboard/recent-activity.get.ts
   (pwedeng simpleng union ng latest payroll/attendance/billing changes, o gumawa ng minimal
   activity_log table kung wala pa — sabihin mo muna sa akin bago gawin kung kailangan ng
   bagong table).
3. I-wire ang dashboard/index.vue: palitan yung TODO comments, i-fetch itong mga endpoint sa
   onMounted (parallel sa existing /api/auth/me call na huwag mo nang galawin), i-save pa rin
   sa cache gamit ang existing saveCache() function nila para gumana pa rin ang offline mode.
4. I-update ang docs/API_MAP.md — isama rin ang existing auth endpoints dito (buod lang,
   isang linya bawat isa) para kumpleto ang map mula umpisa.

Huwag mo munang galawin ang ibang modules (Organization, Employee, etc.) — Phase 2+ na yun.
```

---

## PHASE 2 — Organization (Agency, Client, Site, Rates setup)

```
Context: Master context applies. Focus lang dito sa Agency/Client/Site/Position CRUD.

1. Gumawa ng Nitro CRUD endpoints (list, create, update, soft-delete via Status='Inactive')
   para sa: agency, agency_position (join position), client (join region), client_policy,
   site (join client), site_policy, site_shift (join shift_code).
2. Sundin ang policy resolution order na nakadocument sa SQL comments (site_shift override >
   site_policy > client_policy) — gamitin ang existing view na `vw_effective_site_policy`
   kung saan applicable, huwag gumawa ng duplicate logic.
3. Gumawa/i-complete ang pages: app/pages/organization/agency, position, client, site —
   table view + add/edit modal (gamitin ang existing modal pattern sa components/modals kung
   meron na, kung wala, gawa ng simpleng reusable modal component).
4. I-update ang docs/API_MAP.md.

Wag mo pang galawin ang employee/deployment/attendance/payroll — Phase 3+ pa yun.
```

---

## PHASE 3 — Rates (Payroll Rate, Billing Rate, Client Rate)

```
Context: Master context applies.

1. CRUD endpoints para sa payroll_rate, billing_rate (parehong may AgencyPositionID +
   RegionID), at client_rate (nag-link ng ClientID sa isang PayrollRateID + BillingRateID pair).
2. Sa client_rate creation form, dapat dropdown ang AgencyPosition (agency + position combo)
   at makikita ang existing payroll_rate/billing_rate para dun sa AgencyPositionID, o pwede
   silang gumawa ng bago inline.
3. I-wire ang app/pages/rates/payroll at rates/billing.
4. I-update ang docs/API_MAP.md.
```

---

## PHASE 4 — Employee & Deployment (pinaka-malaki, hatiin pa kung kailangan)

```
Context: Master context applies. Ito yung pinaka-core ng system — Employee List at
Deployment History mockups ko ay nasa app/pages/employees at
app/pages/employees/deployment-history (may static rows pa, palitan ng totoong data).

1. CRUD para sa employee (basic info) + employee_profile, government, education, license,
   training, clearance, bank, insurance bilang related tabs/sections sa isang Employee
   Documents/Profile page (app/pages/employees/documents).
2. Employee List endpoint: dapat may filter by Position, Agency (tulad ng UI mockup ko —
   dropdown "All Positions" / "All Agencies"), at may kasamang current Deployment status
   at Site mula sa pinaka-latest na employee_deployment row (WHERE EndDate IS NULL OR
   EndDate >= CURDATE(), ORDER BY StartDate DESC LIMIT 1).
3. Employee Deployment endpoints: list (may columns na Deployment ID, Employee No, Name,
   Agency, Position, Client, Site, Shift, Type, Start Date, End Date, Status — tugma sa
   mockup ko), at create-new-deployment-row logic (BAGONG row bawat lipat ng site, huwag
   i-overwrite ang luma — sundin yung comment sa SQL schema tungkol dito).
4. Trigger na `trg_employee_agency_change` ay existing na sa DB — huwag gagawa ng duplicate
   logic sa app layer para dun, backend lang ang mag-uupdate ng AgencyPositionID at ang DB
   mismo ang bahalang mag-log sa employee_agency_history.
5. I-wire ang employees/index.vue at employees/deployment-history/index.vue gamit ang totoong
   fetch, panatilihin ang existing table layout/columns.
6. I-update ang docs/API_MAP.md.
```

---

## PHASE 5 — Attendance & Holiday

```
Context: Master context applies.

1. CRUD para sa holiday (Holiday Manager — Legal/Special, recurring flag).
2. Attendance endpoints: get-by-employee-and-date-range (gagamitin ng DTR view/report),
   upsert-single-day (may IsManualEdit flag na ise-set to 1 kapag na-edit manually),
   at isang endpoint na tumatawag sa existing stored procedure `sp_dtr_summary(start, end)`
   para sa summary totals.
3. Ang auto-computation (Regular/OT/ND/Late/Undertime) base sa shift_code + effective policy
   (vw_effective_site_policy + site_shift.NDPolicyOverride) ay dapat gawin sa isang hiwalay
   na utility function (server/utils/attendanceCompute.ts) na maaaring i-override kapag
   IsManualEdit — huwag ilagay ang computation logic diretso sa route handler.
4. I-wire ang app/pages/attendance.
5. I-update ang docs/API_MAP.md.
```

---

## PHASE 6 — Payroll, Deductions, Loans, 13th Month

```
Context: Master context applies.

1. Payroll processing endpoint: kukunin ang attendance rows sa loob ng StartDate-EndDate ng
   isang deployment, i-multiply sa applicable payroll_rate (via ClientRateID chain), gagawa ng
   payroll + payroll_detail rows (isa-isang line item: Basic Pay, OT, ND, Holiday, atbp.).
2. Deduction endpoints: employee_deduction CRUD, at payroll_deduction na naka-link sa
   deduction_type (ReferenceType/ReferenceID pattern para ma-trace kung saan galing —
   loan ba o government deduction).
3. Loan endpoints: employee_loan CRUD, auto-decrement ng RemainingBalance kapag na-deduct
   na sa isang payroll run (i-wrap sa transaction).
4. 13th month: endpoint na tumatawag sa existing `sp_compute_13th_month(year)` procedure.
5. I-wire ang payroll/processing, payroll/payslip, payroll/history, at deductions-loans/*.
6. I-update ang docs/API_MAP.md.
```

---

## PHASE 7 — Billing & Reports

```
Context: Master context applies.

1. Billing generation endpoint: base sa mga Approved/Released payroll ng isang client sa loob
   ng isang period, gamitin ang billing_rate (via ClientRateID) para bumuo ng billing +
   billing_detail rows (isang row per employee per site — tandaan, SiteID snapshot sa
   billing_detail para hindi apektado kapag nagbago ng deployment).
2. I-wire ang billing/generate, billing/history.
3. Reports page: simpleng exportable view (DTR summary via sp_dtr_summary, payroll summary,
   billing summary) — pwedeng CSV/PDF export gamit ang existing skill kung available.
4. I-update ang docs/API_MAP.md — dapat kumpleto na ito sa puntong ito, buod ng buong system.
```

---

## docs/API_MAP.md — template (ipagawa mo ito kay Codex, hindi kailangang gawin mo manually)

```markdown
# API Map — DJA Payroll & Billing System

## <Module Name>
| Method | Path | Tables Used | Called From (.vue) | Notes |
|---|---|---|---|---|
| GET | /api/dashboard/stats | employee, attendance, payroll, billing, employee_deployment, employee_loan | app/pages/dashboard/index.vue | replaces mock `stats` ref |
```

---

## Extra tips para tipid sa Codex budget
- Huwag mo na ulit i-paste yung buong SQL schema sa bawat prompt — nasa repo mo na yun
  (`/database/*.sql`), sabihin mo lang "refer to /database/auth-migration.sql for schema."
- Sabihin mo palagi: **"Only touch files related to this phase."** Kung mag-suggest si Codex
  na i-refactor ang ibang module, sabihin mong "note it in API_MAP.md as a TODO, don't do it now."
- Kung may error, huwag agad "fix everything" — sabihin: "show me just the failing endpoint's
  code and the error, don't re-generate the whole module."
- I-commit/i-save muna bago mag-Phase 2+, para may fallback ka kung kailangan mo bumalik.
