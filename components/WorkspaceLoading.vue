<script setup lang="ts">
defineProps<{ label: string }>()
</script>

<template>
  <div class="workspace-loading" role="status" aria-live="polite">
    <span>{{ label }}</span>
    <div class="workspace-loading__track" aria-hidden="true"><span></span></div>
  </div>
</template>

<style scoped>
.workspace-loading {
  width: min(100%, 450px);
  margin: 76px auto 0;
  color: var(--muted);
  text-align: center;
  font-size: .9rem;
}
.workspace-loading__track {
  height: 4px;
  margin-top: 14px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(40, 98, 233, .12);
}
.workspace-loading__track span {
  display: block;
  width: 38%;
  height: 100%;
  border-radius: inherit;
  background: #2862e9;
  animation: workspace-loading-slide 1.2s ease-in-out infinite;
}
@keyframes workspace-loading-slide {
  from { transform: translateX(-110%); }
  to { transform: translateX(275%); }
}
@media (prefers-reduced-motion: reduce) {
  .workspace-loading__track span { animation: none; width: 100%; }
}
</style>
