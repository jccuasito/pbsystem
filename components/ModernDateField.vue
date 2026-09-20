<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  label: string
  placeholder?: string
  min?: string
  max?: string
  required?: boolean
  align?: 'start' | 'end'
  initialYear?: number
}>(), {
  placeholder: 'Select date',
  align: 'start'
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const id = useId()
const open = ref(false)
const now = new Date()

function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? null : date
}

const initialDate = parseDate(props.modelValue)
const viewYear = ref(initialDate?.getFullYear() ?? props.initialYear ?? now.getFullYear())
const viewMonth = ref(initialDate?.getMonth() ?? now.getMonth())
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const weekdays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const minimumYear = computed(() => parseDate(props.min || '')?.getFullYear() ?? now.getFullYear() - 100)
const maximumYear = computed(() => parseDate(props.max || '')?.getFullYear() ?? now.getFullYear() + 10)
const years = computed(() => Array.from({ length: maximumYear.value - minimumYear.value + 1 }, (_, index) => maximumYear.value - index))

function isoDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const todayValue = isoDate(now)
const formattedValue = computed(() => {
  const date = parseDate(props.modelValue)
  return date ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date) : ''
})

const calendarDays = computed(() => {
  const firstDay = new Date(viewYear.value, viewMonth.value, 1)
  const startOffset = firstDay.getDay()
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(viewYear.value, viewMonth.value, index - startOffset + 1)
    const value = isoDate(date)
    return {
      value,
      day: date.getDate(),
      outside: date.getMonth() !== viewMonth.value,
      today: value === todayValue,
      selected: value === props.modelValue,
      disabled: Boolean((props.min && value < props.min) || (props.max && value > props.max))
    }
  })
})

function showPicker() {
  const selected = parseDate(props.modelValue)
  if (selected) {
    viewYear.value = selected.getFullYear()
    viewMonth.value = selected.getMonth()
  }
  open.value = true
}

function shiftMonth(amount: number) {
  const next = new Date(viewYear.value, viewMonth.value + amount, 1)
  viewYear.value = next.getFullYear()
  viewMonth.value = next.getMonth()
}

function choose(value: string, disabled: boolean) {
  if (disabled) return
  emit('update:modelValue', value)
  open.value = false
}

function chooseToday() {
  if ((props.min && todayValue < props.min) || (props.max && todayValue > props.max)) return
  emit('update:modelValue', todayValue)
  open.value = false
}

function clear() {
  emit('update:modelValue', '')
  open.value = false
}

function leave(event: FocusEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) open.value = false
}

watch(() => props.modelValue, (value) => {
  const selected = parseDate(value)
  if (!selected) return
  viewYear.value = selected.getFullYear()
  viewMonth.value = selected.getMonth()
})
</script>

<template>
  <div class="modern-date-field" :class="`modern-date-field--${align}`" @focusout="leave" @keydown.esc.stop="open = false">
    <label :for="id">{{ label }}</label>
    <button :id="id" class="modern-date-field__trigger" type="button" :aria-expanded="open" aria-haspopup="dialog" @click="open ? open = false : showPicker()">
      <span :class="{ placeholder: !formattedValue }">{{ formattedValue || placeholder }}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M4 9h16"/><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 13h3M13 13h3M8 16h3"/></svg>
    </button>
    <input class="modern-date-field__native" tabindex="-1" :value="modelValue" :required="required" aria-hidden="true" />

    <section v-if="open" class="modern-date-field__panel" role="dialog" :aria-label="`${label} calendar`">
      <header>
        <button type="button" aria-label="Previous month" @click="shiftMonth(-1)">‹</button>
        <div>
          <select v-model.number="viewMonth" :aria-label="`${label} month`">
            <option v-for="(month, index) in monthNames" :key="month" :value="index">{{ month }}</option>
          </select>
          <select v-model.number="viewYear" :aria-label="`${label} year`">
            <option v-for="year in years" :key="year" :value="year">{{ year }}</option>
          </select>
        </div>
        <button type="button" aria-label="Next month" @click="shiftMonth(1)">›</button>
      </header>

      <div class="modern-date-field__weekdays" aria-hidden="true">
        <span v-for="day in weekdays" :key="day">{{ day }}</span>
      </div>
      <div class="modern-date-field__days">
        <button
          v-for="day in calendarDays"
          :key="day.value"
          type="button"
          :disabled="day.disabled"
          :class="{ outside: day.outside, today: day.today, selected: day.selected }"
          :aria-label="day.value"
          @click="choose(day.value, day.disabled)"
        >{{ day.day }}</button>
      </div>

      <footer>
        <button type="button" @click="clear">Clear</button>
        <button type="button" @click="chooseToday">Today</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.modern-date-field{position:relative;display:grid;min-width:0;gap:6px;color:#475569;font-size:.8rem;font-weight:700}
.modern-date-field>label{font:inherit}
.modern-date-field__trigger{display:flex;align-items:center;justify-content:space-between;gap:12px;box-sizing:border-box;width:100%;min-height:44px;border:1px solid #cfd8e6;border-radius:10px;padding:9px 12px;background:#fff;color:#172033;font:inherit;text-align:left;cursor:pointer;transition:border-color .16s ease,box-shadow .16s ease}
.modern-date-field__trigger:hover,.modern-date-field__trigger:focus-visible{border-color:#7798d0;box-shadow:0 0 0 3px rgba(35,73,230,.1);outline:0}
.modern-date-field__trigger .placeholder{color:#8b97a8;font-weight:600}
.modern-date-field__trigger svg{width:19px;height:19px;fill:none;stroke:#315173;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.modern-date-field__native{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.modern-date-field__panel{position:absolute;z-index:30;top:calc(100% + 7px);left:0;width:300px;box-sizing:border-box;border:1px solid #cbd7e8;border-radius:14px;padding:12px;background:#fff;box-shadow:0 18px 45px rgba(23,42,70,.2);font-family:Inter,system-ui,sans-serif}
.modern-date-field--end .modern-date-field__panel{right:0;left:auto}
.modern-date-field__panel header{display:grid;grid-template-columns:34px 1fr 34px;align-items:center;gap:6px;margin-bottom:10px}
.modern-date-field__panel header>div{display:grid;grid-template-columns:1.35fr .85fr;gap:6px}
.modern-date-field__panel select,.modern-date-field__panel header button{min-height:34px;border:1px solid #dae2ee;border-radius:8px;background:#f8faff;color:#1e385b;font:inherit;font-weight:800}
.modern-date-field__panel header button{padding:0;font-size:1.25rem;cursor:pointer}
.modern-date-field__weekdays,.modern-date-field__days{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}
.modern-date-field__weekdays span{padding:5px 0;color:#7b8798;font-size:.67rem;text-align:center;text-transform:uppercase}
.modern-date-field__days button{aspect-ratio:1;border:0;border-radius:8px;background:transparent;color:#243b5a;font:inherit;font-size:.75rem;cursor:pointer}
.modern-date-field__days button:hover:not(:disabled){background:#edf3ff;color:#173fae}
.modern-date-field__days button.outside{color:#a9b2bf}
.modern-date-field__days button.today{box-shadow:inset 0 0 0 1px #7192ce;color:#2349e6}
.modern-date-field__days button.selected{background:#2349e6;color:#fff;box-shadow:none}
.modern-date-field__days button:disabled{color:#d1d6de;cursor:not-allowed}
.modern-date-field__panel footer{display:flex;justify-content:space-between;margin-top:10px;padding-top:9px;border-top:1px solid #edf1f6}
.modern-date-field__panel footer button{border:0;background:transparent;color:#2349e6;font:inherit;font-weight:800;cursor:pointer}
@media(max-width:600px){.modern-date-field__panel,.modern-date-field--end .modern-date-field__panel{right:auto;left:0;width:min(300px,calc(100vw - 56px))}}
</style>
