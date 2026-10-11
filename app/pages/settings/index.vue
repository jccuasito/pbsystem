<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

type Permission = { canView: boolean; canEdit: boolean }
type User = { id: number; name: string; email: string; role: string; status: string; access: Record<string, Permission> }
type Backup = { name: string; kind: string; createdAt: string; size: number }
type Section = 'account' | 'users' | 'backups'

const section = ref<Section>('account')
const account = ref<any>(null)
const access = ref<any>(null)
const users = ref<User[]>([])
const backups = ref<Backup[]>([])
const automatic = ref(false)
const selectedUserId = ref<number | null>(null)
const draft = ref<User | null>(null)
const userSearch = ref('')
const restoreCandidate = ref<Backup | null>(null)
const restoreAcknowledged = ref(false)
const uploadFile = ref<File | null>(null)
const uploading = ref(false)
const busy = ref(false)
const loading = ref(true)
const error = ref('')
const success = ref('')

const isAdmin = computed(() => access.value?.isAdmin === true)
const filteredUsers = computed(() => users.value.filter(user => `${user.name} ${user.email}`.toLowerCase().includes(userSearch.value.toLowerCase().trim())))
const latestBackup = computed(() => backups.value[0] || null)

function errorMessage(cause: any) {
  return cause?.data?.statusMessage || cause?.statusMessage || cause?.message || 'The request could not be completed. Please try again.'
}
function cloneUser(user: User) { return JSON.parse(JSON.stringify(user)) as User }
function selectUser(user: User) { selectedUserId.value = user.id; draft.value = cloneUser(user); error.value = ''; success.value = '' }
function formatDate(value: string) { return new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore' }) }
function formatSize(value: number) { return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB` }
function backupLabel(kind: string) { return kind === 'daily' ? 'Automatic' : kind === 'manual' ? 'Created manually' : kind === 'before-restore' ? 'Safety copy' : 'Uploaded' }
function chooseSection(next: Section) { section.value = next; error.value = ''; success.value = '' }

async function loadSettings() {
  loading.value = true
  error.value = ''
  try {
    const [profile, rights] = await Promise.all([$fetch<any>('/api/auth/me'), $fetch<any>('/api/settings/access')])
    account.value = profile.user
    access.value = rights
    if (rights.isAdmin) {
      const [userResult, backupResult] = await Promise.all([$fetch<any>('/api/settings/users'), $fetch<any>('/api/settings/backups')])
      users.value = userResult.users
      backups.value = backupResult.backups
      automatic.value = backupResult.automatic
      if (selectedUserId.value) {
        const selected = users.value.find(user => user.id === selectedUserId.value)
        draft.value = selected ? cloneUser(selected) : null
      }
    }
  } catch (cause) { error.value = errorMessage(cause) }
  finally { loading.value = false }
}

async function saveUser() {
  if (!draft.value) return
  busy.value = true; error.value = ''; success.value = ''
  try {
    await $fetch('/api/settings/users', { method: 'PUT', body: { userId: draft.value.id, role: draft.value.role, status: draft.value.status, access: draft.value.access } })
    users.value = (await $fetch<any>('/api/settings/users')).users
    const updated = users.value.find(user => user.id === draft.value?.id)
    if (updated) draft.value = cloneUser(updated)
    success.value = `Access settings saved for ${draft.value?.name}.`
  } catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
}

async function createBackup() {
  busy.value = true; error.value = ''; success.value = ''
  try {
    await $fetch('/api/settings/backups', { method: 'POST' })
    backups.value = (await $fetch<any>('/api/settings/backups')).backups
    success.value = 'Backup created. You can download it from the list below.'
  } catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
}

function downloadBackup(name: string) { window.location.href = `/api/settings/backups/download?name=${encodeURIComponent(name)}` }
function askRestore(backup: Backup) { restoreCandidate.value = backup; restoreAcknowledged.value = false; error.value = ''; success.value = '' }

async function restoreBackup() {
  if (!restoreCandidate.value || !restoreAcknowledged.value) return
  busy.value = true; error.value = ''; success.value = ''
  try {
    await $fetch('/api/settings/backups/restore', { method: 'POST', body: { name: restoreCandidate.value.name, confirmation: 'RESTORE' } })
    restoreCandidate.value = null
    await loadSettings()
    success.value = 'Backup restored. A safety copy was created first. Sign in again if your account changed.'
  } catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
}

async function importBackup() {
  if (!uploadFile.value) return
  const form = new FormData()
  form.append('sql', uploadFile.value)
  busy.value = true; error.value = ''; success.value = ''
  try {
    await $fetch('/api/settings/backups/import', { method: 'POST', body: form })
    backups.value = (await $fetch<any>('/api/settings/backups')).backups
    uploadFile.value = null
    uploading.value = false
    success.value = 'Backup added to the list. Select Restore when you need to recover it.'
  } catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
}

onMounted(loadSettings)
</script>

<template>
  <section class="settings-page">
    <header class="page-head">
      <span class="eyebrow">SYSTEM</span>
      <h1>Settings</h1>
      <p>Your account, team access, and saved backups in one place.</p>
    </header>

    <div v-if="error" class="notice error" role="alert">{{ error }}</div>
    <div v-if="success" class="notice success" role="status">{{ success }}</div>
    <div v-if="loading" class="empty">Loading settings...</div>
    <template v-else>
      <nav class="tabs" aria-label="Settings sections">
        <button type="button" :class="{ active: section === 'account' }" @click="chooseSection('account')">My account</button>
        <button v-if="isAdmin" type="button" :class="{ active: section === 'users' }" @click="chooseSection('users')">Team access</button>
        <button v-if="isAdmin" type="button" :class="{ active: section === 'backups' }" @click="chooseSection('backups')">Backups</button>
      </nav>

      <div v-if="section === 'account'" class="two-column">
        <article class="panel profile-panel">
          <div class="panel-kicker">MY ACCOUNT</div>
          <div class="identity"><span class="avatar">{{ account?.firstName?.[0] }}{{ account?.lastName?.[0] }}</span><div><h2>{{ account?.firstName }} {{ account?.lastName }}</h2><p>{{ account?.email }}</p></div></div>
          <dl class="facts"><div><dt>Role</dt><dd>{{ account?.userType }}</dd></div><div><dt>Department</dt><dd>{{ account?.departmentName || 'Not assigned' }}</dd></div><div><dt>Email status</dt><dd>{{ account?.emailVerified ? 'Verified' : 'Not verified' }}</dd></div></dl>
          <NuxtLink class="button primary" to="/userprofile/viewprofile">View my profile</NuxtLink>
        </article>
        <article class="panel">
          <div class="panel-kicker">WHAT I CAN ACCESS</div>
          <h2>Your workspace</h2>
          <p class="subtle">The sections available to your account.</p>
          <div class="access-list"><div v-for="module in access?.modules?.filter((item: any) => access?.access?.[item.key]?.canView)" :key="module.key"><span>{{ module.label }}</span><span class="access-tag">{{ access?.access?.[module.key]?.canEdit ? 'Can make changes' : 'View only' }}</span></div></div>
        </article>
      </div>

      <div v-else-if="section === 'users' && isAdmin" class="team-layout">
        <article class="panel people-panel">
          <div class="panel-kicker">TEAM ACCESS</div><h2>People</h2>
          <p class="subtle">Choose someone to set what they can see or change.</p>
          <label class="sr-only" for="user-search">Search people</label><input id="user-search" v-model="userSearch" class="search" placeholder="Search by name or email" />
          <div class="people-list"><button v-for="user in filteredUsers" :key="user.id" type="button" :class="{ selected: user.id === selectedUserId }" @click="selectUser(user)"><span><strong>{{ user.name }}</strong><small>{{ user.email }}</small></span><span class="mini-status" :class="{ inactive: user.status !== 'Active' }">{{ user.status }}</span></button><div v-if="!filteredUsers.length" class="empty">No matching users.</div></div>
        </article>
        <article v-if="draft" class="panel permissions-panel">
          <div class="panel-kicker">ACCOUNT ACCESS</div><h2>{{ draft.name }}</h2><p class="subtle">{{ draft.email }}</p>
          <div class="form-pair"><label>Account role<select v-model="draft.role"><option>Admin</option><option>Supervisor</option><option>Encoder</option><option>Viewer</option></select></label><label>Account status<select v-model="draft.status"><option>Active</option><option>Inactive</option></select></label></div>
          <p v-if="draft.role === 'Admin'" class="info-note">Admins can view and change all sections.</p>
          <div class="permissions-title"><h3>Section access</h3><p>Choose the sections this person can open and update.</p></div>
          <div class="permission-head"><strong>Section</strong><strong>Can view</strong><strong>Can edit</strong></div>
          <div v-for="module in access?.modules" :key="module.key" class="permission-row"><span>{{ module.label }}</span><label><input v-model="draft.access[module.key].canView" type="checkbox" :disabled="draft.role === 'Admin'" @change="!draft!.access[module.key].canView && (draft!.access[module.key].canEdit = false)" /><span class="sr-only">Can view {{ module.label }}</span></label><label><input v-model="draft.access[module.key].canEdit" type="checkbox" :disabled="draft.role === 'Admin' || !draft.access[module.key].canView" /><span class="sr-only">Can edit {{ module.label }}</span></label></div>
          <div class="panel-footer"><button class="button primary" type="button" :disabled="busy" @click="saveUser">{{ busy ? 'Saving...' : 'Save changes' }}</button></div>
        </article>
        <article v-else class="panel select-person"><h2>Select a person</h2><p>Choose a team member on the left to manage their access.</p></article>
      </div>

      <div v-else-if="section === 'backups' && isAdmin" class="backup-layout">
        <div class="backup-overview">
          <article class="panel schedule-card"><div class="panel-kicker">AUTOMATIC BACKUP</div><h2>Protected every day</h2><p class="subtle">A new copy is saved at 12:00 AM (Asia/Singapore) while the computer and database are running.</p><div class="schedule-status"><span class="dot" :class="{ off: !automatic }"></span>{{ automatic ? 'Daily backup is on' : 'Daily backup is off' }}</div></article>
          <article class="panel latest-card"><div class="panel-kicker">LATEST SAVED COPY</div><h2>{{ latestBackup ? formatDate(latestBackup.createdAt) : 'No backup yet' }}</h2><p class="subtle">{{ latestBackup ? `${backupLabel(latestBackup.kind)} · ${formatSize(latestBackup.size)}` : 'Create your first backup to protect your records.' }}</p><button v-if="latestBackup" class="button secondary" type="button" @click="downloadBackup(latestBackup.name)">Download latest</button></article>
        </div>
        <article class="panel library-panel">
          <div class="library-head"><div><div class="panel-kicker">SAVED COPIES</div><h2>Backup history</h2><p class="subtle">Download a copy to keep it somewhere safe. Restore only when you need to recover older data.</p></div><button class="button primary" type="button" :disabled="busy" @click="createBackup">{{ busy ? 'Working...' : 'Back up now' }}</button></div>
          <div v-if="!backups.length" class="empty">No saved backups yet.</div>
          <div v-else class="backup-table-wrap"><table><thead><tr><th>Date saved</th><th>Created by</th><th>Size</th><th>Actions</th></tr></thead><tbody><tr v-for="backup in backups" :key="backup.name"><td><strong>{{ formatDate(backup.createdAt) }}</strong></td><td>{{ backupLabel(backup.kind) }}</td><td>{{ formatSize(backup.size) }}</td><td><div class="row-actions"><button class="button secondary" type="button" @click="downloadBackup(backup.name)">Download</button><button class="button text-button" type="button" @click="askRestore(backup)">Restore</button></div></td></tr></tbody></table></div>
          <button class="upload-link" type="button" :aria-expanded="uploading" @click="uploading = !uploading">{{ uploading ? 'Hide upload' : 'Upload a downloaded backup' }}</button>
          <div v-if="uploading" class="upload-area"><p>Have a backup file from this system? Add it here so it appears in your saved copies.</p><label>Choose saved backup file<input type="file" accept=".sql" @change="uploadFile = ($event.target as HTMLInputElement).files?.[0] || null" /></label><button class="button secondary" type="button" :disabled="busy || !uploadFile" @click="importBackup">Add backup</button></div>
        </article>
      </div>
    </template>

    <div v-if="restoreCandidate" class="modal-backdrop" role="presentation" @click.self="!busy && (restoreCandidate = null)"><section class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="restore-title"><div class="panel-kicker">RESTORE BACKUP</div><h2 id="restore-title">Go back to this saved copy?</h2><p>This will replace the current records with the data saved on <strong>{{ formatDate(restoreCandidate.createdAt) }}</strong>. Changes made after that backup may be lost. The system will save a safety copy first.</p><label class="confirm-check"><input v-model="restoreAcknowledged" type="checkbox" /><span>I understand that newer changes may be replaced.</span></label><div class="dialog-actions"><button class="button secondary" type="button" :disabled="busy" @click="restoreCandidate = null">Cancel</button><button class="button danger" type="button" :disabled="busy || !restoreAcknowledged" @click="restoreBackup">{{ busy ? 'Restoring...' : 'Restore this backup' }}</button></div></section></div>
  </section>
</template>

<style scoped>
.settings-page{max-width:1540px;margin:auto;padding:34px clamp(18px,3vw,42px) 70px;color:var(--ink);font-family:'Plus Jakarta Sans',Inter,system-ui,sans-serif}.page-head{margin-bottom:28px}.eyebrow,.panel-kicker{color:#2862ce;font-size:.77rem;font-weight:800;letter-spacing:.11em}.page-head h1{font-size:2.1rem;letter-spacing:-.035em;margin:5px 0}.page-head p,.subtle{color:var(--muted);line-height:1.55}.page-head p{margin:0;font-size:1rem}.tabs{display:flex;gap:8px;border-bottom:1px solid var(--line);margin-bottom:24px}.tabs button{border:0;border-bottom:3px solid transparent;background:transparent;color:var(--muted);padding:14px 18px;font:inherit;font-weight:750;cursor:pointer}.tabs button.active{color:#245fe5;border-color:#245fe5}.two-column,.backup-overview{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.panel{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:27px;min-width:0;box-shadow:0 8px 26px rgba(21,48,96,.035)}.panel h2{font-size:1.3rem;margin:8px 0 5px}.panel h3{font-size:1.05rem;margin:0 0 4px}.panel p{margin:0}.identity{display:flex;align-items:center;gap:16px;margin:24px 0}.identity h2{margin:0 0 4px}.identity p{color:var(--muted);overflow-wrap:anywhere}.avatar{width:62px;height:62px;border-radius:17px;background:#e9f0ff;color:#2256bb;display:grid;place-items:center;font-size:1.2rem;font-weight:800;flex:none}.facts{margin:0 0 22px}.facts div,.access-list div{display:flex;justify-content:space-between;gap:14px;padding:13px 0;border-bottom:1px solid var(--line)}.facts dt{color:var(--muted)}.facts dd{margin:0;font-weight:700}.access-list{margin-top:18px}.access-tag{color:#196c52;font-weight:700;font-size:.88rem;white-space:nowrap}.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;border-radius:10px;padding:0 17px;font:inherit;font-weight:750;text-decoration:none;cursor:pointer;white-space:nowrap}.primary{border:1px solid #2862e9;background:#2862e9;color:#fff}.secondary{border:1px solid #cbdaf5;background:var(--surface);color:#194788}.danger{border:1px solid #c73939;background:#c73939;color:#fff}.text-button{border:0;background:transparent;color:#235bc9}.button:disabled{opacity:.55;cursor:not-allowed}.notice{padding:13px 16px;border-radius:10px;margin-bottom:18px}.notice.error{background:#fff0f0;color:#a42828}.notice.success{background:#e9f8ee;color:#157348}.empty{padding:30px;text-align:center;color:var(--muted)}.team-layout{display:grid;grid-template-columns:minmax(280px,.8fr) minmax(480px,1.2fr);gap:20px;align-items:start}.search,.form-pair select,.upload-area input{width:100%;min-width:0;min-height:44px;border:1px solid #cbdaf5;border-radius:10px;background:var(--surface);color:var(--ink);padding:0 12px;font:inherit}.search{margin:18px 0 12px}.people-list{display:grid;gap:8px;max-height:680px;overflow:auto}.people-list button{display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;text-align:left;padding:13px;border:1px solid var(--line);border-radius:11px;background:var(--surface);color:var(--ink);cursor:pointer}.people-list button.selected{border-color:#2862e9;background:#eef4ff}.people-list small{display:block;color:var(--muted);margin-top:3px;overflow-wrap:anywhere}.mini-status{color:#147a50;background:#e5f8ed;padding:4px 9px;border-radius:999px;font-size:.75rem;font-weight:750}.mini-status.inactive{color:#9a4d12;background:#fff3dd}.form-pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:22px 0}.form-pair label,.upload-area label{display:grid;gap:7px;font-size:.88rem;font-weight:700}.info-note{background:#edf3ff;padding:12px;border-radius:10px;color:#315b9b}.permissions-title{margin:25px 0 8px}.permissions-title p{color:var(--muted);font-size:.9rem}.permission-head,.permission-row{display:grid;grid-template-columns:minmax(0,1fr) 86px 86px;align-items:center;gap:8px;padding:11px 6px;border-bottom:1px solid var(--line)}.permission-head{color:var(--muted);font-size:.75rem;text-transform:uppercase}.permission-head strong:not(:first-child),.permission-row label{text-align:center}.permission-row input{width:18px;height:18px;accent-color:#2862e9}.panel-footer{display:flex;justify-content:flex-end;margin-top:20px}.select-person{display:grid;place-content:center;min-height:290px;text-align:center}.select-person p{color:var(--muted)}.backup-layout{display:grid;gap:20px}.schedule-card,.latest-card{min-height:220px}.schedule-status{display:flex;align-items:center;gap:9px;margin-top:22px;color:#147a50;font-weight:750}.dot{width:9px;height:9px;background:#1bb36e;border-radius:50%}.dot.off{background:#dc7b3e}.latest-card .button{margin-top:22px}.library-head{display:flex;justify-content:space-between;align-items:start;gap:20px;margin-bottom:22px}.library-head .subtle{max-width:650px}.backup-table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left}th{background:#f1f5fc;color:#526f9f;text-transform:uppercase;font-size:.75rem}td,th{padding:14px;border-bottom:1px solid var(--line);white-space:nowrap}td strong{font-weight:700}.row-actions{display:flex;gap:6px}.upload-link{margin-top:24px;border:0;background:transparent;color:#245fe5;font:inherit;font-weight:750;cursor:pointer;padding:0}.upload-area{margin-top:14px;padding:18px;border:1px dashed #b9cdef;border-radius:12px;background:#f7faff;display:grid;gap:14px;max-width:680px}.upload-area p{color:var(--muted)}.upload-area input{padding:9px}.upload-area .button{justify-self:start}.modal-backdrop{position:fixed;inset:0;z-index:1000;background:rgba(10,25,55,.54);display:grid;place-items:center;padding:18px}.confirm-dialog{width:min(100%,510px);background:var(--surface);border-radius:18px;padding:30px;box-shadow:0 28px 70px rgba(8,20,42,.24)}.confirm-dialog h2{margin:9px 0 13px}.confirm-dialog p{color:var(--muted);line-height:1.55}.confirm-check{display:flex;align-items:start;gap:11px;margin:23px 0;font-weight:700}.confirm-check input{width:19px;height:19px;accent-color:#2862e9}.dialog-actions{display:flex;justify-content:flex-end;gap:9px}.sr-only{position:absolute;width:1px;height:1px;clip:rect(0,0,0,0);overflow:hidden}@media(max-width:900px){.two-column,.backup-overview,.team-layout{grid-template-columns:1fr}}@media(max-width:560px){.settings-page{padding:24px 16px 55px}.page-head h1{font-size:1.75rem}.tabs button{padding:12px 10px;font-size:.88rem}.panel{padding:19px}.form-pair{grid-template-columns:1fr}.library-head{display:grid}.dialog-actions{flex-wrap:wrap}}
</style>
