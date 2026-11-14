# UI theme

`app/app.vue` provides one theme through `app/composables/useAppTheme.ts` and applies it to `html[data-theme]`. Dashboard, authentication, profile, settings and employee portal switches share that state. A saved `dja-theme` preference takes priority over the device preference. Changes in another tab are applied through the storage event; without an explicit preference, device theme changes are followed. Disabled local storage does not prevent switching themes.

`assets/css/theme.css` owns the palette. Components use `var(--theme-surface, original-light-color)`, `--theme-soft`, `--theme-line`, `--theme-ink`, `--theme-muted` and `--theme-accent`. These names are defined only for dark screens, so the existing light palette and document print colors remain available. Local component tokens such as `--progress-ink` can reference these shared tokens instead of shadowing them with fixed light values. Keep dark text on deliberately bright action buttons.

Use the same tokens for modal footers, native dialogs, calendars, time pickers and searchable menus. Teleported content inherits the theme from `html`, not from the dashboard container. In scoped Vue styles, put the **entire selector** inside `:global(...)` when using it: `:global(html[data-theme='dark'] .payroll-run-progress)`. Putting only `html` inside `:global(...)` makes Vue discard the descendant selector. Ordinary `html[data-theme='dark'] .component-class` selectors also work with scoped styles.

Payslip sheets and compact DTR print bodies retain their paper palette. Billing prints an isolated invoice document. Do not apply blanket dark backgrounds or text overrides to every descendant of these documents. Uploaded scans and logos retain their original pixels.

The Compact DTR paper resets inherited theme tokens and is excluded from the dashboard's generic heading/table/modal color rules. Its text, yellow column headers, green totals and attendance colors must match between themes, on screen and in print. The surrounding toolbar may follow the selected theme. Compact DTR print visibility rules apply only while that paper is present.

The BTR editor follows the theme. `DtrBtrModal.vue` owns paired background/text tokens for sticky column headers, employee totals, footer totals and BTR/REST coverage cells. The dark BTR/REST fills must remain distinct. The theme browser check renders populated DTR and BTR fixtures under the dashboard cascade, compares DTR paper pixels and print colors between themes, and checks BTR headers, totals and the nested cell editor.

Both staff and employee portal tabs inherit the PNG favicon from the app head. Portal-specific titles override only the title text.

Browser regression check (uses mocked data, no database writes):

```powershell
$env:THEME_BROWSER_TEST='1'
# NODE_PATH must expose Playwright; THEME_BROWSER_PATH optionally selects Chromium.
node scripts/test-theme-ui.cjs
```

Existing `scripts/test-portal-mobile.cjs` covers phone layouts and full payslip PNG export. `scripts/test-billing-ui.cjs` covers invoice printing and billing workflows on desktop and mobile.
