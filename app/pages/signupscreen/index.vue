<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'

const isDark = ref(false)
const form = ref({ firstName: '', lastName: '', gender: '', email: '', password: '', confirmPassword: '', departmentId: null as number | null })
const departments = ref<any[]>([]); const error = ref(''); const message = ref(''); const busy = ref(false)
const googleReady = ref(false)
const googleCodeClient = ref<any>(null)
const googleSelected = ref(false); const showVerification = ref(false); const verificationCode = ref(''); const verificationMessage = ref('')
async function register() { error.value = ''; message.value = ''; if (form.value.password !== form.value.confirmPassword) { error.value = 'Passwords do not match.'; return }; busy.value = true; try { const result: any = await $fetch('/api/auth/register', { method: 'POST', body: form.value }); message.value = result.message; showVerification.value = Boolean(result.requiresVerification) } catch (e: any) { error.value = e.data?.statusMessage || 'Unable to create account.' } finally { busy.value = false } }
async function googleSignup(response: { code?: string; error?: string }) { if (!response.code) { error.value = response.error || 'Google sign-up was cancelled.'; return }; error.value = ''; busy.value = true; try { const result: any = await $fetch('/api/auth/google-code', { method: 'POST', body: { code: response.code, intent: 'signup' } }); form.value.firstName = result.profile.firstName; form.value.lastName = result.profile.lastName; form.value.email = result.profile.email; googleSelected.value = true; message.value = 'Google account selected. Complete the remaining fields, then create your account.' } catch (e: any) { error.value = e.data?.statusMessage || 'Google sign-up failed.' } finally { busy.value = false } }
async function verifyEmail() { verificationMessage.value = ''; try { verificationMessage.value = (await $fetch<any>('/api/auth/verify-email', { method: 'POST', body: { email: form.value.email, code: verificationCode.value } })).message; setTimeout(() => navigateTo('/loginscreen'), 1200) } catch (e: any) { verificationMessage.value = e.data?.statusMessage || 'Unable to verify code.' } }
function startGoogle() { error.value = ''; if (!googleReady.value || !googleCodeClient.value) { error.value = 'Google sign-in is still loading. Please try again.'; return }; googleCodeClient.value.requestCode() }

onMounted(async () => {
  const savedTheme = localStorage.getItem('dja-theme')
  isDark.value = savedTheme ? savedTheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
  try { departments.value = (await $fetch<any>('/api/auth/departments')).departments } catch { /* form still works without an optional department */ }
  const id = useRuntimeConfig().public.googleClientId; if (!id) return
  const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.onload = () => { const google = (window as any).google; googleCodeClient.value = google?.accounts.oauth2.initCodeClient({ client_id: id, scope: 'openid email profile', ux_mode: 'popup', callback: googleSignup }); googleReady.value = Boolean(googleCodeClient.value) }; document.head.appendChild(script)
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

      <main class="auth-card auth-card--signup">
        <section class="auth-panel" aria-labelledby="signup-title">
          <div class="auth-panel__inner">
            <h2 id="signup-title">Create your account</h2>
            <p class="auth-panel__lead">Set up your secure DJA Payroll access.</p>
            <form class="auth-form" @submit.prevent="register">
              <div class="auth-form__grid"><div class="auth-field"><label for="first-name">First name</label><input id="first-name" v-model="form.firstName" autocomplete="given-name" placeholder="Juan" required /></div><div class="auth-field"><label for="last-name">Last name</label><input id="last-name" v-model="form.lastName" autocomplete="family-name" placeholder="Dela Cruz" required /></div></div>
              <div class="auth-form__grid"><div class="auth-field"><label for="gender">Gender</label><select id="gender" v-model="form.gender" required><option value="" disabled>Select</option><option>Female</option><option>Male</option><option>Prefer not to say</option></select></div><div class="auth-field"><label for="department">Department (optional)</label><select id="department" v-model="form.departmentId"><option :value="null">Select</option><option v-for="department in departments" :key="department.DepartmentID" :value="department.DepartmentID">{{ department.DepartmentName }}</option></select></div></div>
              <div class="auth-field"><label for="signup-email">Email address</label><input id="signup-email" v-model="form.email" type="email" autocomplete="email" placeholder="name@company.com" required /></div>
              <div class="auth-field"><label for="new-password">Password</label><input id="new-password" v-model="form.password" type="password" autocomplete="new-password" placeholder="12+ chars, letters and numbers" minlength="12" required /></div>
              <div class="auth-field"><label for="confirm-password">Confirm password</label><input id="confirm-password" v-model="form.confirmPassword" type="password" autocomplete="new-password" placeholder="Re-enter your password" minlength="12" required /></div>
              <p v-if="error" role="alert" style="color:#b42318">{{ error }}</p><p v-if="message" style="color:#8ff0bc">{{ message }}</p><AppButton type="submit" class="auth-submit" :disabled="busy">{{ busy ? 'Creating…' : 'Create account' }} <span>&rarr;</span></AppButton>
            </form>
            <div class="auth-divider">or</div>
            <button type="button" class="auth-google-btn" :disabled="busy" @click="startGoogle">
              <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/><path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/><path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"/><path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"/></svg>
              Sign up with Google
            </button>
            <p class="auth-switch">Already have an account? <NuxtLink to="/loginscreen">Log in</NuxtLink></p>
          </div>
        </section>
        <section class="auth-intro auth-intro--right">
          <span class="auth-eyebrow">DJA Payroll System</span>
          <h1>Payroll, <em>simplified.</em></h1>
          <p>Create your account and take the first step toward accurate, secure payroll operations.</p>
          <div class="auth-line"></div><div class="auth-orb"></div>
        </section>
      </main>
      <div v-if="showVerification" class="verification-modal" role="dialog" aria-modal="true" aria-labelledby="verification-title">
        <div class="verification-modal__card">
          <h2 id="verification-title">Verify your email</h2>
          <p>We sent a 6-digit code to <strong>{{ form.email }}</strong>.</p>
          <input v-model="verificationCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000" aria-label="Verification code" />
          <p v-if="verificationMessage" :style="verificationMessage.startsWith('Email verified') ? 'color:#087443' : 'color:#b42318'">{{ verificationMessage }}</p>
          <button type="button" class="auth-submit" @click="verifyEmail">Verify code</button>
        </div>
      </div>
    </div>
  </div>
</template>
