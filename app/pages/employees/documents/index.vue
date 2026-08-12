<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

type SectionKey = 'profile' | 'government' | 'education' | 'license' | 'training' | 'clearance' | 'bank' | 'insurance'

const sections: Array<{ key: SectionKey; label: string; idKey: string; fields: Array<{ key: string; label: string; type?: string }> }> = [
  { key: 'profile', label: 'Employee Profile', idKey: 'ProfileID', fields: [{ key: 'Height', label: 'Height', type: 'number' }, { key: 'Weight', label: 'Weight', type: 'number' }, { key: 'PostalCode', label: 'Postal code' }, { key: 'PaymentMethod', label: 'Payment method' }, { key: 'EntryDate', label: 'Entry date', type: 'date' }] },
  { key: 'government', label: 'Government', idKey: 'GovernmentID', fields: [{ key: 'GovernmentType', label: 'Type' }, { key: 'GovernmentNumber', label: 'Number' }] },
  { key: 'education', label: 'Education', idKey: 'EducationID', fields: [{ key: 'EducationLevel', label: 'Level' }, { key: 'School', label: 'School' }, { key: 'Course', label: 'Course' }, { key: 'YearGraduated', label: 'Year graduated', type: 'number' }, { key: 'Attachment', label: 'Attachment' }] },
  { key: 'license', label: 'License', idKey: 'LicenseID', fields: [{ key: 'LicenseName', label: 'License name' }, { key: 'LicenseNumber', label: 'License number' }, { key: 'IssuedDate', label: 'Issued date', type: 'date' }, { key: 'ExpiryDate', label: 'Expiry date', type: 'date' }, { key: 'Attachment', label: 'Attachment' }] },
  { key: 'training', label: 'Training', idKey: 'TrainingID', fields: [{ key: 'TrainingName', label: 'Training name' }, { key: 'TrainingType', label: 'Training type' }, { key: 'TrainingSchool', label: 'School' }, { key: 'CompletedDate', label: 'Completed date', type: 'date' }, { key: 'Attachment', label: 'Attachment' }] },
  { key: 'clearance', label: 'Clearance', idKey: 'ClearanceID', fields: [{ key: 'ClearanceName', label: 'Clearance name' }, { key: 'IssuedDate', label: 'Issued date', type: 'date' }, { key: 'ExpiryDate', label: 'Expiry date', type: 'date' }, { key: 'Attachment', label: 'Attachment' }] },
  { key: 'bank', label: 'Bank', idKey: 'BankID', fields: [{ key: 'BankName', label: 'Bank name' }, { key: 'AccountNumber', label: 'Account number' }, { key: 'AccountType', label: 'Account type' }, { key: 'Status', label: 'Status' }] },
  { key: 'insurance', label: 'Insurance', idKey: 'InsuranceID', fields: [{ key: 'Beneficiary', label: 'Beneficiary' }, { key: 'Relationship', label: 'Relationship' }, { key: 'ContactNumber', label: 'Contact number' }] }
]

const employees = ref<any[]>([])
const activeEmployeeId = ref('')
const employee = ref<any>(null)
const bundle = ref<any>({})
const activeSection = ref<SectionKey>('profile')
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const editingId = ref<number | null>(null)
const form = ref<Record<string, any>>({})

const activeSectionDef = computed(() => sections.find((section) => section.key === activeSection.value) || sections[0])
const selectedEmployeeLabel = computed(() => {
  const selected = employees.value.find((item) => String(item.EmployeeID) === String(activeEmployeeId.value))
  return selected ? `${selected.EmployeeName} (${selected.EmployeeNumber})` : 'No employee selected'
})

function currentRowForSection(section: SectionKey) {
  const value = bundle.value[section]
  if (!value) return null
  return Array.isArray(value) ? (value[0] || null) : value
}

function blankForm(section: SectionKey) {
  const definition = sections.find((item) => item.key === section)!
  return Object.fromEntries(definition.fields.map((field) => [field.key, field.type === 'date' ? '' : field.type === 'number' ? 0 : '']))
}

function rowsFor(section: SectionKey) {
  const value = bundle.value[section]
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function syncForm(section: SectionKey, item: any = null) {
  const selected = item || currentRowForSection(section)
  form.value = {
    ...blankForm(section),
    EmployeeID: activeEmployeeId.value,
    ...(selected || {})
  }

  const idKey = sections.find((entry) => entry.key === section)?.idKey || 'id'
  editingId.value = selected?.[idKey] ?? null

  if (section === 'profile' && bundle.value.employee) {
    form.value = {
      ...blankForm(section),
      EmployeeID: activeEmployeeId.value,
      Height: selected?.Height ?? bundle.value.profile?.Height ?? '',
      Weight: selected?.Weight ?? bundle.value.profile?.Weight ?? '',
      PostalCode: selected?.PostalCode ?? bundle.value.profile?.PostalCode ?? '',
      PaymentMethod: selected?.PaymentMethod ?? bundle.value.profile?.PaymentMethod ?? '',
      EntryDate: (selected?.EntryDate ?? bundle.value.profile?.EntryDate ?? '')?.slice?.(0, 10) ?? (selected?.EntryDate ?? bundle.value.profile?.EntryDate ?? '')
    }
  }
}

function recordLabel(section: SectionKey, item: any) {
  if (!item) return 'Record'
  if (section === 'profile') return 'Profile'
  const firstField = activeSectionDef.value.fields.find((field) => field.key !== 'Status' && field.key !== 'Attachment')
  return firstField ? (item[firstField.key] || activeSectionDef.value.label) : activeSectionDef.value.label
}

function reset(section: SectionKey, item: any = null) {
  activeSection.value = section
  const idKey = sections.find((entry) => entry.key === section)?.idKey || 'id'
  editingId.value = item?.[idKey] ?? null
  form.value = { EmployeeID: activeEmployeeId.value, ...(item ? { ...item } : blankForm(section)) }
  error.value = ''
}

async function load(employeeId?: string) {
  loading.value = true
  try {
    const response: any = await $fetch('/api/employees/documents', { query: { employeeId: employeeId || activeEmployeeId.value || undefined } })
    employees.value = response.employees || []
    employee.value = response.employee || null
    bundle.value = response
    if (!activeEmployeeId.value && employees.value.length) activeEmployeeId.value = String(employees.value[0].EmployeeID)
    syncForm(activeSection.value)
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to load employee documents.'
  } finally {
    loading.value = false
  }
}

watch(activeEmployeeId, (value) => { if (value) load(value) })
watch(activeSection, (section) => syncForm(section))

async function save(section: SectionKey) {
  saving.value = true
  error.value = ''
  try {
    const hasRecord = editingId.value !== null
    await $fetch('/api/employees/documents', {
      method: hasRecord ? 'PUT' : 'POST',
      body: { section, employeeId: activeEmployeeId.value, id: editingId.value, ...form.value }
    })
    editingId.value = null
    form.value = blankForm(section)
    await load(activeEmployeeId.value)
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to save record.'
  } finally {
    saving.value = false
  }
}

async function remove(section: SectionKey, item: any) {
  if (!confirm('Delete this record?')) return
  const idKey = sections.find((entry) => entry.key === section)?.idKey || 'id'
  try {
    await $fetch('/api/employees/documents', { method: 'DELETE', body: { section, employeeId: activeEmployeeId.value, id: item[idKey] } })
    await load(activeEmployeeId.value)
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to delete record.'
  }
}

function display(value: any) {
  return value === null || value === undefined || value === '' ? '—' : value
}

onMounted(async () => {
  await load()
  if (employees.value.length) activeEmployeeId.value = String(employees.value[0].EmployeeID)
})
</script>

<template>
  <main class="documents-page">
    <header class="page-head">
      <div>
        <p>EMPLOYEE MANAGEMENT</p>
        <h1>Employee Documents / Profile</h1>
        <small class="page-head__selected">Currently editing: {{ selectedEmployeeLabel }}</small>
      </div>
      <select v-model="activeEmployeeId">
        <option value="">Select employee</option>
        <option v-for="item in employees" :key="item.EmployeeID" :value="item.EmployeeID">{{ item.EmployeeName }} ({{ item.EmployeeNumber }})</option>
      </select>
    </header>

    <section class="profile-card" v-if="employee">
      <div>
        <p>Employee ID</p>
        <h2>{{ employee.FirstName }} {{ employee.MiddleName }} {{ employee.LastName }}</h2>
        <small>{{ employee.EmployeeNumber }} • {{ employee.AgencyName }} • {{ employee.PositionName }}</small>
      </div>
      <div class="profile-meta">
        <span>{{ display(employee.EmployeeNumber) }}</span>
        <span>{{ display(employee.Email) }}</span>
        <span>{{ display(employee.ContactNumber) }}</span>
        <span>{{ display(employee.Status) }}</span>
      </div>
    </section>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <div class="tabs">
      <button v-for="section in sections" :key="section.key" type="button" :class="{ active: activeSection === section.key }" @click="activeSection = section.key">{{ section.label }}</button>
    </div>

    <section class="panel">
      <div class="panel-head">
        <h3>{{ activeSectionDef.label }}</h3>
        <button class="primary" @click="reset(activeSection)">+ Add record</button>
      </div>

      <div v-if="activeSection !== 'profile'" class="section-grid">
        <article v-for="item in rowsFor(activeSection)" :key="item[activeSectionDef.idKey]" class="record-card">
          <div class="record-card__head">
            <strong>{{ recordLabel(activeSection, item) }}</strong>
            <div class="record-actions">
              <button type="button" @click="reset(activeSection, item)">Edit</button>
              <button type="button" @click="remove(activeSection, item)">Delete</button>
            </div>
          </div>
          <dl>
            <template v-for="field in activeSectionDef.fields" :key="field.key">
              <dt>{{ field.label }}</dt>
              <dd>{{ display(item[field.key]) }}</dd>
            </template>
          </dl>
        </article>
      </div>

      <form class="edit-form" @submit.prevent="save(activeSection)">
        <label>Record ID<input :value="editingId ?? 'New record'" disabled /></label>
        <label v-for="field in activeSectionDef.fields" :key="field.key">{{ field.label }}<input v-model="form[field.key]" :type="field.type || 'text'" /></label>
        <button class="primary" :disabled="saving">{{ saving ? 'Saving…' : 'Save section' }}</button>
      </form>
    </section>
  </main>
</template>

<style scoped>
.documents-page{padding:32px;max-width:1400px;margin:auto;color:#162033;font-family:Inter,system-ui,sans-serif}.page-head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:20px}.page-head p{margin:0;font-size:.75rem;font-weight:800;letter-spacing:.08em;color:#5271a5}.page-head h1{margin:4px 0 0;font-size:1.8rem}.page-head__selected{display:block;margin-top:4px;color:#637287}.page-head select{min-height:40px;border:1px solid #ccd5e4;border-radius:8px;padding:8px 10px;background:#fff}.profile-card{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:18px 20px;border:1px solid #dce3ee;border-radius:16px;background:linear-gradient(135deg,#fff 0%,#f7faff 100%);margin-bottom:16px}.profile-card p{margin:0 0 4px;color:#5271a5;font-size:.75rem;font-weight:800;letter-spacing:.08em}.profile-card h2{margin:0;font-size:1.35rem}.profile-card small{color:#637287}.profile-meta{display:grid;gap:6px;text-align:right;color:#415063}.tabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}.tabs button{border:1px solid #d7dfeb;background:#fff;border-radius:999px;padding:9px 14px;font-weight:700;cursor:pointer}.tabs button.active{background:#2349e6;color:#fff;border-color:#2349e6}.panel{border:1px solid #dce3ee;border-radius:16px;background:#fff;padding:20px}.panel-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}.primary{border:0;border-radius:10px;background:#2349e6;color:#fff;padding:10px 14px;font-weight:700;cursor:pointer}.section-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-bottom:18px}.record-card{border:1px solid #e3e9f2;border-radius:14px;padding:14px;background:#fdfefe}.record-card__head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.record-actions{display:flex;gap:8px}.record-actions button,.edit-form button{border:1px solid #cfd8e6;background:#fff;border-radius:8px;padding:6px 10px;cursor:pointer}.record-card dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:14px 0 0}.record-card dt{font-size:.72rem;font-weight:800;color:#7a8695;text-transform:uppercase}.record-card dd{margin:0}.edit-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:14px;padding-top:14px;border-top:1px solid #edf1f6}.edit-form label{display:grid;gap:6px;font-size:.8rem;font-weight:700;color:#475569}.edit-form input{min-height:40px;border:1px solid #cfd8e6;border-radius:8px;padding:9px 10px;font:inherit}.error{color:#b42318;margin:0 0 12px}.profile-card span{display:block}.section-grid{margin-top:6px}@media(max-width:800px){.documents-page{padding:20px}.page-head,.profile-card,.panel-head{flex-direction:column;align-items:flex-start}.profile-meta{text-align:left}.edit-form{grid-template-columns:1fr}}
</style>
