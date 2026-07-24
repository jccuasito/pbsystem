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
          <h1>Reset your <em>password.</em></h1>
          <p>No worries. Enter your registered email and we'll send you a link to get back into your account.</p>
          <div class="auth-line"></div><div class="auth-orb"></div>
        </section>

        <section class="auth-panel" aria-labelledby="forgot-title">
          <div class="auth-panel__inner">
            <h2 id="forgot-title">Forgot password?</h2>
            <p class="auth-panel__lead">Enter the email address linked to your account and we'll send you a reset link.</p>
            <form class="auth-form" @submit.prevent>
              <div class="auth-field">
                <label for="forgot-email">Email address</label>
                <input id="forgot-email" type="email" autocomplete="email" placeholder="name@company.com" required />
              </div>
              <AppButton type="submit" class="auth-submit">Send reset link <span>&rarr;</span></AppButton>
            </form>
            <p class="auth-switch">Remembered your password? <NuxtLink to="/loginscreen">Log in</NuxtLink></p>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>