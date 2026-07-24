<script setup>
// "/" is the entry point of the app. On open, send visitors to the
// public funnel/landing page. Add more redirect rules or a role check
// here later (e.g. redirect logged-in users straight to /dashboard).
await navigateTo('/funnelpage', { redirectCode: 302 })
</script>

<template>
  <div />
</template>