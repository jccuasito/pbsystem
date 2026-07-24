<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import { useRoute } from '#app'

const route = useRoute()
const isDark = ref(false)

onMounted(() => {
  const savedTheme = localStorage.getItem('dja-theme')
  isDark.value = savedTheme ? savedTheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
})

watch(isDark, (value) => localStorage.setItem('dja-theme', value ? 'dark' : 'light'))

const navItems = [
  { label: 'Dashboard', to: '/dashboard', icon: 'grid' },
  { label: 'Employees', to: '/employees', icon: 'user' },
  { label: 'Organization', to: '/organization', icon: 'building' },
  { label: 'Attendance', to: '/attendance', icon: 'clock' },
  { label: 'Payroll', to: '/payroll', icon: 'wallet' },
  { label: 'Billing', to: '/billing', icon: 'receipt' },
  { label: 'Rates', to: '/rates', icon: 'percent' },
  { label: 'Deductions and Loans', to: '/deductions-loans', icon: 'piggy-bank' },
  { label: 'Reports', to: '/reports', icon: 'file-text' },
  { label: 'Settings', to: '/settings', icon: 'settings' }
]

const isActive = (to) => route.path === to || route.path.startsWith(to + '/')

// TODO: replace with real fetched values (employee, attendance, payroll, billing tables)
const stats = [
  { label: 'Total Employees', value: '128', trend: '+4 this month', trendType: 'up', icon: 'user' },
  { label: 'Present Today', value: '112', trend: '87.5% attendance', trendType: 'flat', icon: 'clock' },
  { label: 'Pending Payroll', value: '3', trend: 'For Approval', trendType: 'warn', icon: 'wallet' },
  { label: "This Month's Billing", value: '₱842,300', trend: '+12% vs last month', trendType: 'up', icon: 'receipt' },
  { label: 'Active Deployments', value: '96', trend: 'across 14 sites', trendType: 'flat', icon: 'building' },
  { label: 'Active Loans', value: '21', trend: '2 completing soon', trendType: 'warn', icon: 'piggy-bank' }
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

const userInitials = 'JE' // TODO: derive from logged-in user's FirstName/LastName
</script>

<template>
  <div class="page dash-page" :data-theme="isDark ? 'dark' : 'light'">
    <div class="dash-shell">
      <aside class="dash-sidebar">
        <NuxtLink to="/dashboard" class="dash-brand">
          <span class="dash-brand__mark">PMS</span>
          <span class="dash-brand__text"><strong>Payroll Management</strong><small>System</small></span>
        </NuxtLink>

        <nav class="dash-nav">
          <NuxtLink
            v-for="item in navItems"
            :key="item.to"
            :to="item.to"
            :class="{ 'is-active': isActive(item.to) }"
          >
            <svg v-if="item.icon === 'grid'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>
            <svg v-else-if="item.icon === 'user'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c1.2-4 4-6 7.5-6s6.3 2 7.5 6"/></svg>
            <svg v-else-if="item.icon === 'building'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="11" height="18"/><rect x="15" y="8" width="5" height="13"/><path d="M7.5 7h1M11 7h1M7.5 11h1M11 11h1M7.5 15h1M11 15h1"/></svg>
            <svg v-else-if="item.icon === 'clock'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>
            <svg v-else-if="item.icon === 'wallet'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1"/></svg>
            <svg v-else-if="item.icon === 'receipt'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3.5h14v17l-2.5-1.5L14 20.5 11.5 19 9 20.5 6.5 19 5 20.5V3.5Z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>
            <svg v-else-if="item.icon === 'percent'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19 19 5"/><circle cx="7" cy="7" r="2.2"/><circle cx="17" cy="17" r="2.2"/></svg>
            <svg v-else-if="item.icon === 'piggy-bank'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13a6 6 0 0 1 6-6h5.5a3.5 3.5 0 0 1 3.5 3.5v.2l2 1.3-2 1v1a2 2 0 0 1-2 2h-1v2h-3v-2H9.5V19h-3v-2.3A4.7 4.7 0 0 1 4 13Z"/><circle cx="15" cy="10.5" r=".6" fill="currentColor"/><path d="M8.5 7 8 4.5"/></svg>
            <svg v-else-if="item.icon === 'file-text'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>
            <svg v-else-if="item.icon === 'settings'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.64 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.64c.6-.26 1-.85 1-1.55V3a2 2 0 1 1 4 0v.09c0 .7.4 1.29 1 1.55.66.28 1.4.15 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06c-.49.47-.62 1.21-.34 1.87.26.6.85 1 1.55 1H21a2 2 0 1 1 0 4h-.09c-.7 0-1.29.4-1.55 1Z"/></svg>
            {{ item.label }}
          </NuxtLink>
        </nav>

        <div class="dash-sidebar__footer">
          <span class="dash-avatar">{{ userInitials }}</span>
          <div class="dash-sidebar__user">
            <strong>John Doe Ezra</strong>
            <small>Accounting</small>
          </div>
          <button type="button" class="dash-logout" aria-label="Log out">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
          </button>
        </div>
      </aside>

      <div class="dash-main">
        <header class="dash-topbar">
          <button type="button" class="dash-icon-btn" aria-label="Toggle dark mode" @click="isDark = !isDark">
            <svg v-if="!isDark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2"/></svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a7 7 0 0 0 10.7 10.7Z"/></svg>
          </button>
          <button type="button" class="dash-icon-btn" aria-label="Notifications">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5Z"/><path d="M10 19a2 2 0 0 0 4 0"/></svg>
          </button>
          <div class="dash-user-chip">
            <span class="dash-avatar">{{ userInitials }}</span>
            <span>John Doe</span>
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
                <span class="dash-stat-card__icon">
                  <svg v-if="stat.icon === 'user'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c1.2-4 4-6 7.5-6s6.3 2 7.5 6"/></svg>
                  <svg v-else-if="stat.icon === 'clock'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>
                  <svg v-else-if="stat.icon === 'wallet'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1"/></svg>
                  <svg v-else-if="stat.icon === 'receipt'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3.5h14v17l-2.5-1.5L14 20.5 11.5 19 9 20.5 6.5 19 5 20.5V3.5Z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>
                  <svg v-else-if="stat.icon === 'building'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="11" height="18"/><rect x="15" y="8" width="5" height="13"/></svg>
                  <svg v-else-if="stat.icon === 'piggy-bank'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13a6 6 0 0 1 6-6h5.5a3.5 3.5 0 0 1 3.5 3.5v.2l2 1.3-2 1v1a2 2 0 0 1-2 2h-1v2h-3v-2H9.5V19h-3v-2.3A4.7 4.7 0 0 1 4 13Z"/></svg>
                </span>
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
                <NuxtLink to="/payroll">View all</NuxtLink>
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