<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  email: { type: String, required: true },
  error: { type: String, default: '' },
  busy: { type: Boolean, default: false }
})
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; verify: [code: string] }>()

const digits = ref(['', '', '', '', '', ''])
const inputs = ref<HTMLInputElement[]>([])
const code = computed(() => digits.value.join(''))

watch(() => props.modelValue, async (open) => {
  if (!open) return
  digits.value = ['', '', '', '', '', '']
  await nextTick()
  inputs.value[0]?.focus()
})

function setInput(el: HTMLInputElement | null, index: number) {
  if (el) inputs.value[index] = el
}

function inputDigit(index: number, event: Event) {
  const value = (event.target as HTMLInputElement).value.replace(/\D/g, '')
  if (value.length > 1) {
    value.slice(0, 6 - index).split('').forEach((digit, offset) => { digits.value[index + offset] = digit })
    nextTick(() => inputs.value[Math.min(index + value.length, 5)]?.focus())
    return
  }
  digits.value[index] = value
  if (value && index < 5) nextTick(() => inputs.value[index + 1]?.focus())
}

function keydown(index: number, event: KeyboardEvent) {
  if (event.key === 'Backspace' && !digits.value[index] && index > 0) nextTick(() => inputs.value[index - 1]?.focus())
  if (event.key === 'ArrowLeft' && index > 0) inputs.value[index - 1]?.focus()
  if (event.key === 'ArrowRight' && index < 5) inputs.value[index + 1]?.focus()
}

function submit() {
  if (code.value.length === 6) emit('verify', code.value)
}

function close() {
  if (!props.busy) emit('update:modelValue', false)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="email-verification" role="dialog" aria-modal="true" aria-labelledby="verification-title" @click.self="close">
      <section class="email-verification__card">
        <button type="button" class="email-verification__close" aria-label="Close verification dialog" :disabled="busy" @click="close">×</button>
        <div class="email-verification__icon" aria-hidden="true">✉</div>
        <p class="email-verification__eyebrow">EMAIL VERIFICATION</p>
        <h2 id="verification-title">Check your inbox</h2>
        <p class="email-verification__copy">We sent a 6-digit code to <strong>{{ email }}</strong>.</p>
        <form @submit.prevent="submit">
          <div class="email-verification__digits" aria-label="Six digit verification code">
            <input v-for="(_, index) in digits" :key="index" :ref="(el) => setInput(el as HTMLInputElement | null, index)" v-model="digits[index]" inputmode="numeric" autocomplete="one-time-code" maxlength="6" :aria-label="`Digit ${index + 1}`" @input="inputDigit(index, $event)" @keydown="keydown(index, $event)" />
          </div>
          <p v-if="error" class="email-verification__error" role="alert">{{ error }}</p>
          <button type="submit" class="email-verification__submit" :disabled="busy || code.length !== 6">{{ busy ? 'Verifying…' : 'Verify email' }}</button>
        </form>
        <p class="email-verification__hint">The code expires after 15 minutes.</p>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.email-verification { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 20px; background: rgba(4, 19, 54, .7); backdrop-filter: blur(6px); }
.email-verification__card { position: relative; width: min(100%, 430px); box-sizing: border-box; padding: 36px; border: 1px solid rgba(255,255,255,.66); border-radius: 20px; background: #fff; color: #102755; box-shadow: 0 28px 70px rgba(0, 12, 40, .35); text-align: center; }
.email-verification__close { position: absolute; top: 12px; right: 14px; width: 34px; height: 34px; border: 0; border-radius: 50%; background: #edf3fc; color: #385888; font-size: 1.5rem; cursor: pointer; }
.email-verification__icon { display: grid; place-items: center; width: 54px; height: 54px; margin: 0 auto 15px; border-radius: 16px; background: #e8f1ff; color: #2563d8; font-size: 1.7rem; }
.email-verification__eyebrow { margin: 0 0 7px; color: #2867dc; font-size: .72rem; font-weight: 800; letter-spacing: .12em; }
.email-verification h2 { margin: 0; font-size: 1.7rem; letter-spacing: -.04em; }.email-verification__copy { margin: 12px 0 24px; color: #5f7192; line-height: 1.55; }
.email-verification__digits { display: flex; justify-content: center; gap: 8px; }.email-verification__digits input { width: 44px; height: 54px; box-sizing: border-box; border: 1px solid #bad0ef; border-radius: 10px; background: #f9fbff; color: #102755; font-size: 1.45rem; font-weight: 700; text-align: center; outline: none; }.email-verification__digits input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,.16); }
.email-verification__submit { width: 100%; margin-top: 24px; min-height: 48px; border: 0; border-radius: 9px; background: #5ca9eb; color: #103363; font-weight: 800; cursor: pointer; }.email-verification__submit:disabled { opacity: .55; cursor: not-allowed; }
.email-verification__error { margin: 14px 0 -8px; color: #bb2d3b; font-size: .88rem; }.email-verification__hint { margin: 16px 0 0; color: #7686a3; font-size: .8rem; }
@media (max-width: 420px) { .email-verification__card { padding: 30px 20px; }.email-verification__digits { gap: 5px; }.email-verification__digits input { width: 40px; height: 50px; } }
</style>
