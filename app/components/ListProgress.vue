<script setup lang="ts">
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{ shown: number; total: number; hasMore: boolean; unit?: string; loading?: boolean; error?: string; paused?: boolean }>(), { unit: 'records', loading: false, error: '', paused: false })
const emit = defineEmits<{ 'load-more': [] }>()
const sentinel = ref<HTMLButtonElement | null>(null)
let observer: IntersectionObserver | undefined
let active = true
function loadMore() { if (active && props.hasMore && !props.loading && !props.paused) emit('load-more') }
function observe() {
  observer?.disconnect()
  if (active && sentinel.value && props.hasMore && !props.loading && !props.error && !props.paused) observer?.observe(sentinel.value)
}
function stop() { active = false; observer?.disconnect() }
watch([sentinel, () => props.shown, () => props.hasMore, () => props.loading, () => props.error, () => props.paused], observe, { flush: 'post' })
onMounted(() => {
  if (typeof IntersectionObserver !== 'undefined') observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) loadMore()
  }, { rootMargin: '400px 0px' })
  observe()
})
onActivated(() => { active = true; observe() })
onDeactivated(stop)
onBeforeUnmount(stop)
</script>

<template>
  <div v-if="total || loading || error" class="list-progress">
    <span role="status">Showing <strong>{{ shown }}</strong> of <strong>{{ total }}</strong> {{ unit }}</span>
    <div class="list-progress__actions">
      <span v-if="error" class="list-progress__error" role="alert">{{ error }}</span>
      <button v-if="hasMore" ref="sentinel" type="button" class="list-progress__button" :disabled="loading || paused" @click="loadMore">
        {{ loading ? 'Loading more…' : error ? 'Retry loading' : 'Load more' }}
      </button>
      <span v-else-if="!loading">All {{ unit }} displayed</span>
    </div>
  </div>
</template>

<style scoped>
.list-progress { display:flex;align-items:center;justify-content:space-between;gap:12px;margin:16px 0;color:var(--theme-muted,var(--muted,#657792));font:inherit;font-size:.76rem; }
.list-progress__actions { display:flex;align-items:center;justify-content:flex-end;gap:12px; }
.list-progress .list-progress__button { min-height:42px;padding:9px 14px;border:1px solid var(--theme-line,var(--line,#cbd8ea));border-radius:9px;background:var(--theme-surface,var(--surface,#fff));color:var(--theme-accent,var(--accent,#2864d7));font:inherit;font-weight:650;cursor:pointer; }
.list-progress__button:disabled { opacity:.55;cursor:default; }
.list-progress__error { max-width:380px;color:var(--theme-danger,#b42318); }
@media(hover:hover) and (pointer:fine) { .list-progress__button:enabled:hover { border-color:var(--theme-accent,var(--accent,#2864d7));background:var(--theme-soft,var(--soft,#edf3ff)); } }
@media(max-width:600px) { .list-progress,.list-progress__actions { align-items:stretch;flex-direction:column; }.list-progress__button { width:100%; } }
@media print { .list-progress { display:none!important; } }
</style>
