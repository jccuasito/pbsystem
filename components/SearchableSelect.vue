<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
type Option = { value: string | number; label: string; search?: string }
const props = withDefaults(defineProps<{ modelValue: string | number; options: Option[]; label: string; placeholder?: string; disabled?: boolean; required?: boolean; emptyText?: string }>(), { placeholder: 'Search or select', emptyText: 'No matching records.' })
const emit = defineEmits<{ 'update:modelValue': [value: string | number]; change: [value: string | number] }>()
const id = useId(), open = ref(false), query = ref(''), active = ref(0)
const selected = computed(() => props.options.find((option: Option) => String(option.value) === String(props.modelValue)))
const matches = computed(() => {
  const words = query.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return props.options.filter((option: Option) => words.every(word => `${option.label} ${option.search || ''}`.toLocaleLowerCase().includes(word)))
})
const visible = computed(() => matches.value.slice(0, 100))
function expand() { if (!props.disabled) { query.value = ''; active.value = 0; open.value = true } }
function changeQuery(event: Event) {
  query.value = (event.target as HTMLInputElement).value; active.value = 0; open.value = true
  if (props.modelValue !== '') { emit('update:modelValue', ''); emit('change', '') }
}
function choose(option: Option) { emit('update:modelValue', option.value); emit('change', option.value); open.value = false; query.value = '' }
async function move(direction: number) {
  if (!open.value) { expand(); return }
  active.value = Math.max(0, Math.min(visible.value.length - 1, active.value + direction))
  await nextTick(); document.getElementById(`${id}-option-${active.value}`)?.scrollIntoView({ block: 'nearest' })
}
function enter() { const option = visible.value[active.value]; if (open.value && option) choose(option); else expand() }
function leave(event: FocusEvent) { if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) open.value = false }
watch(() => props.disabled, value => { if (value) open.value = false })
watch(() => props.options, () => { active.value = 0 })
</script>

<template>
  <div class="searchable-select" @focusout="leave">
    <label :for="id">{{ label }}</label>
    <input :id="id" role="combobox" autocomplete="off" aria-autocomplete="list" :aria-expanded="open" :aria-controls="id+'-list'" :aria-activedescendant="open && visible[active] ? id+'-option-'+active : undefined" :aria-required="required" :required="required" :disabled="disabled" :placeholder="placeholder" :value="open ? query : selected?.label || ''" @focus="expand" @click="!open && expand()" @input="changeQuery" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.enter.prevent="enter" @keydown.esc.prevent.stop="open=false">
    <div v-if="open" class="searchable-select__menu">
      <ul :id="id+'-list'" role="listbox" :aria-label="label">
        <li v-for="(option, index) in visible" :id="id+'-option-'+index" :key="option.value" role="option" :aria-selected="String(option.value)===String(modelValue)" :class="{active: index===active}" @pointerdown.prevent @click="choose(option)">{{ option.label }}</li>
      </ul>
      <p v-if="!visible.length" role="status">{{ emptyText }}</p>
      <p v-else-if="matches.length > visible.length" role="status">Showing 100 of {{ matches.length }}. Type more to narrow the list.</p>
    </div>
  </div>
</template>

<style scoped>
.searchable-select{position:relative;min-width:0;font:inherit}
.searchable-select>label{display:block;margin-bottom:6px;font-size:.85rem;font-weight:700;color:#475569}
.searchable-select>input{box-sizing:border-box;width:100%;min-width:0;min-height:44px;border:1px solid #cfd8e6;border-radius:8px;padding:10px 12px;background:#fff;color:#172033;font:inherit}
.searchable-select>input:disabled{background:#f4f6fa;color:#768399;cursor:not-allowed}
.searchable-select__menu{position:absolute;z-index:10;left:0;right:0;max-height:240px;overflow-y:auto;border:1px solid #cfd8e6;border-radius:8px;background:#fff;box-shadow:0 8px 24px #17203320}
.searchable-select__menu ul{list-style:none;margin:0;padding:4px}
.searchable-select__menu li{padding:10px;border-radius:5px;cursor:pointer;line-height:1.4;overflow-wrap:anywhere;font-size:.875rem;color:#223a60}
.searchable-select__menu li.active,.searchable-select__menu li:hover{background:#edf3ff}
.searchable-select__menu li[aria-selected=true]{font-weight:700}
.searchable-select__menu p{padding:10px;margin:0;color:#64748b;font-size:.8rem}
</style>
