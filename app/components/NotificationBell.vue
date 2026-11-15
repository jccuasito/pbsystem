<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRealtimeRefresh } from '~/composables/useRealtimeRefresh'
import { useAppTheme } from '~/composables/useAppTheme'
import { requestErrorMessage } from '~~/shared/utils/requestError'
import { validNotificationTarget, type NotificationFeed, type SystemNotification, type NotificationTarget } from '~~/shared/utils/notifications'

const props=defineProps<{portal?:boolean}>()
const emit=defineEmits<{navigate:[target:NotificationTarget]}>()
const dark=useAppTheme(),open=ref(false),loading=ref(false),saving=ref(false),error=ref('')
const data=ref<NotificationFeed>({items:[],unreadCount:0,generatedAt:''})
const unreadOnly=ref(false),trigger=ref<HTMLButtonElement>(),panel=ref<HTMLElement>(),root=ref<HTMLElement>()
const endpoint=computed(()=>props.portal?'/api/employee-portal/notifications':'/api/notifications')
const items=computed(()=>data.value.items.filter(item=>!unreadOnly.value||!item.read))
let pending:Promise<void>|null=null,controller:AbortController|null=null,disposed=false
function timestamp(value:string|null){if(!value)return 'Current alert';return new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value))+' PHT'}
function close(restoreFocus=true){open.value=false;if(restoreFocus)trigger.value?.focus()}
async function toggle(){if(open.value){close();return}open.value=true;await nextTick();panel.value?.focus();void refresh().catch(()=>{})}
async function refresh(){
  if(disposed)return
  if(pending)return pending
  loading.value=true;controller=new AbortController()
  pending=(async()=>{
    try{const result=await $fetch<NotificationFeed>(endpoint.value,{signal:controller!.signal,timeout:15000,retry:0});if(!disposed){data.value=result;error.value=''}}
    catch(cause:any){if(!disposed){if([401,403].includes(cause?.statusCode||cause?.response?.status))data.value={items:[],unreadCount:0,generatedAt:''};error.value=requestErrorMessage(cause,'Unable to load notifications. Please try again.')}throw cause}
    finally{if(!disposed)loading.value=false;pending=null}
  })()
  return pending
}
async function mark(rows:SystemNotification[]){
  if(saving.value||!rows.length)return false
  saving.value=true;error.value=''
  try{
    // Finish any older refresh before marking these exact revisions as read.
    if(pending)await pending
    await $fetch(endpoint.value+'/read',{method:'POST',body:{items:rows.map(({key,revision})=>({key,revision}))},retry:0,timeout:15000})
    const read=new Map(rows.map(item=>[item.key,item.revision]))
    data.value.items=data.value.items.map(item=>read.get(item.key)===item.revision?{...item,read:true}:item)
    data.value.unreadCount=data.value.items.filter(item=>!item.read).length
    return true
  }catch(cause:any){error.value=requestErrorMessage(cause,'Unable to mark notifications as read.');if((cause?.statusCode||cause?.response?.status)===409)void refresh().catch(()=>{});return false}
  finally{saving.value=false}
}
async function visit(item:SystemNotification){
  if(!validNotificationTarget(item.target,props.portal))return
  if(!item.read&&!(await mark([item])))return
  close(false);emit('navigate',item.target)
}
function outside(event:PointerEvent){if(open.value&&!root.value?.contains(event.target as Node))close(false)}
function keyboard(event:KeyboardEvent){if(open.value&&event.key==='Escape'){event.preventDefault();close()}}
onMounted(()=>{document.addEventListener('pointerdown',outside);document.addEventListener('keydown',keyboard);void refresh().catch(()=>{})})
useRealtimeRefresh(()=>saving.value?undefined:refresh(),{intervalMs:60000,shouldRefresh:()=>!saving.value})
onBeforeUnmount(()=>{disposed=true;controller?.abort();document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',keyboard)})
</script>

<template>
  <div ref="root" class="notification-bell" :class="{'notification-bell--dark':dark}">
    <button ref="trigger" type="button" class="notification-trigger" aria-label="Notifications" :aria-expanded="open" aria-haspopup="dialog" :disabled="saving" @click="toggle">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5Z"/><path d="M10 19a2 2 0 0 0 4 0"/></svg>
      <span v-if="data.unreadCount" class="notification-count" aria-live="polite">{{data.unreadCount>99?'99+':data.unreadCount}}<span class="sr-only"> unread notifications</span></span>
    </button>
    <section v-if="open" ref="panel" class="notification-panel" role="dialog" aria-label="Notifications" tabindex="-1" :aria-busy="loading||saving">
      <header><div><h2>Notifications</h2><p>{{portal?'Your payslips and HR responses':'Updates that need your attention'}}</p></div><button type="button" class="icon" aria-label="Close notifications" @click="close">×</button></header>
      <div class="notification-toolbar"><div role="group" aria-label="Filter notifications"><button type="button" :aria-pressed="!unreadOnly" @click="unreadOnly=false">All</button><button type="button" :aria-pressed="unreadOnly" @click="unreadOnly=true">Unread <span>{{data.unreadCount}}</span></button></div><button type="button" class="mark-all" :disabled="saving||loading||!data.unreadCount" @click="mark(data.items.filter(item=>!item.read))">Mark all as read</button></div>
      <p v-if="error" class="notification-error" role="alert">{{error}} <button type="button" :disabled="loading||saving" @click="refresh().catch(()=>{})">Retry</button></p>
      <div class="notification-list">
        <p v-if="loading&&!data.generatedAt" class="notification-empty" role="status">Loading notifications…</p>
        <p v-else-if="!items.length&&!error" class="notification-empty">{{unreadOnly?'You have no unread notifications.':'You are all caught up. No current notifications.'}}</p>
        <article v-for="item in items" :key="item.key" :class="{'is-unread':!item.read}">
          <span class="notification-symbol" :class="item.severity" aria-hidden="true">{{item.severity==='danger'?'!':item.kind==='document-expiry'?'◷':'•'}}</span>
          <div class="notification-copy"><button type="button" class="notification-link" :disabled="saving" @click="visit(item)"><strong>{{item.title}}</strong><span>{{item.message}}</span></button><footer><time :datetime="item.updatedAt||undefined">{{timestamp(item.updatedAt)}}</time><button v-if="!item.read" type="button" :disabled="saving||loading" @click="mark([item])">Mark as read</button><span v-else class="read-label">Read</span></footer></div>
        </article>
      </div>
      <div class="notification-bottom"><span>{{portal?'Only your account is shown.':'Recent DTR/payroll/payslip alerts cover the last 90 days.'}}</span><button type="button" :disabled="loading||saving" @click="refresh().catch(()=>{})">{{loading?'Refreshing…':'Refresh'}}</button></div>
    </section>
  </div>
</template>

<style scoped>
.notification-bell{--notice-surface:#fff;--notice-soft:#f1f5ff;--notice-ink:#172c55;--notice-muted:#63799d;--notice-line:#dce5f4;--notice-blue:#2463da;position:relative;display:inline-flex;font:inherit;color:var(--notice-ink)}
.notification-bell--dark{--notice-surface:#15203a;--notice-soft:#1d2e4a;--notice-ink:#eef3ff;--notice-muted:#aabbd7;--notice-line:#344663;--notice-blue:#92baff}
.notification-trigger{position:relative;width:46px;height:46px;display:grid;place-items:center;border:1px solid var(--notice-line);border-radius:50%;background:var(--notice-surface);color:var(--notice-ink);cursor:pointer}.notification-trigger svg{width:22px;height:22px}.notification-count{position:absolute;top:-3px;right:-4px;min-width:19px;height:19px;padding:0 4px;border-radius:20px;display:grid;place-items:center;background:#d5354c;color:#fff;font-size:10px;font-weight:800;border:2px solid var(--notice-surface)}
.notification-panel{position:absolute;z-index:210;right:0;top:calc(100% + 13px);width:min(430px,calc(100vw - 24px));max-height:min(680px,calc(100dvh - 105px));display:flex;flex-direction:column;background:var(--notice-surface);border:1px solid var(--notice-line);border-radius:18px;box-shadow:0 18px 60px #0d20452b;overflow:hidden;outline:none}.notification-panel *{box-sizing:border-box}.notification-panel header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:20px 20px 15px}.notification-panel h2{margin:0;font-size:1.15rem;line-height:1.4;color:var(--notice-ink)}.notification-panel header p{font-size:.75rem;margin:5px 0 0;color:var(--notice-muted)}.notification-panel button{font:inherit;cursor:pointer}.notification-panel button:disabled{cursor:default;opacity:.5}.notification-panel button:focus-visible,.notification-trigger:focus-visible{outline:3px solid #81aafd;outline-offset:2px}.notification-panel .icon{border:0;background:none;color:var(--notice-muted);font-size:1.5rem;padding:0 4px;line-height:1}
.notification-toolbar{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:0 16px 13px;border-bottom:1px solid var(--notice-line);flex-wrap:wrap}.notification-toolbar>div{display:flex;gap:5px}.notification-toolbar button{border:0;background:none;font-size:.72rem;padding:8px 10px;border-radius:7px;color:var(--notice-muted)}.notification-toolbar button[aria-pressed=true]{background:var(--notice-soft);color:var(--notice-blue);font-weight:700}.notification-toolbar .mark-all{color:var(--notice-blue);padding-right:0}.notification-toolbar span{margin-left:3px}.notification-list{overflow:auto;overscroll-behavior:contain;min-height:70px;scrollbar-width:thin;scrollbar-color:#a7bcdf transparent}.notification-list article{display:flex;gap:12px;padding:17px 18px;border-bottom:1px solid var(--notice-line)}.notification-list article.is-unread{background:var(--notice-soft)}.notification-symbol{flex:0 0 31px;height:31px;display:grid;place-items:center;border-radius:10px;background:#dbe9ff;color:#2563cf;font-size:1.25rem;font-weight:800}.notification-symbol.warning{background:#fff0ce;color:#9a6200}.notification-symbol.danger{background:#ffe0e4;color:#b32843}.notification-copy{min-width:0;flex:1}.notification-link{display:grid;gap:7px;width:100%;padding:0;text-align:left;border:0;background:none;color:var(--notice-ink)}.notification-link strong{font-size:.81rem;line-height:1.5}.notification-link>span{font-size:.75rem;line-height:1.65;color:var(--notice-muted);overflow-wrap:anywhere}.notification-copy footer{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-top:11px;font-size:.63rem;color:var(--notice-muted)}.notification-copy footer button{padding:3px 0;border:0;background:none;color:var(--notice-blue);font-size:inherit}.read-label{opacity:.8}.notification-empty{padding:35px 23px;text-align:center;color:var(--notice-muted);font-size:.81rem;line-height:1.7;margin:0}.notification-error{margin:12px 16px;padding:11px;border:1px solid #d67c8c;border-radius:8px;font-size:.75rem;line-height:1.6;color:var(--notice-ink)}.notification-error button{border:0;background:none;color:var(--notice-blue);font-size:inherit}.notification-bottom{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:11px 16px;color:var(--notice-muted);font-size:.61rem;line-height:1.6;border-top:1px solid var(--notice-line)}.notification-bottom button{border:0;background:none;color:var(--notice-blue);font-size:.7rem;padding:4px 0}.sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:700px){.notification-trigger{width:41px;height:41px}.notification-panel{position:fixed;top:86px;right:12px;left:12px;width:auto;max-height:calc(100dvh - 104px)}.notification-toolbar button{min-height:38px}.notification-copy footer button{min-height:30px}.notification-link strong{font-size:.85rem}}
@media print{.notification-bell{display:none!important}}
</style>
