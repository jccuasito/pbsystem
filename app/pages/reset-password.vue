<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'

const isDark = ref(false)
const route = useRoute(); const password = ref(''); const confirm = ref(''); const message = ref(''); const error = ref(''); const busy = ref(false)
const checkingToken = ref(true); const tokenValid = ref(false)
const showPassword = ref(false); const showConfirmPassword = ref(false)

async function reset() { error.value = ''; if (password.value !== confirm.value) { error.value = 'Passwords do not match.'; return }; busy.value = true; try { message.value = (await $fetch<any>('/api/auth/reset-password', { method: 'POST', body: { token: route.query.token, password: password.value } })).message } catch (e: any) { error.value = e.data?.statusMessage || 'Unable to reset password.' } finally { busy.value = false } }

onMounted(async () => {
  const savedTheme = localStorage.getItem('dja-theme')
  isDark.value = savedTheme ? savedTheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches

  const token = route.query.token
  if (typeof token === 'string' && token.length === 64) {
    try { tokenValid.value = Boolean((await $fetch<any>('/api/auth/verify-reset-token', { query: { token } })).valid) }
    catch { tokenValid.value = false }
  }
  checkingToken.value = false
})

watch(isDark, (value) => localStorage.setItem('dja-theme', value ? 'dark' : 'light'))
</script>

<template>
  <div class="page auth-page" :data-theme="isDark ? 'dark' : 'light'">
    <div class="auth-shell">
      <header class="auth-topbar">
        <NuxtLink to="/funnelpage" class="auth-brand">
          <img src="/images/logo.png" alt="DJA Group of Companies" />
          <span>DJA <small>Group of Companies</small></span>
        </NuxtLink>
        <div style="display: flex; align-items: center; gap: 14px">
          <NuxtLink to="/loginscreen" class="auth-back">&larr; Back to login</NuxtLink>
          <button type="button" class="auth-theme-toggle" aria-label="Toggle dark mode" @click="isDark = !isDark">
            <svg v-if="!isDark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2"/></svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a7 7 0 0 0 10.7 10.7Z"/></svg>
          </button>
        </div>
      </header>

      <main class="auth-card">
        <section class="auth-intro">
          <span class="auth-eyebrow">DJA Payroll System</span>
          <h1>Set a new <em>password.</em></h1>
          <p>Choose a strong password to secure your DJA Payroll account.</p>
          <div class="auth-line"></div><div class="auth-orb"></div>
        </section>

        <section class="auth-panel" aria-labelledby="reset-title">
          <div class="auth-panel__inner">
            <template v-if="checkingToken">
              <h2 id="reset-title">Checking your link…</h2>
              <p class="auth-panel__lead">Please wait a moment.</p>
            </template>

            <template v-else-if="!tokenValid">
              <h2 id="reset-title">Link invalid or expired</h2>
              <p class="auth-panel__lead">This password reset link is invalid or has already expired. Request a new one to continue.</p>
              <NuxtLink to="/forgotpass" class="auth-submit" style="display:inline-flex;align-items:center;justify-content:center;text-decoration:none;margin-top:10px">Request new link &rarr;</NuxtLink>
            </template>

            <template v-else>
              <h2 id="reset-title">Set a new password</h2>
              <p class="auth-panel__lead">Enter and confirm your new password below.</p>
              <form v-if="!message" class="auth-form" @submit.prevent="reset">
                <div class="auth-field">
                  <label for="new-password">New password</label>
                  <div class="auth-password-wrap">
                    <input id="new-password" v-model="password" :type="showPassword ? 'text' : 'password'" autocomplete="new-password" minlength="12" placeholder="12+ chars, letters and numbers" required />
                    <button type="button" class="auth-password-toggle" :aria-label="showPassword ? 'Hide password' : 'Show password'" @click="showPassword = !showPassword">
                      <svg v-if="!showPassword" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.6 18.6 0 0 1 5.06-5.94M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>
                      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>
                  </div>
                </div>
                <div class="auth-field">
                  <label for="confirm-password">Confirm password</label>
                  <div class="auth-password-wrap">
                    <input id="confirm-password" v-model="confirm" :type="showConfirmPassword ? 'text' : 'password'" autocomplete="new-password" minlength="12" required />
                    <button type="button" class="auth-password-toggle" :aria-label="showConfirmPassword ? 'Hide password' : 'Show password'" @click="showConfirmPassword = !showConfirmPassword">
                      <svg v-if="!showConfirmPassword" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.6 18.6 0 0 1 5.06-5.94M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>
                      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>
                  </div>
                </div>
                <p v-if="error" role="alert" style="color:#b42318">{{ error }}</p>
                <button type="submit" class="auth-submit" :disabled="busy">{{ busy ? 'Saving…' : 'Save password' }} <span>&rarr;</span></button>
              </form>
              <template v-else>
                <p style="color:#087443">{{ message }}</p>
                <NuxtLink to="/loginscreen" class="auth-submit" style="display:inline-flex;align-items:center;justify-content:center;text-decoration:none">Log in now &rarr;</NuxtLink>
              </template>
            </template>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>