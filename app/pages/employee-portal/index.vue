<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import SearchableSelect from '../../../components/SearchableSelect.vue'
import EmployeePayslipSheet from '../../components/EmployeePayslipSheet.vue'
import { governmentIdTypes,governmentIdType,governmentIdRule,formatGovernmentNumber } from '~~/shared/utils/governmentIds'
import { portalAgreementVersion,portalPrivacySections } from '~~/shared/utils/employeePortal'

const account=ref<any>(null),payslips=ref<any[]>([]),selected=ref<any>(null)
const mode=ref('login'),loading=ref(true),busy=ref(false),error=ref(''),notice=ref(''),privacyOpen=ref(false),settingsOpen=ref(false)
const search=ref(''),year=ref('')
const form=ref({firstName:'',middleName:'',lastName:'',contactNumber:'',email:'',password:'',confirmPassword:'',governmentType:'',governmentNumber:'',otherType:'',agreementAccepted:false,code:''})
const settings=ref({email:'',contactNumber:'',currentPassword:'',password:'',confirmPassword:''})
let request=0
const typeOptions=governmentIdTypes.map(type=>({value:type,label:type}))
const rule=computed(()=>governmentIdRule(governmentIdType(form.value.governmentType)))
const years=computed(()=>[...new Set(payslips.value.map(item=>item.cutoff.periodEnd.slice(0,4)))].sort().reverse())
const visible=computed(()=>payslips.value.filter(item=>(!year.value||item.cutoff.periodEnd.startsWith(year.value))&&`${item.cutoff.periodStart} ${item.cutoff.periodEnd} ${item.cutoff.siteName||''} ${item.cutoff.sources.map((source:any)=>source.siteName).join(' ')}`.toLowerCase().includes(search.value.trim().toLowerCase())))
const money=(value:number)=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(value||0))
const day=(value:string)=>new Date(value+'T00:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})
const period=(cutoff:any)=>`${day(cutoff.periodStart)} – ${day(cutoff.periodEnd)}`
function changeMode(value:string){mode.value=value;error.value='';notice.value='';form.value.password='';form.value.confirmPassword='';form.value.code=''}
function uppercaseName(field:'firstName'|'middleName'|'lastName',event:Event){
 const input=event.target as HTMLInputElement
 form.value[field]=input.value.toLocaleUpperCase('en-PH')
 input.value=form.value[field]
}
function formatNumber(event:Event){form.value.governmentNumber=formatGovernmentNumber(governmentIdType(form.value.governmentType),(event.target as HTMLInputElement).value)}
async function loadSession(){
 const current=++request;loading.value=true
 try{
  const result:any=await $fetch('/api/employee-portal/me',{timeout:15000,retry:0})
  if(current!==request)return
  account.value=result.account
  const list:any=await $fetch('/api/employee-portal/payslips',{timeout:15000,retry:0})
  if(current===request)payslips.value=list.payslips||[]
 }catch(cause:any){
  if(current!==request)return
  if([401,403].includes(Number(cause?.status||cause?.statusCode||cause?.data?.statusCode))){account.value=null;payslips.value=[];selected.value=null}
  else error.value=cause?.data?.statusMessage||'Unable to load the employee portal. Try again.'
 }finally{if(current===request)loading.value=false}
}
async function submit(){
 if(busy.value)return
 busy.value=true;error.value=''
 try{
  if(mode.value==='signup'&&!form.value.agreementAccepted)throw new Error('Read and accept the privacy notice and account terms first.')
  const body=mode.value==='signup'?{...form.value,governmentType:form.value.governmentType==='Other'?form.value.otherType:form.value.governmentType,agreementVersion:portalAgreementVersion}:mode.value==='recovery'?{code:form.value.code,password:form.value.password,confirmPassword:form.value.confirmPassword}:{email:form.value.email,password:form.value.password}
  await $fetch(`/api/employee-portal/auth/${mode.value}`,{method:'POST',body,timeout:20000,retry:0})
  form.value.password='';form.value.confirmPassword='';form.value.governmentNumber='';form.value.code=''
  await loadSession()
 }catch(cause:any){error.value=cause?.data?.statusMessage||cause?.message||'Unable to continue.'}
 finally{busy.value=false}
}
async function logout(){
 if(busy.value)return
 busy.value=true;error.value='';request++
 try{await $fetch('/api/employee-portal/auth/logout',{method:'POST',body:{},retry:0});account.value=null;payslips.value=[];selected.value=null;settingsOpen.value=false;form.value.password='';notice.value='Signed out.'}
 catch(cause:any){error.value=cause?.data?.statusMessage||'Unable to sign out. Try again.'}
 finally{busy.value=false;loading.value=false}
}
function openSettings(){settings.value={email:account.value.Email,contactNumber:account.value.ContactNumber,currentPassword:'',password:'',confirmPassword:''};settingsOpen.value=true;selected.value=null;notice.value='';error.value=''}
async function saveSettings(){
 if(busy.value)return
 busy.value=true;error.value='';notice.value=''
 try{await $fetch('/api/employee-portal/auth/profile',{method:'POST',body:settings.value,retry:0});settings.value.currentPassword='';settings.value.password='';settings.value.confirmPassword='';settingsOpen.value=false;await loadSession();notice.value='Your login and contact details were updated.'}
 catch(cause:any){error.value=cause?.data?.statusMessage||'Unable to save your account details.'}
 finally{busy.value=false}
}
function printPayslip(){window.print()}
onMounted(loadSession)
onBeforeUnmount(()=>{request++})
</script>

<template>
 <main class="employee-portal">
  <header class="portal-top"><NuxtLink to="/employee-portal" class="portal-brand"><span>PMS</span><div><strong>Employee Portal</strong><small>DJA Group of Companies</small></div></NuxtLink><nav v-if="account" aria-label="Employee account"><button type="button" :disabled="busy" @click="openSettings">My account</button><button type="button" :disabled="busy" @click="logout">Sign out</button></nav></header>
  <div class="portal-content">
   <p v-if="error" class="portal-error" role="alert">{{error}}</p><p v-if="notice" class="portal-success" role="status">{{notice}}</p>
   <p v-if="loading" class="portal-loading" role="status">Loading your portal…</p>
   <section v-else-if="!account" class="portal-auth">
    <aside class="portal-intro"><p class="portal-eyebrow">YOUR PAYROLL, IN ONE PLACE</p><h1>Your payslips.<br>Your private account.</h1><p>View your posted payslips and keep track of your payroll history.</p><ul><li>Use your own employee details to create one account.</li><li>Your government ID must already be recorded by HR.</li><li>No Gmail connection or email OTP is required.</li></ul><small>Having trouble signing in? Contact your agency HR office for identity checks and account recovery.</small></aside>
    <div class="portal-card">
     <div class="portal-mode"><button type="button" :disabled="busy" :class="{active:mode==='login'}" @click="changeMode('login')">Sign in</button><button type="button" :disabled="busy" :class="{active:mode==='signup'}" @click="changeMode('signup')">Create account</button></div>
     <h2>{{mode==='signup'?'Create your employee account':mode==='recovery'?'Recover your account':'Welcome back'}}</h2>
     <p class="portal-muted">{{mode==='signup'?'Enter your name exactly as recorded by HR.':mode==='recovery'?'HR must verify your identity and provide a private recovery code.':'Sign in to view the payslips posted for you.'}}</p>
     <form class="portal-form" @submit.prevent="submit">
      <template v-if="mode==='signup'">
       <div class="portal-grid"><label>First name<input :value="form.firstName" autocomplete="given-name" autocapitalize="characters" maxlength="100" required @input="uppercaseName('firstName',$event)"></label><label>Last name<input :value="form.lastName" autocomplete="family-name" autocapitalize="characters" maxlength="100" required @input="uppercaseName('lastName',$event)"></label></div>
       <label>Middle name<input :value="form.middleName" autocomplete="additional-name" autocapitalize="characters" maxlength="100" placeholder="Leave empty only if none is recorded" @input="uppercaseName('middleName',$event)"></label>
       <SearchableSelect v-model="form.governmentType" label="Government ID type" :options="typeOptions" placeholder="Choose your recorded ID type" required @change="form.governmentNumber=''" />
       <label v-if="form.governmentType==='Other'">ID type name<input v-model="form.otherType" maxlength="80" required placeholder="Name recorded by HR"></label>
       <label>ID number<input :value="form.governmentNumber" :disabled="!form.governmentType" :placeholder="rule.placeholder" maxlength="50" autocomplete="off" required @input="formatNumber"><small>{{rule.hint}}</small></label>
       <label>Contact number<input v-model="form.contactNumber" type="tel" autocomplete="tel" maxlength="25" required></label>
      </template>
      <label v-if="mode!=='recovery'">Email<input v-model="form.email" type="email" autocomplete="username" maxlength="190" required><small v-if="mode==='signup'">Used to sign in. We do not verify this address by email.</small></label>
      <label v-if="mode==='recovery'">Private recovery code<input v-model="form.code" autocomplete="off" maxlength="36" required></label>
      <label>{{mode==='login'?'Password':'Create password'}}<input v-model="form.password" type="password" :autocomplete="mode==='login'?'current-password':'new-password'" :minlength="mode==='login'?undefined:12" maxlength="72" required><small v-if="mode!=='login'">At least 12 characters, including letters and numbers.</small></label>
      <label v-if="mode!=='login'">Confirm password<input v-model="form.confirmPassword" type="password" autocomplete="new-password" maxlength="72" required></label>
      <div v-if="mode==='signup'" class="portal-agreement"><button type="button" class="portal-text" @click="privacyOpen=true">Read privacy notice and account terms</button><label><input v-model="form.agreementAccepted" type="checkbox" required>I have read and agree to the privacy notice and account terms ({{portalAgreementVersion}}).</label></div>
      <button type="submit" class="portal-primary" :disabled="busy || (mode==='signup'&&!form.agreementAccepted)">{{busy?'Please wait…':mode==='signup'?'Create account':mode==='recovery'?'Set new password':'Sign in'}}</button>
     </form>
     <button v-if="mode==='login'" type="button" class="portal-text recovery-link" :disabled="busy" @click="changeMode('recovery')">Forgot password? Use an HR recovery code</button>
    </div>
   </section>
   <template v-else>
    <header class="portal-welcome"><div><p class="portal-eyebrow">EMPLOYEE PAYSLIPS</p><h1>{{account.EmployeeName}}</h1><p class="portal-muted">Only payslips posted for your employee record appear here.</p></div><button v-if="!settingsOpen" type="button" :disabled="busy" @click="loadSession">Refresh</button></header>
    <section v-if="settingsOpen" class="portal-card portal-settings"><button type="button" class="portal-text" @click="settingsOpen=false">← Back to payslips</button><h2>My account</h2><p class="portal-muted">Your employee link stays the same when your email or contact changes.</p><form class="portal-form" @submit.prevent="saveSettings"><label>Login email<input v-model="settings.email" type="email" maxlength="190" required></label><label>Contact number<input v-model="settings.contactNumber" type="tel" maxlength="25" required></label><label>Current password<input v-model="settings.currentPassword" type="password" autocomplete="current-password" maxlength="72" required></label><label>New password (optional)<input v-model="settings.password" type="password" autocomplete="new-password" minlength="12" maxlength="72"></label><label v-if="settings.password">Confirm new password<input v-model="settings.confirmPassword" type="password" autocomplete="new-password" maxlength="72" required></label><button type="submit" class="portal-primary" :disabled="busy">{{busy?'Saving…':'Save account details'}}</button></form></section>
    <template v-else-if="selected"><div class="portal-detail-controls"><button type="button" @click="selected=null">← Back to payslips</button><span>Posted {{selected.postedAt}}</span><button type="button" @click="printPayslip">Print / save PDF</button></div><EmployeePayslipSheet :employee="selected.employee" :cutoff="selected.cutoff" /></template>
    <section v-else class="portal-card portal-payslips"><div class="portal-filters"><label>Search payslips<input v-model="search" type="search" placeholder="Cutoff or site"></label><label>Year<select v-model="year"><option value="">All years</option><option v-for="value in years" :key="value" :value="value">{{value}}</option></select></label><span>{{visible.length}} posted payslips</span></div><div class="portal-table"><table><thead><tr><th>Payroll cutoff</th><th>Assignment / site</th><th>Gross</th><th>Deductions</th><th>Net pay</th><th>Action</th></tr></thead><tbody><tr v-for="item in visible" :key="item.publicationId"><td><strong>{{period(item.cutoff)}}</strong><small>Posted {{item.postedAt}}</small></td><td>{{item.cutoff.assignmentType}}<small v-if="item.cutoff.siteName">{{item.cutoff.siteName}}</small></td><td>{{money(item.cutoff.gross)}}</td><td>{{money(item.cutoff.deductions)}}</td><td><strong>{{money(item.cutoff.net)}}</strong></td><td><button type="button" @click="selected=item">View payslip</button></td></tr><tr v-if="!visible.length"><td colspan="6" class="portal-empty">{{payslips.length?'No posted payslips match your search.':'No payslips have been posted for you yet. Please check with HR/payroll.'}}</td></tr></tbody></table></div></section>
   </template>
   <footer class="portal-footer"><button type="button" class="portal-text" @click="privacyOpen=true">Privacy notice and account terms</button><span>For payroll corrections and account support, contact your agency HR office.</span></footer>
  </div>
  <div v-if="privacyOpen" class="portal-modal" @click.self="privacyOpen=false"><section role="dialog" aria-modal="true" aria-labelledby="portal-privacy-title"><header><div><p class="portal-eyebrow">PRIVACY & ACCOUNT TERMS</p><h2 id="portal-privacy-title">Your employee portal information</h2><small>Version {{portalAgreementVersion}}</small></div><button type="button" aria-label="Close privacy notice" @click="privacyOpen=false">×</button></header><div class="portal-privacy-text"><section v-for="item in portalPrivacySections" :key="item.title"><h3>{{item.title}}</h3><p>{{item.text}}</p></section><p><a href="https://privacy.gov.ph/the-right-to-be-informed/" target="_blank" rel="noopener noreferrer">National Privacy Commission: right to be informed</a></p></div><footer><button v-if="!account && mode==='signup'" type="button" class="portal-primary" @click="form.agreementAccepted=true;privacyOpen=false">I agree to the privacy notice and account terms</button><button v-else type="button" @click="privacyOpen=false">Close</button></footer></section></div>
 </main>
</template>

<style scoped>
.employee-portal{min-height:100vh;background:#f5f8fd;color:#14335e;font-family:Inter,'Segoe UI',sans-serif}.portal-top{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:20px max(24px,calc((100vw - 1320px)/2));border-bottom:1px solid #dce5f2;background:#fff}.portal-brand{display:flex;gap:12px;align-items:center;text-decoration:none;color:inherit}.portal-brand>span{display:grid;place-items:center;width:48px;height:48px;border-radius:13px;background:#205be3;color:#fff;font-weight:800}.portal-brand strong,.portal-brand small{display:block}.portal-brand small{margin-top:4px;color:#6c82a0;font-size:.75rem}.portal-top nav{display:flex;gap:10px}.portal-content{max-width:1320px;margin:auto;padding:32px 24px 48px}.portal-auth{display:grid;grid-template-columns:1fr minmax(360px,560px);gap:70px;align-items:start;padding:30px 20px}.portal-intro{padding-top:55px}.portal-eyebrow{color:#2864e8;letter-spacing:.08em;font-weight:800;font-size:.72rem;margin:0}.portal-intro h1{font-size:2.8rem;line-height:1.18;margin:16px 0}.portal-intro>p:not(.portal-eyebrow){color:#617b9d;font-size:1rem;line-height:1.6}.portal-intro ul{padding-left:20px;color:#45658c;line-height:1.8;font-size:.88rem;margin:25px 0}.portal-intro>small{display:block;color:#6a809e;line-height:1.7}.portal-card{background:#fff;border:1px solid #d8e3f3;border-radius:18px;padding:28px;box-shadow:0 10px 35px #17365b06}.portal-card h2{margin:20px 0 8px;font-size:1.5rem}.portal-muted{color:#6b819f;line-height:1.6;font-size:.86rem;margin:8px 0 20px}.portal-mode{display:flex;padding:5px;gap:5px;border:1px solid #d8e3f3;border-radius:11px;background:#f1f5fb}.portal-mode button{flex:1;border:0;background:transparent}.portal-mode button.active{background:#fff;color:#215be3;box-shadow:0 2px 7px #17365b15}.portal-form{display:grid;gap:17px}.portal-form label,.portal-filters label{display:grid;gap:7px;font-size:.82rem;font-weight:700;color:#3e5a80}.portal-grid{display:grid;grid-template-columns:1fr 1fr;gap:15px}.portal-form input,.portal-filters input,.portal-filters select{box-sizing:border-box;width:100%;min-height:46px;padding:11px 13px;border:1px solid #ccdaef;border-radius:9px;color:#14335e;background:#fff;font:inherit;font-weight:400}.portal-form small{color:#6d84a4;font-size:.73rem;line-height:1.5;font-weight:400}.employee-portal button{font:inherit;font-size:.83rem;font-weight:700;cursor:pointer;border:1px solid #cddbf0;background:#fff;color:#2458ae;border-radius:9px;padding:11px 14px}.employee-portal button:disabled{opacity:.55;cursor:default}.employee-portal button.portal-primary{background:#2864e8;color:#fff;border-color:#2864e8;min-height:46px}.employee-portal button.portal-text{border:0;background:none;padding:0;color:#245bd0;text-align:left;font-size:.79rem;line-height:1.6}.portal-agreement{display:grid;gap:10px;padding:14px;border-radius:10px;background:#f4f8ff}.portal-agreement label{display:flex;align-items:flex-start;gap:10px;font-weight:400;line-height:1.5;font-size:.77rem}.portal-agreement input{width:17px;min-height:17px;height:17px;flex:none;margin-top:2px;accent-color:#2864e8}.recovery-link{margin-top:18px}.portal-error,.portal-success{padding:14px 16px;border:1px solid #fecaca;border-radius:10px;background:#fff1f1;color:#a12a24;font-size:.85rem}.portal-success{background:#e9f9f0;border-color:#bce9cf;color:#1b7947}.portal-loading,.portal-empty{text-align:center;padding:42px;color:#6a819f}.portal-welcome{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:20px}.portal-welcome h1{margin:8px 0;font-size:1.8rem}.portal-settings{max-width:540px;margin:auto}.portal-filters{display:grid;grid-template-columns:1fr 180px auto;align-items:end;gap:20px;margin-bottom:24px}.portal-filters>span{font-size:.78rem;color:#6a819f;padding-bottom:13px}.portal-table{overflow:auto;border:1px solid #d8e3f3;border-radius:12px}.portal-table table{width:100%;min-width:850px;border-collapse:collapse;text-align:left}.portal-table th{background:#f3f7fc;color:#637d9d;text-transform:uppercase;letter-spacing:.03em;font-size:.68rem}.portal-table td{font-size:.82rem}.portal-table th,.portal-table td{padding:17px;border-bottom:1px solid #e4ebf5}.portal-table small{display:block;color:#6e84a1;font-size:.72rem;margin-top:6px}.portal-table tr:last-child td{border-bottom:0}.portal-payslips{padding:24px}.portal-detail-controls{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:20px}.portal-detail-controls>span{font-size:.78rem;color:#6d83a2}.portal-footer{display:flex;justify-content:space-between;gap:20px;margin-top:30px;padding:20px 0;color:#6e84a1;font-size:.75rem}.portal-modal{position:fixed;inset:0;background:#1527448c;display:flex;align-items:center;justify-content:center;padding:24px;z-index:1400}.portal-modal>section{background:#fff;border:1px solid #d8e3f3;border-radius:18px;max-width:760px;width:100%;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 25px 70px #10264b35}.portal-modal header{display:flex;justify-content:space-between;gap:20px;padding:24px;border-bottom:1px solid #dce5f2}.portal-modal h2{font-size:1.3rem;margin:7px 0}.portal-modal small{color:#6d83a2}.portal-privacy-text{padding:8px 24px 24px;overflow:auto}.portal-privacy-text h3{font-size:.95rem;margin:20px 0 7px}.portal-privacy-text p{font-size:.84rem;line-height:1.75;color:#526d91}.portal-modal footer{border-top:1px solid #dce5f2;padding:18px 24px;display:flex;justify-content:flex-end}.employee-portal input:focus,.employee-portal select:focus,.employee-portal button:focus-visible{outline:3px solid #2864e833;outline-offset:2px}
@media(max-width:950px){.portal-auth{grid-template-columns:1fr;gap:24px;padding:0;max-width:600px;margin:auto}.portal-intro{padding:0}.portal-intro h1{font-size:2.1rem}.portal-intro ul{margin:15px 0}.portal-filters{grid-template-columns:1fr 150px}.portal-filters>span{grid-column:1/-1;padding:0}}@media(max-width:600px){.portal-top{padding:15px}.portal-top nav{gap:5px}.portal-top nav button{padding:9px}.portal-content{padding:22px 14px}.portal-card{padding:20px}.portal-grid{grid-template-columns:1fr}.portal-intro h1{font-size:1.8rem}.portal-welcome{align-items:flex-start}.portal-welcome h1{font-size:1.35rem}.portal-welcome .portal-muted{font-size:.76rem}.portal-filters{grid-template-columns:1fr}.portal-footer,.portal-detail-controls{flex-wrap:wrap}.portal-modal{padding:12px}.portal-modal header{padding:18px}.portal-privacy-text{padding:0 18px 18px}}
@media print{.portal-top,.portal-welcome,.portal-footer,.portal-detail-controls,.portal-error,.portal-success{display:none!important}.portal-content{padding:0;max-width:none}.employee-portal{background:#fff}.portal-modal{display:none}}
</style>
