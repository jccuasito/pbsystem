<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { payrollHourComponents, payrollTimeDeductions } from '~~/shared/utils/payrollPreview'

type Result = { cutoffs: { start: string; end: string }[]; selectedCutoff: { start: string; end: string } | null; sites: any[] }
const data = ref<Result>({ cutoffs: [], selectedCutoff: null, sites: [] })
const loading = ref(false)
const error = ref('')
const cutoff = ref('')
const search = ref('')
const agency = ref('')
const client = ref('')
const expanded = ref<number | null>(null)
const money = (value: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value || 0)
const day = (value: string) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const range = (start: string, end: string) => `${day(start)} – ${day(end)}`
const agencies = computed(() => [...new Map(data.value.sites.map(site => [site.AgencyID, site.AgencyName])).entries()])
const clients = computed(() => [...new Map(data.value.sites.filter(site => !agency.value || String(site.AgencyID) === agency.value).map(site => [site.ClientID, site.ClientName])).entries()])
const visible = computed(() => data.value.sites.filter(site =>
  (!agency.value || String(site.AgencyID) === agency.value) &&
  (!client.value || String(site.ClientID) === client.value) &&
  (!search.value.trim() || `${site.SiteName} ${site.ClientName} ${site.AgencyName} ${site.BatchID} ${site.employees.map((employee: any) => employee.EmployeeName).join(' ')}`.toLowerCase().includes(search.value.trim().toLowerCase()))
))
const totals = computed(() => visible.value.reduce((sum, site) => ({ people: sum.people + site.peopleCount, gross: sum.gross + site.gross, deductions: sum.deductions + site.deductions, net: sum.net + site.netPreview }), { people: 0, gross: 0, deductions: 0, net: 0 }))
const orderedComponents = [...payrollHourComponents, ...payrollTimeDeductions]
function siteComponents(site: any) {
  return orderedComponents.map(([code, , label]) => ({ code, label,
    hours: site.employees.reduce((sum: number, employee: any) => sum + Number(employee.components.find((line: any) => line.code === code)?.hours || 0), 0),
    amount: site.employees.reduce((sum: number, employee: any) => sum + Number(employee.components.find((line: any) => line.code === code)?.amount || 0), 0),
  })).filter(line => line.hours)
}
async function load() {
  loading.value = true; error.value = ''
  try {
    const [periodStart, periodEnd] = cutoff.value.split(':')
    const result = await $fetch<Result>('/api/payroll/processing', { query: periodStart && periodEnd ? { periodStart, periodEnd } : {} })
    data.value = result
    if (!cutoff.value && result.selectedCutoff) cutoff.value = `${result.selectedCutoff.start}:${result.selectedCutoff.end}`
    expanded.value = null
  } catch (caught: any) { error.value = caught?.data?.statusMessage || caught?.message || 'Unable to load payroll processing.' }
  finally { loading.value = false }
}
onMounted(load)
</script>

<template>
  <section class="processing-page">
    <header class="processing-heading">
      <div><p class="eyebrow">PAYROLL</p><h1>Payroll Processing</h1><p>Review computed DTR hours, rate amounts, and employee deductions by site.</p></div>
      <button class="refresh" type="button" :disabled="loading" @click="load">{{ loading ? 'Loading…' : 'Refresh' }}</button>
    </header>
    <div class="notice">Review preview only. No payroll or loan transaction is posted here. Amounts follow the rate effective on each attendance date; installments use current balances. Allowances, payroll adjustments, and statutory deductions are not yet included in net preview.</div>
    <div class="processing-filters">
      <label class="search-field">Search site or employee<input v-model="search" placeholder="Search site, client, DTR, or employee"></label>
      <label>Agency<select v-model="agency" @change="client=''">
        <option value="">All agencies</option><option v-for="[id, name] in agencies" :key="id" :value="String(id)">{{ name }}</option>
      </select></label>
      <label>Client<select v-model="client"><option value="">All clients</option><option v-for="[id, name] in clients" :key="id" :value="String(id)">{{ name }}</option></select></label>
      <label>Cutoff<select v-model="cutoff" @change="load"><option value="">Latest computed cutoff</option><option v-for="item in data.cutoffs" :key="item.start+item.end" :value="`${item.start}:${item.end}`">{{ range(item.start, item.end) }}</option></select></label>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p class="count">Showing {{ visible.length }} of {{ data.sites.length }} computed site DTRs<span v-if="data.selectedCutoff"> · {{ range(data.selectedCutoff.start, data.selectedCutoff.end) }}</span></p>
    <div v-if="visible.length" class="summary-strip">
      <div><span>Employees</span><strong>{{ totals.people }}</strong></div><div><span>Gross preview</span><strong>{{ money(totals.gross) }}</strong></div>
      <div><span>Deductions preview</span><strong>{{ money(totals.deductions) }}</strong></div><div><span>Net preview</span><strong>{{ money(totals.net) }}</strong></div>
    </div>
    <div class="processing-table-wrap"><table class="processing-table">
      <thead><tr><th>Site / Client</th><th>Agency / DTR</th><th>People</th><th>Gross</th><th>Deductions</th><th>Net preview</th><th>Actions</th></tr></thead>
      <tbody>
        <template v-for="site in visible" :key="site.BatchID">
          <tr><td><strong>{{ site.SiteName }}</strong><small>{{ site.ClientName }}</small></td><td><strong>{{ site.AgencyName }}</strong><small>DTR-{{ String(site.BatchID).padStart(4, '0') }}</small></td>
            <td>{{ site.peopleCount }}</td><td>{{ money(site.gross) }}</td><td>{{ money(site.deductions) }}</td><td><strong>{{ money(site.netPreview) }}</strong></td>
            <td><button class="details-button" type="button" :aria-expanded="expanded===site.BatchID" @click="expanded=expanded===site.BatchID?null:site.BatchID">{{ expanded===site.BatchID?'Hide details':'View details' }}</button></td></tr>
          <tr v-if="expanded===site.BatchID" class="details-row"><td colspan="7"><div class="details-panel">
            <div v-if="site.warningCount" class="warning">{{ site.warningCount }} pricing note{{ site.warningCount===1?'':'s' }} need review before payroll approval.</div>
            <div class="section-title"><div><p class="eyebrow">SITE TOTALS</p><h2>Hours and rate amounts</h2></div><span>{{ range(site.PeriodStart, site.PeriodEnd) }}</span></div>
            <div class="component-grid"><div v-for="line in siteComponents(site)" :key="line.code" class="component-card"><span>{{ line.label }}</span><strong>{{ line.hours.toFixed(2) }} h</strong><b>{{ money(line.amount) }} <small>{{ line.code.endsWith('Hours') && ['LateHours','UndertimeHours','BreakHours'].includes(line.code) ? 'deduction' : 'earning' }}</small></b></div></div>
            <div class="section-title employee-title"><div><p class="eyebrow">EMPLOYEES</p><h2>Individual breakdown</h2></div></div>
            <details v-for="person in site.employees" :key="person.EmployeeID" class="employee-card">
              <summary><span><strong>{{ person.EmployeeName }}</strong><small>{{ person.EmployeeNumber || `Employee #${person.EmployeeID}` }} · {{ person.PositionName || 'Position unavailable' }}</small></span><span class="employee-money">Gross {{ money(person.gross) }} · Deductions {{ money(person.timeDeductions + person.accountDeductions) }} · <b>Net {{ money(person.netPreview) }}</b></span></summary>
              <div class="employee-content"><div class="employee-columns"><div><h3>Attendance and rates</h3><div v-for="line in person.components" :key="line.code" class="amount-line"><span>{{ line.label }} · {{ Number(line.hours).toFixed(2) }} h</span><strong>{{ line.direction==='Deduction'?'−':'+' }}{{ money(line.amount) }}</strong></div><p v-if="!person.components.length" class="muted">No payable attendance hours recorded.</p></div>
                <div><h3>Linked employee deductions</h3><div v-for="item in person.deductions" :key="`${item.entryType}-${item.recordId}`" class="amount-line"><span>{{ item.name }} <small>({{ item.entryType }}, balance {{ money(item.remainingBalance) }})</small></span><strong>−{{ money(item.amount) }}</strong></div><p v-if="!person.deductions.length" class="muted">No active installment due in this cutoff.</p></div></div>
                <p v-for="warning in person.warnings" :key="warning" class="warning">{{ warning }}</p>
              </div>
            </details>
          </div></td></tr>
        </template>
        <tr v-if="!visible.length"><td colspan="7" class="empty">{{ loading ? 'Loading computed DTRs…' : 'No computed payroll DTRs match this cutoff and search.' }}</td></tr>
      </tbody>
    </table></div>
  </section>
</template>

<style scoped>
.processing-page{max-width:1500px;margin:0 auto;color:#17335c}.processing-heading{display:flex;justify-content:space-between;align-items:start;gap:24px;margin-bottom:22px}.eyebrow{margin:0 0 6px;color:#2d65d6;font-size:12px;font-weight:800;letter-spacing:.09em}.processing-heading h1{margin:0;font-size:30px;color:#102a51}.processing-heading p:last-child{margin:7px 0 0;color:#657894}.refresh,.details-button{border:1px solid #cbd9ec;border-radius:9px;padding:10px 14px;background:#fff;color:#204a88;font:inherit;font-weight:700;cursor:pointer}.refresh:disabled{opacity:.5}.notice{padding:14px 17px;border:1px solid #c6dafa;border-radius:10px;background:#edf4ff;color:#315780;line-height:1.5}.processing-filters{display:grid;grid-template-columns:minmax(240px,2fr) repeat(3,minmax(150px,1fr));gap:14px;margin:24px 0 12px}.processing-filters label{display:flex;flex-direction:column;gap:7px;color:#435877;font-size:13px;font-weight:700}.processing-filters input,.processing-filters select{box-sizing:border-box;width:100%;min-height:49px;padding:0 13px;border:1px solid #cbd9ec;border-radius:9px;background:#fff;color:#163258;font:inherit;font-size:15px}.count{color:#697c99;font-size:14px}.summary-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0}.summary-strip div{display:flex;flex-direction:column;gap:6px;padding:15px;border:1px solid #d8e4f4;border-radius:11px;background:#fff}.summary-strip span{color:#657b9b;font-size:12px}.summary-strip strong{font-size:20px}.processing-table-wrap{overflow-x:auto;border:1px solid #dbe5f2;border-radius:12px;background:#fff}.processing-table{width:100%;border-collapse:collapse;text-align:left;font-size:14px}.processing-table th{padding:14px 16px;background:#f5f8fc;color:#526b8d;font-size:12px;text-transform:uppercase}.processing-table td{padding:15px 16px;border-top:1px solid #e9eef6;vertical-align:middle}.processing-table td small{display:block;margin-top:4px;color:#69809f;font-size:12px}.processing-table strong{color:#18345f}.details-button{white-space:nowrap}.details-row td{padding:0;background:#f6f9fe}.details-panel{padding:22px}.section-title{display:flex;justify-content:space-between;align-items:end;gap:14px;margin-bottom:16px}.section-title h2{margin:0;font-size:18px}.section-title>span{color:#6e819e;font-size:13px}.component-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.component-card{display:flex;flex-direction:column;gap:5px;padding:13px;border:1px solid #d8e4f4;border-radius:9px;background:#fff}.component-card span,.component-card small{color:#667b99;font-size:12px}.component-card b{color:#173967}.employee-title{margin-top:26px}.employee-card{margin:9px 0;border:1px solid #d8e4f4;border-radius:9px;background:#fff}.employee-card summary{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:15px;cursor:pointer}.employee-card summary small{display:block;margin-top:5px;color:#6f809a}.employee-money{color:#536b8e;text-align:right}.employee-content{padding:0 16px 16px}.employee-columns{display:grid;grid-template-columns:1fr 1fr;gap:26px}.employee-columns h3{font-size:14px}.amount-line{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid #edf1f7}.amount-line small{display:inline!important}.muted{color:#71829c}.warning{margin:10px 0;padding:10px 13px;border:1px solid #f4dbaa;border-radius:8px;background:#fff8e9;color:#795523}.empty{text-align:center;color:#697e9c;padding:40px!important}.error{color:#ad2828}
@media(max-width:1050px){.processing-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.component-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.processing-table{min-width:900px}}@media(max-width:650px){.processing-heading{flex-wrap:wrap}.processing-filters,.summary-strip,.employee-columns{grid-template-columns:1fr}.component-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.employee-card summary{align-items:start;flex-direction:column}.employee-money{text-align:left}}
</style>
