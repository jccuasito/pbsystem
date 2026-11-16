# Staff signup, verification and Admin account deletion

Updated November 16, 2026. This describes the application patch; it is not evidence of a live deployment.

## Signup and email verification

1. Submit the signup form. New staff accounts are **Active**, with the **Viewer** role. Browser-supplied role, status and email-verification fields cannot change these defaults.
2. The app creates a cryptographically random, 64-character link token, stores only its SHA-256 hash, and sends a clickable `/verify-email?token=...` link. The link expires after 15 minutes and works once.
3. The signup page changes to **Check your email** after account creation, even if email delivery failed. It clears the password fields and offers **Resend verification link** rather than submitting the same signup again.
4. Open the link, then log in. An Active account still cannot use password login until its email is verified. Admin activation is no longer required for a newly created staff account.
5. To recover after closing the page, open `/signupscreen?verification=1`, enter the account email and select **Resend verification link**. This requires no name, department or password. Invalid/expired links also offer this recovery route.

Successful resend replaces the old link. If SMTP delivery fails, the resend transaction rolls back so any previous, unexpired link remains valid. Unknown and already-verified emails receive the same generic successful response without sending a message. Public auth throttling still applies. New emails use links; the six-digit POST verification API remains compatible with codes sent before this patch until those codes expire.

Google's verified identity can create an Active Viewer through Google login. Google signup still asks the user to complete the form and follows the email-link flow. Existing Inactive accounts are never automatically reactivated by Google login or email verification. Completing a pre-existing, passwordless Google signup preserves that account's saved role/status; replaying its signup proof cannot overwrite a completed password.

## Mail configuration

For local development, configure `APP_URL`, `GMAIL_USER` and `GMAIL_APP_PASSWORD` in the local `.env`. For Namecheap, configure them in **cPanel > Setup Node.js App > pmstest > Environment variables**, then restart the app using the existing deployment procedure.

- `APP_URL`: `https://pmstest.jccuasito.top` on this live installation; use the actual local origin for development or the new domain for another installation.
- `GMAIL_USER`: the sending Gmail address, not the registering user's email.
- `GMAIL_APP_PASSWORD`: the sender's Gmail app password. Keep it private; do not put it in documentation, screenshots or Git.

Production verification mail requires an explicit `APP_URL`; it cannot silently send a localhost link. The app exposes a delivery-failure message without putting SMTP diagnostics or credentials into the signup response. A successful mocked-email test does not prove that a hosting account's SMTP credentials or network delivery work. Verify a real inbox after an authorized deployment.

## Team access and Delete user

- Admin Team access always includes saved Active and Inactive accounts. There is no **Show inactive accounts** checkbox.
- The account's **Manage** dialog offers **Delete user** for another user's account regardless of its Active/Inactive status. Type `DELETE` to confirm.
- Deletion works for **Active and Inactive accounts with or without sign-in/payroll history**. It removes the login identity and directory entry, rather than physically deleting the user row that owns historical foreign keys.
- The account keeps its original UserID, name, role and department for historical attribution. `DeletedAt` and `DeletedBy` record when/by whom it was deleted. Password, email, Google ID, verification/reset tokens are cleared; every open login-history session is closed without deleting its record. Old sessions lose access. The email and Google identity can register again under a new UserID with default Viewer access; the old history is not transferred.
- Admin deletion cannot delete the signed-in Admin through the Team access endpoint. Use **My account > Delete account** for self-delete. Both paths use the same transactional helper and preserve history. Self-delete clears the session cookie after commit, and the last active Admin must assign another Admin before leaving.
- Deleted accounts cannot be reactivated through Team access. A merely Inactive, non-deleted account stays visible and can still be explicitly reactivated through **Reactivate account**. No existing accounts are bulk-deleted.

## Required schema update before deployment

Apply `database/staff-account-deletion.sql` **before publishing this patch**. It adds nullable `DeletedAt` and `DeletedBy`, and widens/makes the existing unique Email column nullable so deletion can release it without inventing a replacement address. No account/history/payroll rows or foreign keys are removed. The migration is idempotent for the actual local MariaDB 10.4 and hosting MariaDB 11.4 installations.

For the existing Namecheap installation, open phpMyAdmin, select the current application database (`jccunkmk_pbsystem`), and run the contents of that migration in the SQL tab after reviewing it through the authorized deployment procedure. This is a targeted ALTER, not a full database import. Do not import an old dump. Do not assume a basic `SELECT 1` readiness probe checks these columns.

This conversation applied the schema update only to local development after testing it twice against a temporary table. The live migration/deployment has not been executed.

The Admin notification now says **New staff accounts**, with an aggregate count of Active accounts that have neither explicit module permissions nor sign-in history. It leads to Team access and does not change permissions. Saving access or signing in removes that account from this initial-review alert. Inactive accounts are excluded.

## Validation

Run from the appropriate repository:

```powershell
$env:STAFF_SIGNUP_TEST_DATABASE='1'
$env:NOTIFICATIONS_TEST_DATABASE='1'
node --test scripts/test-staff-signup.cjs scripts/test-notifications.cjs scripts/test-security.cjs
```

Database tests require a local configured MySQL/MariaDB connection and create only connection-local temporary tables with synthetic data. SMTP is mocked; no email is sent. Never aim these test commands at production.

Optional browser fixtures use a separately available Playwright installation through `NODE_PATH` and a Chromium path through `PORTAL_BROWSER_PATH`:

```powershell
$env:PORTAL_MOBILE_BROWSER_TEST='1'
node --test --test-name-pattern='staff signup email failure|Admin can confirm|self-delete explains|Admin registration alert' scripts/test-portal-services-ui.cjs
```

These browser tests mount the actual Vue components against synthetic API responses. They do not visit the live application or control the user's open browser.
