# DJA Assistant

A bilingual, read-only **system helper**, available from the floating DJA Assistant button across staff workspaces and in Employee Portal. It has 48 curated workflow guides across 36 page contexts, plus seven approved staff data summaries. It is not a trained language model or a general conversational AI. No provider account, API subscription, extra server model, external network service or database migration is needed. It uses the existing Nuxt/MySQL deployment, including the planned Node-capable hosting setup; it does not guarantee hosting capacity.

## Questions to try

| English | Filipino |
| --- | --- |
| How do I create an employee record? | Pano mag create ng records for employee? |
| How do I import attendance from Excel? | Paano mag-import ng attendance sa Excel? |
| How do I post payslips? | Paano mag-post ng payslips? |
| How do I prepare billing? | Paano gumawa ng billing? |
| How do I use BTR? | Paano gamitin ang BTR? |
| Hey DJA AI, can you show me how many active loans this month? | Ilan ang active loans ngayong buwan? |
| How many loans released September 2026? | Ilan ang loans released September 2026? |
| How many active employees? | Ilan ang active employees? |
| Employees hired last month | Ilan ang employees hired nakaraang buwan? |
| How many pending payroll? | Ilan ang pending payroll? |
| Total billing this month | Magkano ang total billing ngayong buwan? |
| Present today | Ilan ang present today? |
| Explain this page | Paano gamitin ito? |

Reply language defaults to automatic detection from known Filipino words; the selector can force English or Filipino. Open **Help topics → All modules**, choose a guide and click **Show steps** to browse without guessing a question. Guides render numbered steps, their source page and related topics. Common how-to wording and action synonyms are recognized; an explicit module can choose a guide from another permitted page. A pronoun follow-up such as “Pano mag edit nito?” can use the last guide topic, and changing pages clears that context. Exact topic selection is available when the resolver cannot identify the intended task.

Guides cover employee setup/edit/position/transfer, deployments, documents, daily status, portal access, agency/client/site/position/region setup, DTR creation/edit/import/print/BTR, relievers, shifts, holidays, payroll review/adjustments/history/summary, 13th-month testing, payslip review/posting, billing drafts/history, rate setup/linking, loan issuance/repayment, contributions/refundable plans, transactions/catalog, settings and backups. The Reports guide identifies the current unimplemented placeholder rather than claiming a report exists.

Database summaries remain system-wide **within the requested module's View access**, not tied to filters, selections or unsaved edits on that page. Source links use the existing navigation and access checks. A snapshot does not imply a reconciled financial report.

## Deliberate limits

- Help covers all registered staff workspaces. It describes existing controls; it never clicks, edits, posts, approves, imports, releases payments or changes records for a user. The 13th-month guide identifies the module as under development/testing.
- Data tools cover loan counts, employee counts, payroll For Approval count, recorded billing total and today's Present attendance count. No per-person payroll, documents, email, password or account credentials are returned. Guide coverage across the system does not imply that every possible database analysis is implemented.
- The portal helper is mounted only after a portal account has authenticated, with only three public portal guides. It is absent from sign-in, registration and recovery screens and unmounts on logout/session loss, clearing its conversation. It runs locally, makes no assistant API requests and cannot return staff data or staff topics. Its separate portal matcher refuses staff procedures, confidential/third-party questions and unrelated topics instead of substituting a registration guide. Explicit topic IDs and prior-topic context cannot bypass that check. It explains viewing/saving your own Posted payslips, registration/HR recovery codes and account details. It does not inspect payslip amounts, identity documents, passwords or account form contents. The portal topic picker and suggestions stay portal-only even if staff access props are supplied.
- Workflow matching recognizes curated topics and common phrasing; it is not unrestricted language reasoning. Unrecognized actions get a clearly labelled available guide or a capabilities reply. Custom data filters, balances, forecasts, uploaded-file analysis, free-form report generation, multiple questions and implicit data-query follow-ups remain unsupported. Prompts are never converted into SQL.
- Unrelated staff questions receive a formal **Scope and limitations / Saklaw at limitasyon** reply. A question word alone does not select the current page guide; current-page help must be explicit and pronoun follow-ups must describe a supported action on a prior guide. Translation, general-knowledge and unrelated requests do not receive a substituted system guide, even with a supplied topic ID. These replies read no business data and contain no workflow steps, metrics or navigation.
- “Active loans this month” is labelled as the current Active status count (including paused), not a historical month-end snapshot. Use “loans released [month year]” for releases. Past active counts are not inferred from ReleaseDate/EndDate.
- Current pending payroll/active employee status is not historical. Monthly hire/release/billing queries use explicit Manila calendar bounds. For all exact definitions and exclusions, see the API contract.
- No response cache is shared between users. Each question rechecks current staff status and module View rights and reads at most one aggregate. Existing global request admission and a 20-question/minute per-user limit apply. In-memory rate limits are not a distributed quota. Performance still depends on actual data size, database indexing and hosting resources.
- Chat is held only in component memory (up to 20 pairs), cleared with Clear chat, leaving the dashboard/portal route, or a session change. Switching staff submenu pages retains the conversation but clears the prior-guide context. Closing the panel retains the current conversation in memory. Staff and portal helpers have separate instances. No transcript is stored in the database, localStorage or an external AI service.
- Failed reads remain failures, never zero counts. UI errors use the shared request error presenter; raw SQL, server paths or stack traces are not rendered. Vue interpolation escapes all prompt/answer content.

## Verification

`node --test scripts/test-dja-assistant.cjs` checks English/Filipino commands, Manila month/year rollover, every guide's bilingual title resolution, full workspace coverage, the reported employee-create question, cross-module procedures, pronoun context, explicit guide selection, portal isolation, permissions before reads, Viewer access, body/topic validation, snapshot semantics, query parameters, unavailable vs zero and rate limits. Optional `ASSISTANT_TEST_DATABASE=1 node --env-file=.env --test scripts/test-dja-assistant.cjs` runs all seven actual aggregate SELECTs against connection-local temporary tables only, without changing persistent records.

`ASSISTANT_BROWSER_TEST=1 node --test scripts/test-dja-assistant-ui.cjs` uses Playwright (on NODE_PATH) and the real Vue component with synthetic API responses and actual workflow knowledge. Covers keyboard submit/Escape/focus, numbered answers to the reported question, related guides, follow-up context, Help topics selection, language, missing-permission suggestions, safe errors, abort/late-response protection, dark colors, mobile widths, print exclusion and local portal help with zero assistant API calls. Screenshots stay ignored under `.data/assistant-tests/`. No credentials or live financial records are used by the browser fixture. This is targeted feature verification, not an independent security audit or a guarantee of unrestricted natural-language accuracy.
