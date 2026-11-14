<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'

type ImportResult = {
  imported?: number
  updated?: number
  skipped?: number
  blank?: number
  cleared?: number
  preservedEmployeeStatusDays?: number
  issues?: { row: number; reason: string }[]
}
const props = defineProps<{ result: ImportResult | null; fileName: string }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const titleId = useId(), descriptionId = useId()
const hasNotes = computed(() => Number(props.result?.skipped || 0) > 0 || Boolean(props.result?.issues?.length))
const missingShift = computed(() => props.result?.issues?.some(issue => /shift code/i.test(issue.reason)))
const metrics = computed(() => [
  { label: 'Added', count: props.result?.imported || 0 },
  { label: 'Updated', count: props.result?.updated || 0 },
  { label: 'Skipped', count: props.result?.skipped || 0 },
  { label: 'Blank rows', count: props.result?.blank || 0 },
])
watch([() => props.result, dialog], ([result, element]) => {
  if (!element) return
  if (result && !element.open) element.showModal()
  if (!result && element.open) element.close()
}, { flush: 'post' })
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="dtr-import-result" :aria-labelledby="titleId" :aria-describedby="descriptionId" @cancel.prevent="emit('close')">
      <template v-if="result">
        <header>
          <span class="result-label" :class="{ 'with-notes': hasNotes }">DTR Excel import</span>
          <button type="button" class="result-close" aria-label="Close import results" @click="emit('close')">×</button>
          <h2 :id="titleId">{{ hasNotes ? 'Import completed with notes' : 'Import completed' }}</h2>
          <p :id="descriptionId">{{ fileName }}</p>
        </header>
        <div class="result-content">
          <dl class="result-metrics">
            <div v-for="metric in metrics" :key="metric.label"><dt>{{ metric.label }}</dt><dd>{{ metric.count }}</dd></div>
          </dl>
          <div v-if="result.blank || result.cleared || result.preservedEmployeeStatusDays" class="result-info">
            <p v-if="result.blank">{{ result.blank }} incomplete biometric row{{ result.blank === 1 ? '' : 's' }} left blank. Review and correct missing punches manually in the DTR.</p>
            <p v-if="result.cleared">{{ result.cleared }} previous attendance row{{ result.cleared === 1 ? '' : 's' }} cleared by blank source rows.</p>
            <p v-if="result.preservedEmployeeStatusDays">{{ result.preservedEmployeeStatusDays }} HR-approved status day{{ result.preservedEmployeeStatusDays === 1 ? '' : 's' }} preserved.</p>
          </div>
          <section v-if="hasNotes" class="result-notes" aria-label="Import notes">
            <h3>Rows to review</h3>
            <p>Skipped rows were not imported. Check the notes below before re-importing those rows.</p>
            <ul v-if="result.issues?.length">
              <li v-for="(issue, index) in result.issues" :key="`${issue.row}-${index}`"><strong>Row {{ issue.row }}</strong><span>{{ issue.reason }}</span></li>
            </ul>
            <p v-else>Check employee matching, dates, and shift codes in the source file.</p>
            <p v-if="Number(result.skipped || 0) > (result.issues?.length || 0) && result.issues?.length" class="result-note-limit">Showing {{ result.issues.length }} of {{ result.skipped }} skipped rows.</p>
            <p v-if="missingShift" class="result-next-step">For a missing or inactive shift code, check its setup under the same agency, then re-import the affected rows.</p>
          </section>
        </div>
        <footer><button type="button" autofocus @click="emit('close')">Back to DTR</button></footer>
      </template>
    </dialog>
  </Teleport>
</template>

<style scoped>
.dtr-import-result{box-sizing:border-box;width:min(620px,calc(100vw - 32px));max-height:calc(100dvh - 32px);margin:auto;padding:0;overflow:auto;border:1px solid var(--theme-line,#dce5f1);border-radius:16px;background:var(--theme-surface,#fff);color:var(--theme-ink,#142f58);box-shadow:0 24px 70px #101b3440;font-family:'Plus Jakarta Sans','Inter',system-ui,sans-serif}
.dtr-import-result::backdrop{background:#0e1e3b80}
header{position:relative;padding:26px 28px 20px;border-bottom:1px solid var(--theme-line,#e3eaf4)}
.result-label{color:#16804b;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.result-label.with-notes{color:#996000}
h2{margin:10px 28px 8px 0;font-size:23px;line-height:1.35}header p{margin:0;color:var(--theme-muted,#64748b);font-size:13px;overflow-wrap:anywhere}
.result-close{position:absolute;top:15px;right:16px;width:34px;height:34px;border:0;border-radius:8px;background:transparent;color:var(--theme-muted,#53657d);font-size:25px;cursor:pointer}.result-close:hover{background:var(--theme-soft,#edf3fa)}
.result-content{padding:22px 28px}.result-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0}.result-metrics div{padding:13px 10px;border:1px solid var(--theme-line,#dce5f1);border-radius:10px;background:var(--theme-soft,#f7f9fc)}.result-metrics dt{color:var(--theme-muted,#64748b);font-size:12px}.result-metrics dd{margin:6px 0 0;font-size:23px;font-weight:800}
.result-info{margin-top:18px;padding:13px 15px;border-radius:10px;background:var(--theme-soft,#edf4ff);color:var(--theme-accent,#315782)}.result-info p{margin:0;font-size:13px;line-height:1.6}.result-info p+p{margin-top:8px}
.result-notes{margin-top:18px;padding:16px;border:1px solid #f0d59b;border-radius:10px;background:#fffbf2}.result-notes h3{margin:0;color:#85501a;font-size:15px}.result-notes p{margin:8px 0 0;color:#7c5c35;font-size:13px;line-height:1.6}.result-notes ul{margin:14px 0 0;padding:0;list-style:none}.result-notes li{display:grid;gap:5px;padding:11px 0;color:#733c1d;font-size:13px;line-height:1.6;overflow-wrap:anywhere}.result-notes li+li{border-top:1px solid #efdfbd}.result-notes li strong{font-size:12px}.result-notes .result-next-step{padding-top:12px;border-top:1px solid #efdfbd}.result-notes .result-note-limit{font-size:12px}
footer{position:sticky;bottom:0;display:flex;justify-content:flex-end;padding:16px 28px;border-top:1px solid var(--theme-line,#e3eaf4);background:var(--theme-surface,#fff)}footer button{min-height:44px;padding:10px 20px;border:1px solid #2867d8;border-radius:9px;background:#2867d8;color:#fff;font:inherit;font-size:14px;font-weight:700;cursor:pointer}.dtr-import-result button:focus-visible{outline:3px solid #92b7ff;outline-offset:2px}
@media(max-width:480px){header{padding:22px 18px 18px}h2{font-size:20px}.result-content{padding:18px}.result-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}footer{padding:14px 18px}footer button{width:100%}}

@media screen{
html[data-theme='dark'] .dtr-import-result .result-label{color:#77dfac}
html[data-theme='dark'] .dtr-import-result .result-label.with-notes{color:#ffd18b}
html[data-theme='dark'] .dtr-import-result .result-notes{background:#332a1c;border-color:#806237}
html[data-theme='dark'] .dtr-import-result .result-notes :is(h3,p,li){color:#f2d1a2}
html[data-theme='dark'] .dtr-import-result .result-notes :is(li+li,.result-next-step){border-color:#806237}
}
</style>
