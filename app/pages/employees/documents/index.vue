<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRealtimeRefresh } from '~/composables/useRealtimeRefresh'
import { formatEmployeeId, formatEmployeeLabel, formatEmployeeName, formatEmployeeNumber } from '~/utils/employee'

type SectionKey = 'profile' | 'government' | 'education' | 'license' | 'training' | 'clearance' | 'bank' | 'insurance'

const sections: Array<{ key: SectionKey; label: string; idKey: string; fields: Array<{ key: string; label: string; type?: string }> }> = [
  { key: 'profile', label: 'Employee Profile', idKey: 'EmployeeID', fields: [] },
  { key: 'government', label: 'Government IDs', idKey: 'GovernmentID', fields: [{ key: 'GovernmentType', label: 'Type' }, { key: 'GovernmentNumber', label: 'Number' }] },
  { key: 'education', label: 'Education', idKey: 'EducationID', fields: [{ key: 'EducationLevel', label: 'Level' }, { key: 'School', label: 'School' }, { key: 'Course', label: 'Course' }, { key: 'YearGraduated', label: 'Year graduated', type: 'number' }, { key: 'Attachment', label: 'Attachment' }] },
  { key: 'license', label: 'License', idKey: 'LicenseID', fields: [{ key: 'LicenseName', label: 'License name' }, { key: 'LicenseNumber', label: 'License number' }, { key: 'IssuedDate', label: 'Issued date', type: 'date' }, { key: 'ExpiryDate', label: 'Expiry date', type: 'date' }, { key: 'Attachment', label: 'Attachment' }] },
  { key: 'training', label: 'Training', idKey: 'TrainingID', fields: [{ key: 'TrainingName', label: 'Training name' }, { key: 'TrainingType', label: 'Training type' }, { key: 'TrainingSchool', label: 'School' }, { key: 'CompletedDate', label: 'Completed date', type: 'date' }, { key: 'Attachment', label: 'Attachment' }] },
  { key: 'clearance', label: 'Clearance', idKey: 'ClearanceID', fields: [{ key: 'ClearanceName', label: 'Clearance name' }, { key: 'IssuedDate', label: 'Issued date', type: 'date' }, { key: 'ExpiryDate', label: 'Expiry date', type: 'date' }, { key: 'Attachment', label: 'Attachment' }] },
  { key: 'bank', label: 'Bank', idKey: 'BankID', fields: [{ key: 'AccountName', label: 'Account holder name' }, { key: 'BankName', label: 'Bank name' }, { key: 'AccountNumber', label: 'Account number' }, { key: 'AccountType', label: 'Account type' }, { key: 'Status', label: 'Status' }] },
  { key: 'insurance', label: 'Insurance', idKey: 'InsuranceID', fields: [{ key: 'Beneficiary', label: 'Beneficiary' }, { key: 'Relationship', label: 'Relationship' }, { key: 'ContactNumber', label: 'Contact number' }] }
]
const emit = defineEmits<{ (event: 'navigate', view: 'employees-list'): void }>()

const employees = ref<any[]>([])
const agencies = ref<any[]>([])
const positions = ref<any[]>([])
const agencyPositions = ref<any[]>([])
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
const formFromDetail = ref(false)
const error = ref('')
const editingId = ref<number | null>(null)
const form = ref<Record<string, any>>({})

const activeSectionDef = computed(() => sections.find((section) => section.key === activeSection.value) || sections[0])
const documentSections = computed(() => sections.filter(section => section.key !== 'profile'))
const profilePhoto = computed(() => employee.value?.PhotoUrl || employee.value?.PhotoPath || '')
const profileInitials = computed(() => [employee.value?.FirstName, employee.value?.LastName].filter(Boolean).map(name => String(name).trim().charAt(0)).join('').toUpperCase() || 'EMP')
const profileGroups = computed(() => {
  const person = employee.value || {}
  const payment = rowsFor('profile')[0] || {}
  return [
    { key: 'employment', title: 'Employment details', fields: [
      { label: 'Employee ID', value: formatEmployeeId(person.EmployeeID) },
      { label: 'Employee number', value: formatEmployeeNumber(person.EmployeeNumber) },
      { label: 'Agency', value: person.AgencyName },
      { label: 'Position', value: person.PositionName },
      { label: 'Date hired', value: profileDate(person.DateHired) },
      { label: 'Status', value: person.Status },
    ] },
    { key: 'personal', title: 'Personal information', fields: [
      { label: 'First name', value: person.FirstName },
      { label: 'Middle name', value: person.MiddleName },
      { label: 'Last name', value: person.LastName },
      { label: 'Nickname', value: person.Nickname },
      { label: 'Birthday', value: profileDate(person.Birthday) },
      { label: 'Gender', value: person.Gender },
      { label: 'Civil status', value: person.CivilStatus },
      { label: 'Email', value: person.Email },
      { label: 'Contact number', value: person.ContactNumber },
    ] },
    { key: 'addresses', title: 'Addresses', fields: [
      { label: 'Permanent address', value: profileAddress('Permanent') || person.Address },
      { label: 'Present address', value: profileAddress('Present') },
    ] },
    { key: 'payment', title: 'Payment information', fields: [
      { label: 'Payment method', value: payment.PaymentMethod },
      { label: 'Effective date', value: profileDate(payment.PaymentMethodEffectiveDate) },
    ] },
    { key: 'emergency', title: 'Emergency contact', fields: [
      { label: 'Full name', value: person.EmergencyName },
      { label: 'Relationship', value: person.EmergencyRelationship },
      { label: 'Contact number', value: person.EmergencyContactNo },
      { label: 'Address', value: person.EmergencyAddress },
    ] },
  ]
})
const profileBeneficiaries = computed(() => {
  const person = employee.value || {}
  if (Number(person.BeneficiaryNotApplicable) === 1) return []
  let entries = person.Beneficiaries
  if (typeof entries === 'string') {
    try { entries = JSON.parse(entries) } catch { entries = null }
  }
  if (!Array.isArray(entries)) entries = [
    { Name: person.Beneficiary1, Relationship: person.Beneficiary1Relationship },
    { Name: person.Beneficiary2, Relationship: person.Beneficiary2Relationship },
  ]
  return entries.filter((entry: any) => entry && (entry.Name || entry.Relationship))
})

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
const availablePositions = computed(() => {
  const agencyId = String(filters.value.agencyId)
  const source = agencyId ? agencyPositions.value.filter((item) => String(item.AgencyID) === agencyId) : agencyPositions.value
  const seen = new Set<string>()
  return source.filter((item) => {
    const id = String(item.PositionID)
    if (seen.has(id)) return false
    seen.add(id)
    return true
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

function profileDate(value: unknown) {
  const day = String(value || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return display(value)
  const parsed = new Date(`${day}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? display(value) : new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed)
}

function profileAddress(prefix: 'Permanent' | 'Present') {
  return ['UnitHouseNumber', 'Street', 'Subdivision', 'Barangay', 'CityMunicipality', 'Province', 'Region', 'PostalCode']
    .map(key => String(employee.value?.[`${prefix}${key}`] ?? '').trim()).filter(Boolean).join(', ')
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

async function load(employeeId?: string, silent = false) {
  if (!silent) loading.value = true
  try {
    const response: any = await $fetch('/api/employees/documents', { query: { employeeId: employeeId || activeEmployeeId.value || undefined } })
    employees.value = response.employees || []
    agencies.value = response.agencies || []
    positions.value = response.positions || []
    agencyPositions.value = response.agencyPositions || []
    employee.value = response.employee || null
    bundle.value = response
    if (!activeEmployeeId.value && employees.value.length) activeEmployeeId.value = String(employees.value[0].EmployeeID)
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to load employee documents.'
  } finally {
    if (!silent) loading.value = false
  }
}

watch(() => filters.value.agencyId, () => { filters.value.positionId = '' })

async function selectEmployee(item: any) {
  activeEmployeeId.value = String(item.EmployeeID)
  await load(activeEmployeeId.value)
}

async function openView(item: any) {
  activeSection.value = 'profile'
  await selectEmployee(item)
  detailOpen.value = true
}

async function openAdd(item: any, section: SectionKey = 'government') {
  if (section === 'profile') section = 'government'
  await selectEmployee(item)
  formFromDetail.value = detailOpen.value
  detailOpen.value = false
  activeSection.value = section
  editingId.value = null
  form.value = { EmployeeID: activeEmployeeId.value, ...blankForm(section) }
  formOpen.value = true
}

function openEdit(section: SectionKey, item: any) {
  if (section === 'profile') return
  formFromDetail.value = detailOpen.value
  detailOpen.value = false
  activeSection.value = section
  editingId.value = item?.[activeSectionDef.value.idKey] ?? null
  form.value = { EmployeeID: activeEmployeeId.value, ...blankForm(section), ...(item || {}) }
  formOpen.value = true
}

function onSectionChanged() {
  if (editingId.value !== null) return
  form.value = { EmployeeID: activeEmployeeId.value, ...blankForm(activeSection.value) }
}

function closeForm() {
  if (saving.value) return
  formOpen.value = false
  detailOpen.value = formFromDetail.value
  formFromDetail.value = false
  error.value = ''
}

async function save(section: SectionKey) {
  if (section === 'profile') return
  saving.value = true
  error.value = ''
  try {
    const hasRecord = editingId.value !== null
    await $fetch('/api/employees/documents', {
      method: hasRecord ? 'PUT' : 'POST',
      body: { section, employeeId: activeEmployeeId.value, id: editingId.value, ...form.value }
    })
    formOpen.value = false
    formFromDetail.value = false
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
  if (section === 'profile') return
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
useRealtimeRefresh(() => load(activeEmployeeId.value, true), { shouldRefresh: () => !saving.value })
</script>

<template>
  <main class="documents-page">
    <header class="page-head">
      <div>
        <p class="eyebrow">EMPLOYEE MANAGEMENT</p>
        <h1>Employee Documents</h1>
        <small>View and manage employee records by document type.</small>
      </div>
      <button type="button" class="primary" @click="emit('navigate', 'employees-list')">+ Add employee</button>
    </header>

    <section class="toolbar">
      <label class="search-field">
        <span>Search employee</span>
        <input v-model="search" type="search" placeholder="Employee ID, name, number, agency, or position" />
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
          <option v-for="position in availablePositions" :key="position.PositionID" :value="position.PositionID">{{ position.PositionName }}</option>
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
          <tr v-if="loading"><td colspan="6" class="table-empty">Loading employees…</td></tr>
          <tr v-else-if="!filteredEmployees.length"><td colspan="6" class="table-empty">No employees match these filters.</td></tr>
          <tr v-for="item in loading ? [] : filteredEmployees" :key="item.EmployeeID">
            <td class="employee-id">{{ formatEmployeeId(item.EmployeeID) }}</td>
            <td>{{ formatEmployeeNumber(item.EmployeeNumber) }}</td>
            <td><strong>{{ formatEmployeeName(item) }}</strong></td>
            <td>{{ display(item.AgencyName) }}</td>
            <td>{{ display(item.PositionName) }}</td>
            <td class="row-actions">
              <button type="button" class="secondary" @click="openView(item)">View documents</button>
              <button type="button" class="primary" @click="openAdd(item)">+ Add record</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <Teleport to="body">
      <div v-if="detailOpen" class="backdrop" @click.self="detailOpen = false">
        <section class="drawer" role="dialog" aria-modal="true" aria-label="Employee documents">
          <header v-if="employee" class="profile-card">
            <div>
              <p class="eyebrow">EMPLOYEE DOCUMENTS · {{ formatEmployeeId(employee.EmployeeID) }}</p>
              <h2>{{ formatEmployeeName(employee) }}</h2>
              <small>{{ display(employee.AgencyName) }} · {{ display(employee.PositionName) }}</small>
            </div>
            <div class="profile-meta">
              <span class="employee-number">{{ formatEmployeeNumber(employee.EmployeeNumber) }}</span>
              <span class="employee-status">{{ display(employee.Status) }}</span>
            </div>
            <button class="close" type="button" aria-label="Close employee documents" @click="detailOpen = false">×</button>
          </header>
          <div class="drawer-body">
            <div v-if="employee && activeSection !== 'profile'" class="contact-strip">
              <span><strong>Email</strong>{{ display(employee.Email) }}</span>
              <span><strong>Contact</strong>{{ display(employee.ContactNumber) }}</span>
            </div>
            <nav class="tabs" aria-label="Document sections">
              <button v-for="section in sections" :key="section.key" type="button" :aria-current="activeSection === section.key ? 'page' : undefined" :class="{ active: activeSection === section.key }" @click="activeSection = section.key">
                {{ section.label }} <span v-if="section.key !== 'profile'">{{ recordCount(section.key) }}</span>
              </button>
            </nav>
            <section v-if="activeSection === 'profile' && employee" class="records-panel profile-view" aria-labelledby="employee-profile-title">
              <header class="profile-intro">
                <img v-if="profilePhoto" class="profile-photo" :src="profilePhoto" :alt="`${formatEmployeeName(employee)} profile photo`" />
                <span v-else class="profile-photo profile-photo--placeholder" aria-hidden="true">{{ profileInitials }}</span>
                <div><p class="eyebrow">EMPLOYEE PROFILE</p><h3 id="employee-profile-title">Basic information</h3><p class="profile-source">Saved in Employee List. Update profile details there.</p></div>
                <span class="profile-readonly">View only</span>
              </header>
              <section v-for="group in profileGroups" :key="group.key" class="profile-group" :aria-labelledby="`profile-${group.key}-title`">
                <h4 :id="`profile-${group.key}-title`">{{ group.title }}</h4>
                <dl class="profile-fields" :class="{ 'profile-fields--addresses': group.key === 'addresses' }">
                  <div v-for="field in group.fields" :key="field.label"><dt>{{ field.label }}</dt><dd>{{ display(field.value) }}</dd></div>
                </dl>
              </section>
              <section class="profile-group" aria-labelledby="profile-beneficiaries-title">
                <h4 id="profile-beneficiaries-title">Beneficiaries</h4>
                <p v-if="Number(employee.BeneficiaryNotApplicable) === 1" class="profile-source">Not applicable</p>
                <dl v-else-if="profileBeneficiaries.length" class="profile-fields">
                  <div v-for="(beneficiary, index) in profileBeneficiaries" :key="index"><dt>Beneficiary {{ index + 1 }}</dt><dd>{{ display(beneficiary.Name) }}<small>{{ display(beneficiary.Relationship) }}</small></dd></div>
                </dl>
                <p v-else class="profile-source">No beneficiaries provided.</p>
              </section>
            </section>
            <section v-else class="records-panel">
              <div class="panel-head">
                <div><p class="eyebrow">DOCUMENT TYPE</p><h3>{{ activeSectionDef.label }}</h3><small>{{ recordCount(activeSection) }} record{{ recordCount(activeSection) === 1 ? '' : 's' }}</small></div>
                <button class="primary" type="button" @click="openAdd(employee, activeSection)">+ Add record</button>
              </div>
              <div class="section-grid">
                <article v-for="item in rowsFor(activeSection)" :key="item[activeSectionDef.idKey]" class="record-card">
                  <div class="record-card__head">
                    <strong>{{ recordLabel(activeSection, item) }}</strong>
                    <div class="record-actions">
                      <button type="button" class="secondary" @click="openEdit(activeSection, item)">Edit</button>
                      <button type="button" class="danger-outline" @click="remove(activeSection, item)">Delete</button>
                    </div>
                  </div>
                  <dl>
                    <template v-for="field in activeSectionDef.fields" :key="field.key">
                      <div><dt>{{ field.label }}</dt><dd>{{ display(item[field.key]) }}</dd></div>
                    </template>
                  </dl>
                </article>
                <div v-if="!rowsFor(activeSection).length" class="empty-state"><strong>No {{ activeSectionDef.label.toLowerCase() }} records yet</strong><p>Add a record to keep this employee’s documents together.</p></div>
              </div>
            </section>
          </div>
          <footer class="drawer-footer"><button type="button" class="secondary" @click="detailOpen = false">Close</button></footer>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="formOpen" class="backdrop" @click.self="closeForm">
        <form class="modal" role="dialog" aria-modal="true" aria-label="Employee document form" @submit.prevent="save(activeSection)">
          <header class="form-head">
            <div><p class="eyebrow">EMPLOYEE DOCUMENTS</p><h2>{{ editingId !== null ? 'Edit record' : 'Add record' }}</h2><p v-if="employee" class="modal-subtitle">{{ formatEmployeeLabel(employee) }}</p></div>
            <button class="close" type="button" aria-label="Close document form" :disabled="saving" @click="closeForm">×</button>
          </header>
          <div class="form-body">
            <label>Document type
              <select v-model="activeSection" :disabled="editingId !== null" @change="onSectionChanged">
                <option v-for="section in documentSections" :key="section.key" :value="section.key">{{ section.label }}</option>
              </select>
            </label>
            <div class="form-grid">
              <label v-for="field in activeSectionDef.fields" :key="field.key">
                {{ field.label }}
                <input v-model="form[field.key]" :type="field.type || 'text'" />
              </label>
            </div>
            <p v-if="error" class="error" role="alert">{{ error }}</p>
          </div>
          <footer class="form-footer">
            <button type="button" class="secondary" :disabled="saving" @click="closeForm">Cancel</button>
            <button type="submit" class="primary" :disabled="saving">{{ saving ? 'Saving…' : editingId !== null ? 'Save changes' : 'Save record' }}</button>
          </footer>
        </form>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
.documents-page{padding:34px;max-width:1500px;margin:auto;color:#0b1f3f;font-family:Inter,system-ui,sans-serif}.page-head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:22px}.page-head p{margin:0;font-size:.75rem;font-weight:800;letter-spacing:.1em;color:#5570a5}.page-head h1{margin:4px 0 0;font-size:2rem;line-height:1.15}.page-head small{display:block;margin-top:6px;color:#66758b}.toolbar{display:grid;grid-template-columns:minmax(300px,1fr) minmax(185px,220px) minmax(185px,220px);gap:16px;margin-bottom:18px}.toolbar label{display:grid;min-width:0;gap:6px;font-size:.78rem;font-weight:800;color:#526174}.toolbar input,.toolbar select{box-sizing:border-box;width:100%;height:42px;border:1px solid #ccd5e4;border-radius:8px;padding:0 12px;background:#fff;font:inherit}.employee-list{overflow:auto;border:1px solid #dce3ee;border-radius:14px;background:#fff}table{width:100%;border-collapse:collapse}th,td{padding:14px;text-align:left;border-bottom:1px solid #edf1f6;font-size:.88rem;white-space:nowrap}th{background:#f8fafc;color:#526174;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em}.employee-id{font-weight:900;color:#1f3fcf}.row-actions{display:flex;gap:8px}.primary,.ghost{border:0;border-radius:8px;padding:9px 13px;font-weight:800;cursor:pointer;text-decoration:none}.primary{background:#2349e6;color:#fff}.ghost{background:#eef3ff;color:#2043cc}.error{color:#b42318;margin:0 0 12px}.backdrop{position:fixed;inset:0;z-index:300;background:rgba(15,23,42,.58);display:grid;place-items:center;padding:18px}.drawer,.modal{position:relative;width:min(100%,1160px);max-height:92vh;overflow:auto;background:#fff;border-radius:16px;padding:26px;color:#162033}.modal{width:min(100%,780px);display:grid;gap:14px}.close{position:absolute;right:14px;top:12px;border:0;background:transparent;font-size:1.1rem;cursor:pointer}.profile-card{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:18px 20px;border:1px solid #dce3ee;border-radius:14px;background:linear-gradient(135deg,#fff 0%,#f7faff 100%);margin-bottom:16px}.profile-card p{margin:0 0 4px;color:#5271a5;font-size:.75rem;font-weight:800;letter-spacing:.08em}.profile-card h2{margin:0;font-size:1.35rem}.profile-card small{color:#637287}.profile-meta{display:grid;gap:6px;text-align:right;color:#415063}.tabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}.tabs button{border:1px solid #d7dfeb;background:#fff;border-radius:999px;padding:9px 13px;font-weight:800;cursor:pointer}.tabs button.active{background:#2349e6;color:#fff;border-color:#2349e6}.tabs span{display:inline-grid;place-items:center;min-width:20px;height:20px;margin-left:6px;border-radius:999px;background:#eef3ff;color:#2043cc;font-size:.72rem}.tabs button.active span{background:#fff;color:#2349e6}.records-panel{border:1px solid #dce3ee;border-radius:14px;background:#fff;padding:18px}.panel-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}.panel-head h3{margin:0}.section-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.record-card{border:1px solid #e3e9f2;border-radius:12px;padding:14px;background:#fdfefe}.record-card__head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.record-actions{display:flex;gap:8px}.record-actions button,.modal footer button:not(.primary){border:1px solid #cfd8e6;background:#fff;border-radius:8px;padding:7px 10px;cursor:pointer;font-weight:700}.record-card dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:14px 0 0}.record-card dt{font-size:.72rem;font-weight:900;color:#7a8695;text-transform:uppercase}.record-card dd{margin:0}.empty{margin:0;color:#66758b}.modal h2{margin:0}.modal-subtitle{margin:-8px 0 0;color:#637287}.modal label{display:grid;gap:6px;font-size:.8rem;font-weight:800;color:#475569}.modal input,.modal select{box-sizing:border-box;width:100%;min-height:40px;border:1px solid #cfd8e6;border-radius:8px;padding:9px 10px;font:inherit}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.modal footer{display:flex;justify-content:flex-end;gap:10px;margin-top:6px}@media(max-width:850px){.documents-page{padding:20px}.toolbar{grid-template-columns:1fr}.profile-card,.panel-head{flex-direction:column;align-items:flex-start}.profile-meta{text-align:left}.form-grid{grid-template-columns:1fr}.row-actions{flex-direction:column}}
.documents-page{max-width:none;padding:34px 36px 48px;color:#112b53}
.page-head{align-items:flex-start;margin-bottom:28px}
.page-head .eyebrow,.eyebrow{margin:0;color:#2863db;font-size:.72rem;font-weight:850;letter-spacing:.09em}
.page-head h1{margin:7px 0 5px;font-size:2rem}
.page-head small{margin:0;color:#657d9f;font-size:.95rem}
.primary,.secondary,.danger-outline{display:inline-flex;align-items:center;justify-content:center;min-height:43px;padding:0 15px;border-radius:9px;font:inherit;font-size:.8rem;font-weight:750;white-space:nowrap;cursor:pointer}
.primary{border:1px solid #2864e8;background:#2864e8;color:#fff}
.secondary{border:1px solid #c8d7ed;background:#fff;color:#1b4b91}
.danger-outline{border:1px solid #edc9c9;background:#fff;color:#b33434}
.primary:hover:not(:disabled){background:#1956d5}.secondary:hover:not(:disabled){background:#f2f6ff}.danger-outline:hover:not(:disabled){background:#fff5f5}
button:disabled{opacity:.55;cursor:default}
.toolbar{grid-template-columns:minmax(250px,1fr) minmax(180px,280px) minmax(180px,280px);gap:16px;margin-bottom:20px}
.toolbar label{gap:7px;color:#3b5478;font-size:.78rem;font-weight:750}
.toolbar input,.toolbar select{height:50px;border-color:#cbd9ee;border-radius:10px;color:#112b53;font-size:.84rem}
.toolbar input:focus,.toolbar select:focus,.modal input:focus,.modal select:focus{outline:2px solid #a4beff;outline-offset:1px}
.employee-list{border-color:#d5e1f2}
th{background:#f3f7fc;color:#526c92;font-size:.7rem;letter-spacing:.03em}
td{border-bottom-color:#e5edf8;color:#112b53;font-size:.82rem}
tbody tr:last-child td{border-bottom:0}
td strong{font-weight:750}.employee-id{font-weight:750;color:#1856c4}
.row-actions{gap:8px}.row-actions .primary,.row-actions .secondary{min-height:40px;padding:0 12px}
.table-empty{text-align:center;padding:32px;color:#657d9f}
.backdrop{background:rgba(20,36,64,.55);font-family:Inter,'Segoe UI',sans-serif;color:#112b53}
.drawer,.modal{box-sizing:border-box;width:min(100%,1320px);max-height:min(90vh,1000px);padding:0;border:1px solid #d5e1f2;border-radius:20px;box-shadow:0 25px 75px rgba(9,31,75,.28);color:#112b53;font-family:Inter,'Segoe UI',sans-serif;overflow:hidden}
.drawer{display:flex;flex-direction:column}.modal{display:flex;flex-direction:column;width:min(100%,820px);gap:0}
.profile-card,.form-head{display:flex;align-items:flex-start;justify-content:space-between;gap:22px;flex:none;margin:0;padding:27px 32px 22px;border:0;border-bottom:1px solid #d5e1f2;border-radius:0;background:#fff}
.profile-card .eyebrow{margin:0;color:#2863db;font-size:.72rem}
.profile-card h2,.form-head h2{margin:7px 0 5px;font-size:1.7rem;line-height:1.2}
.profile-card small,.modal-subtitle{color:#657d9f;font-size:.86rem}
.modal-subtitle{margin:0}
.profile-meta{display:flex;align-items:center;gap:10px;margin-left:auto;margin-right:12px;text-align:left}
.employee-number,.employee-status{padding:7px 10px;border-radius:99px;background:#eef4ff;color:#315486;font-size:.72rem;font-weight:750}
.employee-status{background:#ddfae9;color:#087245}
.close{position:static;flex:none;display:grid;place-items:center;width:38px;height:38px;margin:-6px -6px 0 0;border:0;border-radius:8px;background:transparent;color:#48648d;font-size:1.65rem;line-height:1;cursor:pointer}
.close:hover{background:#edf3fc}
.drawer-body,.form-body{overflow:auto;background:#fafcff}
.drawer-body{padding:22px 32px 28px}.contact-strip{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:22px}
.contact-strip span{display:grid;gap:5px;min-width:220px;padding:11px 14px;border:1px solid #d5e1f2;border-radius:10px;background:#fff;color:#112b53;font-size:.8rem;overflow-wrap:anywhere}
.contact-strip strong{color:#657d9f;font-size:.69rem;text-transform:uppercase}
.tabs{gap:8px;margin-bottom:21px;padding-bottom:12px;border-bottom:1px solid #d5e1f2}
.tabs button{border-color:#c8d7ed;border-radius:9px;background:#fff;color:#315486;font:inherit;font-size:.77rem;font-weight:750}
.tabs button.active{border-color:#2864e8;background:#2864e8;color:#fff}
.tabs span{margin-left:5px;background:#edf3fc;color:#315486}.tabs button.active span{background:#fff;color:#1856c4}
.records-panel{border-color:#d5e1f2;background:#fff;padding:22px}
.panel-head{align-items:center;margin-bottom:18px}.panel-head h3{margin:5px 0 2px;font-size:1.12rem}.panel-head small{color:#657d9f;font-size:.75rem}
.section-grid{grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:13px}
.record-card{border-color:#d5e1f2;background:#fafcff;padding:17px}
.record-card__head{align-items:center}.record-card__head>strong{font-size:.95rem;overflow-wrap:anywhere}
.record-actions button{min-height:34px;padding:0 10px;font-size:.73rem}
.record-card dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:16px;margin:18px 0 0}
.record-card dl>div{min-width:0}.record-card dt{color:#657d9f;font-size:.68rem}.record-card dd{margin:5px 0 0;font-size:.81rem;overflow-wrap:anywhere}
.empty-state{grid-column:1/-1;padding:40px 20px;border:1px dashed #c8d7ed;border-radius:11px;background:#f8fbff;text-align:center}
.empty-state strong{font-size:.9rem}.empty-state p{margin:7px 0 0;color:#657d9f;font-size:.78rem}
.drawer-footer,.form-footer{display:flex;justify-content:flex-end;gap:10px;flex:none;padding:14px 32px;border-top:1px solid #d5e1f2;background:#fff}
.form-body{display:grid;gap:19px;padding:24px 32px 28px}
.modal label{gap:8px;color:#3b5478;font-size:.78rem;font-weight:750}
.modal input,.modal select{min-height:49px;padding:10px 13px;border-color:#cbd9ee;border-radius:9px;color:#112b53;font-size:.84rem}
.form-grid{gap:16px}.modal .form-footer{margin:0}.modal .form-footer .secondary{border-color:#c8d7ed;padding:0 15px}
.error{padding:11px 13px;border:1px solid #fecaca;border-radius:8px;background:#fff1f1;color:#9c2525;font-size:.8rem}
@media(max-width:850px){.documents-page{padding:24px 16px}.toolbar{grid-template-columns:1fr}.row-actions{flex-direction:row}.profile-card,.form-head{flex-direction:row;align-items:flex-start}.profile-meta{flex-wrap:wrap}.form-grid{grid-template-columns:1fr}}
@media(max-width:650px){.page-head{flex-direction:column}.backdrop{padding:0}.drawer,.modal{width:100%;max-height:100vh;height:100vh;border-radius:0}.profile-card,.form-head,.drawer-body,.form-body,.drawer-footer,.form-footer{padding-left:18px;padding-right:18px}.profile-card h2,.form-head h2{font-size:1.35rem}.profile-meta{display:none}.tabs{flex-wrap:nowrap;overflow:auto}.tabs button{flex:none}.section-grid{grid-template-columns:1fr}.record-card__head{align-items:flex-start;flex-direction:column}.row-actions{flex-wrap:wrap}}
.profile-intro{display:flex;align-items:center;gap:16px;padding-bottom:22px;border-bottom:1px solid #e5edf8}.profile-photo{display:block;flex:none;width:80px;height:80px;object-fit:cover;border:1px solid #d5e1f2;border-radius:14px;background:#edf3fc}.profile-photo--placeholder{display:grid;place-items:center;color:#315486;font-size:1.35rem;font-weight:800}.profile-intro h3{margin:6px 0;font-size:1.2rem}.profile-source{margin:0;color:#657d9f;font-size:.8rem;line-height:1.5}.profile-readonly{flex:none;margin-left:auto;padding:6px 10px;border:1px solid #d5e1f2;border-radius:99px;color:#526c92;font-size:.71rem;font-weight:750}.profile-group{padding-top:22px}.profile-group+.profile-group{margin-top:22px;border-top:1px solid #e5edf8}.profile-group h4{margin:0 0 16px;font-size:.95rem}.profile-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px 24px;margin:0}.profile-fields--addresses{grid-template-columns:repeat(2,minmax(0,1fr))}.profile-fields>div{min-width:0}.profile-fields dt{color:#657d9f;font-size:.72rem;font-weight:650}.profile-fields dd{margin:6px 0 0;color:#112b53;font-size:.84rem;line-height:1.55;white-space:pre-line;overflow-wrap:anywhere}.profile-fields dd small{display:block;margin-top:3px;color:#657d9f;font-size:.75rem}@media(max-width:850px){.profile-fields{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:650px){.profile-intro{flex-wrap:wrap;gap:12px}.profile-intro>div{flex:1;min-width:0}.profile-photo{width:60px;height:60px}.profile-readonly{margin-left:72px}.profile-fields,.profile-fields--addresses{grid-template-columns:minmax(0,1fr);gap:16px}.profile-view{padding:18px}}
</style>
