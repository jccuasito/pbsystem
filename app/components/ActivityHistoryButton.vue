<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { activityScopes, activityActions, activitySubjectLabels, activityFieldLabel, historyScopeForView, type ActivityFeed, type ActivityItem } from '~~/shared/utils/activityHistory'
import { activityActionLabels, activitySentence } from '~/utils/activityPresentation'
import { lockBodyScroll } from '~/utils/bodyScrollLock'
import { requestErrorMessage } from '~~/shared/utils/requestError'

const props = defineProps<{ view: string; access: Record<string, { canView: boolean }> }>()
const open = ref(false), loading = ref(false), error = ref(''), scope = ref('all'), action = ref('')
const rows = ref<ActivityItem[]>([]), nextCursor = ref<string | null>(null), visibility = ref('Own'), expanded = ref<string | null>(null)
const period = ref<'recent' | 'archive'>('recent'), asOf = ref(''), cutoff = ref(''), trimmed = ref(false), failedMore = ref(false)
const trigger = ref<HTMLButtonElement>(), panel = ref<HTMLElement>(), scroll = ref<HTMLElement>()
const choices = computed(() => Object.entries(activityScopes).filter(([, value]) => value.module === 'settings' || props.access[value.module]?.canView))
const entries = computed(() => rows.value.map(item => ({ item, sentence: activitySentence(item) })))
let controller: AbortController | null = null, generation = 0, unlock: (() => void) | null = null

function timestamp(value: string, exact = false) { return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', ...(exact ? { second: '2-digit' as const } : {}) }).format(new Date(value)) + (exact ? ' PHT' : '') }
async function load(direction: 'refresh' | 'older' = 'refresh') {
  const append = direction === 'older'
  if (append && (loading.value || !nextCursor.value || !open.value)) return
  const version = ++generation
  controller?.abort(); controller = new AbortController(); loading.value = true; error.value = ''; failedMore.value = false
  const cursor = append ? nextCursor.value : null
  if (!append) { rows.value = []; nextCursor.value = null; asOf.value = ''; cutoff.value = ''; trimmed.value = false; expanded.value = null; scroll.value?.scrollTo(0, 0) }
  try {
    const feed = await $fetch<ActivityFeed>('/api/activity-history', { query: { scope: scope.value, period: period.value, ...(action.value ? { action: action.value } : {}), ...(cursor ? { before: cursor, asOf: asOf.value } : {}) }, signal: controller.signal, timeout: 15000, retry: 0 })
    if (!open.value || version !== generation) return
    const combined = append ? [...new Map([...rows.value, ...feed.items].map(item => [item.id, item])).values()] : feed.items
    const drop = Math.max(0, combined.length - 250)
    const anchor = drop ? scroll.value?.querySelectorAll('.activity-timeline > li')[drop] : null
    const oldTop = anchor?.getBoundingClientRect().top
    rows.value = combined.slice(drop); asOf.value = feed.asOf; cutoff.value = feed.cutoff
    nextCursor.value = feed.nextCursor; visibility.value = feed.visibility
    if (drop) {
      trimmed.value = true
      if (!rows.value.some(item => item.id === expanded.value)) expanded.value = null
      await nextTick()
      const newTop = scroll.value?.querySelector('.activity-timeline > li')?.getBoundingClientRect().top
      if (scroll.value && oldTop !== undefined && newTop !== undefined) scroll.value.scrollTop += newTop - oldTop
    }
  } catch (cause: any) { if (open.value && version === generation) {
    if ([401,403].includes(cause?.statusCode || cause?.response?.status)) { rows.value = []; nextCursor.value = null; expanded.value = null }
    failedMore.value = append
    error.value = requestErrorMessage(cause, 'Unable to load activity history.')
  } }
  finally { if (version === generation) loading.value = false }
}
function onScroll() {
  const element = scroll.value
  if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 160 && !loading.value && !error.value) void load('older')
}
function choosePeriod(value: 'recent' | 'archive') {
  if (period.value === value) return
  period.value = value; void load()
}
function retry() { void load(failedMore.value ? 'older' : 'refresh') }
async function show() {
  scope.value = historyScopeForView(props.view); action.value = ''; period.value = 'recent'; open.value = true
  unlock = lockBodyScroll(); await nextTick(); panel.value?.focus(); void load()
}
function close() {
  open.value = false; generation++; controller?.abort(); loading.value = false
  rows.value = []; expanded.value = null; unlock?.(); unlock = null; trigger.value?.focus()
}
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
  if (event.key !== 'Tab') return
  const nodes = [...(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),summary,[href],[tabindex="0"]') || [])]
  const first = nodes[0], last = nodes.at(-1)
  if (!first) { event.preventDefault(); return }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.value)) { event.preventDefault(); first.focus() }
}
watch(() => props.view, () => { if (open.value) close() })
onBeforeUnmount(() => { generation++; controller?.abort(); unlock?.() })
</script>

<template>
  <button ref="trigger" type="button" class="activity-trigger" aria-label="View activity history" title="Activity history for this page" aria-haspopup="dialog" :aria-expanded="open" @click="show">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2"/></svg>
  </button>
  <Teleport to="body">
    <div v-if="open" class="activity-backdrop" @click.self="close" @keydown="keyboard">
      <section ref="panel" class="activity-dialog" role="dialog" aria-modal="true" aria-labelledby="activity-title" tabindex="-1">
        <header class="activity-header">
          <div class="activity-heading"><span class="activity-eyebrow">WORKSPACE ACTIVITY</span><h2 id="activity-title">{{ period === 'archive' ? 'Activity archive' : 'Activity history' }}</h2><p>{{ period === 'archive' ? 'Activity older than 7 days.' : 'See who changed a record and when.' }}</p></div>
          <div class="activity-header-actions">
            <button type="button" class="activity-icon activity-archive" :aria-label="period === 'archive' ? 'Back to recent activity' : 'View archived activity'" :title="period === 'archive' ? 'Back to recent activity' : 'View archived activity'" @click="choosePeriod(period === 'archive' ? 'recent' : 'archive')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path v-if="period === 'archive'" d="M19 12H5m6-6-6 6 6 6"/><template v-else><path d="M3 4h18v4H3zM5 8v12h14V8M10 12h4"/></template></svg>
            </button>
            <button type="button" class="activity-icon" aria-label="Close activity history" @click="close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
          </div>
        </header>
        <div class="activity-filters">
          <label>Page<select aria-label="Page" v-model="scope" :disabled="loading" @change="load()"><option value="all">All pages</option><option v-for="[key, value] in choices" :key="key" :value="key">{{ value.label }}</option></select></label>
          <label>Action<select aria-label="Action" v-model="action" :disabled="loading" @change="load()"><option value="">All actions</option><option v-for="name in activityActions" :key="name" :value="name">{{ activityActionLabels[name] }}</option></select></label>
          <button type="button" class="activity-refresh" :disabled="loading" @click="load()">{{ loading ? 'Loading…' : 'Refresh' }}</button>
        </div>
        <div ref="scroll" class="activity-scroll" :aria-busy="loading" @scroll.passive="onScroll">
          <p v-if="period === 'archive'" class="activity-period-note">Older activity is kept here automatically. No history is deleted.</p>
          <p v-if="trimmed" class="activity-period-note">Viewing an older section. <button type="button" @click="load()">Back to latest</button></p>
          <p v-if="error" class="activity-error" role="alert">{{ error }} <button type="button" :disabled="loading" @click="retry">Try again</button></p>
          <p v-if="!rows.length && !error" class="activity-empty" role="status">{{ loading ? 'Loading recent activity…' : period === 'archive' ? 'No archived activity for these filters yet.' : 'No activity in the last 7 days. Try Archive for older records.' }}</p>
          <ol v-if="rows.length" class="activity-timeline">
            <li v-for="{ item, sentence } in entries" :key="item.id">
              <span class="activity-dot" :class="{ destructive: ['Delete','Remove'].includes(item.action) }" aria-hidden="true"></span>
              <article>
                <p class="activity-summary"><strong>{{ item.actorName }}</strong>{{ ' ' + sentence.text }}<strong v-if="sentence.target">{{ ' ' + sentence.target }}</strong>{{ /[.!?]$/.test(sentence.target || sentence.text) ? '' : '.' }}</p>
                <p v-if="sentence.note" class="activity-note" :class="{ pending: item.outcome === 'Accepted' }">{{ sentence.note }}</p>
                <div class="activity-meta"><span>{{ activityScopes[item.scope]?.label }}</span><time :datetime="item.at" :title="timestamp(item.at, true)">{{ timestamp(item.at) }}</time></div>
                <button type="button" class="activity-details-toggle" :aria-expanded="expanded === item.id" :aria-controls="'activity-detail-'+item.id" @click="expanded = expanded === item.id ? null : item.id">{{ expanded === item.id ? 'Hide details' : 'View details' }}</button>
                <div v-if="expanded === item.id" :id="'activity-detail-'+item.id" class="activity-details">
                  <p v-if="item.changedFields != null"><strong>What changed</strong>{{ item.changedFields.map(activityFieldLabel).join(', ') || 'No tracked details changed.' }}</p>
                  <p v-else-if="item.fields.length"><strong>Fields included in this request</strong>{{ item.fields.map(activityFieldLabel).join(', ') }}<small>These were submitted with the request; they may not all have changed.</small></p>
                  <p v-for="subject in item.subjects || []" :key="subject.kind+subject.id"><strong>{{ activitySubjectLabels[subject.kind] || 'Related record' }}</strong>{{ subject.label }}<template v-if="subject.previousLabel"><br>Previously named: {{ subject.previousLabel }}</template></p>
                  <p v-if="!item.subjects?.length" class="activity-note">The record name was not included in this entry.</p>
                  <p><strong>When</strong>{{ timestamp(item.at, true) }}</p>
                  <details class="activity-technical">
                    <summary>Technical references</summary>
                    <p><strong>Recorded action</strong>{{ item.operation }}</p>
                    <p><strong>Record IDs</strong>{{ item.references.join(' / ') || 'Page-level action' }}</p>
                    <p><strong>User role at the time</strong>{{ item.actorRole }}</p>
                    <p v-for="(count, name) in item.counts" :key="name"><strong>{{ name }}</strong>{{ count }}</p>
                  </details>
                  <small>Private field values and files are not shown.</small>
                </div>
              </article>
            </li>
          </ol>
          <div v-if="rows.length" class="activity-paging">
            <p role="status">{{ loading ? 'Loading more activity...' : nextCursor ? 'Scroll for more activity' : 'You have reached the end.' }}</p>
            <button v-if="nextCursor" type="button" class="activity-older" :disabled="loading" @click="load('older')">{{ loading ? 'Loading...' : 'Load more activity' }}</button>
          </div>
        </div>
        <footer class="activity-footer"><span>{{ visibility === 'Team' ? 'Showing team activity' : 'Showing your activity only' }}</span><button type="button" @click="close">Done</button></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.activity-trigger{width:var(--topbar-control-size,46px);height:var(--topbar-control-size,46px);display:grid;place-items:center;flex:none;padding:0;border:1px solid var(--line);border-radius:50%;background:var(--surface);color:var(--ink);cursor:pointer}.activity-trigger svg{width:var(--topbar-icon-size,22px);height:var(--topbar-icon-size,22px)}
.activity-backdrop{position:fixed;inset:0;z-index:4000;display:flex;align-items:center;justify-content:center;padding:20px;background:#09162c85;backdrop-filter:blur(5px);color:var(--ink);font-family:Inter,sans-serif}.activity-dialog{width:min(740px,100%);max-height:calc(100dvh - 40px);display:flex;flex-direction:column;overflow:hidden;background:var(--surface);border:1px solid var(--line);border-radius:22px;box-shadow:0 25px 90px #04112440;outline:none}.activity-dialog *{box-sizing:border-box}.activity-dialog button,.activity-dialog select{font:inherit}.activity-dialog button{cursor:pointer;transition:background .15s,color .15s}.activity-dialog button:disabled{opacity:.55;cursor:default}.activity-trigger:focus-visible,.activity-dialog button:focus-visible,.activity-dialog select:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.activity-trigger:hover{background:var(--soft)}
.activity-header{display:flex;justify-content:space-between;gap:16px;padding:24px 26px 20px;border-bottom:1px solid var(--line)}.activity-eyebrow{font-size:10px;font-weight:700;letter-spacing:.13em;color:var(--accent)}.activity-header h2{font-size:24px;line-height:1.4;margin:7px 0;color:var(--ink)}.activity-header p{margin:0;font-size:13px;color:var(--muted)}.activity-heading{min-width:0}.activity-header-actions{display:flex;gap:8px;flex:none;align-items:flex-start}.activity-icon svg{width:19px;height:19px}.activity-icon{display:grid;place-items:center;padding:0;width:36px;height:36px;flex:none;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--muted);font-size:24px!important}.activity-icon:hover{background:var(--soft)}
.activity-filters{display:flex;align-items:flex-end;gap:12px;padding:18px 26px;background:var(--paper);border-bottom:1px solid var(--line)}.activity-filters label{display:flex;flex:1;min-width:0;flex-direction:column;gap:7px;font-size:11px;font-weight:600;color:var(--muted)}.activity-filters label:first-child{flex:1.7}.activity-filters select{width:100%;min-width:0;height:40px;padding:0 10px;border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--ink);font-size:12px}.activity-refresh{height:40px;border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--accent);padding:0 12px;font-size:12px!important}.activity-refresh:hover{background:var(--soft)}
.activity-scroll{min-height:170px;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--line) transparent;padding:22px 26px;flex:1}.activity-empty{padding:45px 12px;margin:0;text-align:center;color:var(--muted);font-size:13px}.activity-timeline{list-style:none;padding:0;margin:0}.activity-timeline li{display:flex;gap:16px;position:relative;padding-bottom:24px}.activity-timeline li:not(:last-child):before{content:'';position:absolute;left:5px;top:16px;bottom:0;width:1px;background:var(--line)}.activity-dot{width:11px;height:11px;flex:none;border:3px solid var(--soft);border-radius:50%;background:var(--accent);margin-top:6px;z-index:1;box-sizing:content-box!important}.activity-dot.destructive{background:#d44b65}.activity-timeline article{flex:1;min-width:0}.activity-summary{font-size:13px;line-height:1.75;margin:0 0 8px;color:var(--ink);overflow-wrap:anywhere}.activity-summary strong{font-weight:650}.activity-note{font-size:11px;line-height:1.6;margin:0 0 8px;color:var(--muted)}.activity-note.pending{color:var(--accent)}.activity-meta{display:flex;align-items:center;gap:6px 14px;flex-wrap:wrap;color:var(--muted);font-size:11px;line-height:1.6}.activity-meta time{white-space:nowrap}.activity-details-toggle{background:none;border:0;color:var(--accent);font-size:11px!important;padding:10px 0 3px;min-height:32px}.activity-details{padding:12px 14px;margin-top:8px;border:1px solid var(--line);background:var(--paper);border-radius:10px;font-size:11px;line-height:1.8;overflow-wrap:anywhere}.activity-details p{margin:0 0 8px}.activity-details strong{display:block;color:var(--muted);font-size:10px}.activity-details small{display:block;color:var(--muted);font-size:10px}.activity-older{display:block;margin:2px auto 0;padding:10px 16px;border-radius:9px;border:1px solid var(--line);background:var(--surface);color:var(--accent);font-size:12px!important}.activity-older:hover{background:var(--soft)}.activity-error{padding:12px;background:#cc354018;border-radius:8px;font-size:12px;line-height:1.7}.activity-error button{border:0;background:none;color:var(--accent)}
.activity-footer{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px 26px;border-top:1px solid var(--line);background:var(--surface)}.activity-footer span{font-size:10px;color:var(--muted);line-height:1.7}.activity-footer button{padding:11px 23px;min-height:42px;border:0;border-radius:10px;background:var(--action-bg,#2363d6);color:white;font-weight:600;font-size:13px}.activity-footer button:hover{background:#1c53ba}
.activity-paging{display:flex;flex-direction:column;gap:8px;align-items:center}.activity-paging p{font-size:11px;color:var(--muted);margin:0}.activity-period-note{font-size:11px;line-height:1.7;color:var(--muted);margin:0 0 18px}.activity-period-note button{border:0;background:none;padding:4px;color:var(--accent)}
.activity-technical{border-top:1px solid var(--line);padding-top:9px;margin:10px 0}.activity-technical summary{cursor:pointer;color:var(--muted);font-size:11px;min-height:32px;display:list-item;list-style-position:inside}.activity-technical[open] summary{margin-bottom:8px}.activity-technical summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
@media(max-width:600px){.activity-backdrop{padding:12px}.activity-dialog{max-height:calc(100dvh - 24px);border-radius:17px}.activity-header{padding:20px 18px 16px;gap:10px}.activity-header-actions{gap:6px}.activity-icon{width:40px;height:40px}.activity-header h2{font-size:21px}.activity-filters{padding:14px 18px;flex-wrap:wrap;gap:10px}.activity-filters label:first-child{flex-basis:100%}.activity-filters label{flex:1}.activity-scroll{padding:20px 18px}.activity-footer{padding:14px 18px}.activity-details-toggle{min-height:40px}.activity-filters select{height:44px}.activity-trigger{width:var(--topbar-control-size,41px);height:var(--topbar-control-size,41px)}}
@media print{.activity-trigger,.activity-backdrop{display:none!important}}
@media(prefers-reduced-motion:reduce){.activity-dialog button{transition:none}}
</style>
