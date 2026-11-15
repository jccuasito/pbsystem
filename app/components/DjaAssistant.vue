<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useAppTheme } from '~/composables/useAppTheme'
import DjaAssistantMark from './DjaAssistantMark.vue'
import { assistantPages, assistantSuggestions, assistantGuides, assistantCanView, assistantCanReadGuide, portalAssistantReply, type AssistantAccess, type AssistantReply } from '~~/shared/utils/djaAssistant'
import { requestErrorMessage } from '~~/shared/utils/requestError'

const props = defineProps<{ view: string; access: AssistantAccess; portal?: boolean }>()
const emit = defineEmits<{ navigate: [view: string] }>()
const isDark = useAppTheme()
const open = ref(false), prompt = ref(''), busy = ref(false), error = ref('')
const locale = ref<'auto' | 'en' | 'fil'>('auto')
const selectedGuide = ref(''), lastTopic = ref<string>()
const input = ref<HTMLInputElement>(), launcher = ref<HTMLButtonElement>(), transcript = ref<HTMLElement>()
const messages = ref<{ id: number; question: string; page: string; answer?: AssistantReply }[]>([])
let sequence = 0, generation = 0, controller: AbortController | undefined
const pageTitle = computed(() => assistantPages[props.portal ? 'employee-portal' : props.view]?.title || 'Dashboard')
const suggestions = computed(() => assistantSuggestions(props.portal ? 'employee-portal' : props.view, props.portal ? {portal:{canView:true}} : props.access, locale.value === 'fil' ? 'fil' : 'en'))
const guideOptions = computed(() => assistantGuides.filter(item => props.portal ? item.view === 'employee-portal' : assistantCanReadGuide(props.access,item)))
watch(() => props.view, () => { lastTopic.value = undefined; selectedGuide.value = '' })
async function show() { open.value = true; await nextTick(); input.value?.focus() }
async function close() { open.value = false; await nextTick(); launcher.value?.focus() }
async function scroll(messageId?: number) {
  await nextTick()
  const box = transcript.value
  if (!box) return
  const answer = messageId ? box.querySelector(`[data-message-id="${messageId}"] .dja-assistant__answer`) : null
  box.scrollTop = answer ? box.scrollTop + answer.getBoundingClientRect().top - box.getBoundingClientRect().top - 12 : box.scrollHeight
}
function clear() { generation++; controller?.abort(); messages.value = []; lastTopic.value = undefined; error.value = ''; busy.value = false; input.value?.focus() }
function showGuide(id: string) { const guide = guideOptions.value.find(item => item.id === id); if (guide) ask(guide.title[locale.value === 'fil' ? 'fil' : 'en'], id) }
function metric(answer: AssistantReply) {
  return answer.metric ? new Intl.NumberFormat('en-PH', answer.metric.format === 'php' ? { style: 'currency', currency: 'PHP' } : { maximumFractionDigits: 0 }).format(answer.metric.value) : ''
}
function timestamp(value: string) { return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) }
async function ask(question = prompt.value, guideId?: string) {
  question = question.trim()
  if (!question || question.length > 500 || busy.value) return
  error.value = ''; prompt.value = ''; busy.value = true
  const request = ++generation
  const requestView = props.view, requestLocale = locale.value
  const message = { id: ++sequence, question, page: pageTitle.value, answer: undefined as AssistantReply | undefined }
  messages.value = [...messages.value.slice(-19), message]
  controller = new AbortController()
  await scroll()
  try {
    const answer = props.portal ? portalAssistantReply(question, requestLocale, guideId, lastTopic.value) : await $fetch<AssistantReply>('/api/assistant/query', { method: 'POST', body: { prompt: question, view: requestView, locale: requestLocale, ...(guideId ? { guideId } : {}), ...(lastTopic.value ? { contextGuide: lastTopic.value } : {}) }, signal: controller.signal, timeout: 15000, retry: 0 })
    if (request !== generation) return
    const row = messages.value.find(item => item.id === message.id)
    if (row) row.answer = answer
    if (requestView === props.view) lastTopic.value = answer.topic
  } catch (cause) {
    if (request === generation) error.value = requestErrorMessage(cause, 'Unable to load an answer. Please try again.')
  } finally {
    if (request === generation) { busy.value = false; await scroll(messages.value.find(item => item.id === message.id)?.answer?.steps?.length ? message.id : undefined); input.value?.focus() }
  }
}
onBeforeUnmount(() => { generation++; controller?.abort() })
</script>

<template>
  <Teleport to="body">
    <div class="dja-assistant" :class="{ 'dja-assistant--dark': isDark }">
      <section v-if="open" id="dja-assistant-panel" class="dja-assistant__panel" role="dialog" aria-labelledby="dja-assistant-title" @keydown.esc.stop="close">
        <header class="dja-assistant__header">
          <div><h2 id="dja-assistant-title"><span class="dja-assistant__brand-mark"><DjaAssistantMark /></span> DJA Assistant <span>Beta</span></h2><p>{{ portal ? 'Employee portal guide' : 'System help & summaries' }} · English / Filipino</p></div>
          <button type="button" class="dja-assistant__icon" aria-label="Close DJA Assistant" @click="close">×</button>
        </header>
        <div class="dja-assistant__context"><span>On this page</span><strong>{{ pageTitle }}</strong></div>
        <div ref="transcript" class="dja-assistant__transcript" role="log" aria-live="polite" aria-relevant="additions text" :aria-busy="busy">
          <div v-if="!messages.length" class="dja-assistant__welcome"><h3>How can I help?</h3><p>{{ portal ? 'Ask how to view payslips, save a copy or use your portal account.' : 'Ask how to create an employee, import attendance, post payslips, prepare billing and more.' }} Puwedeng Tagalog o English.</p><p class="dja-assistant__note">{{ portal ? 'Portal instructions only. Company-wide data is not available here.' : 'Browse Help topics for every module. Data summaries use their stated scope, not current page filters.' }} I cannot change records.</p></div>
          <article v-for="message in messages" :key="message.id" :data-message-id="message.id" class="dja-assistant__message">
            <div class="dja-assistant__question"><small>You · {{ message.page }}</small><p>{{ message.question }}</p></div>
            <div v-if="message.answer" class="dja-assistant__answer">
              <span class="dja-assistant__avatar" aria-hidden="true"><DjaAssistantMark /></span>
              <div class="dja-assistant__reply">
                <small class="dja-assistant__sender">DJA Assistant</small>
                <div class="dja-assistant__bubble">
              <div v-if="message.answer.metric" class="dja-assistant__metric"><span>{{ message.answer.metric.label }}</span><strong>{{ metric(message.answer) }}</strong></div>
              <p v-if="message.answer.scope" class="dja-assistant__scope">{{ message.answer.scope }}</p>
              <h3 v-if="message.answer.heading" class="dja-assistant__guide-title">{{ message.answer.heading }}</h3>
              <p>{{ message.answer.text }}</p>
              <ol v-if="message.answer.steps?.length" class="dja-assistant__steps"><li v-for="(step,index) in message.answer.steps" :key="index">{{ step }}</li></ol>
              <div v-if="message.answer.related?.length" class="dja-assistant__related"><span>Related help</span><button v-for="topic in message.answer.related" :key="topic.id" type="button" :disabled="busy" @click="showGuide(topic.id)">{{ topic.label }}</button></div>
              <button v-if="message.answer.link" type="button" class="dja-assistant__link" @click="emit('navigate', message.answer.link.view); close()">Open {{ message.answer.link.label }} →</button>
                </div>
              <small class="dja-assistant__source">{{ message.answer.source || 'DJA helper' }} · {{ timestamp(message.answer.generatedAt) }} PHT</small>
              </div>
            </div>
          </article>
          <div v-if="busy" class="dja-assistant__pending" role="status"><span class="dja-assistant__avatar" aria-hidden="true"><DjaAssistantMark /></span><span class="dja-assistant__bubble dja-assistant__typing"><span class="dja-assistant__sr">DJA Assistant is typing…</span><span class="dja-assistant__typing-dots" aria-hidden="true"><span v-for="dot in 3" :key="dot" /></span></span></div>
          <p v-if="error" class="dja-assistant__error" role="alert">{{ error }} You can ask again.</p>
        </div>
        <div :key="view + locale" class="dja-assistant__suggestions" aria-label="Suggested questions"><button v-for="question in suggestions" :key="question" type="button" :disabled="busy" @click="ask(question)">{{ question }}</button></div>
        <footer class="dja-assistant__footer">
          <details class="dja-assistant__browse"><summary>Help topics · {{ portal ? 'Employee Portal' : 'All modules' }}</summary><div><label class="dja-assistant__sr" for="dja-assistant-guide">Help topic</label><select id="dja-assistant-guide" v-model="selectedGuide"><option value="">Choose a guide…</option><option v-for="guide in guideOptions" :key="guide.id" :value="guide.id">{{ assistantPages[guide.view].title }} — {{ guide.title[locale === 'fil' ? 'fil' : 'en'] }}</option></select><button type="button" :disabled="busy || !selectedGuide" @click="showGuide(selectedGuide)">Show steps</button></div></details>
          <div class="dja-assistant__options"><label>Reply language <select v-model="locale"><option value="auto">Auto</option><option value="en">English</option><option value="fil">Filipino</option></select></label><button type="button" @click="clear">Clear chat</button></div>
          <form class="dja-assistant__form" @submit.prevent="ask()"><label class="dja-assistant__sr" for="dja-assistant-question">Ask DJA Assistant</label><input id="dja-assistant-question" ref="input" v-model="prompt" maxlength="500" autocomplete="off" placeholder="Ask DJA Assistant…" :disabled="busy"><button type="submit" :disabled="busy || !prompt.trim()">Send</button></form>
          <small>{{ portal ? 'Portal guides' : 'Guides & supported summaries' }} · No chat history saved</small>
        </footer>
      </section>
      <button ref="launcher" type="button" class="dja-assistant__launcher" aria-label="Open DJA Assistant" aria-controls="dja-assistant-panel" :aria-expanded="open" @click="open ? close() : show()"><span class="dja-assistant__launcher-mark" aria-hidden="true"><DjaAssistantMark /></span><span v-if="!open" class="dja-assistant__tooltip" aria-hidden="true">Ask DJA Assistant</span></button>
    </div>
  </Teleport>
</template>

<style scoped>
.dja-assistant{--da-bg:var(--surface,#fff);--da-soft:var(--soft,#edf3ff);--da-ink:var(--ink,#132047);--da-muted:var(--muted,#66718b);--da-line:var(--line,#e5e9f1);--da-accent:var(--accent,#2363d6);--da-action:var(--action-bg,#2363d6);--da-navy:var(--navy,#142b5e);--da-question:var(--da-navy);position:fixed;right:24px;bottom:24px;z-index:80;font-family:'DM Sans',Inter,Arial,sans-serif;color:var(--da-ink);font-size:14px;line-height:1.5}
.dja-assistant--dark{--da-bg:var(--theme-surface,#15203a);--da-soft:var(--theme-soft,#1c2d49);--da-ink:var(--theme-ink,#eef3ff);--da-muted:var(--theme-muted,#aabbd3);--da-line:var(--theme-line,#344765);--da-accent:var(--theme-accent,#91baff);--da-question:var(--soft,#1a315c)}
.dja-assistant *{box-sizing:border-box}.dja-assistant button,.dja-assistant input,.dja-assistant select{font:inherit}.dja-assistant button{cursor:pointer}.dja-assistant button:disabled{cursor:default;opacity:.55}.dja-assistant :focus-visible{outline:3px solid #75a7ff;outline-offset:3px}
.dja-assistant__launcher{position:relative;display:grid;place-items:center;width:60px;height:60px;margin-left:auto;border:1px solid var(--da-action);border-radius:22px;padding:8px;background:linear-gradient(145deg,var(--da-action),var(--da-navy));color:#fff;box-shadow:0 6px 22px #001b4933,inset 0 1px 0 #ffffff38;transition:transform .18s ease,box-shadow .18s ease}
.dja-assistant__launcher-mark{display:flex;align-items:center;justify-content:center;width:42px;height:42px;line-height:0;pointer-events:none}.dja-assistant__launcher:hover{transform:translateY(-2px);box-shadow:0 9px 26px #001b4945,inset 0 1px 0 #ffffff38}.dja-assistant__launcher[aria-expanded="true"]{background:var(--da-navy)}
.dja-assistant__tooltip{position:absolute;right:calc(100% + 12px);top:50%;transform:translate(4px,-50%);padding:7px 11px;border:1px solid var(--da-line);border-radius:9px;background:var(--da-bg);color:var(--da-ink);box-shadow:0 4px 15px #001b491a;font-size:12px;white-space:nowrap;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .18s ease,transform .18s ease,visibility .18s ease}.dja-assistant__launcher:hover .dja-assistant__tooltip,.dja-assistant__launcher:focus-visible .dja-assistant__tooltip{opacity:1;visibility:visible;transform:translate(0,-50%)}
.dja-assistant__header h2 .dja-assistant__brand-mark{display:inline-flex;width:26px;height:26px;vertical-align:middle;margin-right:3px;padding:0;border:0;color:var(--da-accent)}
.dja-assistant__panel{display:flex;flex-direction:column;width:420px;height:min(730px,calc(100dvh - 115px));margin-bottom:12px;border:1px solid var(--da-line);border-radius:20px;background:var(--da-bg);box-shadow:0 16px 55px #00152f40;overflow:hidden}
.dja-assistant__header{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--da-line)}.dja-assistant__header h2{font:700 18px/1.4 'DM Sans',Inter,Arial,sans-serif;margin:0;color:var(--da-ink)}.dja-assistant__header h2 span{font-size:10px;vertical-align:middle;padding:3px 6px;border:1px solid var(--da-line);border-radius:5px;color:var(--da-muted)}.dja-assistant__header p{font-size:12px;margin:3px 0 0;color:var(--da-muted)}
.dja-assistant__icon{border:0;background:none;color:var(--da-muted);font-size:26px!important;width:36px;height:36px}.dja-assistant__context{padding:10px 20px;background:var(--da-soft);border-bottom:1px solid var(--da-line);display:flex;gap:10px;flex-wrap:wrap;font-size:12px}.dja-assistant__context span{color:var(--da-muted)}
.dja-assistant__transcript,.dja-assistant__suggestions{scrollbar-width:thin;scrollbar-color:var(--da-scroll-thumb) transparent;--da-scroll-thumb:#b4c5e2;--da-scroll-hover:#809bc6}.dja-assistant--dark .dja-assistant__transcript,.dja-assistant--dark .dja-assistant__suggestions{--da-scroll-thumb:#4c658b;--da-scroll-hover:#7697c6}.dja-assistant__transcript{scrollbar-gutter:stable}.dja-assistant__suggestions{overscroll-behavior-x:contain}
.dja-assistant__transcript::-webkit-scrollbar,.dja-assistant__suggestions::-webkit-scrollbar{width:8px;height:6px}.dja-assistant__transcript::-webkit-scrollbar-track,.dja-assistant__suggestions::-webkit-scrollbar-track{background:transparent}.dja-assistant__transcript::-webkit-scrollbar-thumb,.dja-assistant__suggestions::-webkit-scrollbar-thumb{background:var(--da-scroll-thumb);border:2px solid var(--da-bg);border-radius:12px}.dja-assistant__transcript::-webkit-scrollbar-thumb:hover,.dja-assistant__suggestions::-webkit-scrollbar-thumb:hover{background:var(--da-scroll-hover)}.dja-assistant__transcript::-webkit-scrollbar-button,.dja-assistant__suggestions::-webkit-scrollbar-button{display:none;width:0;height:0}.dja-assistant__transcript::-webkit-scrollbar-corner,.dja-assistant__suggestions::-webkit-scrollbar-corner{background:transparent}
.dja-assistant__transcript{min-height:0;flex:1;overflow:auto;overscroll-behavior:contain;padding:20px}.dja-assistant__welcome h3{font:700 21px/1.4 Inter,Arial,sans-serif;color:var(--da-ink);margin:8px 0}.dja-assistant p{margin:8px 0;overflow-wrap:anywhere}.dja-assistant__note{font-size:12px;color:var(--da-muted)}.dja-assistant__message+.dja-assistant__message{margin-top:20px}.dja-assistant__question{background:var(--da-question);border-radius:12px 12px 3px 12px;padding:12px 14px;margin:0 0 14px 25px}.dja-assistant small{color:var(--da-muted);font-size:11px}.dja-assistant__answer{padding:0 3px}.dja-assistant__metric{padding:12px 14px;margin-top:8px;background:var(--da-soft);border:1px solid var(--da-line);border-radius:10px}.dja-assistant__metric span{display:block;color:var(--da-muted);font-size:12px}.dja-assistant__metric strong{display:block;font-size:29px;line-height:1.4}.dja-assistant__scope{font-size:12px;color:var(--da-muted)}.dja-assistant__source{display:block;margin-top:12px}.dja-assistant__link{padding:7px 0;border:0;background:none;color:var(--da-accent);font-weight:600!important;text-align:left}.dja-assistant__pending{color:var(--da-muted)}.dja-assistant__error{padding:12px;border:1px solid #cb5967;border-radius:8px;color:var(--da-ink)}
.dja-assistant__guide-title{font:700 17px/1.4 Inter,Arial,sans-serif;color:var(--da-ink);margin:12px 0}.dja-assistant__steps{padding-left:22px;margin:12px 0}.dja-assistant__steps li{margin:0 0 12px;padding-left:3px;overflow-wrap:anywhere}.dja-assistant__steps li::marker{font-weight:700;color:var(--da-accent)}.dja-assistant__related{display:grid;gap:5px;margin-top:14px}.dja-assistant__related span{font-size:11px;color:var(--da-muted)}.dja-assistant__related button{padding:7px 10px;border:1px solid var(--da-line);border-radius:7px;color:var(--da-accent);background:var(--da-soft);text-align:left;font-size:12px}.dja-assistant__browse{margin-bottom:10px;color:var(--da-muted);font-size:12px}.dja-assistant__browse summary{cursor:pointer;padding:2px 0}.dja-assistant__browse>div{display:flex;gap:6px;margin-top:8px}.dja-assistant__browse select{min-width:0;width:100%;flex:1;color:var(--da-ink);background:var(--da-bg);border:1px solid var(--da-line);border-radius:6px;padding:8px}.dja-assistant__browse button{flex-shrink:0;color:var(--da-accent);background:var(--da-soft);border:1px solid var(--da-line);border-radius:6px;padding:8px}
.dja-assistant__suggestions{display:flex;gap:6px;overflow:auto;padding:10px 16px;border-top:1px solid var(--da-line);flex-shrink:0}.dja-assistant__suggestions button{flex-shrink:0;max-width:300px;border:1px solid var(--da-line);border-radius:15px;padding:6px 10px;color:var(--da-accent);background:var(--da-bg);font-size:12px;white-space:nowrap}.dja-assistant__footer{padding:12px 16px 15px;border-top:1px solid var(--da-line)}.dja-assistant__options{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;margin-bottom:10px}.dja-assistant__options label{color:var(--da-muted)}.dja-assistant__options select{border:1px solid var(--da-line);border-radius:5px;background:var(--da-bg);color:var(--da-ink);padding:3px;margin-left:4px}.dja-assistant__options button{border:0;background:none;color:var(--da-accent);padding:4px}.dja-assistant__form{display:flex;gap:8px;margin-bottom:6px}.dja-assistant__form input{min-width:0;flex:1;padding:11px;border:1px solid var(--da-line);border-radius:9px;background:var(--da-soft);color:var(--da-ink)}.dja-assistant__form input::placeholder{color:var(--da-muted)}.dja-assistant__form button{border:0;border-radius:9px;background:var(--da-action);color:#fff;padding:10px 14px;font-weight:600}.dja-assistant__sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.dja-assistant__question{width:fit-content;max-width:calc(100% - 40px);margin:0 0 18px auto;border-radius:17px 17px 4px 17px;background:var(--da-question);color:#fff}.dja-assistant__question small{color:#e0eaff}.dja-assistant__question p{margin:5px 0 0}
.dja-assistant__answer{display:grid;grid-template-columns:30px minmax(0,1fr);gap:9px;padding:0}.dja-assistant__avatar{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:30px;height:30px;padding:3px;border:1px solid var(--da-action);border-radius:11px;background:linear-gradient(145deg,var(--da-action),var(--da-navy));color:#fff}.dja-assistant__answer>.dja-assistant__avatar{margin-top:23px}.dja-assistant__reply{min-width:0}.dja-assistant__sender{display:block;margin:0 0 5px 3px;font-weight:600}.dja-assistant__bubble{min-width:0;padding:12px 14px;border:1px solid var(--da-line);border-radius:4px 17px 17px 17px;background:var(--da-soft);color:var(--da-ink);overflow-wrap:anywhere}.dja-assistant__bubble>p:first-child{margin-top:0}.dja-assistant__bubble>p:last-child{margin-bottom:0}.dja-assistant__bubble .dja-assistant__guide-title{margin-top:8px}.dja-assistant__bubble .dja-assistant__metric,.dja-assistant__bubble .dja-assistant__related button{background:var(--da-bg)}.dja-assistant__source{margin:7px 3px 0;font-size:10px!important}.dja-assistant__pending{display:flex;align-items:center;gap:9px;margin:12px 0}.dja-assistant__pending .dja-assistant__bubble{font-size:12px;color:var(--da-muted)}
@media(max-width:520px){.dja-assistant{right:12px;bottom:12px}.dja-assistant__panel{width:calc(100vw - 24px);height:min(730px,calc(100dvh - 94px));border-radius:16px}.dja-assistant__launcher{width:56px;height:56px;border-radius:20px;padding:7px}.dja-assistant__launcher-mark{width:40px;height:40px}.dja-assistant__header{padding:12px 16px}.dja-assistant__transcript{padding:16px}.dja-assistant__form input{font-size:16px}.dja-assistant__answer{grid-template-columns:26px minmax(0,1fr);gap:7px}.dja-assistant__avatar{width:26px;height:26px;border-radius:9px}.dja-assistant__bubble{padding:10px 11px}.dja-assistant__pending{gap:7px}}
.dja-assistant__typing{display:flex;align-items:center;min-height:42px;padding:12px 16px}.dja-assistant__typing-dots{display:flex;align-items:center;gap:5px;height:16px}.dja-assistant__typing-dots>span{width:6px;height:6px;border-radius:50%;background:var(--da-accent);opacity:.45;animation:dja-typing-dot 1.2s ease-in-out infinite}.dja-assistant__typing-dots>span:nth-child(2){animation-delay:.15s}.dja-assistant__typing-dots>span:nth-child(3){animation-delay:.3s}
@keyframes dja-typing-dot{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-3px);opacity:1}}
@media(prefers-reduced-motion:reduce){.dja-assistant__launcher,.dja-assistant__tooltip{transition:none}.dja-assistant__launcher:hover{transform:none}.dja-assistant__typing-dots>span{animation:none;opacity:.75}}
@media print{.dja-assistant{display:none!important}}
</style>
