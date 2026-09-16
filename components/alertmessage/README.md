# Shared alerts

Keep reusable alert UI and message definitions in this folder.

- `messages.ts`: typed messages and stable server error codes; no Vue or browser dependencies.
- `SystemAlert.vue`: informational, success, and error dialogs. Pass an `AlertMessage | null` with `v-model`; OK or Escape dismisses it. Native dialog keeps keyboard focus inside and displays above nested modals.
- `logoutalert.vue`: existing logout confirmation.

The DTR Add Employee flow uses this catalog on both the client and server. Existing unrelated inline validation messages remain in their screens; move their copy into this catalog when adopting shared alerts.
