<script setup lang="ts">
import { requestErrorMessage } from '~~/shared/utils/requestError'
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { defaultBillingProfile, normalizeBillingProfile } from '~~/shared/utils/billingProfile'

const props = defineProps<{ account: any; busy: boolean; error: string; editable: boolean }>()
const emit = defineEmits<{ (event: 'close'): void; (event: 'save', body: any): void }>()
const form = ref(JSON.parse(JSON.stringify(props.account.profile?.config || defaultBillingProfile())))
const enabled = computed(() => form.value.rules.filter((rule: any) => rule.enabled).length)
const validation = ref('')
function save() {
  if (props.busy || !props.editable) return
  try { const config = normalizeBillingProfile(form.value); validation.value = ''; emit('save', { agencyId: props.account.AgencyID, clientId: props.account.ClientID, revision: props.account.profile?.revision || 0, config }) }
  catch (error: any) { validation.value = requestErrorMessage(error, 'Please review the billing setup fields.') }
}
let overflow = ''
const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !props.busy) emit('close') }
onMounted(() => { overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; window.addEventListener('keydown', escape) })
onBeforeUnmount(() => { document.body.style.overflow = overflow; window.removeEventListener('keydown', escape) })
</script>

<template>
  <Teleport to="body"><div class="billing-setup-backdrop"><form class="billing-setup" role="dialog" aria-modal="true" aria-labelledby="billing-setup-title" @submit.prevent="save">
    <header><div><p class="eyebrow">CLIENT BILLING SETUP</p><h2 id="billing-setup-title">{{ account.ClientName }}</h2><p>{{ account.AgencyName }}</p></div><button type="button" class="close" aria-label="Close client billing setup" :disabled="busy" @click="emit('close')">&times;</button></header>
    <div class="setup-content"><p class="intro">Use finalized payroll quantities and this client's contract prices. This setup applies only to this agency and client; saved drafts retain their own settings.</p>
      <fieldset :disabled="busy || !editable"><section class="setup-basics">
        <label>Invoice scope<select v-model="form.mode"><option value="site">Separate bill per site</option><option value="client">Combine selected client sites</option></select></label>
        <label>Group invoice lines by<select v-model="form.layout"><option value="summary">Service item</option><option value="position">Service item and position</option><option value="site">Service item and site</option></select></label>
        <label>Statement title<input v-model.trim="form.title" maxlength="100"></label>
        <label>Hours per billing day<input v-model.number="form.hoursPerDay" type="number" min="0.01" max="24" step="0.01"><small>For retirement/uniform day equivalents.</small></label>
      </section>
      <div class="section-heading"><div><h3>What this client pays</h3><p>Enable the agreed charges and credits. Labels and units also control the printed bill.</p></div><span>{{ enabled }} enabled</span></div>
      <div class="rules-wrap"><table><thead><tr><th>Billable</th><th>Component / Invoice label</th><th>Unit</th><th>Hours per unit</th><th>Pricing</th><th>Contract rate</th></tr></thead><tbody>
        <tr v-for="rule in form.rules" :key="rule.code" :class="{inactive:!rule.enabled}"><td><button type="button" class="toggle" role="switch" :aria-label="`Bill ${rule.code}`" :aria-checked="rule.enabled" :class="{on:rule.enabled}" @click="rule.enabled=!rule.enabled"><span></span></button></td><td><label><small>{{ rule.code.replace(/([A-Z])/g,' $1').trim() }}</small><input v-model.trim="rule.label" maxlength="100" :aria-label="`${rule.code} invoice label`" :disabled="!rule.enabled"></label></td><td><select v-model="rule.unit" :disabled="!rule.enabled" :aria-label="`${rule.code} unit`" @change="rule.unit==='hour'&&(rule.divisor=1)"><option value="hour">Hours</option><option value="day">Days</option><option value="item">Units</option></select></td><td><input v-model.number="rule.divisor" type="number" min="0.01" max="744" step="0.01" :aria-label="`${rule.code} hours per unit`" :disabled="!rule.enabled||rule.unit==='hour'"></td><td><select v-model="rule.rateMode" :disabled="!rule.enabled" :aria-label="`${rule.code} pricing`"><option value="linked">Linked billing rate</option><option value="fixed">Contract rate</option></select></td><td><input v-if="rule.rateMode==='fixed'" v-model.number="rule.rate" type="number" min="0" max="999999.99" step="0.01" :aria-label="`${rule.code} contract rate`" :disabled="!rule.enabled"><span v-else class="linked-price">At source cutoff end</span></td></tr>
      </tbody></table></div>
      <p class="help">A linked hourly price is multiplied by Hours per unit when billing by day. Different prices stay on separate lines. Fixed contract prices are per selected unit.</p>
      <h3>Contract charges</h3><div class="fees-grid">
        <label>Retirement per day<input v-model.number="form.settings.retirementRate" type="number" min="0" step="0.01"></label>
        <label>Uniform per day<input v-model.number="form.settings.uniformRate" type="number" min="0" step="0.01"></label>
        <label>Administrative cost (%)<input v-model.number="form.settings.adminPercent" type="number" min="0" max="100" step="0.01"></label>
        <label>Administrative base<select v-model="form.settings.adminBase"><option value="service">Service subtotal</option><option value="serviceAndExtras">Service and additional charges</option></select></label>
        <label>VAT (%)<input v-model.number="form.settings.vatPercent" type="number" min="0" max="100" step="0.01"></label>
        <label>VAT base<select v-model="form.settings.vatBase"><option value="administrative">Administrative cost</option><option value="beforeTax">Total before VAT</option></select></label>
        <label>Withholding (%)<input v-model.number="form.settings.withholdingPercent" type="number" min="0" max="100" step="0.01"></label>
        <label>Withholding base<select v-model="form.settings.withholdingBase"><option value="administrative">Administrative cost</option><option value="beforeTax">Total before VAT</option></select></label>
      </div><label class="notes">Default billing notes<textarea v-model.trim="form.notes" maxlength="1000" rows="3"></textarea></label>
      </fieldset>
    </div>
    <footer><p v-if="error || validation" class="error" role="alert">{{ error || validation }}</p><div><button class="secondary" type="button" :disabled="busy" @click="emit('close')">Cancel</button><button v-if="editable" class="primary" :disabled="busy">{{ busy?'Saving...':'Save client setup' }}</button></div></footer>
  </form></div></Teleport>
</template>

<style scoped>
.billing-setup-backdrop{position:fixed;inset:0;z-index:2300;background:#10213b99;display:grid;place-items:center;padding:20px;color:var(--theme-ink,#19365f);font-family:Arial,sans-serif}.billing-setup{width:min(1100px,100%);max-height:94dvh;display:flex;flex-direction:column;background:var(--theme-surface,#fff);border:1px solid var(--theme-line,#dce5f2);border-radius:16px;box-shadow:0 24px 80px #0c1d3955;overflow:hidden}.billing-setup header{padding:22px 26px;display:flex;justify-content:space-between;border-bottom:1px solid var(--theme-line,#dce5f2)}.eyebrow{margin:0 0 6px;font-size:11px;letter-spacing:.08em;color:var(--theme-accent,#3265c8);font-weight:800}h2{font-size:24px;margin:0}header p:last-child{margin:6px 0 0;color:var(--theme-muted,#71829a);font-size:13px}.close{border:0;background:none;font-size:26px;color:var(--theme-muted,#536d8f);align-self:flex-start;cursor:pointer}.setup-content{padding:20px 26px;overflow:auto;min-height:0}.intro,.help{font-size:12px;line-height:1.6;color:var(--theme-muted,#6b7e98);margin:0 0 20px}fieldset{border:0;padding:0;margin:0;min-width:0}.setup-basics,.fees-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.fees-grid{grid-template-columns:repeat(4,minmax(0,1fr))}label{display:grid;gap:6px;font-size:12px;font-weight:700;color:var(--theme-muted,#526c8d)}input,select,textarea{box-sizing:border-box;width:100%;min-width:0;border:1px solid var(--theme-line,#cfdbea);border-radius:7px;background:var(--theme-surface,#fff);color:var(--theme-ink,#203a60);font:inherit;padding:9px 10px;min-height:38px}input:disabled,select:disabled{background:var(--theme-soft,#f5f7fa);color:var(--theme-muted,#8997a9)}small,.linked-price{font-size:10px;font-weight:400;color:var(--theme-muted,#7c8fa7)}h3{font-size:15px;margin:24px 0 12px}.section-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.section-heading p{font-size:12px;color:var(--theme-muted,#72849c);margin:0 0 12px}.section-heading>span{font-size:12px;color:var(--theme-accent,#42649a);white-space:nowrap}.rules-wrap{max-width:100%;overflow:auto;border:1px solid var(--theme-line,#dce5f2);border-radius:9px}table{width:100%;min-width:880px;border-collapse:collapse;font-size:12px}th{padding:10px;background:var(--theme-soft,#f5f8fc);text-align:left;color:var(--theme-muted,#6d809b);font-size:10px;text-transform:uppercase}td{padding:9px;border-top:1px solid var(--theme-line,#e7edf5)}td:nth-child(2){width:29%}td:nth-child(4){width:100px}td:last-child{width:130px}.inactive{background:var(--theme-surface,#fafbfd)}.toggle{box-sizing:border-box;width:34px;height:20px;min-height:0;border:0;border-radius:20px;padding:3px;background:#b6c4d6;cursor:pointer;display:flex;align-items:center}.toggle span{display:block;width:14px;height:14px;border-radius:50%;background:var(--theme-surface,#fff);transform:translateX(0);transition:transform .15s}.toggle.on{background:#278557}.toggle.on span{transform:translateX(14px)}.toggle:focus-visible{outline:3px solid #7ba8f1;outline-offset:3px}.help{margin-top:10px}.notes{margin-top:18px}footer{padding:16px 26px;display:flex;align-items:center;justify-content:flex-end;gap:16px;border-top:1px solid var(--theme-line,#dce5f2)}footer>div{display:flex;gap:8px}button.primary,button.secondary{border:1px solid var(--theme-line,#cad7ea);border-radius:8px;background:var(--theme-surface,white);color:var(--theme-accent,#28518d);font:inherit;font-size:12px;font-weight:700;min-height:40px;padding:9px 14px;cursor:pointer}button.primary{background:#2862d5;color:#fff;border-color:#2862d5}button:disabled{opacity:.5;cursor:default}.error{margin:0;flex:1;color:#b42318;font-size:12px;line-height:1.5}@media(max-width:700px){.billing-setup-backdrop{padding:8px}.billing-setup header,.setup-content,footer{padding:16px}.setup-basics,.fees-grid{grid-template-columns:1fr}footer{flex-wrap:wrap}footer>div{margin-left:auto}.billing-setup{max-height:calc(100dvh - 16px)}}
</style>
