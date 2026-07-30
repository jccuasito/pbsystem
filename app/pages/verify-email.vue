<script setup lang="ts">
const route = useRoute(); const message = ref('Verifying your email…'); const failed = ref(false)
onMounted(async () => { try { message.value = (await $fetch<any>('/api/auth/verify-email', { query: { token: route.query.token } })).message } catch (e: any) { failed.value = true; message.value = e.data?.statusMessage || 'Unable to verify this link.' } })
</script>
<template><main class="page auth-page"><section class="auth-shell" style="padding:5rem 1.5rem"><div class="auth-panel"><div class="auth-panel__inner"><h1>Email verification</h1><p :style="failed ? 'color:#b42318' : ''">{{ message }}</p><NuxtLink class="auth-submit" to="/loginscreen">Go to log in</NuxtLink></div></div></section></main></template>
