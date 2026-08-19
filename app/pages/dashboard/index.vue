<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from '#app'
import LogoutAlert from '../../../components/alertmessage/logoutalert.vue'
import EmployeeListPage from '../employees/index.vue'
import DeploymentHistoryPage from '../employees/deployment-history/index.vue'
import EmployeeDocumentsPage from '../employees/documents/index.vue'
import AgencyPage from '../organization/agency/index.vue'
import PositionPage from '../organization/position/index.vue'
import ClientPage from '../organization/client/index.vue'
import SitePage from '../organization/site/index.vue'
import RegionPage from '../organization/region/index.vue'
import PayrollRatePage from '../rates/payroll/index.vue'
import BillingRatePage from '../rates/billing/index.vue'
import ClientRatePage from '../rates/client/index.vue'
import DailyTimeRecordsPage from '../attendance/daily-time-records/index.vue'
import ShiftCodePage from '../attendance/shift-code/index.vue'
import HolidayManagerPage from '../attendance/holiday-manager/index.vue'

const route = useRoute()
const router = useRouter()

const isDark = ref(false)
const isPinned = ref(false)
const isHovering = ref(false)
const isMobileNavOpen = ref(false)
const currentUser = ref<any>(null)
const showLogoutAlert = ref(false)
const loggingOut = ref(false)
type WorkspaceView =
  | 'employees-list' | 'employees-deployments' | 'employees-documents'
  | 'organization-agency' | 'organization-position' | 'organization-client' | 'organization-site' | 'organization-region'
  | 'attendance-dtr' | 'attendance-shift-code' | 'attendance-holiday-manager' | 'payroll-processing' | 'payslip' | 'payroll-history'
  | 'billing-generate' | 'billing-history' | 'rates-payroll' | 'rates-billing' | 'rates-client'
  | 'deductions' | 'loans' | 'reports' | 'settings'
const workspaceViews = new Set<WorkspaceView>([
  'employees-list', 'employees-deployments', 'employees-documents',
  'organization-agency', 'organization-position', 'organization-client', 'organization-site', 'organization-region',
  'attendance-dtr', 'attendance-shift-code', 'attendance-holiday-manager', 'payroll-processing', 'payslip', 'payroll-history',
  'billing-generate', 'billing-history', 'rates-payroll', 'rates-billing', 'rates-client',
  'deductions', 'loans', 'reports', 'settings'
])
const activeWorkspaceView = computed<WorkspaceView | null>(() => {
  const value = Array.isArray(route.query.view) ? route.query.view[0] : route.query.view
  return typeof value === 'string' && workspaceViews.has(value as WorkspaceView) ? value as WorkspaceView : null
})

// --- OFFLINE / CACHE SUPPORT ---
const isOffline = ref(false)
const isUsingCachedData = ref(false)

const CACHE_KEYS = {
  user: 'dja-cache-user',
  stats: 'dja-cache-stats',
  recentPayroll: 'dja-cache-payroll',
  recentActivity: 'dja-cache-activity',
}

function saveCache(key: string, data: any) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, savedAt: Date.now() }))
  } catch (e) {
    console.warn('Failed to save cache', key, e)
  }
}

function loadCache(key: string) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.data ?? null
  } catch {
    return null
  }
}

function updateOnlineStatus() {
  isOffline.value = !navigator.onLine
}
// --- END OFFLINE / CACHE SUPPORT ---

onMounted(() => {
  const savedTheme = localStorage.getItem('dja-theme')
  isDark.value = savedTheme ? savedTheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches

  isPinned.value = localStorage.getItem('dja-sidebar-pinned') === 'true'
})

watch(isDark, (value) => localStorage.setItem('dja-theme', value ? 'dark' : 'light'))
watch(isPinned, (value) => localStorage.setItem('dja-sidebar-pinned', value ? 'true' : 'false'))
watch(() => route.path, () => { isMobileNavOpen.value = false })

const expanded = computed(() => isPinned.value || isHovering.value || isMobileNavOpen.value)

/* ---- Icon set: raw SVG markup, rendered via v-html.
   No separate component / auto-import needed — avoids resolution issues. ---- */
const ICON_PATHS = {
  'chart-bar': '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  user: '<circle cx="9" cy="8" r="3"/><path d="M2.5 19c1-3.3 3.4-5 6.5-5s5.5 1.7 6.5 5"/><circle cx="17" cy="8" r="2.4"/><path d="M15.5 10.3c2.2.4 3.6 1.9 4.3 4.2"/>',
  building: '<rect x="4" y="3" width="11" height="18"/><rect x="15" y="8" width="5" height="13"/><path d="M7.5 7h1M11 7h1M7.5 11h1M11 11h1M7.5 15h1M11 15h1"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  peso: '<path d="M7 21V4h6a4.2 4.2 0 0 1 0 8.4H7M4.5 11h11M4.5 14h11"/>',
  'file-text': '<path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.64 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.64c.6-.26 1-.85 1-1.55V3a2 2 0 1 1 4 0v.09c0 .7.4 1.29 1 1.55.66.28 1.4.15 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06c-.49.47-.62 1.21-.34 1.87.26.6.85 1 1.55 1H21a2 2 0 1 1 0 4h-.09c-.7 0-1.29.4-1.55 1Z"/>'
}

function iconSvg(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] || ''}</svg>`
}

const navGroups = [
  { label: 'Dashboard', to: '/dashboard', icon: 'chart-bar' },
  {
    label: 'Employee Management', icon: 'user', key: 'employees',
    children: [
      { label: 'Employee List', to: '/employees', icon: 'user', view: 'employees-list' },
      { label: 'Deployment History', to: '/employees/deployment-history', icon: 'chart-bar', view: 'employees-deployments' },
      { label: 'Employee Documents', to: '/employees/documents', icon: 'file-text', view: 'employees-documents' }
    ]
  },
  {
    label: 'Organization', icon: 'building', key: 'organization',
    children: [
      { label: 'Agency', to: '/organization/agency', icon: 'building', view: 'organization-agency' },
      { label: 'Position', to: '/organization/position', icon: 'user', view: 'organization-position' },
      { label: 'Client', to: '/organization/client', icon: 'user', view: 'organization-client' },
      { label: 'Site', to: '/organization/site', icon: 'building', view: 'organization-site' },
      { label: 'Region', to: '/organization/region', icon: 'building', view: 'organization-region' }
    ]
  },
  {
    label: 'Attendance', icon: 'clock', key: 'attendance',
    children: [
      { label: 'Daily Time Records', to: '/attendance/daily-time-records', icon: 'clock', view: 'attendance-dtr' },
      { label: 'Shift Code', to: '/attendance/shift-code', icon: 'clock', view: 'attendance-shift-code' },
      { label: 'Holiday Manager', to: '/attendance/holiday-manager', icon: 'file-text', view: 'attendance-holiday-manager' }
    ]
  },
  {
    label: 'Payroll', icon: 'peso', key: 'payroll',
    children: [
      { label: 'Payroll Processing', to: '/payroll/processing', icon: 'peso', view: 'payroll-processing' },
      { label: 'Payslip', to: '/payroll/payslip', icon: 'file-text', view: 'payslip' },
      { label: 'Payroll History', to: '/payroll/history', icon: 'chart-bar', view: 'payroll-history' }
    ]
  },
  {
    label: 'Billing', icon: 'peso', key: 'billing',
    children: [
      { label: 'Generate Billing', to: '/billing/generate', icon: 'peso', view: 'billing-generate' },
      { label: 'Billing History', to: '/billing/history', icon: 'file-text', view: 'billing-history' }
    ]
  },
  {
    label: 'Rates', icon: 'settings', key: 'rates',
    children: [
      { label: 'Payroll Rate', to: '/rates/payroll', icon: 'peso', view: 'rates-payroll' },
      { label: 'Billing Rate', to: '/rates/billing', icon: 'peso', view: 'rates-billing' },
      { label: 'Client Rate', to: '/rates/client', icon: 'building', view: 'rates-client' }
    ]
  },
  {
    label: 'Deductions & Loans', icon: 'file-text', key: 'deductions',
    children: [
      { label: 'Employee Deduction', to: '/deductions-loans/deduction', icon: 'file-text', view: 'deductions' },
      { label: 'Employee Loan', to: '/deductions-loans/loan', icon: 'peso', view: 'loans' }
    ]
  },
  { label: 'Reports', to: '/reports', icon: 'chart-bar', view: 'reports' },
  { label: 'Settings', to: '/settings', icon: 'settings', view: 'settings' }
]

const openGroups = ref(new Set())

const isActive = (to) => route.path === to || route.path.startsWith(to + '/')
const isNavActive = (item: any) => activeWorkspaceView.value === item.view || (!activeWorkspaceView.value && isActive(item.to))
const groupHasActiveChild = (group: any) => group.children?.some((child: any) => isNavActive(child))

function openWorkspaceView(view: WorkspaceView, updateUrl = true) {
  isMobileNavOpen.value = false

  // Keep the navigation in sync with the content: only the group that owns
  // the selected page stays open, so another submenu is immediately usable.
  const owner = navGroups.find((group: any) => group.children?.some((child: any) => child.view === view)) as any
  openGroups.value = owner?.key ? new Set([owner.key]) : new Set()

  if (updateUrl && route.query.view !== view) {
    router.push({ path: '/dashboard', query: { view } })
  }
}

function returnToDashboard(updateUrl = true) {
  isMobileNavOpen.value = false
  if (updateUrl && route.query.view) router.push('/dashboard')
}

const workspaceComponents: Partial<Record<WorkspaceView, any>> = {
  'employees-list': EmployeeListPage,
  'employees-deployments': DeploymentHistoryPage,
  'employees-documents': EmployeeDocumentsPage,
  'organization-agency': AgencyPage,
  'organization-position': PositionPage,
  'organization-client': ClientPage,
  'organization-site': SitePage,
  'organization-region': RegionPage,
  'rates-payroll': PayrollRatePage,
  'rates-billing': BillingRatePage,
  'rates-client': ClientRatePage,
  'attendance-dtr': DailyTimeRecordsPage,
  'attendance-shift-code': ShiftCodePage,
  'attendance-holiday-manager': HolidayManagerPage
}
const activePageComponent = computed(() => activeWorkspaceView.value ? workspaceComponents[activeWorkspaceView.value] : null)

watch(activeWorkspaceView, (view) => {
  if (view) openWorkspaceView(view, false)
}, { immediate: true })

const toggleGroup = (key) => {
  const next = new Set(openGroups.value)
  next.has(key) ? next.delete(key) : next.add(key)
  openGroups.value = next
}

onMounted(() => {
  navGroups.forEach((g) => {
    if (g.children && groupHasActiveChild(g)) openGroups.value.add(g.key)
  })
})

const stats = ref(loadCache(CACHE_KEYS.stats) || [])
const recentPayroll = ref(loadCache(CACHE_KEYS.recentPayroll) || [])
const recentActivity = ref(loadCache(CACHE_KEYS.recentActivity) || [])

const numberFormat = new Intl.NumberFormat('en-PH')
const pesoFormat = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 })

function formatStatValue(stat: { label?: string; value?: unknown }) {
  const rawValue = typeof stat.value === 'string' ? stat.value.replace(/[^0-9.-]/g, '') : stat.value
  const numericValue = Number(rawValue)
  const safeValue = Number.isFinite(numericValue) ? numericValue : 0
  return stat.label === "This Month's Billing" ? pesoFormat.format(safeValue) : numberFormat.format(safeValue)
}

async function refreshDashboardData() {
  try {
    const [statsResponse, payrollResponse, activityResponse] = await Promise.all([
      $fetch<any>('/api/dashboard/stats'),
      $fetch<any>('/api/dashboard/recent-payroll'),
      $fetch<any>('/api/dashboard/recent-activity')
    ])
    stats.value = statsResponse.stats
    recentPayroll.value = payrollResponse.payroll
    recentActivity.value = activityResponse.activities
    saveCache(CACHE_KEYS.stats, stats.value)
    saveCache(CACHE_KEYS.recentPayroll, recentPayroll.value)
    saveCache(CACHE_KEYS.recentActivity, recentActivity.value)
  } catch (error) {
    console.warn('Failed to refresh dashboard data; showing cached data when available.', error)
  }
}

const statusClass = (status) => 'status-badge status-badge--' + status.toLowerCase().replace(/\s+/g, '-')

const userInitials = computed(() => currentUser.value ? `${currentUser.value.firstName[0]}${currentUser.value.lastName[0]}`.toUpperCase() : '')
const userName = computed(() => currentUser.value ? `${currentUser.value.firstName} ${currentUser.value.lastName}` : '')
const userDepartment = computed(() => currentUser.value?.departmentName || 'Unassigned')

async function logout() { await $fetch('/api/auth/logout', { method: 'POST' }); await navigateTo('/loginscreen') }

async function confirmLogout() {
  loggingOut.value = true
  try { await logout() } finally { loggingOut.value = false; showLogoutAlert.value = false }
}

onMounted(async () => {
  // 1. Agad i-load yung cached user para instant may laman kahit walang net pa
  const cachedUser = loadCache(CACHE_KEYS.user)
  if (cachedUser) {
    currentUser.value = cachedUser
    isUsingCachedData.value = true
  }

  // 2. Setup online/offline listeners
  updateOnlineStatus()
  window.addEventListener('online', updateOnlineStatus)
  window.addEventListener('offline', updateOnlineStatus)

  // Fetch dashboard data in parallel with the existing session request.
  const dashboardRefresh = refreshDashboardData()

  // 3. Subukan mag-fetch ng fresh session
  try {
    const res = await $fetch<any>('/api/auth/me')
    currentUser.value = res.user
    isUsingCachedData.value = false
    isOffline.value = false
    saveCache(CACHE_KEYS.user, res.user)
  } catch (err: any) {
    const status = err?.response?.status || err?.status

    if (status === 401 || status === 403) {
      // Totoong hindi authenticated (expired session, invalid token) — dapat i-logout talaga
      localStorage.removeItem(CACHE_KEYS.user)
      await navigateTo('/loginscreen')
      return
    }

    // Malamang network error lang (walang internet / timeout)
    if (cachedUser) {
      // May cached session tayo — manatili sa dashboard, offline mode na lang
      isOffline.value = true
      isUsingCachedData.value = true
    } else {
      // Walang cache at walang connection — wala tayong choice, kailangan mag-login
      await navigateTo('/loginscreen')
    }
  }

  await dashboardRefresh

})

onBeforeUnmount(() => {
  window.removeEventListener('online', updateOnlineStatus)
  window.removeEventListener('offline', updateOnlineStatus)
})
</script>

<template>
  <div class="page dash-page" :data-theme="isDark ? 'dark' : 'light'">
    <div class="dash-shell" :class="{ 'is-pinned': isPinned }">

      <div class="dash-backdrop" v-show="isMobileNavOpen" @click="isMobileNavOpen = false"></div>

      <aside
        class="dash-sidebar"
        :class="{ 'is-expanded': expanded, 'is-mobile-open': isMobileNavOpen }"
        @mouseenter="isHovering = true"
        @mouseleave="isHovering = false"
      >
        <div class="dash-brand-row">
          <button type="button" class="dash-brand" @click="returnToDashboard">
            <span class="dash-brand__mark">PMS</span>
            <span class="dash-brand__text"><strong>Payroll Management</strong><small>System</small></span>
          </button>
          <button
            type="button"
            class="dash-pin-btn"
            :class="{ 'is-active': isPinned }"
            :title="isPinned ? 'Unlock sidebar' : 'Keep sidebar expanded'"
            @click="isPinned = !isPinned"
          >
            <svg v-if="!isPinned" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v4M8.5 8.5 6 6M15.5 8.5 18 6M6.5 13c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5c0 1.8-.7 2.8-1.2 3.8a2 2 0 0 1-1.8 1.2H9.5a2 2 0 0 1-1.8-1.2C7.2 15.8 6.5 14.8 6.5 13Z"/></svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="10" y="17" width="4" height="4" rx="1" fill="currentColor" stroke="none"/><path d="M6.5 13c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5c0 1.8-.7 2.8-1.2 3.8a2 2 0 0 1-1.8 1.2H9.5a2 2 0 0 1-1.8-1.2C7.2 15.8 6.5 14.8 6.5 13Z" fill="rgba(134,194,255,0.3)"/></svg>
          </button>
        </div>

        <nav class="dash-nav">
          <template v-for="group in navGroups" :key="group.label">
            <button
              v-if="!group.children"
              type="button"
              class="dash-nav-link"
              :class="{ 'is-active': !activeWorkspaceView && isActive(group.to) || activeWorkspaceView === group.view }"
              :title="!expanded ? group.label : null"
              @click="group.view ? openWorkspaceView(group.view) : returnToDashboard()"
            >
              <span class="dash-nav-icon" v-html="iconSvg(group.icon)"></span>
              <span class="dash-nav-label">{{ group.label }}</span>
            </button>

            <div v-else class="dash-nav-group">
              <button
                type="button"
                class="dash-nav-link dash-nav-link--trigger"
                :class="{ 'is-active': groupHasActiveChild(group) || openGroups.has(group.key) }"
                :title="!expanded ? group.label : null"
                @click="toggleGroup(group.key)"
              >
                <span class="dash-nav-icon" v-html="iconSvg(group.icon)"></span>
                <span class="dash-nav-label">{{ group.label }}</span>
                <span class="dash-nav-chevron-wrap">
                  <svg class="dash-nav-chevron" :class="{ 'is-open': openGroups.has(group.key) }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </span>
              </button>

              <div class="dash-nav-sub" v-show="expanded && openGroups.has(group.key)">
                <button
                  v-for="child in group.children"
                  :key="child.to"
                  type="button"
                  class="dash-nav-sublink"
                  :class="{ 'is-active': isNavActive(child) }"
                  @click="openWorkspaceView(child.view)"
                >
                  <span class="dash-nav-icon dash-nav-icon--sm" v-html="iconSvg(child.icon)"></span>
                  {{ child.label }}
                </button>
              </div>
            </div>
          </template>
        </nav>

        <div class="dash-sidebar__footer">
          <NuxtLink to="/userprofile/viewprofile" class="dash-avatar" :title="userName">
            <img v-if="currentUser?.image" :src="currentUser.image" alt="" />
            <template v-else>{{ userInitials }}</template>
          </NuxtLink>
          <NuxtLink to="/userprofile/viewprofile" class="dash-sidebar__user">
            <strong>{{ userName }}</strong>
            <small>{{ currentUser?.userType || 'User' }}</small>
            <small style="display:block;opacity:.75">{{ userDepartment }}</small>
          </NuxtLink>
          <button type="button" class="dash-logout" aria-label="Log out" title="Log out" @click="showLogoutAlert = true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
          </button>
        </div>
      </aside>

      <div class="dash-main">
        <header class="dash-topbar">
          <div class="dash-topbar__left">
            <button type="button" class="dash-mobile-toggle" aria-label="Open menu" @click="isMobileNavOpen = true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
            </button>
          </div>
          <div class="dash-topbar__right">
            <button type="button" class="dash-icon-btn" aria-label="Toggle dark mode" @click="isDark = !isDark">
              <svg v-if="!isDark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2"/></svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a7 7 0 0 0 10.7 10.7Z"/></svg>
            </button>
            <button type="button" class="dash-icon-btn" aria-label="Notifications">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5Z"/><path d="M10 19a2 2 0 0 0 4 0"/></svg>
            </button>
            <NuxtLink to="/userprofile/viewprofile" class="dash-user-chip">
              <span class="dash-avatar">
                <img v-if="currentUser?.image" :src="currentUser.image" alt="" />
                <template v-else>{{ userInitials }}</template>
              </span>
              <span>{{ userName }}</span>
            </NuxtLink>
          </div>
        </header>

        <main class="dash-content">
          <div v-if="isOffline" class="offline-banner">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 9a15.9 15.9 0 0 1 5.5-3.5M8.5 16.5a8 8 0 0 1 7-1M23 9a15.9 15.9 0 0 0-5.5-3.5M2 2l20 20"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></svg>
            <span>No internet connection. Showing the last saved data. It may not be up to date.</span>
          </div>

          <KeepAlive>
            <component v-if="activePageComponent" :key="activeWorkspaceView" :is="activePageComponent" @navigate="openWorkspaceView" />
          </KeepAlive>

          <section v-if="activeWorkspaceView && !activePageComponent" class="workspace-placeholder">
            <p>{{ activeWorkspaceView.replace(/-/g, ' ') }}</p>
            <h1>Module is being prepared</h1>
            <span>This section now stays inside the dashboard workspace. Its full screen will appear here once it is added to the system.</span>
          </section>

          <template v-if="!activeWorkspaceView">
          <div class="dash-header-row">
            <div class="dash-header">
              <h1>Dashboard</h1>
              <p>Welcome back! Here's your payroll overview.</p>
            </div>
          </div>

          <section class="dash-stats">
            <article v-for="stat in stats" :key="stat.label" class="dash-stat-card" :class="`dash-stat-card--${stat.icon}`">
              <div class="dash-stat-card__top">
                <span class="dash-stat-card__icon" v-html="iconSvg(stat.icon)"></span>
                <span class="dash-stat-card__trend" :class="`dash-stat-card__trend--${stat.trendType}`">{{ stat.trend }}</span>
              </div>
              <div class="dash-stat-card__value">{{ formatStatValue(stat) }}</div>
              <div class="dash-stat-card__label">{{ stat.label }}</div>
            </article>
          </section>

          <section class="dash-panels">
            <div class="dash-panel">
              <div class="dash-panel__head">
                <h2>Recent Payroll Runs</h2>
                <NuxtLink to="/payroll/history">View all</NuxtLink>
              </div>
              <table class="dash-table">
                <thead>
                  <tr><th>Employee</th><th>Period</th><th>Net Pay</th><th>Status</th></tr>
                </thead>
                <tbody>
                  <tr v-for="row in recentPayroll" :key="row.name">
                    <td>{{ row.name }}</td>
                    <td>{{ row.period }}</td>
                    <td>{{ row.amount }}</td>
                    <td><span :class="statusClass(row.status)">{{ row.status }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="dash-panel">
              <div class="dash-panel__head">
                <h2>Recent Activity</h2>
              </div>
              <ul class="dash-activity">
                <li v-for="(activity, i) in recentActivity" :key="i">
                  <span class="dash-activity__dot"></span>
                  <div>
                    <div class="dash-activity__text">{{ activity.text }}</div>
                    <div class="dash-activity__time">{{ activity.time }}</div>
                  </div>
                </li>
              </ul>
            </div>
          </section>
          </template>
        </main>
      </div>

      <LogoutAlert v-model="showLogoutAlert" :busy="loggingOut" :dark="isDark" @confirm="confirmLogout" />
    </div>
  </div>
</template>
