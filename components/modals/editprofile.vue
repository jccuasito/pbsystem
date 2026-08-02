<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  user: { type: Object, default: null },
  dark: { type: Boolean, default: false }
})
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; saved: [user: any] }>()

const form = ref({ firstName: '', lastName: '', gender: '', departmentName: '' })
const error = ref(''); const busy = ref(false)
const photoBusy = ref(false); const photoError = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const previewImage = ref('')

watch(() => props.modelValue, (open) => {
  if (!open || !props.user) return
  error.value = ''; photoError.value = ''
  previewImage.value = props.user.image || ''
  form.value = {
    firstName: props.user.firstName || '',
    lastName: props.user.lastName || '',
    gender: props.user.gender || '',
    departmentName: props.user.departmentName === 'Unassigned' ? '' : (props.user.departmentName || '')
  }
})

function initials() {
  if (!props.user) return ''
  return `${props.user.firstName?.[0] || ''}${props.user.lastName?.[0] || ''}`.toUpperCase()
}

function pickPhoto() { fileInput.value?.click() }

async function onPhotoSelected(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  photoError.value = ''
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    photoError.value = 'Only PNG, JPG, or WEBP images are allowed.'
    return
  }
  if (file.size > 2 * 1024 * 1024) {
    photoError.value = 'Image must be 2MB or smaller.'
    return
  }
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  photoBusy.value = true
  try {
    const result: any = await $fetch('/api/auth/upload-avatar', { method: 'POST', body: { image: dataUrl } })
    previewImage.value = result.image
    const refreshed: any = await $fetch('/api/auth/me')
    emit('saved', refreshed.user)
  } catch (e: any) {
    photoError.value = e.data?.statusMessage || 'Unable to upload photo.'
  } finally {
    photoBusy.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

async function save() {
  error.value = ''
  if (!form.value.firstName.trim() || !form.value.lastName.trim() || !form.value.gender) {
    error.value = 'First name, last name, and gender are required.'
    return
  }
  busy.value = true
  try {
    const result: any = await $fetch('/api/auth/update-profile', { method: 'POST', body: form.value })
    emit('saved', result.user)
    emit('update:modelValue', false)
  } catch (e: any) {
    error.value = e.data?.statusMessage || 'Unable to update profile.'
  } finally {
    busy.value = false
  }
}

function close() { if (!busy.value) emit('update:modelValue', false) }
</script>

<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="page edit-profile"
      :data-theme="dark ? 'dark' : 'light'"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-profile-title"
      @click.self="close"
    >
      <section class="edit-profile__card">
        <button type="button" class="edit-profile__close" aria-label="Close" :disabled="busy" @click="close">×</button>
        <p class="edit-profile__eyebrow">ACCOUNT SETTINGS</p>
        <h2 id="edit-profile-title">Edit profile</h2>

        <div class="edit-profile__photo-row">
          <span class="edit-profile__avatar">
            <img v-if="previewImage" :src="previewImage" alt="Profile photo" />
            <template v-else>{{ initials() }}</template>
          </span>
          <div class="edit-profile__photo-actions">
            <button type="button" class="edit-profile__photo-btn" :disabled="photoBusy" @click="pickPhoto">{{ photoBusy ? 'Uploading…' : 'Change photo' }}</button>
            <p class="edit-profile__photo-hint">PNG, JPG, or WEBP. Max 2MB.</p>
            <p v-if="photoError" class="edit-profile__error">{{ photoError }}</p>
          </div>
          <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="onPhotoSelected" />
        </div>

        <form class="edit-profile__form" @submit.prevent="save">
          <div class="edit-profile__grid">
            <div class="edit-profile__field">
              <label for="edit-first-name">First name</label>
              <input id="edit-first-name" v-model="form.firstName" required />
            </div>
            <div class="edit-profile__field">
              <label for="edit-last-name">Last name</label>
              <input id="edit-last-name" v-model="form.lastName" required />
            </div>
          </div>
          <div class="edit-profile__field">
            <label for="edit-gender">Gender</label>
            <select id="edit-gender" v-model="form.gender" required>
              <option value="" disabled>Select</option>
              <option>Female</option>
              <option>Male</option>
              <option>Prefer not to say</option>
            </select>
          </div>
          <div class="edit-profile__field">
            <label for="edit-department">Department</label>
            <input id="edit-department" v-model.trim="form.departmentName" maxlength="100" placeholder="e.g. Human Resources" />
          </div>
          <p v-if="error" role="alert" class="edit-profile__error">{{ error }}</p>
          <div class="edit-profile__actions">
            <button type="button" class="edit-profile__cancel" :disabled="busy" @click="close">Cancel</button>
            <button type="submit" class="edit-profile__save" :disabled="busy">{{ busy ? 'Saving…' : 'Save changes' }}</button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.edit-profile {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: grid;
  place-items: center;
  padding: 20px;
  min-height: 0;
  overflow: visible;
  background: rgba(10, 16, 32, 0.62);
}

.edit-profile__card {
  position: relative;
  width: min(100%, 460px);
  box-sizing: border-box;
  max-height: 90vh;
  overflow-y: auto;
  padding: 32px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface);
  color: var(--ink);
  box-shadow: 0 20px 45px rgba(15, 23, 42, 0.22);
  font-family: 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif;
}

.edit-profile__close {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--soft);
  color: var(--muted);
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.edit-profile__close:hover { background: var(--line); color: var(--ink); }

.edit-profile__eyebrow { margin: 0 0 6px; color: var(--accent); font-size: .68rem; font-weight: 800; letter-spacing: .08em; }
.edit-profile h2 { margin: 0 0 22px; font-size: 1.35rem; font-weight: 800; letter-spacing: -0.02em; }

.edit-profile__photo-row { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; padding-bottom: 22px; border-bottom: 1px solid var(--line); }
.edit-profile__avatar {
  width: 60px; height: 60px; flex-shrink: 0; border-radius: 50%; overflow: hidden;
  display: grid; place-items: center;
  background: var(--navy);
  color: #fff; font-weight: 700; font-size: 1.1rem;
  border: 1px solid var(--line);
}
.edit-profile__avatar img { width: 100%; height: 100%; object-fit: cover; }
.edit-profile__photo-actions { min-width: 0; }
.edit-profile__photo-btn { min-height: 36px; padding: 0 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); font-weight: 700; font-size: .82rem; cursor: pointer; font-family: inherit; }
.edit-profile__photo-btn:hover { border-color: var(--accent); color: var(--accent); }
.edit-profile__photo-btn:disabled { opacity: .6; cursor: not-allowed; }
.edit-profile__photo-hint { margin: 6px 0 0; color: var(--muted); font-size: .74rem; }

.edit-profile__form { display: grid; gap: 14px; }
.edit-profile__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.edit-profile__field { display: grid; gap: 6px; min-width: 0; }
.edit-profile__field label { font-size: .74rem; font-weight: 700; color: var(--muted); }
.edit-profile__field input, .edit-profile__field select {
  width: 100%; box-sizing: border-box; min-height: 44px; padding: 0 12px;
  border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); outline: none;
  font-family: inherit; font-size: .88rem;
}
.edit-profile__field input:focus, .edit-profile__field select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent); }
.edit-profile__error { margin: 0; color: #c0392b; font-size: .82rem; }
.edit-profile__actions { display: flex; gap: 10px; margin-top: 6px; }
.edit-profile__cancel, .edit-profile__save { flex: 1; min-height: 46px; border-radius: 9px; font-weight: 700; font-size: .88rem; cursor: pointer; border: 1px solid transparent; font-family: inherit; }
.edit-profile__cancel { background: var(--surface); color: var(--ink); border-color: var(--line); }
.edit-profile__cancel:hover { background: var(--soft); }
.edit-profile__save { background: var(--accent); color: #fff; }
.edit-profile__save:hover { filter: brightness(1.08); }
.edit-profile__cancel:disabled, .edit-profile__save:disabled { opacity: .6; cursor: not-allowed; }
@media (max-width: 480px) { .edit-profile__card { padding: 24px 18px; } }
</style>