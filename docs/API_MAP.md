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

## Organization

All organization CRUD routes are session-protected and accept only these whitelisted `:resource` values: `agency`, `position`, `agency-position`, `client`, `client-policy`, `site`, `site-policy`, and `site-shift`.

| Method | Path | Tables used | Caller | Request / response |
| --- | --- | --- | --- | --- |
| GET | `/api/organization/:resource` | Resource table; joined tables: `agency`/`position`, `region`, `client`, `site`, `shift_code`; `vw_effective_site_policy` for site-related effective policy | `app/pages/organization/{agency,position,client,site}/index.vue` | Returns `{ items }` plus required active lookup arrays (`regions`, `clients`, `sites`, `agencies`, `positions`, or `shiftCodes`). |
| POST | `/api/organization/:resource` | Target resource table | Organization add modal/API consumers | Body contains the resource's non-ID columns. Returns `{ id }`. |
| PUT | `/api/organization/:resource` | Target resource table | Organization edit modal/API consumers | Body is `{ id, ...resourceFields }`. Returns `{ success: true }`. |
| DELETE | `/api/organization/:resource` | Target resource table | Organization table/API consumers | Body is `{ id }`; soft-deletes with `Status = 'Inactive'`. Returns `{ success: true }`. |

Site and site-shift lists use `vw_effective_site_policy` for client/site policy resolution. `site-shift.EffectiveNDEnabled` applies its `NDPolicyOverride` only after the view's resolved client/site policy, preserving the documented precedence: site-shift override > site policy > client policy.
