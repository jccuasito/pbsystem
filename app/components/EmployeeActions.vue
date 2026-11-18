<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, ref } from 'vue'

const props = defineProps<{ employeeId: number; employeeName: string; inactive: boolean }>()
type Action = 'edit' | 'position' | 'history' | 'transfer' | 'deactivate' | 'delete'
const emit = defineEmits<{ action: [action: Action] }>()
const trigger = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const opened = ref(false)
const menuId = computed(() => `employee-actions-${props.employeeId}`)
const menuStyle = ref<Record<string, string>>({})
const theme = ref('light')
const actions = computed(() => [
  { key: 'position' as const, label: 'Change position / history', disabled: false },
  { key: 'history' as const, label: props.inactive ? 'Rehire employee' : 'Employment history', disabled: false },
  { key: 'transfer' as const, label: 'Transfer to another agency', disabled: props.inactive },
  { key: 'deactivate' as const, label: 'Deactivate / resign employee', disabled: props.inactive },
  { key: 'delete' as const, label: 'Delete permanently', disabled: false },
])

function entries() { return Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []) }
function detach() {
  document.removeEventListener('pointerdown', outside)
  document.removeEventListener('focusin', outside)
  window.removeEventListener('resize', dismiss)
  document.removeEventListener('scroll', onScroll, true)
}
function close(restoreFocus = false) {
  opened.value = false
  detach()
  if (restoreFocus) trigger.value?.focus()
}
function dismiss() { close() }
function outside(event: Event) {
  if (event.target instanceof Node && !menu.value?.contains(event.target) && !trigger.value?.contains(event.target)) close()
}
function onScroll(event: Event) {
  if (event.target instanceof Node && menu.value?.contains(event.target)) return
  close()
}
async function open(last = false) {
  if (opened.value || !trigger.value) return
  const anchor = trigger.value.getBoundingClientRect()
  theme.value = trigger.value.closest('[data-theme]')?.getAttribute('data-theme') || document.documentElement.dataset.theme || 'light'
  menuStyle.value = { visibility: 'hidden', width: `${Math.min(300, window.innerWidth - 24)}px`, maxHeight: `${window.innerHeight - 24}px` }
  opened.value = true
  await nextTick()
  if (!opened.value || !menu.value) return
  const box = menu.value.getBoundingClientRect()
  const below = anchor.bottom + 8
  const top = below + box.height <= window.innerHeight - 12 ? below : Math.max(12, anchor.top - box.height - 8)
  menuStyle.value = { ...menuStyle.value, visibility: 'visible', left: `${Math.max(12, Math.min(anchor.right - box.width, window.innerWidth - box.width - 12))}px`, top: `${top}px` }
  await nextTick()
  if (!opened.value) return
  const buttons = entries()
  buttons[last ? buttons.length - 1 : 0]?.focus({ preventScroll: true })
  document.addEventListener('pointerdown', outside)
  document.addEventListener('focusin', outside)
  window.addEventListener('resize', dismiss)
  document.addEventListener('scroll', onScroll, true)
}
function choose(action: Action) {
  close(true)
  emit('action', action)
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return }
  if (event.key === 'Tab') { close(true); return }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const buttons = entries(), current = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
  buttons[index]?.focus()
}
onDeactivated(dismiss)
onBeforeUnmount(dismiss)
</script>

<template>
  <div class="employee-actions">
    <button class="employee-actions__button" type="button" aria-label="Edit employee" @click="emit('action', 'edit')">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
      Edit
    </button>
    <button ref="trigger" class="employee-actions__button" type="button" aria-label="More employee actions" aria-haspopup="menu" :aria-expanded="opened" :aria-controls="menuId" @click="opened ? close(true) : open()" @keydown.down.prevent="open()" @keydown.up.prevent="open(true)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>
      More
    </button>
    <Teleport to="body">
      <div v-if="opened" :id="menuId" ref="menu" class="employee-actions-menu" role="menu" :aria-label="`Actions for ${employeeName}`" :data-theme="theme" :style="menuStyle" @keydown="onKeydown">
        <p class="employee-actions-menu__name">{{ employeeName }}</p>
        <button v-for="action in actions" :key="action.key" type="button" role="menuitem" :class="{ 'employee-actions-menu__delete': action.key === 'delete' }" :disabled="action.disabled" @click="choose(action.key)">{{ action.label }}</button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.employee-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 6px; }
.employee-actions .employee-actions__button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 40px; padding: 8px; border: 1px solid var(--theme-line,#cfd8e6); border-radius: 8px; background: var(--theme-surface,#fff); color: var(--theme-ink,#24415f); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.employee-actions__button svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.employee-actions__button:hover, .employee-actions__button[aria-expanded="true"] { background: var(--theme-soft,#eef3ff); border-color: var(--theme-accent,#5271a5); }
.employee-actions-menu { position: fixed; z-index: 350; overflow-y: auto; overscroll-behavior: contain; padding: 6px; border: 1px solid #dce3ee; border-radius: 12px; background: #fff; color: #24415f; box-shadow: 0 12px 36px rgba(15,23,42,.2); font-family: Inter,system-ui,sans-serif; }
.employee-actions-menu__name { margin: 0 0 4px; padding: 8px 10px; font-size: 12px; font-weight: 700; color: #637287; overflow-wrap: anywhere; }
.employee-actions-menu button { display: block; width: 100%; min-height: 44px; padding: 10px; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; font-size: 13px; font-weight: 600; line-height: 1.4; text-align: left; cursor: pointer; }
.employee-actions-menu button:hover:not(:disabled), .employee-actions-menu button:focus-visible { background: #eef3ff; outline: 2px solid #5271a5; outline-offset: -2px; }
.employee-actions-menu button:disabled { opacity: .45; cursor: not-allowed; }
.employee-actions-menu .employee-actions-menu__delete { margin-top: 5px; border-top: 1px solid #edf1f6; border-radius: 0 0 6px 6px; color: #b42318; }
.employee-actions-menu[data-theme="dark"] { background: #15203a; border-color: #3a4c6c; color: #c8d7ef; }
.employee-actions-menu[data-theme="dark"] .employee-actions-menu__name { color: #aab7d0; }
.employee-actions-menu[data-theme="dark"] button:hover:not(:disabled), .employee-actions-menu[data-theme="dark"] button:focus-visible { background: #294878; }
.employee-actions-menu[data-theme="dark"] .employee-actions-menu__delete { border-color: #3a4c6c; color: #fda4af; }
@media (max-width: 980px) { .employee-actions .employee-actions__button { min-height: 44px; padding: 10px 12px; font-size: 13px; } }
</style>
