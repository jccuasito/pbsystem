<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'

const isDark = ref(false)
const email = ref(''); const password = ref(''); const error = ref(''); const busy = ref(false)
const showPassword = ref(false)
const googleReady = ref(false)
const googleCodeClient = ref<any>(null)

async function login() {
  error.value = ''; busy.value = true
  try { await $fetch('/api/auth/login', { method: 'POST', body: { email: email.value, password: password.value } }); await navigateTo('/dashboard') }
  catch (e: any) { error.value = e.data?.statusMessage || 'Unable to log in.' } finally { busy.value = false }
}
async function googleLogin(response: { code?: string; error?: string }) {
  if (!response.code) { error.value = response.error || 'Google sign-in was cancelled.'; return }
  error.value = ''; busy.value = true
  try { await $fetch('/api/auth/google-code', { method: 'POST', body: { code: response.code } }); await navigateTo('/dashboard') }
  catch (e: any) { error.value = e.data?.statusMessage || 'Google sign-in failed.' } finally { busy.value = false }
}
function startGoogle() {
  error.value = ''
  if (!googleReady.value || !googleCodeClient.value) { error.value = 'Google sign-in is still loading. Please try again.'; return }
  googleCodeClient.value.requestCode()
}

onMounted(() => {
  const savedTheme = localStorage.getItem('dja-theme')
  isDark.value = savedTheme ? savedTheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
  const config = useRuntimeConfig()
  if (!config.public.googleClientId) return
  const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true
  script.onload = () => { const google = (window as any).google; googleCodeClient.value = google?.accounts.oauth2.initCodeClient({ client_id: config.public.googleClientId, scope: 'openid email profile', ux_mode: 'popup', callback: googleLogin }); googleReady.value = Boolean(googleCodeClient.value) }
  document.head.appendChild(script)
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
          <NuxtLink to="/funnelpage" class="auth-back">&larr; Back to home</NuxtLink>
          <button type="button" class="auth-theme-toggle" aria-label="Toggle dark mode" @click="isDark = !isDark">
            <svg v-if="!isDark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2"/></svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a7 7 0 0 0 10.7 10.7Z"/></svg>
          </button>
        </div>
      </header>

      <main class="auth-card">
        <section class="auth-intro">
          <span class="auth-eyebrow">DJA Payroll System</span>
          <h1>Welcome <em>back.</em></h1>
          <p>Manage payroll, attendance, and employee records from one secure workspace.</p>
          <div class="auth-line"></div><div class="auth-orb"></div>
        </section>
        <section class="auth-panel" aria-labelledby="login-title">
          <div class="auth-panel__inner">
            <h2 id="login-title">Log in to your account</h2>
            <p class="auth-panel__lead">Enter your credentials to continue to DJA Payroll.</p>
            <form class="auth-form" @submit.prevent="login">
              <div class="auth-field"><label for="login-email">Email address</label><input id="login-email" v-model="email" type="email" autocomplete="email" placeholder="name@company.com" required /></div>
              <div class="auth-field">
                <label for="login-password">Password</label>
                <div class="auth-password-wrap">
                  <input id="login-password" v-model="password" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" placeholder="Enter your password" required />
                  <button type="button" class="auth-password-toggle" :aria-label="showPassword ? 'Hide password' : 'Show password'" @click="showPassword = !showPassword">
                    <svg v-if="!showPassword" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.6 18.6 0 0 1 5.06-5.94M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>
                    <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>
                  </button>
                </div>
              </div>
              <div class="auth-options"><label><input type="checkbox" /> Remember me</label><a href="/forgotpass">Forgot password?</a></div>
              <p v-if="error" role="alert" style="color:#b42318">{{ error }}</p><button type="submit" class="auth-submit" :disabled="busy">{{ busy ? 'Logging in…' : 'Log in' }} <span>&rarr;</span></button>
            </form>
            <div class="auth-divider">or</div>
            <button type="button" class="auth-google-btn" :disabled="busy" @click="startGoogle">
              <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/><path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/><path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"/><path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"/></svg>
              Continue with Google
            </button>
            <p class="auth-switch">Don't have an account? <NuxtLink to="/signupscreen">Create one</NuxtLink></p>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>