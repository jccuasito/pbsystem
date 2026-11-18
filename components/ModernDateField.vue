<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, onMounted, ref, useId, watch } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  label: string
  placeholder?: string
  min?: string
  max?: string
  required?: boolean
  disabled?: boolean
  align?: 'start' | 'end'
  initialYear?: number
  responsive?: boolean
}>(), {
  placeholder: 'Select date',
  align: 'start'
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const id = useId()
const open = ref(false)
const field = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const mobile = ref(false)
const panelStyle = ref<Record<string, string>>({})
let mobileQuery: MediaQueryList | null = null
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

async function showPicker() {
  if (props.disabled) return
  const selected = parseDate(props.modelValue)
  if (selected) {
    viewYear.value = selected.getFullYear()
    viewMonth.value = selected.getMonth()
  }
  if (props.responsive) panelStyle.value = { visibility: 'hidden', width: `${Math.min(mobile.value ? 340 : 300, window.innerWidth - 24)}px` }
  open.value = true
  if (!props.responsive) return
  await nextTick()
  positionPanel()
  await nextTick()
  if (open.value) (panel.value?.querySelector<HTMLElement>('button.selected:not(:disabled)') || panel.value?.querySelector<HTMLElement>('button:not(:disabled)'))?.focus({ preventScroll: true })
}

function positionPanel() {
  if (!open.value || !panel.value || !trigger.value) return
  const anchor = trigger.value.getBoundingClientRect()
  const box = panel.value.getBoundingClientRect()
  const below = window.innerHeight - anchor.bottom - 20
  const above = anchor.top - 20
  const height = Math.min(box.height, window.innerHeight - 24)
  const top = below >= height ? anchor.bottom + 8 : above >= height ? anchor.top - height - 8 : Math.max(12, Math.min(anchor.bottom + 8, window.innerHeight - height - 12))
  panelStyle.value = {
    visibility: 'visible', width: `${box.width}px`, maxHeight: `${height}px`,
    left: `${Math.max(12, Math.min(anchor.left, window.innerWidth - box.width - 12))}px`,
    top: `${top}px`,
  }
}

function close(restoreFocus = false) {
  open.value = false
  if (restoreFocus && props.responsive) trigger.value?.focus({ preventScroll: true })
}
function onEscape(event: KeyboardEvent) {
  if (!open.value) return
  event.preventDefault(); event.stopPropagation(); close(true)
}
function outside(event: Event) {
  if (event.target instanceof Node && !field.value?.contains(event.target)) close()
}
function dismiss() { close() }
function onScroll(event: Event) {
  if (event.target instanceof Node && panel.value?.contains(event.target)) return
  positionPanel()
}
function detach() {
  document.removeEventListener('pointerdown', outside)
  document.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', dismiss)
}
function updateMobile() { mobile.value = Boolean(mobileQuery?.matches); close() }

function shiftMonth(amount: number) {
  const next = new Date(viewYear.value, viewMonth.value + amount, 1)
  viewYear.value = next.getFullYear()
  viewMonth.value = next.getMonth()
}

function choose(value: string, disabled: boolean) {
  if (disabled) return
  emit('update:modelValue', value)
  close(true)
}

function chooseToday() {
  if ((props.min && todayValue < props.min) || (props.max && todayValue > props.max)) return
  emit('update:modelValue', todayValue)
  close(true)
}

function clear() {
  emit('update:modelValue', '')
  close(true)
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
watch(() => props.disabled, (disabled) => { if (disabled) open.value = false })
watch(open, (opened) => {
  if (!props.responsive) return
  detach()
  if (opened) {
    document.addEventListener('pointerdown', outside)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', dismiss)
  }
})
onMounted(() => {
  if (!props.responsive) return
  mobileQuery = window.matchMedia('(max-width: 980px), (pointer: coarse)')
  updateMobile()
  mobileQuery.addEventListener('change', updateMobile)
})
onDeactivated(() => { close(); detach() })
onBeforeUnmount(() => { close(); detach(); mobileQuery?.removeEventListener('change', updateMobile) })
</script>

<template>
  <div ref="field" class="modern-date-field" :class="[`modern-date-field--${align}`, { 'modern-date-field--disabled': disabled }]" @focusout="leave" @keydown.esc="onEscape">
    <label :for="id">{{ label }}</label>
    <button :id="id" ref="trigger" class="modern-date-field__trigger" type="button" :aria-expanded="open" :aria-controls="`${id}-calendar`" aria-haspopup="dialog" :disabled="disabled" @click="open ? close() : showPicker()">
      <span :class="{ placeholder: !formattedValue }">{{ formattedValue || placeholder }}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M4 9h16"/><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 13h3M13 13h3M8 16h3"/></svg>
    </button>
    <input class="modern-date-field__native" tabindex="-1" :value="modelValue" :required="required" :disabled="disabled" aria-hidden="true" />

    <section v-if="open" :id="`${id}-calendar`" ref="panel" class="modern-date-field__panel" :class="{ 'modern-date-field__panel--floating': responsive, 'modern-date-field__panel--touch': responsive && mobile }" :style="responsive ? panelStyle : undefined" role="dialog" :aria-label="`${label} calendar`">
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
.modern-date-field{position:relative;display:grid;min-width:0;gap:6px;color:var(--theme-muted,#475569);font-size:.8rem;font-weight:700}
.modern-date-field>label{font:inherit}
.modern-date-field__trigger{display:flex;align-items:center;justify-content:space-between;gap:12px;box-sizing:border-box;width:100%;min-height:44px;border:1px solid var(--theme-line,#cfd8e6);border-radius:10px;padding:9px 12px;background:var(--theme-surface,#fff);color:var(--theme-ink,#172033);font:inherit;text-align:left;cursor:pointer;transition:border-color .16s ease,box-shadow .16s ease}
.modern-date-field__trigger:hover,.modern-date-field__trigger:focus-visible{border-color:#7798d0;box-shadow:0 0 0 3px rgba(35,73,230,.1);outline:0}
.modern-date-field--disabled{color:var(--theme-muted,#8290a3)}
.modern-date-field--disabled .modern-date-field__trigger{border-color:var(--theme-line,#d6deea);background:var(--theme-soft,#e9eef5);color:var(--theme-muted,#8290a3);cursor:not-allowed;box-shadow:none}
.modern-date-field--disabled .modern-date-field__trigger svg{stroke:var(--theme-muted,#91a0b5)}
.modern-date-field__trigger .placeholder{color:var(--theme-muted,#8b97a8);font-weight:600}
.modern-date-field__trigger svg{width:19px;height:19px;fill:none;stroke:var(--theme-muted,#315173);stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.modern-date-field__native{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.modern-date-field__panel{position:absolute;z-index:30;top:calc(100% + 7px);left:0;width:300px;box-sizing:border-box;border:1px solid var(--theme-line,#cbd7e8);border-radius:14px;padding:12px;background:var(--theme-surface,#fff);box-shadow:0 18px 45px rgba(23,42,70,.2);font-family:Inter,system-ui,sans-serif}
.modern-date-field--end .modern-date-field__panel{right:0;left:auto}
.modern-date-field__panel.modern-date-field__panel--floating{position:fixed;right:auto;z-index:400;overflow-y:auto;overscroll-behavior:contain;margin:0}
.modern-date-field__panel header{display:grid;grid-template-columns:34px 1fr 34px;align-items:center;gap:6px;margin-bottom:10px}
.modern-date-field__panel header>div{display:grid;grid-template-columns:1.35fr .85fr;gap:6px}
.modern-date-field__panel--floating header>div{min-width:0;grid-template-columns:minmax(0,1.35fr) minmax(0,.85fr)}
.modern-date-field__panel--floating select{min-width:0;width:100%;padding:0 4px}
.modern-date-field__panel select,.modern-date-field__panel header button{min-height:34px;border:1px solid var(--theme-line,#dae2ee);border-radius:8px;background:var(--theme-soft,#f8faff);color:var(--theme-ink,#1e385b);font:inherit;font-weight:800}
.modern-date-field__panel header button{padding:0;font-size:1.25rem;cursor:pointer}
.modern-date-field__weekdays,.modern-date-field__days{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}
.modern-date-field__weekdays span{padding:5px 0;color:var(--theme-muted,#7b8798);font-size:.67rem;text-align:center;text-transform:uppercase}
.modern-date-field__days button{aspect-ratio:1;border:0;border-radius:8px;background:transparent;color:var(--theme-ink,#243b5a);font:inherit;font-size:.75rem;cursor:pointer}
.modern-date-field__days button:hover:not(:disabled){background:var(--theme-soft,#edf3ff);color:var(--theme-accent,#173fae)}
.modern-date-field__days button.outside{color:var(--theme-muted,#a9b2bf)}
.modern-date-field__days button.today{box-shadow:inset 0 0 0 1px #7192ce;color:var(--theme-accent,#2349e6)}
.modern-date-field__days button.selected{background:#2349e6;color:#fff;box-shadow:none}
.modern-date-field__days button:disabled{color:#d1d6de;cursor:not-allowed}
.modern-date-field__panel footer{display:flex;justify-content:space-between;margin-top:10px;padding-top:9px;border-top:1px solid var(--theme-line,#edf1f6)}
.modern-date-field__panel footer button{border:0;background:transparent;color:var(--theme-accent,#2349e6);font:inherit;font-weight:800;cursor:pointer}
.modern-date-field__panel--touch header { grid-template-columns: 40px minmax(0,1fr) 40px; }
.modern-date-field__panel--touch header button,.modern-date-field__panel--touch select{min-height:40px}
.modern-date-field__panel--touch .modern-date-field__days button{aspect-ratio:auto;min-height:40px}
.modern-date-field__panel--touch footer button{min-height:44px;padding:8px}
@media(max-width:600px){.modern-date-field__panel,.modern-date-field--end .modern-date-field__panel{right:auto;left:0;width:min(300px,calc(100vw - 56px))}}
</style>
