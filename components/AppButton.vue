<script setup>
defineProps({
  to: { type: String, default: '' },
  href: { type: String, default: '' },
  variant: {
    type: String,
    default: 'primary',
    validator: (value) => ['primary', 'outline', 'light'].includes(value)
  },
  size: {
    type: String,
    default: 'default',
    validator: (value) => ['default', 'large'].includes(value)
  },
  type: { type: String, default: 'button' },
  disabled: { type: Boolean, default: false }
})
</script>

<template>
  <NuxtLink v-if="to" :to="to" class="app-button" :class="[`app-button--${variant}`, `app-button--${size}`]"><slot /></NuxtLink>
  <a v-else-if="href" :href="href" class="app-button" :class="[`app-button--${variant}`, `app-button--${size}`]"><slot /></a>
  <button v-else :type="type" :disabled="disabled" class="app-button" :class="[`app-button--${variant}`, `app-button--${size}`]"><slot /></button>
</template>
