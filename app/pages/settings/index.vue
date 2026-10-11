<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import EditProfile from '../../../components/modals/editprofile.vue'
import WorkspaceLoading from '../../../components/WorkspaceLoading.vue'

type Permission = { canView: boolean; canEdit: boolean }
type User = { id: number; name: string; email: string; image: string | null; departmentId: number | null; role: string; status: string; access: Record<string, Permission> }
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
const showInactiveUsers = ref(false)
const expandedGroups = ref<Record<string, boolean>>({})
const newDepartmentName = ref('')
const showAddDepartment = ref(false)
const departmentToRemove = ref<Department | null>(null)
const removeDepartmentAcknowledged = ref(false)
const userToDelete = ref<User | null>(null)
const showDeleteAccount = ref(false)
const deletePhrase = ref('')
const showEditProfile = ref(false)
const isDark = ref(false)
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
  const listedUsers = users.value.filter(user => showInactiveUsers.value || user.status === 'Active')
  const groups = departments.value.map(department => ({ key: `department-${department.id}`, id: department.id as number | null, name: department.name, status: department.status, users: listedUsers.filter(user => user.departmentId === department.id) }))
  const unassigned = listedUsers.filter(user => !departments.value.some(department => department.id === user.departmentId))
  if (unassigned.length) groups.push({ key: 'unassigned', id: null, name: 'Unassigned users', status: '', users: unassigned })
  const query = userSearch.value.toLowerCase().trim()
  if (!query) return groups
  return groups.map(group => group.name.toLowerCase().includes(query)
    ? group
    : { ...group, users: group.users.filter(user => `${user.name} ${user.email} ${user.role} ${user.status}`.toLowerCase().includes(query)) }
  ).filter(group => group.name.toLowerCase().includes(query) || group.users.length)
})
const adminCount = computed(() => users.value.filter(user => user.role === 'Admin' && user.status === 'Active').length)
const latestBackup = computed(() => backups.value[0] || null)
const visibleBackups = computed(() => backups.value.slice(0, backupLimit.value))
const visibleModules = computed(() => (access.value?.modules || []).filter((item: any) => access.value?.access?.[item.key]?.canView))
const editableModuleCount = computed(() => visibleModules.value.filter((item: any) => access.value?.access?.[item.key]?.canEdit).length)
watch(userSearch, () => { expandedGroups.value = {} })

function errorMessage(cause: any) {
  return cause?.data?.statusMessage || cause?.statusMessage || cause?.message || 'The request could not be completed. Please try again.'
}
function cloneUser(user: User) { return JSON.parse(JSON.stringify(user)) as User }
function selectUser(user: User) { selectedUserId.value = user.id; draft.value = cloneUser(user); error.value = ''; success.value = '' }
function closeUser() { selectedUserId.value = null; draft.value = null; error.value = '' }
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase() }
function photoUsers(groupUsers: User[]) { return groupUsers.filter(user => Boolean(user.image)).slice(0, 3) }
function formatDate(value: string) { return new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore' }) }
function formatSize(value: number) { return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB` }
function backupLabel(kind: string) { return kind === 'daily' ? 'Automatic' : kind === 'manual' ? 'Created manually' : kind === 'before-restore' ? 'Safety copy' : 'Uploaded' }
function chooseSection(next: Section) { section.value = next; error.value = ''; success.value = '' }
function isGroupExpanded(key: string) { return expandedGroups.value[key] ?? Boolean(userSearch.value.trim()) }
function toggleGroup(key: string) { expandedGroups.value = { ...expandedGroups.value, [key]: !isGroupExpanded(key) } }
function closeAddDepartment() { if (!busy.value) { showAddDepartment.value = false; newDepartmentName.value = ''; error.value = '' } }
function askRemoveDepartment(group: { id: number | null }) { departmentToRemove.value = departments.value.find(item => item.id === group.id) || null; removeDepartmentAcknowledged.value = false; error.value = '' }
function askDeleteUser() { if (!draft.value || draft.value.id === account.value?.id) return; userToDelete.value = cloneUser(draft.value); deletePhrase.value = ''; error.value = ''; draft.value = null }
function closeDeleteUser() { if (!busy.value) { userToDelete.value = null; deletePhrase.value = ''; error.value = '' } }
function closeDeleteAccount() { if (!busy.value) { showDeleteAccount.value = false; deletePhrase.value = ''; error.value = '' } }
function openEditProfile() { isDark.value = document.querySelector('.dash-page')?.getAttribute('data-theme') === 'dark'; showEditProfile.value = true }
async function onProfileSaved() { account.value = (await $fetch<any>('/api/auth/me')).user; success.value = 'Profile updated.'; if (isAdmin.value) await refreshDirectory() }
async function refreshDirectory() {
  const result = await $fetch<{ users: User[]; departments: Department[] }>('/api/settings/users')
  users.value = result.users
  departments.value = result.departments
}

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
    await $fetch('/api/settings/users', { method: 'PUT', body: { userId: draft.value.id, role: draft.value.role, status: draft.value.status, departmentId: draft.value.departmentId, access: draft.value.access } })
    await refreshDirectory()
    const updated = users.value.find(user => user.id === draft.value?.id)
    success.value = `Access settings saved for ${updated?.name || draft.value.name}.`
    closeUser()
  } catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
}
async function reactivateUser() { if (!draft.value) return; draft.value.status = 'Active'; await saveUser(); if (draft.value) draft.value.status = 'Inactive' }

async function createDepartment() {
  const name = newDepartmentName.value.trim()
  if (!name) { error.value = 'Enter a department name.'; return }
  busy.value = true; error.value = ''; success.value = ''
  try {
    await $fetch('/api/settings/departments', { method: 'POST', body: { name } })
    await refreshDirectory()
    newDepartmentName.value = ''
    showAddDepartment.value = false
    success.value = `${name} is now available for user accounts.`
  } catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
}

async function removeDepartment() {
  if (!departmentToRemove.value || !removeDepartmentAcknowledged.value) return
  const department = departmentToRemove.value
  busy.value = true; error.value = ''; success.value = ''
  try {
    await $fetch(`/api/settings/departments/${department.id}`, { method: 'DELETE' })
    await refreshDirectory()
    departmentToRemove.value = null
    success.value = `${department.name} was removed from active departments.`
  } catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
}

async function deleteUser() {
  if (!userToDelete.value || deletePhrase.value !== 'DELETE') return
  const user = userToDelete.value
  busy.value = true; error.value = ''; success.value = ''
  try {
    await $fetch(`/api/settings/users/${user.id}`, { method: 'DELETE', body: { confirmation: deletePhrase.value } })
    await refreshDirectory()
    userToDelete.value = null; deletePhrase.value = ''
    success.value = `${user.name}'s account was deleted. Their historical records remain available.`
  } catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
}

async function deleteAccount() {
  if (deletePhrase.value !== 'DELETE') return
  busy.value = true; error.value = ''
  try {
    await $fetch('/api/auth/account', { method: 'DELETE', body: { confirmation: deletePhrase.value } })
    window.location.assign('/loginscreen')
  } catch (cause) { error.value = errorMessage(cause); busy.value = false }
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

onMounted(() => { isDark.value = localStorage.getItem('dja-theme') === 'dark'; loadSettings() })
</script>

<template>
  <section class="settings-page">
    <header class="page-head">
      <span class="eyebrow">SYSTEM</span>
      <h1>Settings</h1>
      <p>Your account, team access, and saved backups in one place.</p>
    </header>

    <div v-if="error" class="notice error page-notice" role="alert"><span>{{ error }}</span><button type="button" aria-label="Dismiss error" @click="error = ''">×</button></div>
    <div v-if="success" class="notice success page-notice" role="status"><span>{{ success }}</span><button type="button" aria-label="Dismiss message" @click="success = ''">×</button></div>
    <WorkspaceLoading v-if="loading" label="Loading settings..." />
    <template v-else>
      <div class="settings-shell">
        <nav class="section-nav" aria-label="Settings sections">
          <button type="button" :class="{ active: section === 'account' }" :aria-current="section === 'account' ? 'page' : undefined" @click="chooseSection('account')">My account</button>
          <button v-if="isAdmin" type="button" :class="{ active: section === 'users' }" :aria-current="section === 'users' ? 'page' : undefined" @click="chooseSection('users')">Team access</button>
          <button v-if="isAdmin" type="button" :class="{ active: section === 'backups' }" :aria-current="section === 'backups' ? 'page' : undefined" @click="chooseSection('backups')">Backups</button>
        </nav>

        <div class="section-content">
      <div v-if="section === 'account'" class="section-stack">
        <div class="section-intro"><span class="panel-kicker">PERSONAL SETTINGS</span><h2>My account</h2><p>Review your profile and workspace access.</p></div>
        <article class="panel settings-list">
          <div class="list-title"><h3>Profile</h3><button class="button secondary" type="button" @click="openEditProfile">Edit profile</button></div>
          <div class="profile-list-identity"><span class="avatar"><img v-if="account?.image" :src="account.image" alt="" /><template v-else>{{ account?.firstName?.[0] }}{{ account?.lastName?.[0] }}</template></span><div><strong>{{ account?.firstName }} {{ account?.lastName }}</strong><span>{{ account?.email }}</span></div></div>
          <dl class="setting-facts"><div><dt>Role</dt><dd>{{ account?.userType }}</dd></div><div><dt>Department</dt><dd>{{ account?.departmentName || 'Not assigned' }}</dd></div><div><dt>Email status</dt><dd>{{ account?.emailVerified ? 'Verified' : 'Not verified' }}</dd></div></dl>
        </article>
        <article class="panel settings-list">
          <div class="list-title"><div><h3>Workspace access</h3><p>{{ visibleModules.length }} sections available · {{ editableModuleCount }} editable</p></div><button v-if="!isAdmin" class="button secondary" type="button" :aria-expanded="showAccessDetails" @click="showAccessDetails = !showAccessDetails">{{ showAccessDetails ? 'Hide details' : 'View details' }}</button><span v-else class="role-badge role-admin">Full access</span></div>
          <div v-if="!isAdmin && showAccessDetails" class="access-list"><div v-for="module in visibleModules" :key="module.key"><span>{{ module.label }}</span><span class="access-tag">{{ access?.access?.[module.key]?.canEdit ? 'Can edit' : 'View only' }}</span></div></div>
        </article>
        <article class="panel settings-list">
          <div class="list-title"><div><h3>Delete account</h3><p>Disable your sign-in while keeping payroll and audit history.</p></div><button class="button danger-outline" type="button" @click="showDeleteAccount = true; deletePhrase = ''; error = ''">Delete account</button></div>
        </article>
      </div>

      <div v-else-if="section === 'users' && isAdmin" class="section-stack">
        <div class="section-intro section-intro-actions"><div><span class="panel-kicker">ACCESS MANAGEMENT</span><h2>Departments &amp; users</h2><p>Manage departments and account permissions in one list.</p></div><button class="button primary" type="button" @click="showAddDepartment = true; error = ''; success = ''">Add department</button></div>
        <div class="directory-summary">{{ departments.length }} departments <span>·</span> {{ users.filter(user => user.status === 'Active').length }} active accounts <span>·</span> {{ adminCount }} admins</div>
        <div class="list-toolbar"><label class="sr-only" for="team-search">Search departments or users</label><input id="team-search" v-model="userSearch" class="search" placeholder="Search department, name, or role" /><label class="inactive-toggle"><input v-model="showInactiveUsers" type="checkbox" /> Show inactive accounts</label></div>
        <div class="panel directory-list">
          <div class="directory-columns"><span>Department / user</span><span>Role</span><span>Status</span><span>Action</span></div>
          <div v-if="!departmentGroups.length" class="empty">No matching departments or users.</div>
          <section v-for="group in departmentGroups" :key="group.key" class="directory-group" :aria-label="group.name">
            <div class="directory-group-head">
              <button v-if="group.users.length" class="directory-expand" type="button" :aria-expanded="isGroupExpanded(group.key)" :aria-controls="`members-${group.key}`" @click="toggleGroup(group.key)"><span class="department-icon" aria-hidden="true">{{ group.id === null ? 'U' : group.name.slice(0, 1).toUpperCase() }}</span><strong>{{ group.name }}</strong><span class="member-count">{{ group.users.length }} {{ group.users.length === 1 ? 'user' : 'users' }}</span><span v-if="photoUsers(group.users).length" class="department-user-previews" aria-hidden="true"><img v-for="user in photoUsers(group.users)" :key="user.id" :src="user.image || undefined" alt="" /></span><svg class="directory-chevron" :class="{ open: isGroupExpanded(group.key) }" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7 5 5 5-5" /></svg></button>
              <div v-else class="directory-name"><span class="department-icon" aria-hidden="true">{{ group.name.slice(0, 1).toUpperCase() }}</span><strong>{{ group.name }}</strong><span class="member-count">0 users</span></div>
              <button v-if="group.id !== null && !group.users.length" class="department-remove" type="button" :disabled="busy" :aria-label="`Remove ${group.name}`" @click="askRemoveDepartment(group)">Remove</button>
            </div>
            <div v-if="group.users.length" v-show="isGroupExpanded(group.key)" :id="`members-${group.key}`" class="directory-members"><div v-for="user in group.users" :key="user.id" class="directory-user-row"><div class="member-identity"><span class="member-avatar"><img v-if="user.image" :src="user.image" alt="" /><template v-else>{{ initials(user.name) }}</template></span><span><strong>{{ user.name }}</strong><small>{{ user.email }}</small></span></div><span class="role-badge" :class="{ 'role-admin': user.role === 'Admin' }">{{ user.role }}</span><span class="mini-status" :class="{ inactive: user.status !== 'Active' }">{{ user.status }}</span><button class="button secondary" type="button" @click="selectUser(user)">Manage</button></div></div>
          </section>
        </div>
      </div>

      <div v-else-if="section === 'backups' && isAdmin" class="section-stack">
        <div class="section-intro section-intro-actions"><div><span class="panel-kicker">DATA PROTECTION</span><h2>Backups</h2><p>See backup status and manage saved copies.</p></div><button class="button primary" type="button" :disabled="busy" @click="createBackup">{{ busy ? 'Working...' : 'Back up now' }}</button></div>
        <article class="panel settings-list backup-status-list">
          <div class="list-title"><h3>Backup status</h3></div>
          <div class="setting-row"><div><strong>Automatic backup</strong><small>Runs at 12:00 AM (Asia/Singapore) while the server and database are running.</small></div><span class="mini-status" :class="{ inactive: !automatic }">{{ automatic ? 'On' : 'Off' }}</span></div>
          <div class="setting-row"><div><strong>Latest saved copy</strong><small>{{ latestBackup ? `${backupLabel(latestBackup.kind)} · ${formatSize(latestBackup.size)}` : 'No backup yet' }}</small></div><div class="setting-row-action"><strong>{{ latestBackup ? formatDate(latestBackup.createdAt) : '—' }}</strong><button v-if="latestBackup" class="button secondary" type="button" @click="downloadBackup(latestBackup.name)">Download</button></div></div>
        </article>
        <article class="panel settings-list backup-history-list">
          <div class="list-title"><div><h3>Saved copies</h3><p>Older backups stay hidden until you choose to view them.</p></div><span class="member-count">{{ backups.length }} saved</span></div>
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
    </template>

    <div v-if="restoreCandidate" class="modal-backdrop" role="presentation" @click.self="!busy && closeRestore()"><section class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="restore-title" aria-describedby="restore-warning"><div class="panel-kicker">RESTORE BACKUP</div><h2 id="restore-title">Restore this saved copy?</h2><p id="restore-warning" class="restore-warning">This will replace the current database with the copy saved on <strong>{{ formatDate(restoreCandidate.createdAt) }}</strong>. Changes made after that time may be lost. A safety backup will be created first.</p><label class="confirm-check"><input v-model="restoreAcknowledged" type="checkbox" /><span>I understand that newer changes may be replaced.</span></label><label class="restore-phrase">Type RESTORE to confirm<input v-model.trim="restorePhrase" type="text" autocomplete="off" spellcheck="false" placeholder="RESTORE" /></label><div class="dialog-actions"><button class="button secondary" type="button" :disabled="busy" @click="closeRestore">Cancel</button><button class="button danger" type="button" :disabled="busy || !restoreAcknowledged || restorePhrase !== 'RESTORE'" @click="restoreBackup">{{ busy ? 'Restoring...' : 'Restore this backup' }}</button></div></section></div>
    <div v-if="showAddDepartment" class="modal-backdrop" role="presentation" @click.self="closeAddDepartment"><form class="confirm-dialog department-form-dialog" role="dialog" aria-modal="true" aria-labelledby="department-form-title" @submit.prevent="createDepartment"><div class="panel-kicker">DEPARTMENT MANAGEMENT</div><h2 id="department-form-title">Add department</h2><p>It will appear in account department choices once saved.</p><div v-if="error" class="notice error" role="alert">{{ error }}</div><label for="new-department" class="department-form-label">Department name</label><input id="new-department" v-model="newDepartmentName" maxlength="100" placeholder="e.g. Operations Department" autocomplete="off" autofocus /><div class="dialog-actions department-dialog-actions"><button class="button secondary" type="button" :disabled="busy" @click="closeAddDepartment">Cancel</button><button class="button primary" type="submit" :disabled="busy || !newDepartmentName.trim()">{{ busy ? 'Saving...' : 'Add department' }}</button></div></form></div>
    <EditProfile v-model="showEditProfile" :user="account" :dark="isDark" @saved="onProfileSaved" />
    <div v-if="departmentToRemove" class="modal-backdrop" role="presentation" @click.self="!busy && (departmentToRemove = null)">
      <section class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="department-remove-title">
        <span class="panel-kicker">REMOVE DEPARTMENT</span>
        <h2 id="department-remove-title">Remove {{ departmentToRemove.name }}?</h2>
        <p>This department will disappear from account choices. Existing account and payroll history will remain.</p>
        <label class="confirm-check"><input v-model="removeDepartmentAcknowledged" type="checkbox" /><span>Yes, remove this empty department.</span></label>
        <div v-if="error" class="notice error" role="alert">{{ error }}</div>
        <div class="dialog-actions"><button class="button secondary" type="button" :disabled="busy" @click="departmentToRemove = null">Cancel</button><button class="button danger" type="button" :disabled="busy || !removeDepartmentAcknowledged" @click="removeDepartment">{{ busy ? 'Removing...' : 'Remove department' }}</button></div>
      </section>
    </div>
    <div v-if="draft" class="modal-backdrop" role="presentation" @click.self="!busy && closeUser()">
      <section class="user-dialog" role="dialog" aria-modal="true" aria-labelledby="user-dialog-title">
        <header class="user-dialog-head"><div><span class="panel-kicker">ACCOUNT ACCESS</span><h2 id="user-dialog-title">{{ draft.name }}</h2><p>{{ draft.email }}</p></div><button class="dialog-close" type="button" aria-label="Close user settings" :disabled="busy" @click="closeUser">&times;</button></header>
        <div class="user-dialog-body">
          <div v-if="error" class="notice error" role="alert">{{ error }}</div>
          <div class="form-pair"><label>Account role<select v-model="draft.role"><option>Admin</option><option>Supervisor</option><option>Encoder</option><option>Viewer</option></select></label><div class="status-field"><span>Account status</span><strong class="mini-status" :class="{ inactive: draft.status !== 'Active' }">{{ draft.status }}</strong></div></div>
          <label class="user-department-label">Department<select v-model="draft.departmentId"><option :value="null">Unassigned</option><option v-for="department in departments" :key="department.id" :value="department.id">{{ department.name }}</option></select></label>
          <p class="field-hint">Moving a user changes their department in the account directory.</p>
          <p v-if="draft.role === 'Admin'" class="info-note">Admins can view and change all sections.</p>
          <div class="permissions-title"><h3>Section access</h3><p>Choose the sections this person can open and update.</p></div>
          <div class="permission-head"><strong>Section</strong><strong>Can view</strong><strong>Can edit</strong></div>
          <div v-for="module in access?.modules" :key="module.key" class="permission-row"><span>{{ module.label }}</span><label><input v-model="draft.access[module.key].canView" type="checkbox" :disabled="draft.role === 'Admin'" @change="!draft!.access[module.key].canView && (draft!.access[module.key].canEdit = false)" /><span class="sr-only">Can view {{ module.label }}</span></label><label><input v-model="draft.access[module.key].canEdit" type="checkbox" :disabled="draft.role === 'Admin' || !draft.access[module.key].canView" /><span class="sr-only">Can edit {{ module.label }}</span></label></div>
        </div>
        <footer class="user-dialog-footer"><button v-if="draft.id !== account?.id && draft.status === 'Active'" class="button danger-outline user-delete-button" type="button" :disabled="busy" @click="askDeleteUser">Delete user</button><button class="button secondary" type="button" :disabled="busy" @click="closeUser">Cancel</button><button v-if="draft.status === 'Active'" class="button primary" type="button" :disabled="busy" @click="saveUser">{{ busy ? 'Saving...' : 'Save changes' }}</button><button v-else class="button primary" type="button" :disabled="busy" @click="reactivateUser">{{ busy ? 'Saving...' : 'Reactivate account' }}</button></footer>
      </section>
    </div>
    <div v-if="userToDelete" class="modal-backdrop" role="presentation" @click.self="closeDeleteUser">
      <section class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-user-title">
        <span class="panel-kicker">DELETE USER</span><h2 id="delete-user-title">Delete {{ userToDelete.name }}?</h2>
        <p>This account will lose sign-in access. Payroll and audit records will be preserved.</p>
        <div v-if="error" class="notice error" role="alert">{{ error }}</div>
        <label class="restore-phrase">Type DELETE to confirm<input v-model.trim="deletePhrase" autocomplete="off" spellcheck="false" placeholder="DELETE" /></label>
        <div class="dialog-actions"><button class="button secondary" type="button" :disabled="busy" @click="closeDeleteUser">Cancel</button><button class="button danger" type="button" :disabled="busy || deletePhrase !== 'DELETE'" @click="deleteUser">{{ busy ? 'Deleting...' : 'Delete user' }}</button></div>
      </section>
    </div>
    <div v-if="showDeleteAccount" class="modal-backdrop" role="presentation" @click.self="closeDeleteAccount">
      <section class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-account-title">
        <span class="panel-kicker">DELETE ACCOUNT</span><h2 id="delete-account-title">Delete your account?</h2>
        <p>You will be signed out and will no longer be able to sign in. Payroll and audit history will be preserved. If you are the last active admin, first assign another admin.</p>
        <div v-if="error" class="notice error" role="alert">{{ error }}</div>
        <label class="restore-phrase">Type DELETE to confirm<input v-model.trim="deletePhrase" autocomplete="off" spellcheck="false" placeholder="DELETE" /></label>
        <div class="dialog-actions"><button class="button secondary" type="button" :disabled="busy" @click="closeDeleteAccount">Cancel</button><button class="button danger" type="button" :disabled="busy || deletePhrase !== 'DELETE'" @click="deleteAccount">{{ busy ? 'Deleting...' : 'Delete account' }}</button></div>
      </section>
    </div>
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
.department-create{display:flex;align-items:end;justify-content:space-between;gap:24px;padding:22px 25px}.department-create h3{margin:7px 0 4px;font-size:1.05rem}.department-create p{color:var(--muted);font-size:.84rem;line-height:1.45}.department-create-controls{display:flex;gap:9px;width:min(100%,480px)}.department-create-controls input{min-width:0;flex:1;min-height:44px;border:1px solid #cbdaf5;border-radius:10px;background:var(--surface);color:var(--ink);padding:0 12px;font:inherit}.department-remove{border:0;background:transparent;color:#ad3838;font:inherit;font-size:.8rem;font-weight:750;cursor:pointer}.department-remove:hover{text-decoration:underline}.department-remove:focus-visible{outline:3px solid #96b6fa;outline-offset:3px}.department-dialog-actions{margin-top:24px}
.directory-head{display:flex;justify-content:space-between;align-items:end;gap:20px;margin:4px 0 0}.directory-head h3{font-size:1.08rem;margin:0 0 4px}.directory-head p{color:var(--muted);font-size:.86rem;line-height:1.45}.directory-head label{min-width:min(100%,320px)}.directory-head .search{margin:0}
.department-card{padding:0;overflow:hidden}.department-head{display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid var(--line);background:#f9fbff}.department-title{display:flex;align-items:center;gap:13px}.department-icon{width:40px;height:40px;border-radius:11px;display:grid;place-items:center;background:#e7efff;color:#235ac0;font-size:.95rem;font-weight:800;flex:none}.department-title h3{margin:0 0 3px;font-size:1.05rem}.department-title p{color:var(--muted);font-size:.8rem}.department-empty{padding:23px 24px;color:var(--muted);font-size:.86rem}.member-heading,.member-row{display:grid;grid-template-columns:minmax(0,1fr) 105px 100px 105px;align-items:center;gap:14px;padding:13px 24px}.member-heading{color:#627ca8;font-size:.7rem;font-weight:800;letter-spacing:.05em}.member-row{border-top:1px solid var(--line);min-height:72px}.member-identity{display:flex;align-items:center;gap:11px;min-width:0}.member-identity strong,.member-identity small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.member-identity strong{font-size:.86rem}.member-identity small{margin-top:3px;color:var(--muted);font-size:.77rem}.member-avatar{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:#e9f0ff;color:#2859b4;font-size:.72rem;font-weight:800;flex:none}.role-badge{justify-self:start;border-radius:999px;padding:5px 10px;background:#f0f3f8;color:#475e83;font-size:.75rem;font-weight:750}.role-badge.role-admin{background:#e7efff;color:#235ac0}.member-row .mini-status{justify-self:start}.member-row .button{min-height:37px;padding:0 12px;font-size:.78rem}
.user-dialog{width:min(100%,800px);max-height:min(92vh,960px);display:flex;flex-direction:column;overflow:hidden;border-radius:18px;background:var(--surface);box-shadow:0 28px 70px rgba(8,20,42,.24)}.user-dialog-head{display:flex;justify-content:space-between;align-items:start;gap:18px;padding:23px 28px;border-bottom:1px solid var(--line)}.user-dialog-head h2{font-size:1.35rem;margin:5px 0 4px}.user-dialog-head p{color:var(--muted);overflow-wrap:anywhere}.dialog-close{border:0;background:transparent;color:#56709b;font-size:1.7rem;line-height:1;cursor:pointer}.user-dialog-body{overflow:auto;padding:2px 28px 28px}.user-dialog-body .form-pair{margin-top:22px}.user-dialog-body .permission-row{min-height:48px}.user-dialog-footer{display:flex;justify-content:flex-end;gap:10px;padding:17px 28px;border-top:1px solid var(--line);background:var(--surface)}
@media(max-width:780px){.directory-head{align-items:stretch;flex-direction:column}.directory-head label{width:100%}.member-heading{display:none}.member-row{grid-template-columns:minmax(0,1fr) auto auto auto;gap:8px;padding:14px 18px}.member-identity{grid-column:1/-1}.department-head{padding:17px 18px}.department-empty{padding:18px}.member-row .button{justify-self:end}}
@media(max-width:780px){.department-create{align-items:stretch;flex-direction:column}}
@media(max-width:540px){.team-stats div{padding:14px}.team-stats strong{font-size:1.2rem}.team-stats span{font-size:.7rem}.member-row{grid-template-columns:auto auto minmax(0,1fr)}.member-identity{grid-column:1/-1}.user-dialog-head,.user-dialog-footer{padding:18px}.user-dialog-body{padding:2px 18px 20px}.department-create-controls{flex-direction:column}.department-create-controls .button{width:100%}}
.settings-page{max-width:1500px;padding-top:28px}.page-head{margin-bottom:21px}.settings-shell{display:block}.section-nav{position:static;display:flex;gap:28px;padding:0;border:0;border-bottom:1px solid var(--line);border-radius:0;background:transparent;box-shadow:none;margin-bottom:25px}.section-nav button{flex:none;display:block;border:0;border-bottom:3px solid transparent;border-radius:0;padding:12px 4px 14px;color:var(--muted);font-weight:750}.section-nav button:hover{background:transparent;color:#174bad}.section-nav button.active{background:transparent;border-color:#2862e9;color:#174bad}.section-content{max-width:none}.section-stack{gap:17px}.section-intro-actions{display:flex;align-items:center;justify-content:space-between;gap:20px}.section-intro-actions .button{flex:none}.panel.settings-list,.directory-list{padding:0;overflow:hidden;border-radius:15px;box-shadow:0 5px 18px rgba(21,48,96,.025)}
.page-notice{display:flex;align-items:center;justify-content:space-between;gap:14px;max-width:680px;padding:10px 14px;border:1px solid transparent;font-size:.83rem}.page-notice.success{border-color:#c8ebd4}.page-notice.error{border-color:#f0c8c8}.page-notice button{border:0;background:transparent;color:inherit;font:inherit;font-size:1.2rem;line-height:1;cursor:pointer}
.list-title{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:18px 23px;border-bottom:1px solid var(--line)}.list-title h3{font-size:1rem;margin:0}.list-title p{margin:4px 0 0;color:var(--muted);font-size:.82rem}.list-title .button{min-height:37px;font-size:.79rem}.profile-list-identity{display:flex;align-items:center;gap:15px;padding:19px 23px}.profile-list-identity .avatar{width:48px;height:48px;border-radius:13px;font-size:1rem}.profile-list-identity strong,.profile-list-identity span:not(.avatar){display:block}.profile-list-identity strong{font-size:.95rem}.profile-list-identity div span{margin-top:3px;color:var(--muted);font-size:.83rem}.setting-facts{margin:0;border-top:1px solid var(--line)}.setting-facts>div,.setting-row{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:15px 23px;border-bottom:1px solid var(--line)}.setting-facts>div:last-child,.setting-row:last-child{border-bottom:0}.setting-facts dt{color:var(--muted);font-size:.84rem}.setting-facts dd{margin:0;text-align:right;font-weight:750;font-size:.86rem}.setting-row>div:first-child{display:grid;gap:4px}.setting-row strong{font-size:.86rem}.setting-row small{color:var(--muted);font-size:.78rem;line-height:1.4}.setting-row-action{display:flex;align-items:center;gap:18px}.setting-row-action .button{min-height:36px;font-size:.78rem}.settings-list .access-list{margin:0;padding:0 23px 10px}.settings-list .access-list div:last-child{border-bottom:0}
.directory-summary{display:flex;gap:7px;color:var(--muted);font-size:.83rem}.directory-summary span{color:#9bb0d1}.list-toolbar{display:flex;align-items:center;justify-content:space-between;gap:15px}.list-toolbar .search{width:min(100%,400px);margin:0}.list-toolbar>span{color:var(--muted);font-size:.79rem}.directory-columns,.directory-user-row{display:grid;grid-template-columns:minmax(0,1fr) 130px 120px 115px;align-items:center;gap:14px;padding:12px 22px}.directory-columns{background:#f3f6fc;color:#5e78a3;text-transform:uppercase;font-size:.69rem;font-weight:800;letter-spacing:.045em}.directory-group+.directory-group{border-top:1px solid #dbe5f4}.directory-group-head{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:14px 22px;background:#fafcff}.directory-name{display:flex;align-items:center;gap:11px;min-width:0}.directory-name strong{font-size:.88rem}.directory-name .department-icon{width:32px;height:32px;border-radius:9px;font-size:.78rem}.member-count{color:var(--muted);font-size:.76rem;white-space:nowrap}.directory-empty{padding:10px 22px 15px 65px;color:var(--muted);font-size:.8rem}.directory-user-row{min-height:62px;border-top:1px solid var(--line);padding-left:65px}.directory-user-row .button{justify-self:start;min-height:35px;font-size:.76rem;padding:0 12px}.directory-user-row .member-avatar{width:32px;height:32px}.directory-user-row .member-identity strong{font-size:.83rem}.directory-user-row .member-identity small{font-size:.74rem}.department-remove{white-space:nowrap}.directory-list .empty{padding:30px}
.backup-status-list .mini-status{flex:none}.backup-history-list>.history-toggle{margin:16px 23px}.backup-history-list>.upload-link{margin:0 23px 20px}.backup-history-list .backup-table-wrap{margin:0 23px 14px}.backup-history-list .more-backups{margin:0 23px 18px}.backup-history-list .upload-area{margin:0 23px 22px}.backup-history-list>.empty{padding:26px 23px}.department-form-label{display:block;margin:23px 0 7px;font-size:.84rem;font-weight:750}.department-form-dialog input{width:100%;min-height:46px;border:1px solid #cbdaf5;border-radius:10px;background:var(--surface);color:var(--ink);padding:0 12px;font:inherit}
@media(max-width:800px){.directory-columns{display:none}.directory-user-row{grid-template-columns:minmax(0,1fr) auto auto;gap:8px;padding:12px 17px 12px 52px}.directory-user-row .member-identity{grid-column:1/-1}.directory-user-row .button{justify-self:end}.directory-group-head{padding:13px 17px}.directory-empty{padding-left:52px}.list-toolbar{align-items:stretch;flex-direction:column}.list-toolbar .search{width:100%}}
@media(max-width:560px){.settings-page{padding-top:22px}.section-nav{gap:18px;overflow-x:auto}.section-nav button{white-space:nowrap;font-size:.83rem}.section-intro-actions{align-items:stretch;flex-direction:column}.section-intro-actions .button{align-self:flex-start}.directory-summary{flex-wrap:wrap}.directory-name{flex-wrap:wrap}.directory-name .member-count{width:100%;padding-left:43px}.directory-user-row{padding-left:17px}.directory-empty{padding-left:17px}.setting-row,.setting-facts>div{align-items:flex-start}.setting-row-action{align-items:flex-end;flex-direction:column;gap:8px}.list-title{padding:17px}.profile-list-identity{padding:17px}.setting-facts>div,.setting-row{padding:14px 17px}}
.directory-expand{display:flex;align-items:center;gap:11px;min-width:0;flex:1;border:0;background:transparent;color:var(--ink);padding:0;text-align:left;font:inherit;cursor:pointer}.directory-expand strong{font-size:.88rem}.directory-expand:hover strong{color:#235bc9}.directory-expand:focus-visible{outline:3px solid #96b6fa;outline-offset:5px;border-radius:6px}.directory-chevron{width:18px;height:18px;margin-left:auto;flex:none;fill:none;stroke:#607da9;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .16s}.directory-chevron.open{transform:rotate(180deg)}.directory-group-head:has(.directory-expand):hover{background:#f3f7ff}.directory-members{background:var(--surface)}
.directory-group-head{min-height:60px}.directory-group-head .department-icon{width:32px;height:32px;flex:0 0 32px;border-radius:9px;font-size:.78rem;line-height:1}
.inactive-toggle{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:.8rem;cursor:pointer}.inactive-toggle input{width:17px;height:17px;accent-color:#2862e9}.status-field{display:grid;gap:7px;font-size:.88rem;font-weight:700}.status-field .mini-status{justify-self:start}
@media(max-width:560px){.directory-expand{flex-wrap:wrap}.directory-expand .member-count{width:100%;padding-left:43px}.directory-expand .directory-chevron{position:absolute;right:17px}.directory-group-head{position:relative}}
.danger-outline{border:1px solid #edc1c1;background:var(--surface);color:#a62828}.user-department-label{display:grid;gap:7px;font-size:.88rem;font-weight:700}.user-department-label select{width:100%;min-height:44px;border:1px solid #cbdaf5;border-radius:10px;background:var(--surface);color:var(--ink);padding:0 12px;font:inherit}.field-hint{margin:7px 0 0!important;color:var(--muted);font-size:.8rem}.user-delete-button{margin-right:auto}@media(max-width:540px){.user-dialog-footer{flex-wrap:wrap}.user-delete-button{width:100%;margin-right:0}}
.avatar img,.member-avatar img{display:block;width:100%;height:100%;object-fit:cover;border-radius:inherit}
.department-user-previews{display:flex;align-items:center;flex:none;margin-left:auto;padding-right:5px}.department-user-previews img{width:30px;height:30px;border:2px solid var(--surface);border-radius:50%;object-fit:cover;background:#e9f0ff}.department-user-previews img+img{margin-left:-8px}.department-user-previews+.directory-chevron{margin-left:0}
</style>
