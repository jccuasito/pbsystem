<script setup lang="ts">
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  dark: { type: Boolean, default: false }
})
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; confirm: [] }>()

function cancel() { if (!props.busy) emit('update:modelValue', false) }
function confirm() { emit('confirm') }
</script>

<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="page logout-alert"
      :data-theme="dark ? 'dark' : 'light'"
      role="dialog"
      aria-modal="true"
      aria-labelledby="logout-alert-title"
      @click.self="cancel"
    >
      <section class="logout-alert__card">
        <div class="logout-alert__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
        </div>
        <h2 id="logout-alert-title">Log out?</h2>
        <p class="logout-alert__copy">You'll need to sign in again to access your dashboard.</p>
        <div class="logout-alert__actions">
          <button type="button" class="logout-alert__cancel" :disabled="busy" @click="cancel">Cancel</button>
          <button type="button" class="logout-alert__confirm" :disabled="busy" @click="confirm">{{ busy ? 'Logging out…' : 'Log out' }}</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.logout-alert {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: grid;
  place-items: center;
  padding: 20px;
  min-height: 0;
  overflow: visible;
  background: rgba(10, 16, 32, 0.62);
}

.logout-alert__card {
  width: min(100%, 380px);
  box-sizing: border-box;
  padding: 34px 32px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--surface);
  color: var(--ink);
  box-shadow: 0 20px 45px rgba(15, 23, 42, 0.22);
  text-align: center;
  font-family: 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif;
}

.logout-alert__icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  margin: 0 auto 16px;
  border-radius: 14px;
  background: color-mix(in srgb, #d9483b 14%, var(--soft));
  color: #d9483b;
}
.logout-alert__icon svg { width: 24px; height: 24px; }

.logout-alert h2 { margin: 0; font-size: 1.3rem; font-weight: 800; letter-spacing: -0.03em; color: var(--ink); }
.logout-alert__copy { margin: 8px 0 26px; color: var(--muted); font-size: 0.88rem; line-height: 1.55; }

.logout-alert__actions { display: flex; gap: 10px; }
.logout-alert__cancel,
.logout-alert__confirm {
  flex: 1;
  min-height: 46px;
  border-radius: 9px;
  font-weight: 700;
  font-size: 0.88rem;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.15s ease, filter 0.15s ease, border-color 0.15s ease;
}
.logout-alert__cancel { background: var(--surface); color: var(--ink); border-color: var(--line); }
.logout-alert__cancel:hover { background: var(--soft); }
.logout-alert__confirm { background: #d9483b; color: #fff; }
.logout-alert__confirm:hover { filter: brightness(1.08); }
.logout-alert__cancel:disabled, .logout-alert__confirm:disabled { opacity: .6; cursor: not-allowed; }

@media (max-width: 420px) {
  .logout-alert__card { padding: 28px 22px; }
}
</style>