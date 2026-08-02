<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import EditProfile from '../../../components/modals/editprofile.vue'

const isDark = ref(false)
const currentUser = ref<any>(null)
const loading = ref(true)
const showEdit = ref(false)

const userInitials = computed(() => currentUser.value ? `${currentUser.value.firstName[0]}${currentUser.value.lastName[0]}`.toUpperCase() : '')

async function load() {
  loading.value = true
  try { currentUser.value = (await $fetch<any>('/api/auth/me')).user }
  catch { await navigateTo('/loginscreen') }
  finally { loading.value = false }
}

function onSaved(user: any) { currentUser.value = user }

onMounted(() => {
  const savedTheme = localStorage.getItem('dja-theme')
  isDark.value = savedTheme ? savedTheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
  load()
})

watch(isDark, (value) => localStorage.setItem('dja-theme', value ? 'dark' : 'light'))
</script>

<template>
  <div class="page dash-page" :data-theme="isDark ? 'dark' : 'light'">
    <div class="profile-shell">
      <header class="profile-topbar">
        <NuxtLink to="/dashboard" class="profile-back">&larr; Back to dashboard</NuxtLink>
        <button type="button" class="profile-theme-toggle" aria-label="Toggle dark mode" @click="isDark = !isDark">
          <svg v-if="!isDark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2"/></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a7 7 0 0 0 10.7 10.7Z"/></svg>
        </button>
      </header>

      <main v-if="loading" class="profile-loading">Loading your profile…</main>

      <main v-else-if="currentUser" class="profile-card">
        <div class="profile-card__body">
          <div class="profile-card__name-row">
            <div class="profile-card__identity">
              <span class="profile-avatar">
                <img v-if="currentUser.image" :src="currentUser.image" alt="Profile photo" />
                <template v-else>{{ userInitials }}</template>
              </span>
              <div>
                <h1>{{ currentUser.firstName }} {{ currentUser.lastName }}</h1>
                <div class="profile-card__badges">
                  <span class="profile-badge profile-badge--role">{{ currentUser.userType }}</span>
                  <span class="profile-badge profile-badge--dept">{{ currentUser.departmentName }}</span>
                </div>
              </div>
            </div>
            <button type="button" class="profile-edit-btn" @click="showEdit = true">Edit profile</button>
          </div>
        </div>

        <dl class="profile-details">
          <div>
            <dt>Email address</dt>
            <dd class="profile-details__email">
              {{ currentUser.email }}
              <span v-if="currentUser.emailVerified" class="verified-badge" title="Email verified">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.3l2.3 2.3 4.7-4.7"/></svg>
                Verified
              </span>
            </dd>
          </div>
          <div><dt>Gender</dt><dd>{{ currentUser.gender }}</dd></div>
          <div><dt>Department</dt><dd>{{ currentUser.departmentName }}</dd></div>
          <div><dt>Role</dt><dd>{{ currentUser.userType }}</dd></div>
          <div v-if="currentUser.createdAt"><dt>Member since</dt><dd>{{ new Date(currentUser.createdAt).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) }}</dd></div>
        </dl>
      </main>

      <EditProfile v-model="showEdit" :user="currentUser" :dark="isDark" @saved="onSaved" />
    </div>
  </div>
</template>

<style scoped>
.profile-shell { max-width: 720px; margin: 0 auto; padding: 0 20px 60px; font-family: 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif; }
.profile-topbar { display: flex; align-items: center; justify-content: space-between; padding: 20px 0 16px; }
.profile-back { color: var(--muted); font-weight: 700; font-size: .86rem; text-decoration: none; }
.profile-back:hover { color: var(--accent); }
.profile-theme-toggle { width: 38px; height: 38px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 50%; background: var(--surface); color: var(--ink); cursor: pointer; }
.profile-theme-toggle svg { width: 17px; height: 17px; }
.profile-loading { padding: 80px 0; text-align: center; color: var(--muted); }

.profile-card { border: 1px solid var(--line); border-radius: 16px; background: var(--surface); overflow: hidden; box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06); }

.profile-card__body { padding: 28px clamp(20px, 4vw, 36px) 22px; }

.profile-card__name-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.profile-card__identity { display: flex; align-items: center; gap: 16px; min-width: 0; }

.profile-avatar {
  display: grid; place-items: center; width: 76px; height: 76px; border-radius: 50%; overflow: hidden;
  background: var(--navy);
  color: #fff; font-weight: 800; font-size: 1.4rem;
  border: 1px solid var(--line);
  flex-shrink: 0;
}
.profile-avatar img { width: 100%; height: 100%; object-fit: cover; }

.profile-card__name-row h1 { margin: 0; font-size: 1.4rem; font-weight: 800; letter-spacing: -0.03em; color: var(--ink); }
.profile-card__badges { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.profile-badge { display: inline-flex; align-items: center; padding: 3px 11px; border-radius: 999px; font-size: 0.74rem; font-weight: 700; }
.profile-badge--role { color: #1f6fd6; background: #e6f0fd; }
.profile-badge--dept { color: var(--muted); background: var(--soft); }
.profile-edit-btn {
  min-height: 42px; padding: 0 20px; border: 1px solid var(--line); border-radius: 10px;
  background: var(--surface); color: var(--ink); font-weight: 700; font-size: .84rem; cursor: pointer;
  font-family: inherit;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.profile-edit-btn:hover { background: var(--accent); color: #fff; border-color: var(--accent); }

.profile-details { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin: 0; padding: 4px clamp(20px, 4vw, 36px) 28px; border-top: 1px solid var(--line); }
.profile-details > div { padding: 16px 0; border-bottom: 1px dashed var(--line); min-width: 0; }
.profile-details > div:nth-last-child(1), .profile-details > div:nth-last-child(2) { border-bottom: none; }
.profile-details dt { margin: 0 0 4px; color: var(--muted); font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
.profile-details dd { margin: 0; color: var(--ink); font-size: .94rem; font-weight: 600; word-break: break-word; }
.profile-details__email { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.verified-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 9px; border-radius: 999px; background: #e4f7ee; color: #17915a; font-size: .7rem; font-weight: 700; }
.verified-badge svg { width: 13px; height: 13px; }

@media (max-width: 620px) {
  .profile-card__name-row { flex-direction: column; align-items: stretch; }
  .profile-card__identity { flex-direction: column; align-items: flex-start; }
  .profile-edit-btn { width: 100%; }
  .profile-details { grid-template-columns: 1fr; }
  .profile-details > div:nth-last-child(2) { border-bottom: 1px dashed var(--line); }
}
</style>