<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { formatEmployeeId, formatEmployeeLabel, formatEmployeeName, formatEmployeeNumber } from '~/utils/employee'

type SectionKey = 'profile' | 'government' | 'education' | 'license' | 'training' | 'clearance' | 'bank' | 'insurance'

const sections: Array<{ key: SectionKey; label: string; idKey: string; fields: Array<{ key: string; label: string; type?: string }> }> = [
  { key: 'profile', label: 'Employee Profile', idKey: 'ProfileID', fields: [{ key: 'Height', label: 'Height', type: 'number' }, { key: 'Weight', label: 'Weight', type: 'number' }, { key: 'PostalCode', label: 'Postal code' }, { key: 'PaymentMethod', label: 'Payment method' }, { key: 'EntryDate', label: 'Entry date', type: 'date' }] },
  { key: 'government', label: 'Government IDs', idKey: 'GovernmentID', fields: [{ key: 'GovernmentType', label: 'Type' }, { key: 'GovernmentNumber', label: 'Number' }] },
  { key: 'education', label: 'Education', idKey: 'EducationID', fields: [{ key: 'EducationLevel', label: 'Level' }, { key: 'School', label: 'School' }, { key: 'Course', label: 'Course' }, { key: 'YearGraduated', label: 'Year graduated', type: 'number' }, { key: 'Attachment', label: 'Attachment' }] },
  { key: 'license', label: 'License', idKey: 'LicenseID', fields: [{ key: 'LicenseName', label: 'License name' }, { key: 'LicenseNumber', label: 'License number' }, { key: 'IssuedDate', label: 'Issued date', type: 'date' }, { key: 'ExpiryDate', label: 'Expiry date', type: 'date' }, { key: 'Attachment', label: 'Attachment' }] },
  { key: 'training', label: 'Training', idKey: 'TrainingID', fields: [{ key: 'TrainingName', label: 'Training name' }, { key: 'TrainingType', label: 'Training type' }, { key: 'TrainingSchool', label: 'School' }, { key: 'CompletedDate', label: 'Completed date', type: 'date' }, { key: 'Attachment', label: 'Attachment' }] },
  { key: 'clearance', label: 'Clearance', idKey: 'ClearanceID', fields: [{ key: 'ClearanceName', label: 'Clearance name' }, { key: 'IssuedDate', label: 'Issued date', type: 'date' }, { key: 'ExpiryDate', label: 'Expiry date', type: 'date' }, { key: 'Attachment', label: 'Attachment' }] },
  { key: 'bank', label: 'Bank', idKey: 'BankID', fields: [{ key: 'BankName', label: 'Bank name' }, { key: 'AccountNumber', label: 'Account number' }, { key: 'AccountType', label: 'Account type' }, { key: 'Status', label: 'Status' }] },
  { key: 'insurance', label: 'Insurance', idKey: 'InsuranceID', fields: [{ key: 'Beneficiary', label: 'Beneficiary' }, { key: 'Relationship', label: 'Relationship' }, { key: 'ContactNumber', label: 'Contact number' }] }
]

const employees = ref<any[]>([])
const agencies = ref<any[]>([])
const positions = ref<any[]>([])
const employee = ref<any>(null)
const bundle = ref<any>({})
const activeEmployeeId = ref('')
const activeSection = ref<SectionKey>('profile')
const search = ref('')
const filters = ref({ agencyId: '', positionId: '' })
const loading = ref(true)
const saving = ref(false)
const detailOpen = ref(false)
const formOpen = ref(false)
const error = ref('')
const editingId = ref<number | null>(null)
const form = ref<Record<string, any>>({})

const activeSectionDef = computed(() => sections.find((section) => section.key === activeSection.value) || sections[0])

const filteredEmployees = computed(() => {
  const query = search.value.trim().toLowerCase()
  return employees.value.filter((item) => {
    const matchesSearch = !query || [formatEmployeeId(item.EmployeeID), item.EmployeeNumber, formatEmployeeName(item), item.AgencyName, item.PositionName]
      .some((value) => String(value || '').toLowerCase().includes(query))
    const matchesAgency = !filters.value.agencyId || String(item.AgencyID) === String(filters.value.agencyId)
    const matchesPosition = !filters.value.positionId || String(item.PositionID) === String(filters.value.positionId)
    return matchesSearch && matchesAgency && matchesPosition
  })
})

function rowsFor(section: SectionKey) {
  const value = bundle.value[section]
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function blankForm(section: SectionKey) {
  const definition = sections.find((item) => item.key === section)!
  return Object.fromEntries(definition.fields.map((field) => [field.key, field.type === 'number' ? 0 : '']))
}

function display(value: any) {
  return value === null || value === undefined || value === '' ? '\u2014' : value
}

function recordLabel(section: SectionKey, item: any) {
  if (!item) return 'New record'
  const definition = sections.find((entry) => entry.key === section) || sections[0]
  const firstField = definition.fields.find((field) => field.key !== 'Status' && field.key !== 'Attachment')
  return section === 'profile' ? 'Profile details' : display(firstField ? item[firstField.key] : definition.label)
}

function recordCount(section: SectionKey) {
  return rowsFor(section).length
}

async function load(employeeId?: string) {
  loading.value = true
  try {
    const response: any = await $fetch('/api/employees/documents', { query: { employeeId: employeeId || activeEmployeeId.value || undefined } })
    employees.value = response.employees || []
    agencies.value = response.agencies || []
    positions.value = response.positions || []
    employee.value = response.employee || null
    bundle.value = response
    if (!activeEmployeeId.value && employees.value.length) activeEmployeeId.value = String(employees.value[0].EmployeeID)
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to load employee documents.'
  } finally {
    loading.value = false
  }
}

async function selectEmployee(item: any) {
  activeEmployeeId.value = String(item.EmployeeID)
  await load(activeEmployeeId.value)
}

async function openView(item: any) {
  await selectEmployee(item)
  detailOpen.value = true
}

async function openAdd(item: any, section: SectionKey = 'profile') {
  await selectEmployee(item)
  activeSection.value = section
  editingId.value = null
  form.value = { EmployeeID: activeEmployeeId.value, ...blankForm(section) }
  formOpen.value = true
}

function openEdit(section: SectionKey, item: any) {
  activeSection.value = section
  editingId.value = item?.[activeSectionDef.value.idKey] ?? null
  form.value = { EmployeeID: activeEmployeeId.value, ...blankForm(section), ...(item || {}) }
  formOpen.value = true
}

function onSectionChanged() {
  if (editingId.value !== null) return
  form.value = { EmployeeID: activeEmployeeId.value, ...blankForm(activeSection.value) }
}

async function save(section: SectionKey) {
  saving.value = true
  error.value = ''
  try {
    const hasRecord = editingId.value !== null
    await $fetch('/api/employees/documents', {
      method: hasRecord ? 'PUT' : 'POST',
      body: { section, employeeId: activeEmployeeId.value, id: editingId.value, ...form.value }
    })
    formOpen.value = false
    editingId.value = null
    await load(activeEmployeeId.value)
    detailOpen.value = true
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to save record.'
  } finally {
    saving.value = false
  }
}

async function remove(section: SectionKey, item: any) {
  if (!confirm('Delete this record?')) return
  const definition = sections.find((entry) => entry.key === section) || sections[0]
  try {
    await $fetch('/api/employees/documents', { method: 'DELETE', body: { section, employeeId: activeEmployeeId.value, id: item[definition.idKey] } })
    await load(activeEmployeeId.value)
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to delete record.'
  }
}

onMounted(load)
</script>

<template>
  <main class="documents-page">
    <header class="page-head">
      <div>
        <p>EMPLOYEE MANAGEMENT</p>
        <h1>Employee Documents / Profile</h1>
        <small>Search an employee, then add or view sectioned documents.</small>
      </div>
    </header>

    <section class="toolbar">
      <label class="search-field">
        <span>Search employee</span>
        <input v-model="search" placeholder="Search Employee ID, name, employee no., agency, or position" />
      </label>
      <label>
        <span>Agency</span>
        <select v-model="filters.agencyId">
          <option value="">All Agencies</option>
          <option v-for="agency in agencies" :key="agency.AgencyID" :value="agency.AgencyID">{{ agency.AgencyName }}</option>
        </select>
      </label>
      <label>
        <span>Position</span>
        <select v-model="filters.positionId">
          <option value="">All Positions</option>
          <option v-for="position in positions" :key="position.PositionID" :value="position.PositionID">{{ position.PositionName }}</option>
        </select>
      </label>
    </section>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <section class="employee-list">
      <table>
        <thead>
          <tr>
            <th>Employee ID</th>
            <th>Employee No.</th>
            <th>Name</th>
            <th>Agency</th>
            <th>Position</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading"><td colspan="6">Loading...</td></tr>
          <tr v-else-if="!filteredEmployees.length"><td colspan="6">No employees found.</td></tr>
          <tr v-for="item in filteredEmployees" :key="item.EmployeeID">
            <td class="employee-id">{{ formatEmployeeId(item.EmployeeID) }}</td>
            <td>{{ formatEmployeeNumber(item.EmployeeNumber) }}</td>
            <td>{{ formatEmployeeName(item) }}</td>
            <td>{{ display(item.AgencyName) }}</td>
            <td>{{ display(item.PositionName) }}</td>
            <td class="row-actions">
              <button type="button" class="ghost" @click="openView(item)">View documents</button>
              <button type="button" class="primary" @click="openAdd(item)">+ Add documents</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <Teleport to="body">
      <div v-if="detailOpen" class="backdrop" @click.self="detailOpen = false">
        <section class="drawer">
          <button class="close" type="button" aria-label="Close" @click="detailOpen = false">x</button>
          <header v-if="employee" class="profile-card">
            <div>
              <p>Employee ID</p>
              <h2>{{ formatEmployeeName(employee) }}</h2>
              <small>{{ formatEmployeeId(employee.EmployeeID) }} - {{ employee.AgencyName }} - {{ employee.PositionName }}</small>
            </div>
            <div class="profile-meta">
              <span>{{ formatEmployeeNumber(employee.EmployeeNumber) }}</span>
              <span>{{ display(employee.Email) }}</span>
              <span>{{ display(employee.ContactNumber) }}</span>
              <span>{{ display(employee.Status) }}</span>
            </div>
          </header>

          <nav class="tabs" aria-label="Document sections">
            <button v-for="section in sections" :key="section.key" type="button" :class="{ active: activeSection === section.key }" @click="activeSection = section.key">
              {{ section.label }} <span>{{ recordCount(section.key) }}</span>
            </button>
          </nav>

          <section class="records-panel">
            <div class="panel-head">
              <h3>{{ activeSectionDef.label }}</h3>
              <button class="primary" type="button" @click="openAdd(employee, activeSection)">+ Add record</button>
            </div>

            <div class="section-grid">
              <article v-for="item in rowsFor(activeSection)" :key="item[activeSectionDef.idKey]" class="record-card">
                <div class="record-card__head">
                  <strong>{{ recordLabel(activeSection, item) }}</strong>
                  <div class="record-actions">
                    <button type="button" @click="openEdit(activeSection, item)">Edit</button>
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
              <p v-if="!rowsFor(activeSection).length" class="empty">No records yet for this section.</p>
            </div>
          </section>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="formOpen" class="backdrop" @click.self="!saving && (formOpen = false)">
        <form class="modal" @submit.prevent="save(activeSection)">
          <button class="close" type="button" aria-label="Close" @click="formOpen = false">x</button>
          <h2>{{ editingId ? 'Edit document' : 'Add documents' }}</h2>
          <p v-if="employee" class="modal-subtitle">{{ formatEmployeeLabel(employee) }}</p>

          <label>Document type
            <select v-model="activeSection" :disabled="editingId !== null" @change="onSectionChanged">
              <option v-for="section in sections" :key="section.key" :value="section.key">{{ section.label }}</option>
            </select>
          </label>

          <div class="form-grid">
            <label v-for="field in activeSectionDef.fields" :key="field.key">
              {{ field.label }}
              <input v-model="form[field.key]" :type="field.type || 'text'" />
            </label>
          </div>

          <p v-if="error" class="error">{{ error }}</p>
          <footer>
            <button type="button" @click="formOpen = false">Cancel</button>
            <button class="primary" :disabled="saving">{{ saving ? 'Saving...' : 'Save document' }}</button>
          </footer>
        </form>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
.documents-page{padding:34px;max-width:1500px;margin:auto;color:#0b1f3f;font-family:Inter,system-ui,sans-serif}.page-head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:22px}.page-head p{margin:0;font-size:.75rem;font-weight:800;letter-spacing:.1em;color:#5570a5}.page-head h1{margin:4px 0 0;font-size:2rem;line-height:1.15}.page-head small{display:block;margin-top:6px;color:#66758b}.toolbar{display:grid;grid-template-columns:minmax(260px,1fr) 220px 220px;gap:14px;margin-bottom:18px}.toolbar label{display:grid;gap:6px;font-size:.78rem;font-weight:800;color:#526174}.toolbar input,.toolbar select{height:42px;border:1px solid #ccd5e4;border-radius:8px;padding:0 12px;background:#fff;font:inherit}.employee-list{overflow:auto;border:1px solid #dce3ee;border-radius:14px;background:#fff}table{width:100%;border-collapse:collapse}th,td{padding:14px;text-align:left;border-bottom:1px solid #edf1f6;font-size:.88rem;white-space:nowrap}th{background:#f8fafc;color:#526174;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em}.employee-id{font-weight:900;color:#1f3fcf}.row-actions{display:flex;gap:8px}.primary,.ghost{border:0;border-radius:8px;padding:9px 13px;font-weight:800;cursor:pointer;text-decoration:none}.primary{background:#2349e6;color:#fff}.ghost{background:#eef3ff;color:#2043cc}.error{color:#b42318;margin:0 0 12px}.backdrop{position:fixed;inset:0;z-index:300;background:rgba(15,23,42,.58);display:grid;place-items:center;padding:18px}.drawer,.modal{position:relative;width:min(100%,1160px);max-height:92vh;overflow:auto;background:#fff;border-radius:16px;padding:26px;color:#162033}.modal{width:min(100%,780px);display:grid;gap:14px}.close{position:absolute;right:14px;top:12px;border:0;background:transparent;font-size:1.1rem;cursor:pointer}.profile-card{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:18px 20px;border:1px solid #dce3ee;border-radius:14px;background:linear-gradient(135deg,#fff 0%,#f7faff 100%);margin-bottom:16px}.profile-card p{margin:0 0 4px;color:#5271a5;font-size:.75rem;font-weight:800;letter-spacing:.08em}.profile-card h2{margin:0;font-size:1.35rem}.profile-card small{color:#637287}.profile-meta{display:grid;gap:6px;text-align:right;color:#415063}.tabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}.tabs button{border:1px solid #d7dfeb;background:#fff;border-radius:999px;padding:9px 13px;font-weight:800;cursor:pointer}.tabs button.active{background:#2349e6;color:#fff;border-color:#2349e6}.tabs span{display:inline-grid;place-items:center;min-width:20px;height:20px;margin-left:6px;border-radius:999px;background:#eef3ff;color:#2043cc;font-size:.72rem}.tabs button.active span{background:#fff;color:#2349e6}.records-panel{border:1px solid #dce3ee;border-radius:14px;background:#fff;padding:18px}.panel-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}.panel-head h3{margin:0}.section-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.record-card{border:1px solid #e3e9f2;border-radius:12px;padding:14px;background:#fdfefe}.record-card__head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.record-actions{display:flex;gap:8px}.record-actions button,.modal footer button:not(.primary){border:1px solid #cfd8e6;background:#fff;border-radius:8px;padding:7px 10px;cursor:pointer;font-weight:700}.record-card dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:14px 0 0}.record-card dt{font-size:.72rem;font-weight:900;color:#7a8695;text-transform:uppercase}.record-card dd{margin:0}.empty{margin:0;color:#66758b}.modal h2{margin:0}.modal-subtitle{margin:-8px 0 0;color:#637287}.modal label{display:grid;gap:6px;font-size:.8rem;font-weight:800;color:#475569}.modal input,.modal select{box-sizing:border-box;width:100%;min-height:40px;border:1px solid #cfd8e6;border-radius:8px;padding:9px 10px;font:inherit}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.modal footer{display:flex;justify-content:flex-end;gap:10px;margin-top:6px}@media(max-width:850px){.documents-page{padding:20px}.toolbar{grid-template-columns:1fr}.profile-card,.panel-head{flex-direction:column;align-items:flex-start}.profile-meta{text-align:left}.form-grid{grid-template-columns:1fr}.row-actions{flex-direction:column}}
</style>
