<script setup lang="ts">
import { ref, useId, watch } from 'vue'
import type { AlertMessage } from './messages'

const props = defineProps<{ modelValue: AlertMessage | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: null] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const titleId = useId(), messageId = useId()
function dismiss() { emit('update:modelValue', null) }
watch([() => props.modelValue, dialog], ([message, element]) => {
  if (!element) return
  if (message && !element.open) element.showModal()
  if (!message && element.open) element.close()
}, { flush: 'post' })
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="system-alert" :aria-labelledby="titleId" :aria-describedby="messageId" @cancel.prevent="dismiss">
      <template v-if="modelValue">
        <span class="system-alert__label" :data-tone="modelValue.tone">{{ modelValue.tone === 'success' ? 'Success' : modelValue.tone === 'error' ? 'Action needed' : 'Notice' }}</span>
        <h2 :id="titleId">{{ modelValue.title }}</h2>
        <p :id="messageId">{{ modelValue.message }}</p>
        <button type="button" autofocus @click="dismiss">OK</button>
      </template>
    </dialog>
  </Teleport>
</template>

<style scoped>
.system-alert { box-sizing: border-box; width: min(440px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); margin: auto; padding: 28px; border: 1px solid #d6e1f1; border-radius: 16px; background: #fff; color: #142f58; box-shadow: 0 20px 60px #101b3433; font-family: 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif; }
.system-alert::backdrop { background: #0e1e3b80; }
.system-alert__label { color: #2859a3; font-size: 12px; font-weight: 700; text-transform: uppercase; }
.system-alert__label[data-tone=success] { color: #16804b; }
.system-alert__label[data-tone=error] { color: #b42318; }
.system-alert h2 { margin: 10px 0; font-size: 20px; }
.system-alert p { margin: 0 0 24px; color: #526683; line-height: 1.6; overflow-wrap: anywhere; }
.system-alert button { display: block; margin-left: auto; min-width: 80px; padding: 11px 20px; border: 0; border-radius: 9px; background: #2867d8; color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
.system-alert button:focus-visible { outline: 3px solid #92b7ff; outline-offset: 3px; }
</style>
