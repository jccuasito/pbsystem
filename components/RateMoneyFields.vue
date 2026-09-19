<script setup lang="ts">
import { rateFormFields } from '~~/shared/utils/rateFields'
defineProps<{ modelValue: Record<string, any> }>()
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, any>] }>()
</script>

<template>
  <div class="rate-money-grid">
    <label v-for="field in rateFormFields" :key="field.key">{{ field.label }}
      <input :value="modelValue[field.key]" type="number" min="0" max="99999999.99" step="0.01"
        @input="emit('update:modelValue', { ...modelValue, [field.key]: ($event.target as HTMLInputElement).value })" />
    </label>
  </div>
</template>

<style scoped>
.rate-money-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.rate-money-grid label{display:grid;gap:5px;font-size:.8rem;font-weight:700;color:#475569}
.rate-money-grid input{box-sizing:border-box;width:100%;min-width:0;min-height:40px;border:1px solid #cfd8e6;border-radius:7px;padding:8px;font:inherit;color:#172033;background:#fff}
@media(max-width:700px){.rate-money-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:420px){.rate-money-grid{grid-template-columns:1fr}}
</style>
