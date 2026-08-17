# API Map

## Auth

| Method | Path | Tables used | Caller | Summary |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/login` | `user`, `user_history` | `app/pages/loginscreen/index.vue` | Email/password sign-in; sets `pbs_session`. |
| POST | `/api/auth/register` | `user`, `department` | `app/pages/signupscreen/index.vue` | Creates a local user and sends verification. |
| POST | `/api/auth/logout` | `user_history` | Authenticated pages | Clears `pbs_session`. |
| GET | `/api/auth/me` | `user`, `department` | `app/pages/dashboard/index.vue` | Returns the current session user. |
| POST | `/api/auth/forgot-password` | `user` | `app/pages/forgotpass` | Sends a password-reset link. |
| POST | `/api/auth/reset-password` | `user` | Password-reset page | Validates token and changes password. |
| GET | `/api/auth/verify-email` | `user` | Email link | Verifies an email token. |
| POST | `/api/auth/verify-email` | `user` | Verification UI | Verifies a submitted email code. |
| GET | `/api/auth/verify-reset-token` | `user` | Password-reset page | Checks reset-token validity. |
| POST | `/api/auth/resend-verification` | `user` | Signup/verification UI | Resends an email verification code. |
| POST | `/api/auth/update-profile` | `user` | Profile UI | Updates the signed-in user's profile. |
| POST | `/api/auth/upload-avatar` | `user` | Profile UI | Uploads the signed-in user's avatar. |
| GET | `/api/auth/departments` | `department` | Signup/profile UI | Lists active departments. |
| POST | `/api/auth/google-code` | `user`, `user_history` | Login/signup pages | Google authorization-code flow; sets `pbs_session`. |
| POST | `/api/auth/google` | — | None | Deprecated broken legacy endpoint; do not use, pending approved deletion. |

## Dashboard

| Method | Path | Tables used | Caller | Request / response |
| --- | --- | --- | --- | --- |
| GET | `/api/dashboard/stats` | `employee`, `attendance`, `payroll`, `billing`, `employee_deployment`, `employee_loan` | `app/pages/dashboard/index.vue` | Session required. `{ stats: Array<{ label, value: number, trend, trendType, icon }> }`; null/invalid aggregates return `0`. |
| GET | `/api/dashboard/recent-payroll` | `payroll`, `employee` | `app/pages/dashboard/index.vue` | Session required. `{ payroll: Array<{ id, name, period, amount, status }> }` (latest 5). |
| GET | `/api/dashboard/recent-activity` | `payroll`, `attendance`, `billing` | `app/pages/dashboard/index.vue` | Session required. `{ activities: Array<{ text, time }> }` (latest 5). |

## Employees

| Method | Path | Tables used | Caller | Request / response |
| --- | --- | --- | --- | --- |
| GET | `/api/employees` | `employee`, `agency_position`, `agency`, `position`, latest active `employee_deployment`, `client_rate`, `client`, `site`, `site_shift`, `shift_code` | `app/pages/employees/index.vue` | Session required. Supports `agencyId` and `positionId` filters. Rows expose integer `EmployeeID` as the primary identifier; `EmployeeNumber` is nullable optional badge/reference data. |
| POST | `/api/employees` | `employee` | `app/pages/employees/index.vue` | Session required. Creates basic info and returns `{ id }` (the new EmployeeID). `EmployeeNumber` is optional; a blank value is stored as `NULL`. |
| PUT | `/api/employees/:id` | `employee` | `app/pages/employees/index.vue` | Session required. Updates basic info, including an optional EmployeeNumber. Returns `{ success: true }`. |
| DELETE | `/api/employees/:id` | `employee` | `app/pages/employees/index.vue` | Session required. Soft-deletes by setting `Status = 'Inactive'`. Returns `{ success: true }`. |
| POST | `/api/employees/:id/transfer` | `employee`, `employee_deployment`, `client_rate`, `payroll_rate`, `site`, optional `site_shift`; validates `attendance` and `payroll` | `app/pages/employees/index.vue` | Session required. Body `{ ClientRateID, SiteID, SiteShiftID?, StartDate, Remarks }`. Closes the active deployment, creates a new deployment, and updates the employee’s current agency-position in one transaction. `SiteShiftID` may be blank; DTR hours must then be handled manually until a shift is linked. Historical payroll and attendance remain linked to the prior `DeploymentID`. |
| POST | `/api/employees/site-shifts` | `client_rate`, `payroll_rate`, `agency_position`, `site`, `shift_code`, `site_shift` | `app/pages/employees/index.vue` | Session required. Body selects an existing agency shift code or provides `newShift`; links it to the selected transfer site and returns `{ id, shiftCodeId }`. |
| GET | `/api/employees/documents` | `employee`, `agency_position`, `agency`, `position`, `employee_profile`, `government`, `education`, `license`, `training`, `clearance`, `bank`, `insurance` | `app/pages/employees/documents/index.vue` | Session required. Query `employeeId`. Returns `{ employee, employees, agencies, positions, profile, government, education, license, training, clearance, bank, insurance }`; `employees` includes integer `EmployeeID` plus agency/position metadata for search and filters. |
| POST | `/api/employees/documents` | `employee_profile`, `government`, `education`, `license`, `training`, `clearance`, `bank`, `insurance` | `app/pages/employees/documents/index.vue` | Session required. Body includes `section`, `employeeId`, and section fields. Creates a related row or upserts the one-to-one profile row. Returns `{ success: true, id }`. |
| PUT | `/api/employees/documents` | `employee_profile`, `government`, `education`, `license`, `training`, `clearance`, `bank`, `insurance` | `app/pages/employees/documents/index.vue` | Session required. Body includes `section`, `employeeId`, `id`, and section fields. Updates the selected row. Returns `{ success: true }`. |
| DELETE | `/api/employees/documents` | `employee_profile`, `government`, `education`, `license`, `training`, `clearance`, `bank`, `insurance` | `app/pages/employees/documents/index.vue` | Session required. Body includes `section`, `employeeId`, and `id`. Deletes the selected related row. Returns `{ success: true }`. |
| GET | `/api/employees/deployments` | `employee_deployment`, `employee`, `client_rate`, `payroll_rate`, `agency_position`, `agency`, `position`, `site`, `site_shift`, `shift_code`, `client` | `app/pages/employees/deployment-history/index.vue` | Session required. Returns `{ items, employees, clientRates, sites, shiftCodes }`; employee selectors use integer `EmployeeID`, displayed as formatted `EMP-0001`, while `EmployeeNumber` remains optional. Shift lookups expose `SiteShiftID` and `SiteID`. |
| POST | `/api/employees/deployments` | `employee_deployment` | `app/pages/employees/deployment-history/index.vue` | Session required. Creates a new deployment row, closes any active prior row for the employee, and returns `{ success: true, id }`. |

## Organization

All organization CRUD routes are session-protected and accept only these whitelisted `:resource` values: `agency`, `position`, `agency-position`, `client`, `client-policy`, `site`, `site-policy`, and `site-shift`.

| Method | Path | Tables used | Caller | Request / response |
| --- | --- | --- | --- | --- |
| GET | `/api/organization/:resource` | Resource table; joined tables: `agency`/`position`, `region`, `client`, `site`, `shift_code`; `vw_effective_site_policy` for site-related effective policy | `app/pages/organization/{agency,position,client,site}/index.vue` | Returns `{ items }` plus required active lookup arrays (`regions`, `clients`, `sites`, `agencies`, `positions`, or `shiftCodes`). |
| POST | `/api/organization/:resource` | Target resource table | Organization add modal/API consumers | Body contains the resource's non-ID columns. Returns `{ id }`. |
| PUT | `/api/organization/:resource` | Target resource table | Organization edit modal/API consumers | Body is `{ id, ...resourceFields }`. Returns `{ success: true }`. |
| DELETE | `/api/organization/:resource` | Target resource table | Organization table/API consumers | Body is `{ id }`; soft-deletes with `Status = 'Inactive'`. Returns `{ success: true }`. |
| GET | `/api/organization/positions` | `agency_position`, `agency`, `position` | `app/pages/organization/position/index.vue` | Returns agency-position rows plus agency and position lookup arrays for filters. |
| POST | `/api/organization/positions` | `position`, `agency_position` | `app/pages/organization/position/index.vue` | Creates a new position or links an existing `PositionID` to an agency in one transaction. |
| PUT | `/api/organization/positions` | `position`, `agency_position` | `app/pages/organization/position/index.vue` | Updates a selected assignment and its position details in one transaction. |
| DELETE | `/api/organization/positions` | `agency_position` | `app/pages/organization/position/index.vue` | Soft-deactivates the selected assignment. Body: `{ agencyPositionId }`. |

Site and site-shift lists use `vw_effective_site_policy` for client/site policy resolution. `site-shift.EffectiveNDEnabled` applies its `NDPolicyOverride` only after the view's resolved client/site policy, preserving the documented precedence: site-shift override > site policy > client policy.

## Rates

All rate routes are session-protected. `:resource` is whitelisted to `payroll-rate`, `billing-rate`, or `client-rate`.

| Method | Path | Tables used | Caller | Request / response |
| --- | --- | --- | --- | --- |
| GET | `/api/rates/:resource` | `payroll_rate` or `billing_rate` with `agency_position`, `agency`, `position`, `region`; `client_rate` also joins `client` | `app/pages/rates/{payroll,billing,client}/index.vue` | Returns `{ items }` and lookup arrays. Client-rate includes agency-position-filterable payroll/billing rates. |
| POST | `/api/rates/:resource` | Target rate table; client rate can also create `payroll_rate` and/or `billing_rate` in one transaction | Rate add/link forms | Rate body contains `AgencyPositionID`, optional `RegionID`, monetary fields, effective date, and status. Client-rate body links `ClientID`, matching rate IDs, or `inlinePayrollRate` / `inlineBillingRate`. Returns `{ id }`. |
| PUT | `/api/rates/:resource` | Target rate table | Rate edit forms | Body is `{ id, ...fields }`; client-rate validates its payroll/billing pair belongs to the selected agency position. Returns `{ success: true }`. |
| DELETE | `/api/rates/:resource` | Target rate table | Rate tables | Body `{ id }`; soft-deletes through `Status = 'Inactive'`. Returns `{ success: true }`. |

## Attendance

| Method | Path | Tables used | Caller | Request / response |
| --- | --- | --- | --- | --- |
| GET | `/api/attendance/dtr-lookups` | `agency`, `agency_position`, `payroll_rate`, `client_rate`, `client` | `app/pages/attendance/daily-time-records/index.vue` | Session required. Optional `agencyId` filters clients to active client-rate links under that agency. Returns `{ agencies, clients }`. |
# Database recovery

- `database/rebuild-employee-deployment.sql` — recovery-only migration for a corrupt or missing `employee_deployment` InnoDB tablespace. It recreates the deployment schema with an optional `SiteShiftID`; it intentionally does not recreate lost deployment rows.
- `database/recover-known-deployments.sql` — one-time, idempotent recovery data that restores the two verified Jhoncharls deployments and re-links the surviving August 1–15 attendance records to DeploymentID 1.
