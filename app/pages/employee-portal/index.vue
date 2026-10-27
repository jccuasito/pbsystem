<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useHead, onBeforeRouteLeave } from '#imports'
import SearchableSelect from '../../../components/SearchableSelect.vue'
import ArchivedPayslipsPanel from '../../components/ArchivedPayslipsPanel.vue'
import EmployeeInformationPanel from '../../components/EmployeeInformationPanel.vue'
import EmployeePayslipSheet from '../../components/EmployeePayslipSheet.vue'
import { governmentIdTypes,governmentIdType,governmentIdRule,formatGovernmentNumber } from '~~/shared/utils/governmentIds'
import { portalAgreementVersion,portalPrivacySections } from '~~/shared/utils/employeePortal'
import { payslipSiteNames,payslipPostedLabel } from '~~/shared/utils/payslipPresentation'
import { createPayslipPng } from '~/utils/payslipImage'
import { lockBodyScroll } from '../../utils/bodyScrollLock'
import { formatEmployeeId } from '~/utils/employee'

useHead({title:'Payslip Portal - DJA Group of Companies'})

const account=ref<any>(null),payslips=ref<any[]>([]),selected=ref<any>(null)
const employeeIdentity=computed(()=>{
 const number=typeof account.value?.EmployeeNumber==='string'?account.value.EmployeeNumber.trim():''
 return number||formatEmployeeId(account.value?.EmployeeID)
})
const mode=ref('login'),loading=ref(true),busy=ref(false),error=ref(''),notice=ref(''),privacyOpen=ref(false),settingsOpen=ref(false)
const informationOpen=ref(false),informationDirty=ref(false),informationBusy=ref(false)
type PortalDestination='payslips'|'information'|'settings'
let pendingDestination:PortalDestination='payslips'
const search=ref(''),year=ref(''),showPassword=ref(false)
const orderedPayslips=computed(()=>[...payslips.value].sort((a,b)=>b.cutoff.periodEnd.localeCompare(a.cutoff.periodEnd)||b.cutoff.periodStart.localeCompare(a.cutoff.periodStart)||Number(b.publicationId)-Number(a.publicationId)))
const latestPayslip=computed(()=>orderedPayslips.value[0]||null)
const imageUrl=ref(''),imageBlob=ref<Blob|null>(null),imageName=ref(''),imageBusy=ref(false),imageError=ref('')
let imageRequest=0
const canShareImage=computed(()=>{
 if(!imageBlob.value||typeof navigator==='undefined'||!navigator.canShare)return false
 try{return navigator.canShare({files:[new File([imageBlob.value],imageName.value,{type:'image/png'})]})}catch{return false}
})
const form=ref({firstName:'',middleName:'',lastName:'',contactNumber:'',email:'',password:'',confirmPassword:'',governmentType:'',governmentNumber:'',otherType:'',agreementAccepted:false,code:''})
const settings=ref({email:'',contactNumber:'',currentPassword:'',password:'',confirmPassword:''})
type AccountSettings={email:string;contactNumber:string;currentPassword:string;password:string;confirmPassword:string}
type Confirmation='save'|'signout'|'discard'|'leave'
const confirmation=ref<Confirmation|null>(null),confirmationError=ref(''),pendingSettings=ref<AccountSettings|null>(null)
const confirmDialog=ref<HTMLElement|null>(null),confirmCancel=ref<HTMLButtonElement|null>(null)
let resolveLeave:((allow:boolean)=>void)|null=null
const normalizedSettings=()=>({...settings.value,email:settings.value.email.trim().toLowerCase(),contactNumber:settings.value.contactNumber.trim()})
const settingsChanged=computed(()=>{const value=normalizedSettings();return value.email!==String(account.value?.Email||'').trim().toLowerCase()||value.contactNumber!==String(account.value?.ContactNumber||'').trim()||Boolean(value.password)})
const settingsDirty=computed(()=>(settingsOpen.value&&(settingsChanged.value||Boolean(settings.value.currentPassword)||Boolean(settings.value.confirmPassword)))||(informationOpen.value&&informationDirty.value))
const reviewedChanges=computed(()=>{
 const value=pendingSettings.value;if(!value)return []
 const changes:Array<{label:string;before?:string;after:string}>=[]
 if(value.email!==String(account.value?.Email||'').trim().toLowerCase())changes.push({label:'Login email',before:account.value?.Email,after:value.email})
 if(value.contactNumber!==String(account.value?.ContactNumber||'').trim())changes.push({label:'Contact number',before:account.value?.ContactNumber,after:value.contactNumber})
 if(value.password)changes.push({label:'Password',after:'Your password will be changed. The password is not displayed here.'})
 return changes
})
const confirmationTitle=computed(()=>confirmation.value==='save'?'Save these account changes?':confirmation.value==='signout'?'Sign out of Payslip Portal?':'Discard your changes?')
const confirmationDescription=computed(()=>confirmation.value==='save'?'Review the details below. Your account will only be updated after you confirm.':confirmation.value==='signout'?'You will need to sign in again to view your payslips.':'Your changes have not been saved or sent. Leave without keeping them?')
const confirmationAction=computed(()=>confirmation.value==='save'?'Confirm and save':confirmation.value==='signout'?'Yes, sign out':'Discard changes')
function clearSettings(){settings.value={email:account.value?.Email||'',contactNumber:account.value?.ContactNumber||'',currentPassword:'',password:'',confirmPassword:''}}
function showConfirmation(action:Confirmation){if(busy.value||informationBusy.value||confirmation.value)return;confirmationError.value='';confirmation.value=action}
function cancelConfirmation(){if(busy.value)return;confirmation.value=null;pendingSettings.value=null;confirmationError.value='';const resolve=resolveLeave;resolveLeave=null;resolve?.(false)}
function applyDestination(destination:PortalDestination){clearSettings();settingsOpen.value=destination==='settings';informationOpen.value=destination==='information';informationDirty.value=false;selected.value=null;error.value='';notice.value=''}
function navigatePortal(destination:PortalDestination){if(busy.value||informationBusy.value)return;if((destination==='settings'&&settingsOpen.value)||(destination==='information'&&informationOpen.value))return;if(settingsDirty.value){pendingDestination=destination;showConfirmation('discard');return}applyDestination(destination)}
function returnToPayslips(){navigatePortal('payslips')}
function openInformation(){navigatePortal('information')}
function brandClick(event:MouseEvent){if(account.value){event.preventDefault();returnToPayslips()}}
function requestSignout(){showConfirmation('signout')}
function requestSave(){
 if(busy.value||confirmation.value||!settingsChanged.value)return
 error.value=''
 if(settings.value.password&&settings.value.password!==settings.value.confirmPassword){error.value='The new password and confirmation do not match.';return}
 pendingSettings.value=normalizedSettings();showConfirmation('save')
}
async function confirmAction(){
 if(busy.value||!confirmation.value)return
 const action=confirmation.value
 if(action==='save'){
  if(!pendingSettings.value)return
  if(!await saveSettings(pendingSettings.value))return
 }else if(action==='signout'){if(!await logout())return}
 else{applyDestination(action==='leave'?'payslips':pendingDestination)}
 confirmation.value=null;pendingSettings.value=null;confirmationError.value=''
 const resolve=resolveLeave;resolveLeave=null;resolve?.(true)
}
function warnBeforeUnload(event:BeforeUnloadEvent){if(settingsDirty.value){event.preventDefault();event.returnValue=''}}
onBeforeRouteLeave(()=>{
 if(busy.value||informationBusy.value||confirmation.value)return false
 if(!settingsDirty.value)return true
 return new Promise<boolean>(resolve=>{resolveLeave=resolve;showConfirmation('leave')})
})
let request=0
const typeOptions=governmentIdTypes.map(type=>({value:type,label:type}))
const rule=computed(()=>governmentIdRule(governmentIdType(form.value.governmentType)))
const years=computed(()=>[...new Set(payslips.value.map(item=>item.cutoff.periodEnd.slice(0,4)))].sort().reverse())
const visible=computed(()=>orderedPayslips.value.filter(item=>(!year.value||item.cutoff.periodEnd.startsWith(year.value))&&`${item.cutoff.periodStart} ${item.cutoff.periodEnd} ${item.cutoff.siteName||''} ${item.cutoff.sources.map((source:any)=>source.siteName).join(' ')}`.toLowerCase().includes(search.value.trim().toLowerCase())))
const currency=new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'})
const money=(value:number)=>currency.format(Number(value||0))
const day=(value:string)=>new Date(value+'T00:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})
const period=(cutoff:any)=>`${day(cutoff.periodStart)} – ${day(cutoff.periodEnd)}`
function changeMode(value:string){mode.value=value;showPassword.value=false;error.value='';notice.value='';form.value.password='';form.value.confirmPassword='';form.value.code=''}
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
  if(current===request){
   const selectedId=selected.value?.publicationId
   payslips.value=list.payslips||[]
   if(selectedId)selected.value=payslips.value.find(item=>item.publicationId===selectedId)||null
  }
 }catch(cause:any){
  if(current!==request)return
  if([401,403].includes(Number(cause?.status||cause?.statusCode||cause?.data?.statusCode))){account.value=null;payslips.value=[];selected.value=null;settingsOpen.value=false;informationOpen.value=false;informationDirty.value=false;clearSettings()}
  else error.value=cause?.data?.statusMessage||'Unable to load your payslip portal. Try again.'
 }finally{if(current===request)loading.value=false}
}
async function submit(){
 if(busy.value)return
 busy.value=true;error.value=''
 try{
  if(mode.value==='signup'&&!form.value.agreementAccepted)throw new Error('Read and accept the privacy notice and account terms first.')
  const body=mode.value==='signup'?{...form.value,governmentType:form.value.governmentType==='Other'?form.value.otherType:form.value.governmentType,agreementVersion:portalAgreementVersion}:mode.value==='recovery'?{email:form.value.email,code:form.value.code,password:form.value.password,confirmPassword:form.value.confirmPassword}:{email:form.value.email,password:form.value.password}
  await $fetch(`/api/employee-portal/auth/${mode.value}`,{method:'POST',body,timeout:20000,retry:0})
  form.value.password='';form.value.confirmPassword='';form.value.governmentNumber='';form.value.code='';showPassword.value=false
  await loadSession()
 }catch(cause:any){error.value=cause?.data?.statusMessage||cause?.message||'Unable to continue.'}
 finally{busy.value=false}
}
async function logout(){
 if(busy.value)return
 busy.value=true;error.value='';confirmationError.value='';request++
 try{await $fetch('/api/employee-portal/auth/logout',{method:'POST',body:{},retry:0,timeout:20000});account.value=null;payslips.value=[];selected.value=null;settingsOpen.value=false;informationOpen.value=false;informationDirty.value=false;clearSettings();form.value.password='';showPassword.value=false;notice.value='Signed out.';return true}
 catch(cause:any){confirmationError.value=cause?.data?.statusMessage||'Unable to sign out. Try again.';return false}
 finally{busy.value=false;loading.value=false}
}
function openSettings(){navigatePortal('settings')}
async function saveSettings(body:AccountSettings){
 if(busy.value)return
 busy.value=true;error.value='';notice.value='';confirmationError.value=''
 try{await $fetch('/api/employee-portal/auth/profile',{method:'POST',body,retry:0,timeout:20000});settings.value.currentPassword='';settings.value.password='';settings.value.confirmPassword='';settingsOpen.value=false;await loadSession();notice.value='Your login and contact details were updated.';return true}
 catch(cause:any){confirmationError.value=cause?.data?.statusMessage||'Unable to save your account details.';return false}
 finally{busy.value=false}
}
function printPayslip(){window.print()}
function closeImage(){imageRequest++;if(imageUrl.value)URL.revokeObjectURL(imageUrl.value);imageUrl.value='';imageBlob.value=null;imageName.value='';imageBusy.value=false;imageError.value=''}
async function saveImage(){
 if(!selected.value||imageBusy.value)return
 const current=++imageRequest,snapshot=selected.value
 imageBusy.value=true;imageError.value=''
 try{
  const result=await createPayslipPng(snapshot)
  if(current!==imageRequest)return
  if(imageUrl.value)URL.revokeObjectURL(imageUrl.value)
  imageBlob.value=result.blob;imageName.value=result.fileName;imageUrl.value=URL.createObjectURL(result.blob)
 }catch(cause:any){if(current===imageRequest)imageError.value=cause?.message||'Unable to create the image.'}
 finally{if(current===imageRequest)imageBusy.value=false}
}
async function shareImage(){
 if(!imageBlob.value||!canShareImage.value)return
 try{await navigator.share({files:[new File([imageBlob.value],imageName.value,{type:'image/png'})],title:'My payslip'})}
 catch(cause:any){if(cause?.name!=='AbortError')imageError.value='Sharing is unavailable. Download the PNG or save the preview image.'}
}
watch(selected,closeImage)
onMounted(()=>{void loadSession();window.addEventListener('beforeunload',warnBeforeUnload)})
const privacyDialog=ref<HTMLElement|null>(null),imageDialog=ref<HTMLElement|null>(null)
const modalOpen=computed(()=>Boolean(confirmation.value)||privacyOpen.value||Boolean(imageUrl.value))
const activeDialog=()=>confirmation.value?confirmDialog.value:imageUrl.value?imageDialog.value:privacyDialog.value
let releaseScroll:(()=>void)|null=null,previousFocus:HTMLElement|null=null
watch(modalOpen,async open=>{
 if(open){previousFocus=document.activeElement as HTMLElement;releaseScroll=lockBodyScroll();await nextTick();(confirmation.value?confirmCancel.value:activeDialog())?.focus()}
 else{releaseScroll?.();releaseScroll=null;previousFocus?.focus()}
})
watch(confirmation,async value=>{await nextTick();if(value)confirmCancel.value?.focus();else if(modalOpen.value)activeDialog()?.focus()})
function modalKeydown(event:KeyboardEvent){
 if(event.key==='Escape'){event.preventDefault();if(confirmation.value)cancelConfirmation();else if(imageUrl.value)closeImage();else privacyOpen.value=false;return}
 if(event.key!=='Tab')return
 const dialog=activeDialog()
 const controls=[...dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select')||[]].filter(node=>node.offsetParent!==null)
 const first=controls[0],last=controls[controls.length-1];if(!first||!last)return
 if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog)){event.preventDefault();last.focus()}
 else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
}
onBeforeUnmount(()=>{request++;closeImage();pendingSettings.value=null;clearSettings();resolveLeave?.(false);resolveLeave=null;window.removeEventListener('beforeunload',warnBeforeUnload);releaseScroll?.();releaseScroll=null})
</script>

<template>
 <main class="employee-portal">
  <header class="portal-top" :inert="modalOpen">
   <NuxtLink to="/employee-portal" class="portal-brand" @click="brandClick"><img src="/images/logo.png" alt="DJA"><div><strong>Payslip Portal</strong><small>DJA Group of Companies</small></div></NuxtLink>
   <nav v-if="account" aria-label="Payslip account"><button type="button" :class="{active:informationOpen}" :disabled="busy||informationBusy" @click="openInformation">My information</button><button type="button" :class="{active:settingsOpen}" :disabled="busy||informationBusy" @click="openSettings"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg>My account</button><button type="button" :disabled="busy||informationBusy" @click="requestSignout">Sign out<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H4v16h6M14 8l4 4-4 4M9 12h11"/></svg></button></nav>
   <span v-else class="portal-top-caption">EMPLOYEE SELF-SERVICE</span>
  </header>
  <div class="portal-content" :inert="modalOpen">
   <p v-if="error&&(account||loading)" class="portal-error" role="alert">{{error}}</p><p v-if="notice&&account" class="portal-success" role="status">{{notice}}</p>
   <div v-if="loading" class="portal-loading" role="status"><span class="loading-mark" aria-hidden="true"></span>Loading your payslip portal...</div>
   <section v-else-if="!account" class="portal-auth" :class="{'portal-auth-signup':mode==='signup'}">
    <aside class="portal-intro">
     <p class="portal-eyebrow">DJA PAYSLIP PORTAL</p>
     <h1 v-if="mode==='login'">Welcome <em>back.</em></h1><h1 v-else-if="mode==='signup'">Your payslips.<em>Your account.</em></h1><h1 v-else>Let's get you <em>back in.</em></h1>
     <p>View your payslips, check your payroll history, and keep a personal copy. All in one place.</p>
     <div class="intro-line" aria-hidden="true"></div>
     <div class="intro-support"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z"/><path d="m8 12 3 3 5-6"/></svg><div><strong>Your account. Your payslips.</strong><small>Use your own employee details. Keep your password and recovery code private.</small></div></div>
     <div class="intro-orb" aria-hidden="true"></div>
    </aside>
    <div class="portal-card portal-auth-panel">
     <div class="portal-mode" aria-label="Account options"><button type="button" :disabled="busy" :class="{active:mode==='login'||mode==='recovery'}" @click="changeMode('login')">Sign in</button><button type="button" :disabled="busy" :class="{active:mode==='signup'}" @click="changeMode('signup')">Create account</button></div>
     <h2>{{mode==='signup'?'Create your account':mode==='recovery'?'Recover your account':'Sign in to your account'}}</h2>
     <p class="portal-muted">{{mode==='signup'?'Use the employee name and government ID already recorded by HR.':mode==='recovery'?'Ask HR to verify your identity and give you a private 6-digit recovery code.':'Enter your login details to view your posted payslips.'}}</p>
     <p v-if="error" class="portal-error" role="alert">{{error}}</p><p v-if="notice" class="portal-success" role="status">{{notice}}</p>
     <form class="portal-form" @submit.prevent="submit">
      <template v-if="mode==='signup'"><p class="form-section-title">01 &nbsp; Employee details</p>
       <div class="portal-grid"><label>First name<input :value="form.firstName" autocomplete="given-name" autocapitalize="characters" maxlength="100" required @input="uppercaseName('firstName',$event)"></label><label>Last name<input :value="form.lastName" autocomplete="family-name" autocapitalize="characters" maxlength="100" required @input="uppercaseName('lastName',$event)"></label></div>
       <label>Middle name<input :value="form.middleName" autocomplete="additional-name" autocapitalize="characters" maxlength="100" placeholder="Leave empty only if none is recorded" @input="uppercaseName('middleName',$event)"></label>
       <SearchableSelect v-model="form.governmentType" label="Government ID type" :options="typeOptions" placeholder="Choose your recorded ID type" required @change="form.governmentNumber=''" />
       <label v-if="form.governmentType==='Other'">ID type name<input v-model="form.otherType" maxlength="80" required placeholder="Name recorded by HR"></label>
       <label>ID number<input :value="form.governmentNumber" :disabled="!form.governmentType" :placeholder="rule.placeholder" maxlength="50" autocomplete="off" required @input="formatNumber"><small>{{rule.hint}}</small></label>
       <p class="form-section-title">02 &nbsp; Login &amp; contact</p><label>Contact number<input v-model="form.contactNumber" type="tel" autocomplete="tel" maxlength="25" required></label>
      </template>
      <label>{{mode==='recovery'?'Login email':'Email'}}<input v-model="form.email" type="email" autocomplete="username" placeholder="you@example.com" maxlength="190" required><small v-if="mode==='signup'">Used to sign in. We do not verify this address by email.</small><small v-if="mode==='recovery'">Use the email recorded on your portal account. No email will be sent.</small></label>
      <label v-if="mode==='recovery'">6-digit recovery code<input v-model="form.code" class="portal-recovery-code" type="text" inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" minlength="6" maxlength="6" placeholder="000000" required @input="form.code=form.code.replace(/[^0-9]/g,'').slice(0,6)"><small>Valid for 15 minutes and one use. After 5 incorrect attempts, ask HR for a new code.</small></label>
      <div class="password-field"><label for="portal-password">{{mode==='login'?'Password':'Create password'}}</label><div class="password-wrap"><input id="portal-password" v-model="form.password" :type="showPassword?'text':'password'" :autocomplete="mode==='login'?'current-password':'new-password'" :minlength="mode==='login'?undefined:12" maxlength="72" placeholder="Enter your password" required><button type="button" class="password-toggle" :aria-label="showPassword?'Hide password':'Show password'" :aria-pressed="showPassword" @click="showPassword=!showPassword"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path v-if="!showPassword" d="m3 3 18 18"/></svg></button></div><small v-if="mode!=='login'">At least 12 characters, including letters and numbers.</small></div>
      <label v-if="mode!=='login'">Confirm password<input v-model="form.confirmPassword" type="password" autocomplete="new-password" maxlength="72" required></label>
      <div v-if="mode==='signup'" class="portal-agreement"><button type="button" class="portal-text" @click="privacyOpen=true">Read privacy notice and account terms</button><label><input v-model="form.agreementAccepted" type="checkbox" required>I have read and agree to the privacy notice and account terms ({{portalAgreementVersion}}).</label></div>
      <button type="submit" class="portal-primary" :disabled="busy || (mode==='signup'&&!form.agreementAccepted)">{{busy?'Please wait…':mode==='signup'?'Create account':mode==='recovery'?'Set new password':'Sign in'}}</button>
     </form>
     <button v-if="mode==='login'" type="button" class="portal-text recovery-link" :disabled="busy" @click="changeMode('recovery')">Forgot password? Use an HR recovery code</button><p class="auth-help">Need help? Contact your agency HR office.</p>
    </div>
   </section>
   <template v-else>
    <div v-if="!informationOpen&&!settingsOpen&&!selected" class="portal-overview">
     <header class="portal-welcome">
      <div class="welcome-identity"><p class="portal-eyebrow">YOUR PAYSLIP WORKSPACE</p><h1>{{account.EmployeeName}}</h1><p class="welcome-agency"><span>Agency</span><strong>{{account.AgencyName || 'No agency assigned'}}</strong></p><p class="welcome-meta">{{employeeIdentity}}</p><small v-if="account.PositionName">{{account.PositionName}}</small><p class="welcome-message">Your payroll history, always within reach.</p></div>
      <div v-if="latestPayslip" class="latest-payslip"><span>Latest posted payslip</span><strong>{{money(latestPayslip.cutoff.net)}}</strong><small>Net pay &middot; {{period(latestPayslip.cutoff)}}</small><button type="button" @click="selected=latestPayslip">View latest payslip <span aria-hidden="true">&rarr;</span></button></div>
      <div v-else class="welcome-empty"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2ZM9 8h6M9 12h6"/></svg><span>Your available payslips are listed in the history below.</span></div>
     </header>
     <div class="portal-current-sites"><div class="assignment-caption"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg><span class="site-caption">Current assignment</span></div><span v-for="site in account.CurrentSites || []" :key="site.SiteID+':'+site.DeploymentType" class="current-site"><strong>{{site.SiteName}}</strong><small>{{site.ClientName}} &middot; {{site.IsPermanentSite?'Fixed post':site.DeploymentType}}</small></span><small v-if="!account.CurrentSites?.length">No current site assignment recorded.</small></div>
    </div>
    <section v-if="informationOpen" class="portal-information"><button type="button" class="portal-text" @click="returnToPayslips">&larr; Back to payslips</button><EmployeeInformationPanel :employee="account" @dirty="informationDirty=$event" @processing="informationBusy=$event"/></section>
    <section v-else-if="settingsOpen" class="portal-card portal-settings"><button type="button" class="portal-text" @click="returnToPayslips">← Back to payslips</button><p class="portal-eyebrow">ACCOUNT SETTINGS</p><h2>My account</h2><p class="portal-muted">Your employee link stays the same when your email or contact changes.</p><div class="settings-identity"><strong>{{account.EmployeeName}}</strong><small>{{employeeIdentity}}<span v-if="account.AgencyName"> &middot; {{account.AgencyName}}</span></small></div><form class="portal-form" @submit.prevent="requestSave"><p class="form-section-title">Login &amp; contact details</p><label>Login email<input v-model="settings.email" type="email" maxlength="190" required></label><label>Contact number<input v-model="settings.contactNumber" type="tel" maxlength="25" required></label><p class="form-section-title">Password &amp; security</p><label>Current password<input v-model="settings.currentPassword" type="password" autocomplete="current-password" maxlength="72" required></label><label>New password (optional)<input v-model="settings.password" type="password" autocomplete="new-password" minlength="12" maxlength="72"></label><label v-if="settings.password">Confirm new password<input v-model="settings.confirmPassword" type="password" autocomplete="new-password" maxlength="72" required></label><p v-if="settingsChanged" class="settings-pending" role="status">You have unsaved changes. Review and confirm them before they are applied.</p><button type="submit" class="portal-primary" :disabled="busy||!settingsChanged">{{busy?'Saving…':'Save account details'}}</button></form></section>
    <template v-else-if="selected">
     <div class="portal-detail-controls">
      <button type="button" @click="selected=null">← Back to payslips</button>
      <div class="portal-posted"><small>Date posted · Philippine time</small><strong>{{payslipPostedLabel(selected.postedAt)}}</strong><button type="button" class="portal-detail-refresh" aria-label="Refresh" title="Refresh payslip" :disabled="busy" @click="loadSession"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M18 5a8 8 0 0 0-13 4M6 19a8 8 0 0 0 13-4"/></svg></button></div>
      <div class="portal-save-actions"><button type="button" class="portal-primary" :disabled="imageBusy" @click="saveImage">{{imageBusy?'Preparing image…':'Save as PNG'}}</button><button type="button" @click="printPayslip">Print / PDF</button></div>
     </div>
     <p v-if="imageError" class="portal-error" role="alert">{{imageError}}</p>
     <EmployeePayslipSheet :employee="selected.employee" :cutoff="selected.cutoff" :show-record-note="false" />
    </template>
    <section v-else class="portal-card portal-payslips"><div class="payslip-list-heading"><div><p class="portal-eyebrow">PAYROLL HISTORY</p><h2>Your payslips</h2><p>View a breakdown or save a copy for your records.</p></div><button type="button" class="portal-sync" :disabled="busy" @click="loadSession"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M18 5a8 8 0 0 0-13 4M6 19a8 8 0 0 0 13-4"/></svg>Refresh</button></div><div class="portal-filters"><label>Search payslips<input v-model="search" type="search" placeholder="Cutoff or site"></label><label>Year<select v-model="year"><option value="">All years</option><option v-for="value in years" :key="value" :value="value">{{value}}</option></select></label><span>{{visible.length}} posted payslips</span></div><div class="portal-table"><table><thead><tr><th>Payroll cutoff</th><th>Assignment / site</th><th>Gross</th><th>Deductions</th><th>Net pay</th><th>Action</th></tr></thead><tbody><tr v-for="item in visible" :key="item.publicationId"><td><strong>{{period(item.cutoff)}}</strong><span v-if="item.publicationId===latestPayslip?.publicationId" class="latest-label">Latest</span><small>Posted {{payslipPostedLabel(item.postedAt)}}</small></td><td>{{item.cutoff.assignmentType}}<small>{{payslipSiteNames(item.cutoff).join(' / ') || 'Site not recorded'}}</small></td><td>{{money(item.cutoff.gross)}}</td><td>{{money(item.cutoff.deductions)}}</td><td><strong>{{money(item.cutoff.net)}}</strong></td><td><button type="button" @click="selected=item">View payslip</button></td></tr><tr v-if="!visible.length"><td colspan="6" class="portal-empty">{{payslips.length?'No posted payslips match your search.':'No system-generated payslips posted yet. Check the historical PDF archive below.'}}</td></tr></tbody></table></div><div class="portal-mobile-payslips">
      <article v-for="item in visible" :key="item.publicationId" class="mobile-payslip-card">
       <header><div class="mobile-card-label"><span>Posted payslip</span><small v-if="item.publicationId===latestPayslip?.publicationId" class="latest-label">Latest</small></div><strong>{{period(item.cutoff)}}</strong></header>
       <p class="mobile-payslip-site">{{payslipSiteNames(item.cutoff).join(' / ') || 'Site not recorded'}}</p>
       <span class="mobile-assignment">{{item.cutoff.assignmentType}}</span>
       <div class="mobile-net"><span>Net pay</span><strong>{{money(item.cutoff.net)}}</strong></div>
       <dl><div><dt>Gross pay</dt><dd>{{money(item.cutoff.gross)}}</dd></div><div><dt>Deductions</dt><dd>{{money(item.cutoff.deductions)}}</dd></div></dl>
       <footer><small>Posted {{payslipPostedLabel(item.postedAt)}}</small><button type="button" @click="selected=item">View payslip</button></footer>
      </article>
      <p v-if="!visible.length" class="portal-empty">{{payslips.length?'No posted payslips match your search.':'No payslips have been posted for you yet.'}}</p>
     </div><ArchivedPayslipsPanel /></section>
   </template>
   <footer class="portal-footer"><button type="button" class="portal-text" @click="privacyOpen=true">Privacy notice and account terms</button><span>For payroll corrections and account support, contact your agency HR office.</span></footer>
  </div>
  <div v-if="confirmation" class="portal-modal portal-confirm-modal" @click.self="cancelConfirmation">
   <section ref="confirmDialog" role="alertdialog" aria-modal="true" aria-labelledby="portal-confirm-title" aria-describedby="portal-confirm-description" tabindex="-1" @keydown="modalKeydown">
    <header><div><p class="portal-eyebrow">{{confirmation==='save'?'REVIEW ACCOUNT CHANGES':'ACCOUNT CONFIRMATION'}}</p><h2 id="portal-confirm-title">{{confirmationTitle}}</h2></div><button type="button" aria-label="Close confirmation" :disabled="busy" @click="cancelConfirmation"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></header>
    <div class="confirmation-body"><p id="portal-confirm-description">{{confirmationDescription}}</p>
     <dl v-if="confirmation==='save'" class="confirmation-changes"><div v-for="change in reviewedChanges" :key="change.label"><dt>{{change.label}}</dt><dd><span v-if="change.before" class="change-before">{{change.before}}</span><strong>{{change.after}}</strong></dd></div></dl>
     <p v-if="confirmation==='signout'&&settingsDirty" class="confirmation-warning">You have unsaved changes. Signing out will discard them.</p>
     <p v-if="confirmation==='save'&&reviewedChanges.some(change=>change.label==='Login email')" class="confirmation-note">Use your updated email the next time you sign in.</p>
     <p v-if="confirmationError" class="portal-error" role="alert">{{confirmationError}}</p>
    </div>
    <footer><button ref="confirmCancel" type="button" :disabled="busy" @click="cancelConfirmation">{{confirmation==='signout'?'Stay signed in':'Keep editing'}}</button><button type="button" class="portal-primary" :class="{'confirm-destructive':confirmation!=='save'}" :disabled="busy" @click="confirmAction">{{busy?(confirmation==='save'?'Saving...':'Signing out...'):confirmationAction}}</button></footer>
   </section>
  </div>
  <div v-if="imageUrl" class="portal-modal portal-image-modal" @click.self="closeImage"><section ref="imageDialog" role="dialog" aria-modal="true" aria-labelledby="portal-image-title" tabindex="-1" @keydown="modalKeydown"><header><div><p class="portal-eyebrow">PAYSLIP IMAGE</p><h2 id="portal-image-title">Save your payslip</h2><small>On a phone, you can also touch and hold the preview to save the image.</small></div><button type="button" aria-label="Close image preview" @click="closeImage"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button></header><div class="portal-image-preview"><img :src="imageUrl" alt="Your complete posted payslip, ready to save as PNG"></div><footer><a class="portal-download" :href="imageUrl" :download="imageName">Download PNG</a><button v-if="canShareImage" type="button" @click="shareImage">Share / save image</button><button type="button" @click="closeImage">Close</button></footer><p v-if="imageError" class="portal-error" role="alert">{{imageError}}</p></section></div>
  <div v-if="privacyOpen" class="portal-modal" @click.self="privacyOpen=false"><section ref="privacyDialog" role="dialog" aria-modal="true" aria-labelledby="portal-privacy-title" tabindex="-1" @keydown="modalKeydown"><header><div><p class="portal-eyebrow">PRIVACY & ACCOUNT TERMS</p><h2 id="portal-privacy-title">Your payslip portal information</h2><small>Version {{portalAgreementVersion}}</small></div><button type="button" aria-label="Close privacy notice" @click="privacyOpen=false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button></header><div class="portal-privacy-text"><section v-for="item in portalPrivacySections" :key="item.title"><h3>{{item.title}}</h3><p>{{item.text}}</p></section><p><a href="https://privacy.gov.ph/the-right-to-be-informed/" target="_blank" rel="noopener noreferrer">National Privacy Commission: right to be informed</a></p></div><footer><button v-if="!account && mode==='signup'" type="button" class="portal-primary" @click="form.agreementAccepted=true;privacyOpen=false">I agree to the privacy notice and account terms</button><button v-else type="button" @click="privacyOpen=false">Close</button></footer></section></div>
 </main>
</template>

<style scoped>
.portal-information{display:grid;gap:24px}.portal-information>.portal-text{justify-self:start}@media(max-width:760px){.portal-top{flex-wrap:wrap}.portal-top nav{width:100%;display:flex;flex-wrap:wrap}.portal-top nav button{flex:1;white-space:nowrap}}
/* The portal shares DJA Payroll's white, navy and blue visual language. */
.employee-portal{--ink:#15264b;--muted:#64748e;--line:#dde5f0;--blue:#2563da;--navy:#17386e;min-height:100vh;color:var(--ink);background:radial-gradient(ellipse at 0 0,#dfe9fa 0,transparent 48rem),#f7f9fc;font-family:'DM Sans',Inter,'Segoe UI',sans-serif;line-height:1.5}
.employee-portal *{box-sizing:border-box}.employee-portal h1,.employee-portal h2,.employee-portal h3{line-height:1.2;letter-spacing:-.035em}.employee-portal button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:10px 16px;border:1px solid #cbd8eb;border-radius:8px;background:#fff;color:#244e88;font:inherit;font-size:.86rem;font-weight:700;cursor:pointer}.employee-portal button:hover{background:#edf3fc}.employee-portal button:disabled{opacity:.55;cursor:default}.employee-portal button.portal-primary{background:var(--blue);border-color:var(--blue);color:#fff;min-height:48px}.employee-portal button.portal-primary:hover{background:#1d51bd}.employee-portal button.portal-text{min-height:auto;justify-content:flex-start;padding:0;border:0;background:transparent;color:#2459b6;font-size:.81rem;text-align:left;text-decoration:underline;text-underline-offset:3px}.employee-portal button:focus-visible,.employee-portal a:focus-visible,.employee-portal input:focus-visible,.employee-portal select:focus-visible{outline:3px solid #75aaf0;outline-offset:3px}.employee-portal svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex:none}
.portal-top{max-width:1200px;margin:auto;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:28px 28px 22px}.portal-brand{display:flex;align-items:center;gap:12px;text-decoration:none;color:var(--ink);min-width:0}.portal-brand img{width:46px;height:46px;object-fit:contain;flex:none}.portal-brand strong,.portal-brand small{display:block}.portal-brand strong{font-size:1.13rem;font-weight:800;letter-spacing:-.025em}.portal-brand small{font-size:.75rem;color:var(--muted);margin-top:2px}.portal-top-caption{font-size:.65rem;font-weight:700;color:#6a7c98;letter-spacing:.1em}.portal-top nav{display:flex;gap:8px}.portal-top nav button{background:#ffffffb3;font-size:.8rem;padding:9px 13px}.portal-top nav button.active{background:#e9f1ff;border-color:#a9c4f2}.portal-top nav svg{width:17px;height:17px}.portal-content{max-width:1200px;margin:auto;padding:0 28px 30px}.portal-eyebrow{margin:0;color:var(--blue);font-weight:800;font-size:.68rem;letter-spacing:.12em;text-transform:uppercase}.portal-muted{font-size:.88rem;line-height:1.65;color:var(--muted)}.portal-card{border:1px solid var(--line);border-radius:16px;background:#fff;box-shadow:0 8px 26px #152c5405}.portal-error,.portal-success{padding:13px 16px;margin:0 0 18px;border:1px solid #f0bfc3;border-radius:9px;background:#fff0f0;color:#9b2b35;font-size:.86rem;line-height:1.6;overflow-wrap:anywhere}.portal-success{border-color:#b6dfcb;background:#eaf8f1;color:#216c4d}.portal-loading,.portal-empty{text-align:center;color:var(--muted);padding:40px 20px}.portal-loading{display:flex;justify-content:center;align-items:center;gap:12px;min-height:260px}.loading-mark{width:18px;height:18px;border:2px solid #c5d6f4;border-top-color:var(--blue);border-radius:50%;animation:portal-spin 1s linear infinite}@keyframes portal-spin{to{transform:rotate(360deg)}}
/* Sign in, registration and recovery */
.portal-auth{display:grid;grid-template-columns:1fr 1fr;min-height:620px;border:1px solid var(--line);border-radius:20px;box-shadow:0 25px 65px #152b5e1c;background:#fff;overflow:hidden}.portal-intro{position:relative;display:flex;flex-direction:column;justify-content:center;overflow:hidden;padding:clamp(32px,5vw,68px)}.portal-intro h1{font-size:clamp(2.7rem,5.2vw,4.5rem);max-width:10ch;margin:22px 0 24px;line-height:1.04;letter-spacing:-.055em}.portal-intro h1 em{display:block;font-family:'Playfair Display',Georgia,serif;font-weight:600;color:var(--blue);letter-spacing:-.05em}.portal-intro>p:not(.portal-eyebrow){max-width:30ch;margin:0;color:var(--muted);font-size:1rem;line-height:1.8}.intro-line{width:78px;height:3px;background:var(--blue);margin:30px 0}.intro-support{display:flex;align-items:flex-start;gap:12px;position:relative;z-index:1;max-width:320px}.intro-support>svg{color:#4c75b2;width:23px;height:23px;margin-top:2px}.intro-support strong,.intro-support small{display:block}.intro-support strong{font-size:.79rem;color:#36527b}.intro-support small{font-size:.74rem;line-height:1.7;color:var(--muted);margin-top:5px}.intro-orb{position:absolute;bottom:-125px;right:-110px;width:290px;height:290px;border:1px solid #d7e5fd;border-radius:50%;pointer-events:none}.intro-orb:after{content:'';position:absolute;inset:35px;border:1px dashed #d7e5fd;border-radius:50%}
.portal-auth-signup .portal-intro{justify-content:flex-start;padding-top:70px}.portal-auth-panel{align-self:stretch;display:flex;flex-direction:column;justify-content:center;min-width:0;padding:44px clamp(24px,4.3vw,56px);border:0;border-radius:0;background:linear-gradient(145deg,#193b74,#122c5c);color:#eef5ff;box-shadow:none}.portal-mode{display:flex;gap:20px;margin:0 0 30px;border-bottom:1px solid #ffffff26}.portal-auth-panel .portal-mode button{padding:0 0 12px;min-height:40px;border:0;border-bottom:2px solid transparent;border-radius:0;background:none;color:#a9c5e9;font-size:.84rem}.portal-auth-panel .portal-mode button.active{border-bottom-color:#79bcfa;color:#fff}.portal-auth-panel h2{font-size:1.65rem;margin:0;color:#fff;letter-spacing:-.04em}.portal-auth-panel .portal-muted{margin:12px 0 26px;color:#b6cbea;font-size:.86rem}.portal-form{display:grid;gap:18px}.portal-form label,.password-field>label,.portal-filters label{display:grid;gap:7px;color:#47607f;font-size:.81rem;font-weight:700}.portal-form input,.portal-filters input,.portal-filters select{width:100%;min-width:0;min-height:48px;padding:11px 13px;border:1px solid #cbd7e9;border-radius:8px;background:#fff;color:var(--ink);font:inherit;font-size:.94rem;font-weight:400}.portal-form input:disabled{opacity:.55;cursor:not-allowed}.portal-form small{font-size:.73rem;color:var(--muted);font-weight:400;line-height:1.65}.portal-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.portal-auth-panel .portal-form label,.portal-auth-panel .password-field>label{color:#c3d6ef}.portal-auth-panel .portal-form input:not([type=checkbox]),.portal-auth-panel :deep(.searchable-select>input){border:1px solid #41699e;background:#0c275a66;color:#fff}.portal-auth-panel .portal-form input::placeholder,.portal-auth-panel :deep(input::placeholder){color:#a2badc}.portal-auth-panel .portal-form small{color:#bacde8}.portal-auth-panel :deep(.searchable-select>label){color:#c3d6ef;font-size:.81rem}.portal-auth-panel :deep(.searchable-select>input){font-size:.94rem;min-height:48px}.portal-auth-panel .portal-form>button.portal-primary{background:#71b6f4;border-color:#71b6f4;color:#102e60;margin-top:5px;min-height:50px}.portal-auth-panel .portal-form>button.portal-primary:hover{background:#94c9f8}.password-field{display:grid;gap:7px}.password-wrap{position:relative;min-width:0}.password-wrap input{padding-right:49px}.employee-portal .password-toggle{position:absolute;right:4px;top:4px;width:40px;min-height:40px;padding:0;border:0;background:transparent;color:#bad2f1}.employee-portal .password-toggle:hover{background:#ffffff12}.password-toggle svg{width:19px;height:19px}.employee-portal .portal-auth-panel .recovery-link{color:#c7e1ff;margin-top:22px;line-height:1.8;font-size:.78rem}.auth-help{margin:24px 0 0;padding-top:20px;border-top:1px solid #ffffff1f;color:#a8c2e3;font-size:.75rem;line-height:1.7}.form-section-title{margin:5px 0 0;padding-bottom:10px;border-bottom:1px solid var(--line);font-size:.7rem;letter-spacing:.065em;text-transform:uppercase;color:#4e678b;font-weight:800}.portal-auth-panel .form-section-title{border-color:#ffffff24;color:#a7c7f1}.portal-agreement{display:grid;gap:12px;padding:15px;border:1px solid #ffffff24;border-radius:9px;background:#ffffff08}.employee-portal .portal-agreement .portal-text{color:#d8eaff;line-height:1.7}.portal-agreement label{display:flex;align-items:flex-start;gap:10px;font-weight:400;line-height:1.7;font-size:.75rem}.portal-agreement input{width:18px;min-height:18px;height:18px;margin-top:3px;flex:none;accent-color:#71b6f4}.portal-recovery-code{font-size:1.45rem!important;letter-spacing:.3em;font-variant-numeric:tabular-nums;text-align:center}

/* Personal payslip workspace */
.portal-overview{margin-bottom:26px}.portal-welcome{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:38px;align-items:center;border-radius:16px 16px 0 0;background:linear-gradient(120deg,#193b73,#122c5c);padding:32px 36px;color:#fff}.welcome-identity{min-width:0}.portal-welcome .portal-eyebrow{color:#a4c9fa;font-size:.64rem}.portal-welcome h1{margin:12px 0 10px;font-size:clamp(1.5rem,2.5vw,2.05rem);color:#fff;overflow-wrap:anywhere}.welcome-agency{display:grid;gap:5px;margin:16px 0 13px;overflow-wrap:anywhere}.welcome-agency>span{font-size:.64rem;letter-spacing:.07em;text-transform:uppercase;color:#aac5e8}.welcome-agency>strong{font-size:.92rem;color:#e4efff;font-weight:600;line-height:1.6}.welcome-meta{font-size:.8rem;color:#c2d4ed;margin:0 0 3px;overflow-wrap:anywhere}.welcome-identity>small{color:#aac5e8;font-size:.8rem}.welcome-message{color:#c2d4ed;font-size:.83rem;margin:22px 0 0}.latest-payslip{min-width:0;padding:22px 24px;border:1px solid #ffffff2b;border-radius:12px;background:#ffffff0b}.latest-payslip>span{display:block;font-size:.74rem;color:#c5d8f1}.latest-payslip>strong{display:block;color:#fff;font-size:2rem;margin:6px 0;font-variant-numeric:tabular-nums;letter-spacing:-.045em;overflow-wrap:anywhere}.latest-payslip>small{display:block;color:#bcd1ed;font-size:.72rem;line-height:1.7}.employee-portal .latest-payslip button{justify-content:space-between;width:100%;margin-top:17px;min-height:40px;border:0;background:#77baf6;color:#15325e;font-size:.75rem}.welcome-empty{display:flex;gap:16px;align-items:flex-start;color:#bdd3ef;font-size:.86rem;line-height:1.75}.welcome-empty svg{width:30px;height:30px}.portal-current-sites{display:flex;align-items:center;flex-wrap:wrap;gap:14px 22px;background:#fff;border:1px solid var(--line);border-top:0;border-radius:0 0 16px 16px;padding:20px 28px}.assignment-caption{display:flex;align-items:center;gap:8px;color:#71839f}.assignment-caption svg{width:18px;height:18px}.site-caption{font-size:.72rem;font-weight:700}.current-site{display:grid;gap:3px;min-width:0;padding-left:20px;border-left:1px solid var(--line)}.current-site strong{font-size:.83rem;color:#294469;overflow-wrap:anywhere}.current-site small,.portal-current-sites>small{font-size:.73rem;color:var(--muted);overflow-wrap:anywhere}
.portal-payslips{padding:28px}.payslip-list-heading{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:24px}.payslip-list-heading h2{font-size:1.6rem;margin:7px 0 8px}.payslip-list-heading p:not(.portal-eyebrow){font-size:.83rem;color:var(--muted);margin:0}.employee-portal .portal-sync{font-size:.75rem;padding:8px 12px;min-height:40px}.portal-sync svg{width:17px;height:17px}.portal-filters{display:grid;grid-template-columns:1fr 170px auto;align-items:end;gap:16px;margin-bottom:22px;padding:18px;background:#f6f8fc;border:1px solid #e8edf5;border-radius:10px}.portal-filters input,.portal-filters select{min-height:44px;font-size:.86rem}.portal-filters>span{font-size:.74rem;color:var(--muted);padding-bottom:12px;white-space:nowrap}.portal-table{max-width:100%;overflow:auto;border:1px solid var(--line);border-radius:10px}.portal-table table{border-collapse:collapse;width:100%;min-width:870px;text-align:left}.portal-table th{background:#f5f8fc;color:#667d9c;font-size:.63rem;text-transform:uppercase;letter-spacing:.05em;font-weight:800}.portal-table th,.portal-table td{padding:18px 16px;border-bottom:1px solid #e8edf5}.portal-table td{font-size:.81rem;vertical-align:middle}.portal-table td:nth-child(n+3):nth-child(-n+5){white-space:nowrap;font-variant-numeric:tabular-nums}.portal-table td:nth-child(5){color:#1e539d}.portal-table td>strong{font-weight:700}.portal-table td>small{display:block;color:var(--muted);font-size:.68rem;margin-top:7px}.portal-table tr:last-child td{border-bottom:0}.portal-table td>button{font-size:.76rem;white-space:nowrap}.latest-label{display:inline-flex;padding:3px 7px;background:#eaf2ff;border:1px solid #d7e6fd;color:#2d5ea1;border-radius:5px;font-size:.62rem;font-weight:700;line-height:1.4}.portal-table .latest-label{margin-left:7px}.portal-mobile-payslips{display:none}.portal-footer{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin-top:28px;padding:20px 0;color:var(--muted);font-size:.73rem;line-height:1.75}.portal-footer>span{max-width:400px;text-align:right}.portal-footer .portal-text{font-size:.73rem}
/* Account settings and saved payslip detail */
.portal-settings{max-width:660px;margin:auto;padding:30px}.portal-settings h2{margin:8px 0;font-size:1.8rem}.portal-settings>.portal-text{margin-bottom:25px}.portal-settings .portal-muted{margin:10px 0 20px}.settings-identity{display:grid;gap:4px;padding:18px 20px;border:1px solid var(--line);border-radius:10px;background:#f5f8fd;margin-bottom:24px;overflow-wrap:anywhere}.settings-identity strong{font-size:.86rem}.settings-identity small{font-size:.74rem;color:var(--muted)}.portal-detail-controls{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:18px;align-items:center;margin-bottom:22px;padding:16px 18px;border:1px solid var(--line);border-radius:12px;background:#fff}.portal-posted{display:grid;gap:4px;justify-self:end;text-align:right;min-width:0}.portal-posted small{font-size:.65rem;color:var(--muted)}.portal-posted strong{font-size:.76rem;color:#456080;line-height:1.6}.portal-posted{grid-template-columns:minmax(0,1fr) auto;column-gap:8px}.portal-posted strong{grid-column:1}.employee-portal .portal-detail-refresh{grid-column:2;grid-row:1/3;align-self:center;width:32px;min-height:36px;padding:0;border:0;background:transparent}.portal-detail-refresh svg{width:17px;height:17px}.portal-save-actions{display:flex;gap:8px}.portal-save-actions>button{font-size:.78rem;white-space:nowrap}
/* Image preview and privacy notice share the Employee List close-control style. */
.portal-modal{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:1400;padding:24px;background:#10244899;overscroll-behavior:contain}.portal-modal>section{width:100%;max-width:760px;max-height:92dvh;display:flex;flex-direction:column;background:#fff;border:1px solid var(--line);border-radius:16px;box-shadow:0 25px 75px #0a1c4a40;overflow:hidden;outline:none}.portal-modal header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:22px 26px;border-bottom:1px solid var(--line);flex-shrink:0}.portal-modal h2{font-size:1.4rem;margin:6px 0 9px}.portal-modal small{display:block;color:var(--muted);font-size:.78rem;line-height:1.7}.employee-portal .portal-modal header>button{width:36px;min-height:36px;height:36px;flex:none;display:grid;place-items:center;padding:0;border:0;border-radius:9px;background:transparent;color:#53657d}.employee-portal .portal-modal header>button:hover{background:#edf3fa;color:#17375f}.portal-modal header>button svg{width:19px;height:19px;stroke-width:2}.portal-modal footer{display:flex;justify-content:flex-end;align-items:center;flex-wrap:wrap;gap:10px;padding:18px 26px;border-top:1px solid var(--line);flex-shrink:0}.portal-privacy-text{min-height:0;padding:6px 26px 26px;overflow:auto}.portal-privacy-text h3{font-size:.95rem;margin:22px 0 9px}.portal-privacy-text p{font-size:.84rem;line-height:1.85;color:#516885}.portal-privacy-text a{color:#2357ac;text-decoration:underline;text-underline-offset:3px}.portal-image-modal>section{max-width:1120px}.portal-image-preview{min-height:0;overflow:auto;padding:20px;background:#eef3fa}.portal-image-preview img{display:block;width:auto;max-width:100%;max-height:calc(92dvh - 230px);height:auto;object-fit:contain;margin:auto;box-shadow:0 3px 18px #18345612;user-select:auto;-webkit-user-select:auto}.portal-download{display:inline-flex;align-items:center;justify-content:center;min-height:44px;border-radius:8px;padding:11px 16px;background:var(--blue);color:#fff;font-size:.83rem;font-weight:700;text-decoration:none}.portal-image-modal .portal-error{margin:0 20px 16px}

.settings-pending{margin:0;padding:12px 14px;border:1px solid #ccdcf6;border-radius:8px;background:#f0f5ff;color:#375f96;font-size:.78rem;line-height:1.7}
.portal-confirm-modal{z-index:1500}.portal-confirm-modal>section{max-width:540px}.portal-confirm-modal h2{font-size:1.35rem;margin-top:8px}.confirmation-body{padding:20px 26px;overflow:auto;min-height:0}.confirmation-body>p{margin:0 0 17px;color:#536984;font-size:.88rem;line-height:1.8}.confirmation-body>p:last-child{margin-bottom:0}.confirmation-changes{display:grid;gap:15px;margin:0 0 18px;padding:18px;border:1px solid var(--line);border-radius:10px;background:#f7f9fd}.confirmation-changes dt{font-size:.73rem;color:#627c9f;font-weight:700;margin-bottom:6px}.confirmation-changes dd{margin:0;display:grid;gap:5px;overflow-wrap:anywhere;font-size:.88rem;line-height:1.7}.confirmation-changes strong{color:#204c88;font-weight:600}.change-before{color:#71819a;text-decoration:line-through;font-size:.8rem}.confirmation-body>.confirmation-warning{padding:12px 14px;border:1px solid #f0d3a5;border-radius:8px;background:#fff8ec;color:#805716;font-size:.81rem}.confirmation-body>.confirmation-note{font-size:.79rem;color:#536d93}.employee-portal button.portal-primary.confirm-destructive{background:#a7333b;border-color:#a7333b}.employee-portal button.portal-primary.confirm-destructive:hover{background:#8d2931}.portal-confirm-modal footer{gap:10px}.portal-confirm-modal footer>button{flex:1;min-width:0;font-size:.8rem}
/* Phone layouts keep forms readable and every primary action in reach. */
@media(max-width:950px){.portal-auth{grid-template-columns:.85fr 1.15fr}.portal-intro{padding:32px}.portal-intro h1{font-size:3.3rem}.portal-auth-panel{padding:34px 28px}.portal-welcome{grid-template-columns:1fr 270px;padding:28px;gap:24px}.portal-filters{grid-template-columns:1fr 150px}.portal-filters>span{grid-column:1/-1;padding:0}}
@media(max-width:760px){.confirmation-body{padding:18px}.portal-confirm-modal header{padding:18px}.portal-confirm-modal footer{padding:14px 18px}.portal-confirm-modal h2{font-size:1.2rem}.portal-top{padding:20px 18px 18px}.portal-content{padding:0 18px 24px}.portal-top-caption{font-size:.56rem;max-width:80px;text-align:right;line-height:1.8}.portal-brand img{width:39px;height:39px}.portal-brand strong{font-size:1rem}.portal-brand small{font-size:.67rem}.portal-top nav svg{display:none}.portal-top nav button{padding:9px 11px;font-size:.74rem}.portal-auth{display:block;min-height:0;max-width:540px;margin:auto;border-radius:16px}.portal-intro{padding:30px 28px 28px}.portal-intro h1{max-width:none;margin:14px 0 13px;font-size:2.3rem;line-height:1.07}.portal-intro h1 em{display:inline}.portal-intro h1 em:before{content:' '}.portal-intro>p:not(.portal-eyebrow){max-width:35ch;font-size:.87rem;line-height:1.8}.intro-line{width:58px;margin:20px 0 0}.intro-support{display:none}.intro-orb{width:190px;height:190px;right:-115px;bottom:-100px}.portal-auth-panel{padding:28px}.portal-auth-panel h2{font-size:1.55rem}.portal-mode{margin-bottom:24px}.portal-auth-panel .portal-muted{font-size:.83rem;margin:12px 0 24px}.portal-form{gap:17px}.portal-form input,.portal-filters input,.portal-filters select,.portal-auth-panel :deep(.searchable-select>input){font-size:16px}.portal-auth-signup .portal-intro{padding-block:24px}.portal-auth-signup .portal-intro h1{font-size:2rem}.portal-auth-signup .intro-line{display:none}.portal-welcome{grid-template-columns:1fr;gap:24px;padding:25px 23px}.portal-welcome h1{font-size:1.5rem;margin-top:10px}.welcome-message{margin-top:14px}.latest-payslip{padding:20px}.latest-payslip>strong{font-size:2.15rem;margin:5px 0}.latest-payslip>small{font-size:.76rem}.employee-portal .latest-payslip button{font-size:.82rem;min-height:44px}.portal-current-sites{display:grid;gap:13px;padding:20px 23px}.current-site{border-left:0;border-top:1px solid #edf1f7;padding:12px 0 0}.current-site strong{font-size:.86rem}.portal-overview{margin-bottom:24px}.portal-payslips{background:none;box-shadow:none;border:0;padding:0}.payslip-list-heading{margin-bottom:18px;align-items:flex-start}.payslip-list-heading h2{font-size:1.45rem}.payslip-list-heading p:not(.portal-eyebrow){max-width:24ch;font-size:.8rem}.employee-portal .portal-sync{min-height:40px;font-size:.72rem;padding:8px 10px}.portal-filters{grid-template-columns:minmax(0,1fr) 116px;gap:12px;background:#fff;padding:16px;border-color:var(--line);margin-bottom:18px}.portal-filters label{font-size:.76rem}.portal-filters>span{font-size:.72rem}.portal-table{display:none}.portal-mobile-payslips{display:grid;gap:16px}.mobile-payslip-card{border:1px solid var(--line);border-radius:13px;background:#fff;padding:22px;min-width:0}.mobile-payslip-card header{display:grid;gap:12px}.mobile-card-label{display:flex;justify-content:space-between;align-items:center;gap:10px}.mobile-card-label>span{font-size:.63rem;color:#4c6b95;font-weight:800;text-transform:uppercase;letter-spacing:.09em}.mobile-payslip-card header>strong{font-size:1rem;line-height:1.5;letter-spacing:-.02em}.mobile-payslip-site{font-size:.85rem;line-height:1.65;font-weight:600;overflow-wrap:anywhere;color:#355374;margin:14px 0 8px}.mobile-assignment{font-size:.67rem;display:inline-block;border-radius:5px;background:#f0f4f9;padding:3px 8px;color:#607998}.mobile-net{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:18px 0;padding:17px 0;border-block:1px solid #e7edf6}.mobile-net>span{font-size:.8rem;color:var(--muted)}.mobile-net>strong{font-size:1.7rem;font-weight:800;color:#204f99;letter-spacing:-.04em;font-variant-numeric:tabular-nums}.mobile-payslip-card dl{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0 0 19px}.mobile-payslip-card dt{font-size:.7rem;color:var(--muted);margin-bottom:4px}.mobile-payslip-card dd{margin:0;font-size:.87rem;font-weight:700;overflow-wrap:anywhere}.mobile-payslip-card footer{display:grid;gap:16px}.mobile-payslip-card footer>small{font-size:.68rem;color:var(--muted);line-height:1.6}.employee-portal .mobile-payslip-card footer>button{width:100%;min-height:46px;background:#eef4ff;color:#2458ad;border-color:#d2e1f9;font-size:.8rem}.portal-footer{flex-direction:column;gap:12px;margin-top:22px;padding:18px 2px}.portal-footer>span{max-width:340px;text-align:left}.portal-settings{padding:24px}.portal-settings h2{font-size:1.65rem}.portal-detail-controls{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px 10px;padding:14px}.portal-detail-controls>button{padding:10px 6px;font-size:.72rem}.portal-posted small{font-size:.6rem}.portal-posted strong{font-size:.7rem}.portal-save-actions{display:grid;grid-template-columns:1fr 1fr;grid-column:1/-1}.portal-save-actions>button{min-height:46px;font-size:.77rem}.portal-modal{padding:10px}.portal-modal>section{max-height:94dvh;border-radius:13px}.portal-modal header{padding:18px;gap:12px}.portal-modal h2{font-size:1.2rem}.portal-modal small{font-size:.73rem}.portal-privacy-text{padding:0 18px 18px}.portal-modal footer{padding:14px 18px}.portal-modal footer>button{white-space:normal;line-height:1.65}.portal-image-preview{padding:10px}.portal-image-preview img{max-height:calc(94dvh - 260px)}.portal-image-modal footer{display:grid;grid-template-columns:1fr 1fr;gap:8px}.portal-image-modal footer>*{font-size:.73rem;padding:10px 8px;min-height:44px;text-align:center}.portal-image-modal footer>button:last-child:nth-child(3){grid-column:1/-1}}
@media(max-width:390px){.portal-top{padding:16px 12px;gap:10px}.portal-content{padding:0 12px 20px}.portal-brand{gap:8px}.portal-brand img{width:34px;height:34px}.portal-brand strong{font-size:.89rem}.portal-brand small{font-size:.58rem}.portal-top nav{gap:5px}.portal-top nav button{padding:8px;font-size:.67rem}.portal-intro{padding:26px 23px}.portal-intro h1{font-size:2.1rem}.portal-auth-panel{padding:26px 22px}.portal-grid{grid-template-columns:1fr}.portal-mode{gap:18px}.portal-auth-panel .portal-mode button{font-size:.8rem}.portal-welcome{padding:23px 20px}.portal-welcome h1{font-size:1.35rem}.latest-payslip{padding:18px}.latest-payslip>strong{font-size:1.9rem}.portal-current-sites{padding:18px 20px}.mobile-payslip-card{padding:19px}.mobile-net>strong{font-size:1.5rem}.portal-settings{padding:22px 19px}.portal-filters{grid-template-columns:minmax(0,1fr) 116px;padding:14px;gap:10px}}
@media(prefers-reduced-motion:reduce){.loading-mark{animation:none}}
@media print{.portal-top,.portal-overview,.portal-footer,.portal-detail-controls,.portal-error,.portal-success,.portal-modal{display:none!important}.portal-content{padding:0;max-width:none}.employee-portal{background:#fff}.portal-content:has(.payslip-sheet){margin:0}}
</style>
