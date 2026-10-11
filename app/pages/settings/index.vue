<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

type Permission = { canView: boolean; canEdit: boolean }
type User = { id: number; name: string; email: string; departmentId: number | null; role: string; status: string; access: Record<string, Permission> }
type Department = { id: number; name: string; status: string }
type Backup = { name: string; kind: string; createdAt: string; size: number }
type Section = 'account' | 'users' | 'backups'

const section = ref<Section>('account')
const account = ref<any>(null)
const access = ref<any>(null)
const users = ref<User[]>([])
const departments = ref<Department[]>([])
const backups = ref<Backup[]>([])
const automatic = ref(false)
const selectedUserId = ref<number | null>(null)
const draft = ref<User | null>(null)
const userSearch = ref('')
const restoreCandidate = ref<Backup | null>(null)
const restoreAcknowledged = ref(false)
const restorePhrase = ref('')
const showBackups = ref(false)
const backupLimit = ref(3)
const showAccessDetails = ref(false)
const uploadFile = ref<File | null>(null)
const uploading = ref(false)
const busy = ref(false)
const loading = ref(true)
const error = ref('')
const success = ref('')

const isAdmin = computed(() => access.value?.isAdmin === true)
const departmentGroups = computed(() => {
  const groups = departments.value.map(department => ({ key: `department-${department.id}`, name: department.name, status: department.status, users: users.value.filter(user => user.departmentId === department.id) }))
  const unassigned = users.value.filter(user => !departments.value.some(department => department.id === user.departmentId))
  if (unassigned.length) groups.push({ key: 'unassigned', name: 'Unassigned', status: '', users: unassigned })
  const query = userSearch.value.toLowerCase().trim()
  if (!query) return groups
  return groups.map(group => group.name.toLowerCase().includes(query)
    ? group
    : { ...group, users: group.users.filter(user => `${user.name} ${user.email} ${user.role} ${user.status}`.toLowerCase().includes(query)) }
  ).filter(group => group.name.toLowerCase().includes(query) || group.users.length)
})
const adminCount = computed(() => users.value.filter(user => user.role === 'Admin').length)
const latestBackup = computed(() => backups.value[0] || null)
const visibleBackups = computed(() => backups.value.slice(0, backupLimit.value))
const visibleModules = computed(() => (access.value?.modules || []).filter((item: any) => access.value?.access?.[item.key]?.canView))
const editableModuleCount = computed(() => visibleModules.value.filter((item: any) => access.value?.access?.[item.key]?.canEdit).length)

function errorMessage(cause: any) {
  return cause?.data?.statusMessage || cause?.statusMessage || cause?.message || 'The request could not be completed. Please try again.'
}
function cloneUser(user: User) { return JSON.parse(JSON.stringify(user)) as User }
function selectUser(user: User) { selectedUserId.value = user.id; draft.value = cloneUser(user); error.value = ''; success.value = '' }
function closeUser() { selectedUserId.value = null; draft.value = null; error.value = '' }
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase() }
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
      departments.value = userResult.departments
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
    success.value = `Access settings saved for ${updated?.name || draft.value.name}.`
    closeUser()
  } catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
}

async function createBackup() {
  busy.value = true; error.value = ''; success.value = ''
  try {
    await $fetch('/api/settings/backups', { method: 'POST' })
    backups.value = (await $fetch<any>('/api/settings/backups')).backups
    success.value = 'Backup created. You can download the latest copy above.'
  } catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
}

function downloadBackup(name: string) { window.location.href = `/api/settings/backups/download?name=${encodeURIComponent(name)}` }
function toggleBackups() { showBackups.value = !showBackups.value; backupLimit.value = 3 }
function closeRestore() { restoreCandidate.value = null; restoreAcknowledged.value = false; restorePhrase.value = '' }
function askRestore(backup: Backup) { restoreCandidate.value = backup; restoreAcknowledged.value = false; restorePhrase.value = ''; error.value = ''; success.value = '' }

async function restoreBackup() {
  if (!restoreCandidate.value || !restoreAcknowledged.value || restorePhrase.value !== 'RESTORE') return
  busy.value = true; error.value = ''; success.value = ''
  try {
    await $fetch('/api/settings/backups/restore', { method: 'POST', body: { name: restoreCandidate.value.name, confirmation: restorePhrase.value } })
    closeRestore()
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
    success.value = 'Backup added. Open saved backups if you need to download or restore it.'
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
      <div class="settings-shell">
        <nav class="section-nav" aria-label="Settings sections">
          <span class="nav-heading">WORKSPACE SETTINGS</span>
          <button type="button" :class="{ active: section === 'account' }" :aria-current="section === 'account' ? 'page' : undefined" @click="chooseSection('account')">
            <span class="nav-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.4-3.5 2.7-5.5 7-5.5s6.6 2 7 5.5"/></svg></span><span><strong>My account</strong><small>Profile and access</small></span>
          </button>
          <button v-if="isAdmin" type="button" :class="{ active: section === 'users' }" :aria-current="section === 'users' ? 'page' : undefined" @click="chooseSection('users')">
            <span class="nav-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M2.5 19c.3-3.1 2-5 5.5-5s5.2 1.9 5.5 5M16 5.5a3 3 0 0 1 0 5.8M16.5 14c3.2.1 4.7 1.9 5 5"/></svg></span><span><strong>Team access</strong><small>People and permissions</small></span>
          </button>
          <button v-if="isAdmin" type="button" :class="{ active: section === 'backups' }" :aria-current="section === 'backups' ? 'page' : undefined" @click="chooseSection('backups')">
            <span class="nav-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5h16v12H4zM7 4.5h10M8 12.5h8M8 16h5"/></svg></span><span><strong>Backups</strong><small>Saved copies and recovery</small></span>
          </button>
          <div class="nav-note">Changes to team access take effect on the next request.</div>
        </nav>

        <div class="section-content">
      <div v-if="section === 'account'" class="account-layout">
        <div class="section-intro"><span class="panel-kicker">PERSONAL SETTINGS</span><h2>My account</h2><p>Your profile and access at a glance.</p></div>
        <article class="panel account-overview">
          <div class="account-main"><div class="identity"><span class="avatar">{{ account?.firstName?.[0] }}{{ account?.lastName?.[0] }}</span><div><span class="account-status">Active account</span><h3>{{ account?.firstName }} {{ account?.lastName }}</h3><p>{{ account?.email }}</p></div></div><NuxtLink class="button secondary" to="/userprofile/viewprofile">Manage profile <span aria-hidden="true">↗</span></NuxtLink></div>
          <dl class="account-facts"><div><dt>Role</dt><dd>{{ account?.userType }}</dd></div><div><dt>Department</dt><dd>{{ account?.departmentName || 'Not assigned' }}</dd></div><div><dt>Email</dt><dd>{{ account?.emailVerified ? 'Verified' : 'Not verified' }}</dd></div></dl>
        </article>
        <article class="panel access-overview">
          <div class="access-summary"><div><span class="panel-kicker">ACCESS OVERVIEW</span><h3>Your workspace</h3><p class="subtle">{{ isAdmin ? 'Administrator access to every section of the system.' : 'A summary of the sections available to your account.' }}</p></div><span class="access-level">{{ isAdmin ? 'Full access' : `${visibleModules.length} sections` }}</span></div>
          <div class="access-stats"><div><strong>{{ visibleModules.length }}</strong><span>Sections available</span></div><div><strong>{{ editableModuleCount }}</strong><span>Sections you can edit</span></div></div>
          <button v-if="!isAdmin" class="detail-toggle" type="button" :aria-expanded="showAccessDetails" @click="showAccessDetails = !showAccessDetails">{{ showAccessDetails ? 'Hide access details' : 'View access details' }} <span aria-hidden="true">{{ showAccessDetails ? '↑' : '↓' }}</span></button>
          <div v-if="!isAdmin && showAccessDetails" class="access-list"><div v-for="module in visibleModules" :key="module.key"><span>{{ module.label }}</span><span class="access-tag">{{ access?.access?.[module.key]?.canEdit ? 'Can edit' : 'View only' }}</span></div></div>
        </article>
      </div>

      <div v-else-if="section === 'users' && isAdmin" class="section-stack">
        <div class="section-intro"><span class="panel-kicker">ACCESS MANAGEMENT</span><h2>Departments &amp; users</h2><p>See who belongs to each department and manage their access.</p></div>
        <div class="team-stats"><div><strong>{{ departments.length }}</strong><span>Departments</span></div><div><strong>{{ users.length }}</strong><span>User accounts</span></div><div><strong>{{ adminCount }}</strong><span>Admins</span></div></div>
        <div class="directory-head"><div><h3>Department directory</h3><p>All departments are shown, including those without assigned users.</p></div><label><span class="sr-only">Search departments or users</span><input v-model="userSearch" class="search" placeholder="Search department, name, or role" /></label></div>
        <div v-if="!departmentGroups.length" class="panel empty">No matching departments or users.</div>
        <article v-for="group in departmentGroups" :key="group.key" class="panel department-card">
          <div class="department-head"><div class="department-title"><span class="department-icon" aria-hidden="true">{{ group.name.slice(0, 1).toUpperCase() }}</span><div><h3>{{ group.name }}</h3><p>{{ group.users.length }} {{ group.users.length === 1 ? 'user' : 'users' }}<span v-if="group.status && group.status !== 'Active'"> · {{ group.status }} department</span></p></div></div></div>
          <div v-if="!group.users.length" class="department-empty">No users assigned to this department.</div>
          <div v-else class="member-list"><div class="member-heading"><span>USER</span><span>ROLE</span><span>STATUS</span><span>ACTION</span></div><div v-for="user in group.users" :key="user.id" class="member-row"><div class="member-identity"><span class="member-avatar">{{ initials(user.name) }}</span><span><strong>{{ user.name }}</strong><small>{{ user.email }}</small></span></div><span class="role-badge" :class="{ 'role-admin': user.role === 'Admin' }">{{ user.role }}</span><span class="mini-status" :class="{ inactive: user.status !== 'Active' }">{{ user.status }}</span><button class="button secondary" type="button" @click="selectUser(user)">Manage</button></div></div>
        </article>
      </div>

      <div v-else-if="section === 'backups' && isAdmin" class="section-stack">
        <div class="section-intro"><span class="panel-kicker">DATA PROTECTION</span><h2>Backups</h2><p>Keep a recent copy of your records and recover one when needed.</p></div>
        <div class="backup-layout">
        <div class="backup-overview">
          <article class="panel schedule-card"><div class="panel-kicker">AUTOMATIC BACKUP</div><h2>Protected every day</h2><p class="subtle">A new copy is saved at 12:00 AM (Asia/Singapore) while the computer and database are running.</p><div class="schedule-status"><span class="dot" :class="{ off: !automatic }"></span>{{ automatic ? 'Daily backup is on' : 'Daily backup is off' }}</div></article>
          <article class="panel latest-card"><div class="panel-kicker">LATEST SAVED COPY</div><h2>{{ latestBackup ? formatDate(latestBackup.createdAt) : 'No backup yet' }}</h2><p class="subtle">{{ latestBackup ? `${backupLabel(latestBackup.kind)} · ${formatSize(latestBackup.size)}` : 'Create your first backup to protect your records.' }}</p><button v-if="latestBackup" class="button secondary" type="button" @click="downloadBackup(latestBackup.name)">Download latest</button></article>
        </div>
        <article class="panel library-panel">
          <div class="library-head"><div><div class="panel-kicker">SAVED COPIES</div><h2>Backup history</h2><p class="subtle">Older backups stay hidden until you need them. Restore is available only after opening this list.</p></div><button class="button primary" type="button" :disabled="busy" @click="createBackup">{{ busy ? 'Working...' : 'Back up now' }}</button></div>
          <div v-if="!backups.length" class="empty">No saved backups yet.</div>
          <template v-else>
            <button class="button secondary history-toggle" type="button" :aria-expanded="showBackups" @click="toggleBackups">{{ showBackups ? 'Hide saved backups' : `View saved backups (${backups.length})` }}</button>
            <div v-if="showBackups" class="backup-table-wrap"><table><thead><tr><th>Date saved</th><th>Backup type</th><th>Size</th><th>Actions</th></tr></thead><tbody><tr v-for="backup in visibleBackups" :key="backup.name"><td><strong>{{ formatDate(backup.createdAt) }}</strong></td><td>{{ backupLabel(backup.kind) }}</td><td>{{ formatSize(backup.size) }}</td><td><div class="row-actions"><button class="button secondary" type="button" @click="downloadBackup(backup.name)">Download</button><button class="button text-button" type="button" @click="askRestore(backup)">Restore</button></div></td></tr></tbody></table></div>
            <button v-if="showBackups && backupLimit < backups.length" class="button secondary more-backups" type="button" @click="backupLimit += 3">Show 3 more</button>
          </template>
          <button class="upload-link" type="button" :aria-expanded="uploading" @click="uploading = !uploading">{{ uploading ? 'Hide upload' : 'Upload a downloaded backup' }}</button>
          <div v-if="uploading" class="upload-area"><p>Have a backup file from this system? Add it here so it appears in your saved copies.</p><label>Choose saved backup file<input type="file" accept=".sql" @change="uploadFile = ($event.target as HTMLInputElement).files?.[0] || null" /></label><button class="button secondary" type="button" :disabled="busy || !uploadFile" @click="importBackup">Add backup</button></div>
        </article>
        </div>
      </div>
        </div>
      </div>
    </template>

    <div v-if="restoreCandidate" class="modal-backdrop" role="presentation" @click.self="!busy && closeRestore()"><section class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="restore-title" aria-describedby="restore-warning"><div class="panel-kicker">RESTORE BACKUP</div><h2 id="restore-title">Restore this saved copy?</h2><p id="restore-warning" class="restore-warning">This will replace the current database with the copy saved on <strong>{{ formatDate(restoreCandidate.createdAt) }}</strong>. Changes made after that time may be lost. A safety backup will be created first.</p><label class="confirm-check"><input v-model="restoreAcknowledged" type="checkbox" /><span>I understand that newer changes may be replaced.</span></label><label class="restore-phrase">Type RESTORE to confirm<input v-model.trim="restorePhrase" type="text" autocomplete="off" spellcheck="false" placeholder="RESTORE" /></label><div class="dialog-actions"><button class="button secondary" type="button" :disabled="busy" @click="closeRestore">Cancel</button><button class="button danger" type="button" :disabled="busy || !restoreAcknowledged || restorePhrase !== 'RESTORE'" @click="restoreBackup">{{ busy ? 'Restoring...' : 'Restore this backup' }}</button></div></section></div>
    <div v-if="draft" class="modal-backdrop" role="presentation" @click.self="!busy && closeUser()"><section class="user-dialog" role="dialog" aria-modal="true" aria-labelledby="user-dialog-title"><header class="user-dialog-head"><div><span class="panel-kicker">ACCOUNT ACCESS</span><h2 id="user-dialog-title">{{ draft.name }}</h2><p>{{ draft.email }}</p></div><button class="dialog-close" type="button" aria-label="Close user settings" :disabled="busy" @click="closeUser">×</button></header><div class="user-dialog-body"><div v-if="error" class="notice error" role="alert">{{ error }}</div><div class="form-pair"><label>Account role<select v-model="draft.role"><option>Admin</option><option>Supervisor</option><option>Encoder</option><option>Viewer</option></select></label><label>Account status<select v-model="draft.status"><option>Active</option><option>Inactive</option></select></label></div><p v-if="draft.role === 'Admin'" class="info-note">Admins can view and change all sections.</p><div class="permissions-title"><h3>Section access</h3><p>Choose the sections this person can open and update.</p></div><div class="permission-head"><strong>Section</strong><strong>Can view</strong><strong>Can edit</strong></div><div v-for="module in access?.modules" :key="module.key" class="permission-row"><span>{{ module.label }}</span><label><input v-model="draft.access[module.key].canView" type="checkbox" :disabled="draft.role === 'Admin'" @change="!draft!.access[module.key].canView && (draft!.access[module.key].canEdit = false)" /><span class="sr-only">Can view {{ module.label }}</span></label><label><input v-model="draft.access[module.key].canEdit" type="checkbox" :disabled="draft.role === 'Admin' || !draft.access[module.key].canView" /><span class="sr-only">Can edit {{ module.label }}</span></label></div></div><footer class="user-dialog-footer"><button class="button secondary" type="button" :disabled="busy" @click="closeUser">Cancel</button><button class="button primary" type="button" :disabled="busy" @click="saveUser">{{ busy ? 'Saving...' : 'Save changes' }}</button></footer></section></div>
  </section>
</template>

<style scoped>
.settings-page{max-width:1540px;margin:auto;padding:34px clamp(18px,3vw,42px) 70px;color:var(--ink);font-family:'Plus Jakarta Sans',Inter,system-ui,sans-serif}.page-head{margin-bottom:28px}.eyebrow,.panel-kicker{color:#2862ce;font-size:.77rem;font-weight:800;letter-spacing:.11em}.page-head h1{font-size:2.1rem;letter-spacing:-.035em;margin:5px 0}.page-head p,.subtle{color:var(--muted);line-height:1.55}.page-head p{margin:0;font-size:1rem}.tabs{display:flex;gap:8px;border-bottom:1px solid var(--line);margin-bottom:24px}.tabs button{border:0;border-bottom:3px solid transparent;background:transparent;color:var(--muted);padding:14px 18px;font:inherit;font-weight:750;cursor:pointer}.tabs button.active{color:#245fe5;border-color:#245fe5}.two-column,.backup-overview{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.panel{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:27px;min-width:0;box-shadow:0 8px 26px rgba(21,48,96,.035)}.panel h2{font-size:1.3rem;margin:8px 0 5px}.panel h3{font-size:1.05rem;margin:0 0 4px}.panel p{margin:0}.identity{display:flex;align-items:center;gap:16px;margin:24px 0}.identity h2{margin:0 0 4px}.identity p{color:var(--muted);overflow-wrap:anywhere}.avatar{width:62px;height:62px;border-radius:17px;background:#e9f0ff;color:#2256bb;display:grid;place-items:center;font-size:1.2rem;font-weight:800;flex:none}.facts{margin:0 0 22px}.facts div,.access-list div{display:flex;justify-content:space-between;gap:14px;padding:13px 0;border-bottom:1px solid var(--line)}.facts dt{color:var(--muted)}.facts dd{margin:0;font-weight:700}.access-list{margin-top:18px}.access-tag{color:#196c52;font-weight:700;font-size:.88rem;white-space:nowrap}.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;border-radius:10px;padding:0 17px;font:inherit;font-weight:750;text-decoration:none;cursor:pointer;white-space:nowrap}.primary{border:1px solid #2862e9;background:#2862e9;color:#fff}.secondary{border:1px solid #cbdaf5;background:var(--surface);color:#194788}.danger{border:1px solid #c73939;background:#c73939;color:#fff}.text-button{border:0;background:transparent;color:#235bc9}.button:disabled{opacity:.55;cursor:not-allowed}.notice{padding:13px 16px;border-radius:10px;margin-bottom:18px}.notice.error{background:#fff0f0;color:#a42828}.notice.success{background:#e9f8ee;color:#157348}.empty{padding:30px;text-align:center;color:var(--muted)}.team-layout{display:grid;grid-template-columns:minmax(280px,.8fr) minmax(480px,1.2fr);gap:20px;align-items:start}.search,.form-pair select,.upload-area input{width:100%;min-width:0;min-height:44px;border:1px solid #cbdaf5;border-radius:10px;background:var(--surface);color:var(--ink);padding:0 12px;font:inherit}.search{margin:18px 0 12px}.people-list{display:grid;gap:8px;max-height:680px;overflow:auto}.people-list button{display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;text-align:left;padding:13px;border:1px solid var(--line);border-radius:11px;background:var(--surface);color:var(--ink);cursor:pointer}.people-list button.selected{border-color:#2862e9;background:#eef4ff}.people-list small{display:block;color:var(--muted);margin-top:3px;overflow-wrap:anywhere}.mini-status{color:#147a50;background:#e5f8ed;padding:4px 9px;border-radius:999px;font-size:.75rem;font-weight:750}.mini-status.inactive{color:#9a4d12;background:#fff3dd}.form-pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:22px 0}.form-pair label,.upload-area label{display:grid;gap:7px;font-size:.88rem;font-weight:700}.info-note{background:#edf3ff;padding:12px;border-radius:10px;color:#315b9b}.permissions-title{margin:25px 0 8px}.permissions-title p{color:var(--muted);font-size:.9rem}.permission-head,.permission-row{display:grid;grid-template-columns:minmax(0,1fr) 86px 86px;align-items:center;gap:8px;padding:11px 6px;border-bottom:1px solid var(--line)}.permission-head{color:var(--muted);font-size:.75rem;text-transform:uppercase}.permission-head strong:not(:first-child),.permission-row label{text-align:center}.permission-row input{width:18px;height:18px;accent-color:#2862e9}.panel-footer{display:flex;justify-content:flex-end;margin-top:20px}.select-person{display:grid;place-content:center;min-height:290px;text-align:center}.select-person p{color:var(--muted)}.backup-layout{display:grid;gap:20px}.schedule-card,.latest-card{min-height:220px}.schedule-status{display:flex;align-items:center;gap:9px;margin-top:22px;color:#147a50;font-weight:750}.dot{width:9px;height:9px;background:#1bb36e;border-radius:50%}.dot.off{background:#dc7b3e}.latest-card .button{margin-top:22px}.library-head{display:flex;justify-content:space-between;align-items:start;gap:20px;margin-bottom:22px}.library-head .subtle{max-width:650px}.backup-table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left}th{background:#f1f5fc;color:#526f9f;text-transform:uppercase;font-size:.75rem}td,th{padding:14px;border-bottom:1px solid var(--line);white-space:nowrap}td strong{font-weight:700}.row-actions{display:flex;gap:6px}.upload-link{margin-top:24px;border:0;background:transparent;color:#245fe5;font:inherit;font-weight:750;cursor:pointer;padding:0}.upload-area{margin-top:14px;padding:18px;border:1px dashed #b9cdef;border-radius:12px;background:#f7faff;display:grid;gap:14px;max-width:680px}.upload-area p{color:var(--muted)}.upload-area input{padding:9px}.upload-area .button{justify-self:start}.modal-backdrop{position:fixed;inset:0;z-index:1000;background:rgba(10,25,55,.54);display:grid;place-items:center;padding:18px}.confirm-dialog{width:min(100%,510px);background:var(--surface);border-radius:18px;padding:30px;box-shadow:0 28px 70px rgba(8,20,42,.24)}.confirm-dialog h2{margin:9px 0 13px}.confirm-dialog p{color:var(--muted);line-height:1.55}.confirm-check{display:flex;align-items:start;gap:11px;margin:23px 0;font-weight:700}.confirm-check input{width:19px;height:19px;accent-color:#2862e9}.dialog-actions{display:flex;justify-content:flex-end;gap:9px}.sr-only{position:absolute;width:1px;height:1px;clip:rect(0,0,0,0);overflow:hidden}@media(max-width:900px){.two-column,.backup-overview,.team-layout{grid-template-columns:1fr}}@media(max-width:560px){.settings-page{padding:24px 16px 55px}.page-head h1{font-size:1.75rem}.tabs button{padding:12px 10px;font-size:.88rem}.panel{padding:19px}.form-pair{grid-template-columns:1fr}.library-head{display:grid}.dialog-actions{flex-wrap:wrap}}
.history-toggle{margin-bottom:18px}.more-backups{margin-top:16px}.restore-warning{margin:16px 0 0!important;padding:14px 16px;border:1px solid #f1c7a4;border-radius:10px;background:#fff7ef;color:#7f3f1d!important}.restore-phrase{display:grid;gap:8px;margin:0 0 24px;font-size:.88rem;font-weight:750}.restore-phrase input{min-height:45px;width:100%;border:1px solid #cbdaf5;border-radius:10px;background:var(--surface);color:var(--ink);padding:0 12px;font:inherit}
.settings-shell{display:grid;grid-template-columns:238px minmax(0,1fr);gap:28px;align-items:start}
.section-nav{position:sticky;top:24px;display:grid;gap:5px;padding:16px;border:1px solid var(--line);border-radius:18px;background:var(--surface);box-shadow:0 8px 26px rgba(21,48,96,.035)}
.nav-heading{padding:7px 10px 10px;color:#7487a9;font-size:.68rem;font-weight:800;letter-spacing:.13em}
.section-nav button{display:flex;align-items:center;gap:12px;min-width:0;border:1px solid transparent;border-radius:12px;background:transparent;color:var(--ink);padding:12px 10px;text-align:left;font:inherit;cursor:pointer;transition:background .15s,border-color .15s}
.section-nav button:hover{background:#f5f8ff}.section-nav button.active{background:#edf3ff;border-color:#d4e1fb;color:#174bad}
.section-nav button strong,.section-nav button small{display:block}.section-nav button strong{font-size:.9rem}.section-nav button small{margin-top:3px;color:var(--muted);font-size:.73rem;line-height:1.3}.nav-icon{display:grid;place-items:center;width:35px;height:35px;flex:none;border:1px solid #e0e9f8;border-radius:10px;background:#f7f9fd;color:#4a6b9e}.section-nav button.active .nav-icon{border-color:#c9dafa;background:#dfeaff;color:#245fe5}.nav-icon svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.nav-note{margin:12px 6px 3px;padding:13px 8px 0;border-top:1px solid var(--line);color:var(--muted);font-size:.72rem;line-height:1.5}.section-content{min-width:0}.section-stack,.account-layout{display:grid;gap:20px}.section-intro{margin:1px 0 3px}.section-intro h2{margin:6px 0 4px;font-size:1.55rem;letter-spacing:-.03em}.section-intro p{margin:0;color:var(--muted);line-height:1.5}
.account-overview{padding:0;overflow:hidden}.account-main{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:27px;background:linear-gradient(115deg,#fff 45%,#f0f5ff)}.account-main .identity{margin:0}.account-main .identity h3{font-size:1.34rem;letter-spacing:-.02em;margin:7px 0 3px}.account-main .identity p{margin:0}.account-main .avatar{width:66px;height:66px;border-radius:18px;background:#dfeaff}.account-status{display:inline-flex;align-items:center;gap:6px;color:#13744d;font-size:.76rem;font-weight:800}.account-status:before{content:'';width:7px;height:7px;border-radius:50%;background:#20b47c}.account-main .button{gap:9px;flex:none}.account-main .button span{font-size:1.12rem;line-height:1}
.account-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:0;padding:20px 27px}.account-facts div{padding:0 20px;border-left:1px solid var(--line)}.account-facts div:first-child{padding-left:0;border-left:0}.account-facts dt{color:var(--muted);font-size:.78rem}.account-facts dd{margin:7px 0 0;font-weight:750;overflow-wrap:anywhere}
.access-overview{padding:25px 27px}.access-summary{display:flex;justify-content:space-between;align-items:start;gap:18px}.access-summary h3{margin:7px 0 4px;font-size:1.23rem}.access-level{margin-top:5px;flex:none;padding:7px 12px;border-radius:999px;background:#e5f7ec;color:#11764a;font-size:.77rem;font-weight:800}.access-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:23px}.access-stats div{display:grid;gap:4px;padding:17px 20px;border:1px solid #e0e9f7;border-radius:12px;background:#f7faff}.access-stats strong{color:#16458e;font-size:1.5rem;line-height:1.1}.access-stats span{color:var(--muted);font-size:.82rem}.detail-toggle{margin-top:18px;padding:0;border:0;background:transparent;color:#245fe5;font:inherit;font-size:.85rem;font-weight:800;cursor:pointer}.detail-toggle span{margin-left:5px}.section-nav button:focus-visible,.detail-toggle:focus-visible,.button:focus-visible{outline:3px solid #96b6fa;outline-offset:2px}
@media(max-width:1100px){.settings-shell{grid-template-columns:1fr;gap:20px}.section-nav{position:static;display:flex;flex-wrap:wrap;gap:8px;padding:9px}.section-nav button{flex:1 1 190px}.nav-heading,.nav-note{display:none}}
@media(max-width:700px){.account-main{align-items:flex-start;flex-direction:column}.account-facts{grid-template-columns:1fr;gap:14px}.account-facts div,.account-facts div:first-child{padding:0;border:0}.account-facts div+div{padding-top:14px;border-top:1px solid var(--line)}.access-summary{flex-wrap:wrap}.section-nav button{flex-basis:130px}.section-nav button small{display:none}.section-nav button strong{font-size:.82rem}}
.team-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.team-stats div{display:grid;gap:3px;padding:17px 20px;border:1px solid var(--line);border-radius:13px;background:var(--surface)}.team-stats strong{font-size:1.45rem;color:#174a9a;line-height:1.15}.team-stats span{font-size:.78rem;color:var(--muted)}
.directory-head{display:flex;justify-content:space-between;align-items:end;gap:20px;margin:4px 0 0}.directory-head h3{font-size:1.08rem;margin:0 0 4px}.directory-head p{color:var(--muted);font-size:.86rem;line-height:1.45}.directory-head label{min-width:min(100%,320px)}.directory-head .search{margin:0}
.department-card{padding:0;overflow:hidden}.department-head{display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid var(--line);background:#f9fbff}.department-title{display:flex;align-items:center;gap:13px}.department-icon{width:40px;height:40px;border-radius:11px;display:grid;place-items:center;background:#e7efff;color:#235ac0;font-size:.95rem;font-weight:800;flex:none}.department-title h3{margin:0 0 3px;font-size:1.05rem}.department-title p{color:var(--muted);font-size:.8rem}.department-empty{padding:23px 24px;color:var(--muted);font-size:.86rem}.member-heading,.member-row{display:grid;grid-template-columns:minmax(0,1fr) 105px 100px 105px;align-items:center;gap:14px;padding:13px 24px}.member-heading{color:#627ca8;font-size:.7rem;font-weight:800;letter-spacing:.05em}.member-row{border-top:1px solid var(--line);min-height:72px}.member-identity{display:flex;align-items:center;gap:11px;min-width:0}.member-identity strong,.member-identity small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.member-identity strong{font-size:.86rem}.member-identity small{margin-top:3px;color:var(--muted);font-size:.77rem}.member-avatar{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:#e9f0ff;color:#2859b4;font-size:.72rem;font-weight:800;flex:none}.role-badge{justify-self:start;border-radius:999px;padding:5px 10px;background:#f0f3f8;color:#475e83;font-size:.75rem;font-weight:750}.role-badge.role-admin{background:#e7efff;color:#235ac0}.member-row .mini-status{justify-self:start}.member-row .button{min-height:37px;padding:0 12px;font-size:.78rem}
.user-dialog{width:min(100%,800px);max-height:min(92vh,960px);display:flex;flex-direction:column;overflow:hidden;border-radius:18px;background:var(--surface);box-shadow:0 28px 70px rgba(8,20,42,.24)}.user-dialog-head{display:flex;justify-content:space-between;align-items:start;gap:18px;padding:23px 28px;border-bottom:1px solid var(--line)}.user-dialog-head h2{font-size:1.35rem;margin:5px 0 4px}.user-dialog-head p{color:var(--muted);overflow-wrap:anywhere}.dialog-close{border:0;background:transparent;color:#56709b;font-size:1.7rem;line-height:1;cursor:pointer}.user-dialog-body{overflow:auto;padding:2px 28px 28px}.user-dialog-body .form-pair{margin-top:22px}.user-dialog-body .permission-row{min-height:48px}.user-dialog-footer{display:flex;justify-content:flex-end;gap:10px;padding:17px 28px;border-top:1px solid var(--line);background:var(--surface)}
@media(max-width:780px){.directory-head{align-items:stretch;flex-direction:column}.directory-head label{width:100%}.member-heading{display:none}.member-row{grid-template-columns:minmax(0,1fr) auto auto auto;gap:8px;padding:14px 18px}.member-identity{grid-column:1/-1}.department-head{padding:17px 18px}.department-empty{padding:18px}.member-row .button{justify-self:end}}
@media(max-width:540px){.team-stats div{padding:14px}.team-stats strong{font-size:1.2rem}.team-stats span{font-size:.7rem}.member-row{grid-template-columns:auto auto minmax(0,1fr)}.member-identity{grid-column:1/-1}.user-dialog-head,.user-dialog-footer{padding:18px}.user-dialog-body{padding:2px 18px 20px}}
</style>
