<script setup>
import { ref, onMounted, watch } from 'vue'

const isDark = ref(false)

onMounted(() => {
  const savedTheme = localStorage.getItem('dja-theme')
  isDark.value = savedTheme ? savedTheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
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
            <form class="auth-form" @submit.prevent>
              <div class="auth-form__grid"><div class="auth-field"><label for="first-name">First name</label><input id="first-name" autocomplete="given-name" placeholder="Juan" required /></div><div class="auth-field"><label for="last-name">Last name</label><input id="last-name" autocomplete="family-name" placeholder="Dela Cruz" required /></div></div>
              <div class="auth-form__grid auth-form__grid--birth"><div class="auth-field"><label for="birthday">Birthday</label><input id="birthday" type="date" required /></div><div class="auth-field"><label for="age">Age</label><input id="age" type="number" min="18" placeholder="18" required /></div></div>
              <div class="auth-form__grid"><div class="auth-field"><label for="gender">Gender</label><select id="gender" required><option value="" disabled selected>Select</option><option>Female</option><option>Male</option><option>Prefer not to say</option></select></div><div class="auth-field"><label for="department">Department</label><input id="department" placeholder="Finance" required /></div></div>
              <div class="auth-field"><label for="signup-email">Email address</label><input id="signup-email" type="email" autocomplete="email" placeholder="name@company.com" required /></div>
              <div class="auth-field"><label for="new-password">Password</label><input id="new-password" type="password" autocomplete="new-password" placeholder="At least 8 characters" minlength="8" required /></div>
              <div class="auth-field"><label for="confirm-password">Confirm password</label><input id="confirm-password" type="password" autocomplete="new-password" placeholder="Re-enter your password" minlength="8" required /></div>
              <AppButton type="submit" class="auth-submit">Create account <span>&rarr;</span></AppButton>
            </form>
            <div class="auth-divider">or</div>
            <button type="button" class="auth-google-btn">
              <svg viewBox="0 0 48 48"><path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/><path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/><path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"/><path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"/></svg>
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
    </div>
  </div>
</template>
