<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from '#app'

const route = useRoute()

const isDark = ref(false)
const isPinned = ref(false)
const isHovering = ref(false)
const isMobileNavOpen = ref(false)
const currentUser = ref<any>(null)

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
      { label: 'Employee List', to: '/employees', icon: 'user' },
      { label: 'Deployment History', to: '/employees/deployment-history', icon: 'chart-bar' },
      { label: 'Employee Documents', to: '/employees/documents', icon: 'file-text' }
    ]
  },
  {
    label: 'Organization', icon: 'building', key: 'organization',
    children: [
      { label: 'Agency', to: '/organization/agency', icon: 'building' },
      { label: 'Position', to: '/organization/position', icon: 'user' },
      { label: 'Client', to: '/organization/client', icon: 'user' },
      { label: 'Site', to: '/organization/site', icon: 'building' }
    ]
  },
  { label: 'Attendance', to: '/attendance', icon: 'clock' },
  {
    label: 'Payroll', icon: 'peso', key: 'payroll',
    children: [
      { label: 'Payroll Processing', to: '/payroll/processing', icon: 'peso' },
      { label: 'Payslip', to: '/payroll/payslip', icon: 'file-text' },
      { label: 'Payroll History', to: '/payroll/history', icon: 'chart-bar' }
    ]
  },
  {
    label: 'Billing', icon: 'peso', key: 'billing',
    children: [
      { label: 'Generate Billing', to: '/billing/generate', icon: 'peso' },
      { label: 'Billing History', to: '/billing/history', icon: 'file-text' }
    ]
  },
  {
    label: 'Rates', icon: 'settings', key: 'rates',
    children: [
      { label: 'Payroll Rate', to: '/rates/payroll', icon: 'peso' },
      { label: 'Billing Rate', to: '/rates/billing', icon: 'peso' }
    ]
  },
  {
    label: 'Deductions & Loans', icon: 'file-text', key: 'deductions',
    children: [
      { label: 'Employee Deduction', to: '/deductions-loans/deduction', icon: 'file-text' },
      { label: 'Employee Loan', to: '/deductions-loans/loan', icon: 'peso' }
    ]
  },
  { label: 'Reports', to: '/reports', icon: 'chart-bar' },
  { label: 'Settings', to: '/settings', icon: 'settings' }
]

const openGroups = ref(new Set())

const isActive = (to) => route.path === to || route.path.startsWith(to + '/')
const groupHasActiveChild = (group) => group.children?.some((c) => isActive(c.to))

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

// TODO: replace with real fetched values (employee, attendance, payroll, billing tables)
const stats = [
  { label: 'Total Employees', value: '128', trend: '+4 this month', trendType: 'up', icon: 'user' },
  { label: 'Present Today', value: '112', trend: '87.5% attendance', trendType: 'flat', icon: 'clock' },
  { label: 'Pending Payroll', value: '3', trend: 'For Approval', trendType: 'warn', icon: 'peso' },
  { label: "This Month's Billing", value: '₱842,300', trend: '+12% vs last month', trendType: 'up', icon: 'file-text' },
  { label: 'Active Deployments', value: '96', trend: 'across 14 sites', trendType: 'flat', icon: 'building' },
  { label: 'Active Loans', value: '21', trend: '2 completing soon', trendType: 'warn', icon: 'peso' }
]

// TODO: replace with real employee_deployment / payroll rows
const recentPayroll = [
  { name: 'Maria Santos', period: 'Jul 1–15', amount: '₱18,450.00', status: 'Released' },
  { name: 'Juan Dela Cruz', period: 'Jul 1–15', amount: '₱16,200.00', status: 'Approved' },
  { name: 'Ana Reyes', period: 'Jul 1–15', amount: '₱17,800.00', status: 'For Approval' },
  { name: 'Mark Villanueva', period: 'Jul 1–15', amount: '₱15,950.00', status: 'Draft' }
]

const recentActivity = [
  { text: 'Payroll for Jul 1–15 cutoff was released', time: '2 hours ago' },
  { text: 'New employee Ana Reyes added under Finance', time: '5 hours ago' },
  { text: 'Billing invoice #INV-0231 sent to Client A', time: 'Yesterday, 4:12 PM' },
  { text: '3 attendance records flagged as Late', time: 'Yesterday, 9:05 AM' }
]

const statusClass = (status) => 'status-badge status-badge--' + status.toLowerCase().replace(/\s+/g, '-')

const userInitials = computed(() => currentUser.value ? `${currentUser.value.firstName[0]}${currentUser.value.lastName[0]}`.toUpperCase() : '')
const userName = computed(() => currentUser.value ? `${currentUser.value.firstName} ${currentUser.value.lastName}` : '')
async function logout() { await $fetch('/api/auth/logout', { method: 'POST' }); await navigateTo('/loginscreen') }
onMounted(async () => { try { currentUser.value = (await $fetch<any>('/api/auth/me')).user } catch { await navigateTo('/loginscreen') } })
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
          <NuxtLink to="/dashboard" class="dash-brand">
            <span class="dash-brand__mark">PMS</span>
            <span class="dash-brand__text"><strong>Payroll Management</strong><small>System</small></span>
          </NuxtLink>
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
            <NuxtLink
              v-if="!group.children"
              :to="group.to"
              class="dash-nav-link"
              :class="{ 'is-active': isActive(group.to) }"
              :title="!expanded ? group.label : null"
            >
              <span class="dash-nav-icon" v-html="iconSvg(group.icon)"></span>
              <span class="dash-nav-label">{{ group.label }}</span>
            </NuxtLink>

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
                <NuxtLink
                  v-for="child in group.children"
                  :key="child.to"
                  :to="child.to"
                  class="dash-nav-sublink"
                  :class="{ 'is-active': isActive(child.to) }"
                >
                  <span class="dash-nav-icon dash-nav-icon--sm" v-html="iconSvg(child.icon)"></span>
                  {{ child.label }}
                </NuxtLink>
              </div>
            </div>
          </template>
        </nav>

        <div class="dash-sidebar__footer">
          <span class="dash-avatar">{{ userInitials }}</span>
          <div class="dash-sidebar__user">
            <strong>{{ userName }}</strong>
            <small>{{ currentUser?.userType || 'User' }}</small>
          </div>
          <button type="button" class="dash-logout" aria-label="Log out" title="Log out" @click="logout">
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
            <div class="dash-user-chip">
              <span class="dash-avatar">{{ userInitials }}</span>
              <span>{{ userName }}</span>
            </div>
          </div>
        </header>

        <main class="dash-content">
          <div class="dash-header-row">
            <div class="dash-header">
              <h1>Dashboard</h1>
              <p>Welcome back! Here's your payroll overview.</p>
            </div>
            <AppButton to="/employees" variant="primary">+ Add Employee</AppButton>
          </div>

          <section class="dash-stats">
            <article v-for="stat in stats" :key="stat.label" class="dash-stat-card">
              <div class="dash-stat-card__top">
                <span class="dash-stat-card__icon" v-html="iconSvg(stat.icon)"></span>
                <span class="dash-stat-card__trend" :class="`dash-stat-card__trend--${stat.trendType}`">{{ stat.trend }}</span>
              </div>
              <div class="dash-stat-card__value">{{ stat.value }}</div>
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
        </main>
      </div>
    </div>
  </div>
</template>
