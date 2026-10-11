<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  label: string
  placeholder?: string
  required?: boolean
  disabled?: boolean
  align?: 'start' | 'end'
}>(), {
  placeholder: 'Select time',
  align: 'start'
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const id = useId()
const trigger = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const open = ref(false)
const panelStyle = ref({ top: '0px', left: '0px' })
const hour = ref(8)
const minute = ref(0)
const period = ref<'AM' | 'PM'>('AM')
const hours = Array.from({ length: 12 }, (_, index) => index + 1)
const minutes = Array.from({ length: 60 }, (_, index) => index)

function parseTime(value: string) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value || '')
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  return h >= 0 && h < 24 && m >= 0 && m < 60 ? { h, m } : null
}

function displayTime(value: string) {
  const time = parseTime(value)
  if (!time) return ''
  return `${String(time.h % 12 || 12).padStart(2, '0')}:${String(time.m).padStart(2, '0')} ${time.h < 12 ? 'AM' : 'PM'}`
}

const formattedValue = computed(() => displayTime(props.modelValue))
const draftValue = computed(() => `${String(hour.value).padStart(2, '0')}:${String(minute.value).padStart(2, '0')} ${period.value}`)

function positionPanel() {
  if (!trigger.value || !panel.value) return
  const rect = trigger.value.getBoundingClientRect()
  const width = panel.value.offsetWidth
  const height = panel.value.offsetHeight
  const left = props.align === 'end' ? rect.right - width : rect.left
  const top = rect.bottom + 8 + height <= window.innerHeight - 12 && rect.bottom >= 0
    ? rect.bottom + 8
    : Math.max(12, rect.top - height - 8)
  panelStyle.value = {
    top: `${Math.min(top, Math.max(12, window.innerHeight - height - 12))}px`,
    left: `${Math.max(12, Math.min(left, window.innerWidth - width - 12))}px`
  }
}

async function showPicker() {
  if (props.disabled) return
  const selected = parseTime(props.modelValue)
  hour.value = selected ? selected.h % 12 || 12 : 8
  minute.value = selected?.m ?? 0
  period.value = selected && selected.h >= 12 ? 'PM' : 'AM'
  open.value = true
  await nextTick()
  positionPanel()
}

function closePicker(focusTrigger = false) {
  open.value = false
  if (focusTrigger) trigger.value?.focus()
}

function apply() {
  const h = Number(hour.value)
  const m = Number(minute.value)
  if (h < 1 || h > 12 || m < 0 || m > 59) return
  const hour24 = h % 12 + (period.value === 'PM' ? 12 : 0)
  emit('update:modelValue', `${String(hour24).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  closePicker(true)
}

function clear() {
  emit('update:modelValue', '')
  closePicker(true)
}

function onPointerDown(event: PointerEvent) {
  if (!open.value) return
  const target = event.target as Node
  if (!trigger.value?.contains(target) && !panel.value?.contains(target)) closePicker()
}

function onKeyDown(event: KeyboardEvent) {
  if (open.value && event.key === 'Escape') {
    event.stopPropagation()
    closePicker(true)
  }
}

function onScroll() {
  if (open.value) positionPanel()
}

onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onScroll)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown)
  document.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onScroll)
})

watch(() => props.disabled, (disabled) => { if (disabled) closePicker() })
</script>

<template>
  <div class="modern-time-field" :class="{ 'modern-time-field--disabled': disabled }">
    <label :for="id">{{ label }}</label>
    <button
      :id="id"
      ref="trigger"
      class="modern-time-field__trigger"
      type="button"
      :aria-expanded="open"
      aria-haspopup="dialog"
      :disabled="disabled"
      @click="open ? closePicker() : showPicker()"
    >
      <span :class="{ placeholder: !formattedValue }">{{ formattedValue || placeholder }}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
    </button>
    <input class="modern-time-field__native" :value="modelValue" :required="required" :disabled="disabled" tabindex="-1" aria-hidden="true" @invalid="showPicker" />

    <Teleport to="body">
      <section v-if="open" ref="panel" class="modern-time-field__panel" :style="panelStyle" role="dialog" :aria-label="`${label} time picker`">
        <div class="modern-time-field__heading">Choose time</div>
        <div class="modern-time-field__controls">
          <label>Hour
            <select v-model.number="hour" :aria-label="`${label} hour`">
              <option v-for="option in hours" :key="option" :value="option">{{ String(option).padStart(2, '0') }}</option>
            </select>
          </label>
          <span class="modern-time-field__separator" aria-hidden="true">:</span>
          <label>Minute
            <select v-model.number="minute" :aria-label="`${label} minute`">
              <option v-for="option in minutes" :key="option" :value="option">{{ String(option).padStart(2, '0') }}</option>
            </select>
          </label>
        </div>
        <div class="modern-time-field__period" role="group" :aria-label="`${label} period`">
          <button v-for="option in (['AM', 'PM'] as const)" :key="option" type="button" :class="{ selected: period === option }" :aria-pressed="period === option" @click="period = option">{{ option }}</button>
        </div>
        <div class="modern-time-field__preview">{{ draftValue }}</div>
        <footer>
          <button type="button" @click="clear">Clear</button>
          <button class="modern-time-field__apply" type="button" @click="apply">Set time</button>
        </footer>
      </section>
    </Teleport>
  </div>
</template>

<style scoped>
.modern-time-field{position:relative;display:grid;min-width:0;gap:6px;color:#3b5478;font-size:.78rem;font-weight:750}
.modern-time-field>label{font:inherit}
.modern-time-field__trigger{display:flex;align-items:center;justify-content:space-between;gap:12px;box-sizing:border-box;width:100%;min-height:47px;border:1px solid #cbd9ee;border-radius:9px;padding:9px 12px;background:#fff;color:#112b53;font:inherit;font-size:.85rem;text-align:left;cursor:pointer;transition:border-color .16s ease,box-shadow .16s ease}
.modern-time-field__trigger:hover,.modern-time-field__trigger:focus-visible{border-color:#7798d0;box-shadow:0 0 0 3px rgba(35,73,230,.1);outline:0}
.modern-time-field__trigger .placeholder{color:#8b97a8;font-weight:600}
.modern-time-field__trigger svg{width:19px;height:19px;flex:none;fill:none;stroke:#315173;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.modern-time-field--disabled{color:#8290a3}
.modern-time-field--disabled .modern-time-field__trigger{background:#e9eef5;color:#8290a3;cursor:not-allowed}
.modern-time-field__native{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.modern-time-field__panel{position:fixed;z-index:1400;box-sizing:border-box;width:min(320px,calc(100vw - 24px));border:1px solid #cbd7e8;border-radius:14px;padding:15px;background:#fff;box-shadow:0 18px 45px rgba(23,42,70,.2);color:#243b5a;font-family:Inter,system-ui,sans-serif;font-size:.8rem}
.modern-time-field__heading{margin-bottom:12px;color:#1e385b;font-weight:800}
.modern-time-field__controls{display:grid;grid-template-columns:1fr auto 1fr;align-items:end;gap:9px}
.modern-time-field__controls label{display:grid;gap:5px;color:#526c92;font-size:.73rem;font-weight:700}
.modern-time-field__controls select{width:100%;min-height:40px;border:1px solid #dae2ee;border-radius:8px;padding:7px 9px;background:#f8faff;color:#1e385b;font:inherit;font-size:.92rem;font-weight:800;cursor:pointer}
.modern-time-field__controls select:focus-visible,.modern-time-field__panel button:focus-visible{outline:2px solid #7798d0;outline-offset:2px}
.modern-time-field__separator{padding-bottom:9px;color:#526c92;font-size:1.2rem;font-weight:800}
.modern-time-field__period{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:12px}
.modern-time-field__period button{min-height:36px;border:1px solid #dae2ee;border-radius:8px;background:#f8faff;color:#315173;font:inherit;font-weight:800;cursor:pointer}
.modern-time-field__period button.selected{border-color:#2349e6;background:#edf3ff;color:#2349e6}
.modern-time-field__preview{margin-top:13px;color:#1e385b;font-size:1rem;font-weight:800;text-align:center}
.modern-time-field__panel footer{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:12px;padding-top:11px;border-top:1px solid #edf1f6}
.modern-time-field__panel footer button{min-height:34px;border:0;border-radius:7px;padding:5px 9px;background:transparent;color:#2349e6;font:inherit;font-weight:800;cursor:pointer}
.modern-time-field__panel footer .modern-time-field__apply{padding:7px 12px;background:#2349e6;color:#fff}
</style>
