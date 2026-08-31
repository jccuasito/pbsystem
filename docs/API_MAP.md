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
| GET | `/api/employees/deployments` | `employee_deployment`, `attendance_dtr`, `attendance_dtr_employee`, `employee`, `client_rate`, `payroll_rate`, `agency_position`, `agency`, `position`, `site`, `site_shift`, `shift_code`, `client` | `app/pages/employees/deployment-history/index.vue` | Session required. Returns `{ items, dtrAssignments, agencies, employees, clientRates, sites, shiftCodes }`. `dtrAssignments` is the cutoff-specific source for the site/client roster and exposes every enrolled employee's DTR `AttendanceType` (`Regular` or `Reliever`), client, site, cutoff, and DTR status. The page uses this as its site-first view; an employee search separates permanent deployments from cutoff-specific DTR attendance history. Technical deployment rows created only to satisfy a DTR attendance foreign key are excluded from the permanent timeline, so they never appear as transfers. |
| POST | `/api/employees/deployments` | `employee_deployment`, `employee`, `agency_position`, `client_rate`, `payroll_rate`, `site`, `site_shift` | `app/pages/employees/deployment-history/index.vue` | Session required. Creates a new deployment row, closes any active prior row for the employee, and returns `{ success: true, id }`. Validates that the selected client rate belongs to the employee's current agency and that the site and shift belong to the selected rate/client and site. |

## Organization

All organization CRUD routes are session-protected and accept only these whitelisted `:resource` values: `agency`, `position`, `agency-position`, `client`, `client-policy`, `site`, `site-policy`, `site-shift`, `shift-code`, and `region`.

| Method | Path | Tables used | Caller | Request / response |
| --- | --- | --- | --- | --- |
| GET/POST/PUT | `/api/organization/shift-code` | `shift_code` | `app/pages/attendance/shift-code/index.vue` | Session required. Each shift code has a persisted `WorkdayCount` (1–31; default 1, existing straight shifts migrate to 2) in addition to hours and ND settings. This is copied to each saved DTR attendance entry, so it remains a payroll-safe snapshot even if the shift code changes later. |
| POST | `/api/organization/:resource` | Target resource table | Organization add modal/API consumers | Body contains the resource's non-ID columns. `agency` and `site` may additionally send `LogoData` as a PNG/JPG/WEBP data URL (max 2 MB). Returns `{ id }`. |
| PUT | `/api/organization/:resource` | Target resource table | Organization edit modal/API consumers | Body is `{ id, ...resourceFields }`. `agency` and `site` can replace `LogoData`, or send `LogoData: null` to remove it. Returns `{ success: true }`. |
| GET | `/api/organization/logo?resource=agency|site&id=:id` | `agency` or `site` logo columns | Organization tables and future finalized DTR documents | Returns the saved logo bytes with its original image content type; session protected. |
| DELETE | `/api/organization/:resource` | Target resource table; `shift-code` checks `site_shift` references | Organization table/API consumers | Body is `{ id }`; soft-deletes with `Status = 'Inactive'`. For `shift-code`, body `{ id, permanent: true }` permanently deletes only an unused code; codes linked to a site shift are blocked and must be deactivated. Returns `{ success: true }`. |
| GET | `/api/organization/positions` | `agency_position`, `agency`, `position` | `app/pages/organization/position/index.vue` | Returns agency-position rows plus agency and position lookup arrays for filters. |
| POST | `/api/organization/positions` | `position`, `agency_position` | `app/pages/organization/position/index.vue` | Creates a new position or links an existing `PositionID` to an agency in one transaction. |
| PUT | `/api/organization/positions` | `position`, `agency_position` | `app/pages/organization/position/index.vue` | Updates a selected assignment and its position details in one transaction. |
| DELETE | `/api/organization/positions` | `agency_position` | `app/pages/organization/position/index.vue` | Soft-deactivates the selected assignment. Body: `{ agencyPositionId }`. |

Site and site-shift lists use `vw_effective_site_policy` for client/site policy resolution. `site-shift.EffectiveNDEnabled` applies its `NDPolicyOverride` only after the view's resolved client/site policy, preserving the documented precedence: site-shift override > site policy > client policy.

`database/shift-code-nd-window.sql` adds an optional Night Differential window to each shift code. The shift code form does not prefill a window; enabled codes must receive an admin-entered start and end time.

`database/shift-code-types.sql` migrates shift types from the former generic labels to the operational values `DS`, `NS`, `MS`, `SS`, and `Flexible`. Run it once before creating or editing shift codes with the new type choices.

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
| GET | `/api/attendance/dtr` | `attendance_dtr`, `agency`, `client`, `site`, `attendance` | `app/pages/attendance/daily-time-records/index.vue` | Session required. Supports agency/client/site/cutoff/search filters. Returns DTR batches, attendance-hour totals, and active agency/client/site lookups. |
| POST | `/api/attendance/dtr` | `attendance_dtr`, `client_rate`, `payroll_rate`, `agency_position`, `site` | `app/pages/attendance/daily-time-records/index.vue` | Session required. Body `{ AgencyID, ClientID, SiteID, PeriodStart, PeriodEnd }`; validates that the selected client is actively rated under the agency and the site belongs to the client, then creates a Draft batch. |
| PUT | `/api/attendance/dtr/:id` | `attendance_dtr`, `client_rate`, `payroll_rate`, `agency_position`, `site` | `app/pages/attendance/daily-time-records/index.vue` | Session required. Updates an uncomputed/unlocked batch. The same agency/site/cutoff cannot be duplicated. |
| DELETE | `/api/attendance/dtr/:id` | `attendance_dtr`, `attendance`, `attendance_dtr_employee` | `app/pages/attendance/daily-time-records/index.vue` | Session required. Deletes a Draft DTR and its DTR attendance rows; its employee enrollments cascade with the DTR. Employee master records, regular deployments, rates, and shift codes are not changed. Computed, approved, locked, or any non-Draft DTR remains protected. Returns `{ success, deleted, deletedAttendanceRows }`. |
| POST | `/api/attendance/dtr/:id/compute` | `attendance_dtr` | `app/pages/attendance/daily-time-records/index.vue` | Session required. Body `{ target: 'payroll' | 'billing' }`. Marks the DTR as computed to payroll, billing, or both; it does not yet create/finalize payroll or billing records. |
| GET | `/api/attendance/dtr/:id/summary` | `attendance_dtr`, `attendance` | `app/pages/attendance/daily-time-records/index.vue` | Session required. Returns employee count, attendance-entry count, and regular/OT/night-differential hours for the selected DTR batch. |
| GET | `/api/attendance/dtr/:id/records` | `attendance_dtr`, `attendance_dtr_employee`, `attendance`, `holiday`, `employee`, `employee_deployment`, `shift_code` | `app/components/DtrAttendanceWorkspace.vue` | Session required. Returns enrolled employee totals plus one daily attendance row per employee/date, matching active Holiday Manager dates, the DTR-specific Regular/Reliever type, each employee's saved `DefaultShiftCodeID` batch baseline, active agency shift codes, and persisted `IsWDO` / `WDODays` payroll markers. On a Draft DTR it synchronizes holiday markers and Legal/Special holiday hours first, but only for worked attendance; recurring holidays match by month/day. Days worked count only payable/time-stamped attendance; each saved row contributes its snapshotted shift-code `WorkdayCount`, so a configured 2-day straight duty contributes 2 Total Days. Saved Absent, Rest Day, Leave, and Reliever placeholders remain retrievable but do not count. Batch-default cells stay neutral; manually different DS/NS/SS cells are color-coded. |
| GET | `/api/attendance/dtr/:id/employees` | `attendance_dtr`, `employee`, `agency_position`, `position`, `payroll_rate`, `client_rate` | `app/components/DtrAttendanceWorkspace.vue` | Session required. Query `search`; lists only active employees from the DTR agency that have an active rate for the DTR client, so an incompatible employee cannot be selected. |
| POST | `/api/attendance/dtr/:id/employees` | `attendance_dtr`, `employee`, `client_rate`, `payroll_rate`, `employee_deployment`, `attendance_dtr_employee` | `app/components/DtrAttendanceWorkspace.vue` | Session required. Body `{ EmployeeID, DeploymentType: 'Regular' | 'Reliever' }`; creates/reuses a cutoff site deployment and stores the chosen type on this DTR enrollment without changing their employee master agency. |
| PUT | `/api/attendance/dtr/:id/employees` | `attendance_dtr`, `attendance_dtr_employee`, `attendance` | `app/components/DtrAttendanceWorkspace.vue` | Session required. Body `{ EmployeeID, DeploymentType }`; atomically changes this DTR employee's type and synchronizes every existing daily attendance row in the same DTR. Returns `{ success, syncedAttendanceRows }`. |
| DELETE | `/api/attendance/dtr/:id/employees` | `attendance_dtr`, `attendance_dtr_employee`, `attendance` | `app/components/DtrAttendanceWorkspace.vue` | Session required. Body `{ EmployeeID }`; removes the employee only from this editable DTR and deletes all of their attendance rows in that cutoff. Their employee profile, rates, deployment records, and other DTRs remain unchanged. Returns `{ success, deletedAttendanceRows }`. |
| POST | `/api/attendance/dtr/:id/apply-shift` | `attendance_dtr`, `attendance_dtr_employee`, `attendance`, `holiday`, `shift_code` | `app/components/DtrAttendanceWorkspace.vue` | Session required. With `OnlyEmpty: false`, atomically resets every cutoff day to the selected active agency shift: it replaces status with Present, shift/time, and all attendance hour columns; dates matching an active holiday receive a Legal/Special holiday marker and holiday hours when worked. WDO markers are then persisted: 14 qualifying worked days = 1 WDO and 15+ = 2 WDO. |
| POST | `/api/attendance/dtr/:id/records` | `attendance_dtr`, `attendance_dtr_employee`, `attendance`, `holiday`, `shift_code` | `app/components/DtrAttendanceWorkspace.vue` | Session required. With `{ ApplyBatch: true, EmployeeID, ShiftCodeID, OnlyEmpty: false }`, atomically resets every cutoff day through this stable route: it writes the selected shift/time/hours, sets the status to Present, applies the active matching Legal/Special holiday when that date is worked, and saves `ShiftCodeID` as the employee's neutral batch baseline. Returns `{ success, changed, onlyEmpty, wdoCount }`. Otherwise it upserts one employee/date cell; body includes `EmployeeID`, optional agency-owned `ShiftCodeID`, date/time, attendance status (including `Reliever`), remarks, and all attendance hour fields. `TimeIn`/`TimeOut` accept copy-pasteable `YYYY-MM-DD HH:mm` (or ISO `T`) format. For a configured overnight shift, a same-date time-out that falls before time-in is normalized to the next calendar date; all other invalid time-out values are rejected. When an enabled-ND shift is selected, the server calculates `NightDiffHours` from the actual time overlap with that shift code's ND window. The UI clears shift, timestamps, and hours for Absent, Rest Day, On-Leave, and Reliever; Reliever is intentionally blank in the matrix and does not count as a worked day/WDO. Every create or update re-computes and persists the employee's 14/15+ worked-day WDO marker for that cutoff. |
| POST | `/api/attendance/dtr/:id/records` (manual-reset action) | `attendance_dtr`, `attendance_dtr_employee`, `attendance` | `app/components/DtrAttendanceWorkspace.vue` | Session required. With `{ ResetBatch: true, EmployeeID }`, removes only that employee's attendance rows from the current editable cutoff, returning every cell to blank manual entry. The employee remains enrolled in the DTR; their profile, deployment, and attendance in other cutoffs are unchanged. Returns `{ success, deletedAttendanceRows }`. |
| GET | `/api/attendance/holidays` | `holiday` | `app/pages/attendance/holiday-manager/index.vue` | Session required. Returns `{ items }` with active and inactive holiday rows. |
| POST | `/api/attendance/holidays` | `holiday` | `app/pages/attendance/holiday-manager/index.vue` | Session required. Creates a Legal or Special holiday with date, recurring flag, and status. Rejects duplicate name/date pairs. Returns `{ id }`. |
| PUT | `/api/attendance/holidays` | `holiday` | `app/pages/attendance/holiday-manager/index.vue` | Session required. Body `{ id, HolidayName, HolidayDate, HolidayType, Recurring, Status }`. Updates a holiday after date/type validation. |
| DELETE | `/api/attendance/holidays` | `holiday` | `app/pages/attendance/holiday-manager/index.vue` | Session required. Body `{ id }`; soft-deactivates the holiday and returns `{ success: true }`. |
# Database recovery

- `database/rebuild-employee-deployment.sql` — recovery-only migration for a corrupt or missing `employee_deployment` InnoDB tablespace. It recreates the deployment schema with an optional `SiteShiftID`; it intentionally does not recreate lost deployment rows.
- `database/recover-known-deployments.sql` — one-time, idempotent recovery data that restores the two verified Jhoncharls deployments and re-links the surviving August 1–15 attendance records to DeploymentID 1.
