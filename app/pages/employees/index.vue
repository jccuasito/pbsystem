<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ModernDateField from '~~/components/ModernDateField.vue'
import SearchableSelect from '~~/components/SearchableSelect.vue'
import { useRealtimeRefresh } from '~/composables/useRealtimeRefresh'
import { formatEmployeeId, formatEmployeeName, formatEmployeeNumber } from '~/utils/employee'
import { alertMessages, EMPLOYEE_DUPLICATE, EMPLOYEE_SIMILAR } from '../../../components/alertmessage/messages'

const emit = defineEmits<{ (event: 'navigate', view: 'employees-documents'): void }>()

const items = ref<any[]>([])
const agencies = ref<any[]>([])
const positions = ref<any[]>([])
const agencyPositions = ref<any[]>([])
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const formError = ref('')
const photoError = ref('')
const photoPickerOpen = ref(false)
const photoDragActive = ref(false)
const photoFileInput = ref<HTMLInputElement | null>(null)
const photoPickerModal = ref<HTMLElement | null>(null)
const modalOpen = ref(false)
const employeeFormSnapshot = ref('')
const discardEmployeeOpen = ref(false)
const sameAsPermanentAddress = ref(false)
type BeneficiaryEntry = { Name: string; Relationship: string }
const beneficiaries = ref<BeneficiaryEntry[]>([])
const missingEmployeeFields = ref<string[]>([])
const duplicateReviewOpen = ref(false)
const duplicateReviewKind = ref<'exact' | 'similar'>('similar')
const duplicateMatches = ref<any[]>([])
const transferOpen = ref(false)
const deleteOpen = ref(false)
const editing = ref<any>(null)
const transferring = ref<any>(null)
const deleting = ref<any>(null)
const deleteBusy = ref(false)
const deleteError = ref('')
const transferBusy = ref(false)
const transferError = ref('')
const transferClientRates = ref<any[]>([])
const transferSites = ref<any[]>([])
const transferShiftCodes = ref<any[]>([])
const siteShiftCodes = ref<any[]>([])
const rateSearch = ref('')
const ratePickerOpen = ref(false)
const shiftSetupOpen = ref(false)
const shiftSetupBusy = ref(false)
const shiftSetupError = ref('')
const createNewShiftCode = ref(false)
const filters = ref({ agencyId: '', positionId: '' })
const search = ref('')
const visibleEmployeeCount = ref(50)
const loadMoreSentinel = ref<HTMLElement | null>(null)
const isCompactView = ref(false)
const employeeBatchSize = 50
const suggestedBirthYear = new Date().getFullYear() - 25
const relationshipOptions = ['Spouse', 'Child', 'Parent', 'Sibling', 'Grandchild', 'Grandparent', 'Legal Guardian', 'Other Relative', 'Partner', 'Other']
let employeeObserver: IntersectionObserver | null = null
let compactViewQuery: MediaQueryList | null = null
const deleteWarning = alertMessages.employeePermanentDelete()
const unsavedChangesWarning = alertMessages.employeeUnsavedChanges()

const form = ref({
  AgencyPositionID: '',
  EmployeeNumber: '',
  FirstName: '',
  MiddleName: '',
  LastName: '',
  Nickname: '',
  PhotoUrl: '',
  PhotoDataUrl: '',
  RemovePhoto: false,
  Birthday: '',
  Gender: '',
  CivilStatus: '',
  Address: '',
  Email: '',
  ContactNumber: '',
  DateHired: '',
  Status: 'Active',
  PermanentUnitHouseNumber: '',
  PermanentProvince: '',
  PermanentStreet: '',
  PermanentCityMunicipality: '',
  PermanentSubdivision: '',
  PermanentBarangay: '',
  PermanentRegion: '',
  PermanentPostalCode: '',
  PresentUnitHouseNumber: '',
  PresentProvince: '',
  PresentStreet: '',
  PresentCityMunicipality: '',
  PresentSubdivision: '',
  PresentBarangay: '',
  PresentRegion: '',
  PresentPostalCode: '',
  BeneficiaryNotApplicable: false,
  EmergencyName: '',
  EmergencyRelationship: '',
  EmergencyAddress: '',
  EmergencyContactNo: ''
})
const transferForm = ref({ ClientRateID: '', SiteID: '', SiteShiftID: '', StartDate: '', Remarks: '' })
const siteShiftForm = ref({ ShiftCodeID: '', ShiftCode: '', ShiftName: '', ShiftType: 'Day', TimeIn: '08:00', TimeOut: '17:00', RegularHours: '8', RegularOTCap: '4' })

function beneficiariesFromEmployee(item: any): BeneficiaryEntry[] {
  let parsed: any = item?.Beneficiaries
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { parsed = [] }
  }
  if (!Array.isArray(parsed)) {
    parsed = [
      { Name: item?.Beneficiary1, Relationship: item?.Beneficiary1Relationship },
      { Name: item?.Beneficiary2, Relationship: item?.Beneficiary2Relationship },
    ]
  }
  return parsed
    .map((entry: any) => ({ Name: String(entry?.Name || '').toLocaleUpperCase(), Relationship: String(entry?.Relationship || '') }))
    .filter((entry: BeneficiaryEntry) => entry.Name || entry.Relationship)
}

function employeeDraftSnapshot() {
  return JSON.stringify({ form: form.value, beneficiaries: beneficiaries.value })
}

function employeePayload(confirmPossibleDuplicate = false) {
  return { ...form.value, Beneficiaries: beneficiaries.value, ConfirmPossibleDuplicate: confirmPossibleDuplicate }
}

function reset(item: any = null) {
  editing.value = item
  photoPickerOpen.value = false
  photoDragActive.value = false
  form.value = {
    AgencyPositionID: item?.AgencyPositionID ?? '',
    EmployeeNumber: item?.EmployeeNumber ?? '',
    FirstName: String(item?.FirstName ?? '').toLocaleUpperCase(),
    MiddleName: String(item?.MiddleName ?? '').toLocaleUpperCase(),
    LastName: String(item?.LastName ?? '').toLocaleUpperCase(),
    Nickname: String(item?.Nickname ?? '').toLocaleUpperCase(),
    PhotoUrl: item?.PhotoUrl ?? '',
    PhotoDataUrl: '',
    RemovePhoto: false,
    Birthday: item?.Birthday?.slice?.(0, 10) ?? item?.Birthday ?? '',
    Gender: item?.Gender ?? '',
    CivilStatus: item?.CivilStatus ?? '',
    Address: item?.Address ?? '',
    Email: item?.Email ?? '',
    ContactNumber: item?.ContactNumber ?? '',
    DateHired: item?.DateHired?.slice?.(0, 10) ?? item?.DateHired ?? '',
    Status: item?.Status ?? 'Active',
    PermanentUnitHouseNumber: item?.PermanentUnitHouseNumber ?? '',
    PermanentProvince: item?.PermanentProvince ?? '',
    PermanentStreet: item?.PermanentStreet ?? '',
    PermanentCityMunicipality: item?.PermanentCityMunicipality ?? '',
    PermanentSubdivision: item?.PermanentSubdivision ?? '',
    PermanentBarangay: item?.PermanentBarangay ?? '',
    PermanentRegion: item?.PermanentRegion ?? '',
    PermanentPostalCode: item?.PermanentPostalCode ?? '',
    PresentUnitHouseNumber: item?.PresentUnitHouseNumber ?? '',
    PresentProvince: item?.PresentProvince ?? '',
    PresentStreet: item?.PresentStreet ?? '',
    PresentCityMunicipality: item?.PresentCityMunicipality ?? '',
    PresentSubdivision: item?.PresentSubdivision ?? '',
    PresentBarangay: item?.PresentBarangay ?? '',
    PresentRegion: item?.PresentRegion ?? '',
    PresentPostalCode: item?.PresentPostalCode ?? '',
    BeneficiaryNotApplicable: Number(item?.BeneficiaryNotApplicable || 0) === 1,
    EmergencyName: String(item?.EmergencyName ?? '').toLocaleUpperCase(),
    EmergencyRelationship: item?.EmergencyRelationship ?? '',
    EmergencyAddress: item?.EmergencyAddress ?? '',
    EmergencyContactNo: item?.EmergencyContactNo ?? ''
  }
  beneficiaries.value = form.value.BeneficiaryNotApplicable ? [] : beneficiariesFromEmployee(item)
  sameAsPermanentAddress.value = permanentAddressHasValues() && presentAddressMatchesPermanent()
  employeeFormSnapshot.value = employeeDraftSnapshot()
  missingEmployeeFields.value = []
  discardEmployeeOpen.value = false
  duplicateReviewOpen.value = false
  duplicateMatches.value = []
  error.value = ''
  formError.value = ''
  photoError.value = ''
}

async function load(silent = false) {
  if (!silent) loading.value = true
  try {
    const response: any = await $fetch('/api/employees', { query: { agencyId: filters.value.agencyId || undefined, positionId: filters.value.positionId || undefined } })
    items.value = response.items || []
    agencies.value = response.agencies || []
    positions.value = response.positions || []
    agencyPositions.value = response.agencyPositions || []
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to load employees.'
  } finally {
    if (!silent) loading.value = false
  }
}

async function save(confirmPossibleDuplicate = false) {
  if (busy.value) return
  missingEmployeeFields.value = incompleteEmployeeFields()
  if (missingEmployeeFields.value.length) {
    formError.value = alertMessages.employeeIncomplete(missingEmployeeFields.value).message
    return
  }
  if (photoError.value) {
    formError.value = photoError.value
    return
  }
  busy.value = true
  formError.value = ''
  try {
    if (!confirmPossibleDuplicate) {
      const duplicateReview: any = await $fetch('/api/employees/duplicates', {
        method: 'POST',
        body: { ...employeePayload(), id: editing.value?.EmployeeID }
      })
      if (duplicateReview.exactMatches?.length || duplicateReview.similarMatches?.length) {
        duplicateReviewKind.value = duplicateReview.exactMatches?.length ? 'exact' : 'similar'
        duplicateMatches.value = duplicateReview.exactMatches?.length ? duplicateReview.exactMatches : duplicateReview.similarMatches
        duplicateReviewOpen.value = true
        return
      }
    }
    await $fetch(editing.value ? `/api/employees/${editing.value.EmployeeID}` : '/api/employees', {
      method: editing.value ? 'PUT' : 'POST',
      body: editing.value
        ? { id: editing.value.EmployeeID, ...employeePayload(confirmPossibleDuplicate) }
        : employeePayload(confirmPossibleDuplicate)
    })
    duplicateReviewOpen.value = false
    modalOpen.value = false
    reset()
    await load()
  } catch (cause: any) {
    const duplicateData = cause.data?.data || cause.data
    if (duplicateData?.code === EMPLOYEE_DUPLICATE && duplicateData.matches?.length) {
      duplicateReviewKind.value = 'exact'
      duplicateMatches.value = duplicateData.matches
      duplicateReviewOpen.value = true
    } else if (duplicateData?.code === EMPLOYEE_SIMILAR && duplicateData.matches?.length) {
      duplicateReviewKind.value = 'similar'
      duplicateMatches.value = duplicateData.matches
      duplicateReviewOpen.value = true
    } else {
      formError.value = cause.data?.statusMessage || cause.data?.message || 'Unable to save employee.'
    }
  } finally {
    busy.value = false
  }
}

function reviewEmployeeDetails() {
  duplicateReviewOpen.value = false
}

async function confirmSimilarEmployee() {
  duplicateReviewOpen.value = false
  await save(true)
}

async function deactivate(item: any) {
  if (!confirm('Mark this employee as inactive?')) return
  try {
    await $fetch(`/api/employees/${item.EmployeeID}`, { method: 'DELETE', body: { id: item.EmployeeID } })
    await load()
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to deactivate employee.'
  }
}

function openDelete(item: any) {
  deleting.value = item
  deleteError.value = ''
  deleteOpen.value = true
}

function closeDelete() {
  if (deleteBusy.value) return
  deleteOpen.value = false
  deleting.value = null
  deleteError.value = ''
}

async function confirmDelete() {
  if (!deleting.value || deleteBusy.value) return
  deleteBusy.value = true
  deleteError.value = ''
  try {
    await $fetch(`/api/employees/${deleting.value.EmployeeID}/permanent`, { method: 'DELETE' })
    deleteOpen.value = false
    deleting.value = null
    await load()
  } catch (cause: any) {
    deleteError.value = cause.data?.statusMessage || cause.data?.message || 'Unable to permanently delete employee.'
  } finally {
    deleteBusy.value = false
  }
}

function format(value: any) {
  return value === null || value === undefined || value === '' ? '\u2014' : value
}

function displayEmployeeName(item: any) {
  return formatEmployeeName(item).toLocaleUpperCase()
}

function employeeInitials(item: any) {
  return [item?.FirstName, item?.LastName].filter(Boolean).map((value) => String(value).charAt(0).toLocaleUpperCase()).join('').slice(0, 2) || 'E'
}

const photoPreview = computed(() => form.value.PhotoDataUrl || (!form.value.RemovePhoto ? form.value.PhotoUrl : ''))
const employeeFormDirty = computed(() => employeeDraftSnapshot() !== employeeFormSnapshot.value)
const duplicateReviewMessage = computed(() => duplicateReviewKind.value === 'exact' ? alertMessages.employeeDuplicate() : alertMessages.employeeSimilar())

function requestCloseEmployeeModal() {
  if (busy.value) return
  photoPickerOpen.value = false
  if (employeeFormDirty.value) {
    discardEmployeeOpen.value = true
    return
  }
  modalOpen.value = false
}

function keepEditingEmployee() {
  discardEmployeeOpen.value = false
}

function discardEmployeeChanges() {
  discardEmployeeOpen.value = false
  photoPickerOpen.value = false
  modalOpen.value = false
  reset()
}

const availableTransferSites = computed(() => {
  const rate = transferClientRates.value.find((item) => String(item.ClientRateID) === String(transferForm.value.ClientRateID))
  return rate ? transferSites.value.filter((item) => String(item.ClientID) === String(rate.ClientID)) : []
})

const availableTransferShifts = computed(() => transferShiftCodes.value.filter((item) => String(item.SiteID) === String(transferForm.value.SiteID)))
const selectedTransferRate = computed(() => transferClientRates.value.find((item) => String(item.ClientRateID) === String(transferForm.value.ClientRateID)) || null)
const filteredTransferClientRates = computed(() => {
  const query = rateSearch.value.trim().toLowerCase()
  const results = transferClientRates.value.filter((item) => {
    const matchesSearch = !query || [item.ClientName, item.AgencyName, item.PositionName].some((value) => String(value || '').toLowerCase().includes(query))
    return matchesSearch
  })
  return results.slice(0, 8)
})
const availableSiteShiftCodes = computed(() => {
  const agencyId = selectedTransferRate.value?.AgencyID
  return siteShiftCodes.value.filter((item) => String(item.AgencyID) === String(agencyId))
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

const agencyPositionOptions = computed(() => agencyPositions.value.map((item) => ({
  value: item.AgencyPositionID,
  label: `${item.AgencyName} — ${item.PositionName}`,
  search: `${item.AgencyName} ${item.PositionName}`
})))

const filteredItems = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return items.value
  return items.value.filter((item) => [formatEmployeeId(item.EmployeeID), item.EmployeeNumber, formatEmployeeName(item), item.AgencyName, item.PositionName, item.SiteName]
    .some((value) => String(value || '').toLowerCase().includes(query)))
})

const visibleItems = computed(() => filteredItems.value.slice(0, visibleEmployeeCount.value))
const hasMoreEmployees = computed(() => visibleItems.value.length < filteredItems.value.length)

function loadMoreEmployees() {
  if (!hasMoreEmployees.value) return
  visibleEmployeeCount.value = Math.min(visibleEmployeeCount.value + employeeBatchSize, filteredItems.value.length)
}

function handleCompactViewChange(event: MediaQueryListEvent) {
  isCompactView.value = event.matches
}

function uppercaseNameField(field: 'FirstName' | 'MiddleName' | 'LastName' | 'Nickname' | 'EmergencyName', event: Event) {
  const input = event.target as HTMLInputElement
  const uppercased = input.value.toLocaleUpperCase()
  input.value = uppercased
  form.value[field] = uppercased
}

function applyEmployeePhoto(file: File | null | undefined, input?: HTMLInputElement) {
  photoError.value = ''
  if (!file) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    photoError.value = 'Use a PNG, JPG, or WEBP image.'
    if (input) input.value = ''
    return
  }
  if (file.size > 2 * 1024 * 1024) {
    photoError.value = 'Employee photo must be 2MB or smaller.'
    if (input) input.value = ''
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    form.value.PhotoDataUrl = String(reader.result || '')
    form.value.RemovePhoto = false
    photoPickerOpen.value = false
    if (input) input.value = ''
  }
  reader.onerror = () => { photoError.value = 'Unable to read the selected photo.' }
  reader.readAsDataURL(file)
}

function selectEmployeePhoto(event: Event) {
  const input = event.target as HTMLInputElement
  applyEmployeePhoto(input.files?.[0], input)
}

async function openPhotoPicker() {
  photoError.value = ''
  photoDragActive.value = false
  photoPickerOpen.value = true
  await nextTick()
  photoPickerModal.value?.focus()
}

function openPhotoFileDialog() {
  photoFileInput.value?.click()
}

function dropEmployeePhoto(event: DragEvent) {
  photoDragActive.value = false
  applyEmployeePhoto(event.dataTransfer?.files?.[0])
}

function pasteEmployeePhoto(event: ClipboardEvent) {
  const file = Array.from(event.clipboardData?.items || [])
    .find(item => item.kind === 'file' && item.type.startsWith('image/'))
    ?.getAsFile()
  if (!file) return
  event.preventDefault()
  applyEmployeePhoto(file)
}

function removeSelectedPhoto() {
  form.value.PhotoDataUrl = ''
  form.value.RemovePhoto = true
  photoError.value = ''
}

function permanentAddressHasValues() {
  return [
    form.value.PermanentUnitHouseNumber,
    form.value.PermanentProvince,
    form.value.PermanentStreet,
    form.value.PermanentCityMunicipality,
    form.value.PermanentSubdivision,
    form.value.PermanentBarangay,
    form.value.PermanentRegion,
    form.value.PermanentPostalCode
  ].some(value => String(value || '').trim())
}

function presentAddressMatchesPermanent() {
  return form.value.PresentUnitHouseNumber === form.value.PermanentUnitHouseNumber
    && form.value.PresentProvince === form.value.PermanentProvince
    && form.value.PresentStreet === form.value.PermanentStreet
    && form.value.PresentCityMunicipality === form.value.PermanentCityMunicipality
    && form.value.PresentSubdivision === form.value.PermanentSubdivision
    && form.value.PresentBarangay === form.value.PermanentBarangay
    && form.value.PresentRegion === form.value.PermanentRegion
    && form.value.PresentPostalCode === form.value.PermanentPostalCode
}

function syncPresentAddress() {
  Object.assign(form.value, {
    PresentUnitHouseNumber: form.value.PermanentUnitHouseNumber,
    PresentProvince: form.value.PermanentProvince,
    PresentStreet: form.value.PermanentStreet,
    PresentCityMunicipality: form.value.PermanentCityMunicipality,
    PresentSubdivision: form.value.PermanentSubdivision,
    PresentBarangay: form.value.PermanentBarangay,
    PresentRegion: form.value.PermanentRegion,
    PresentPostalCode: form.value.PermanentPostalCode
  })
}

function clearPresentAddress() {
  Object.assign(form.value, {
    PresentUnitHouseNumber: '',
    PresentProvince: '',
    PresentStreet: '',
    PresentCityMunicipality: '',
    PresentSubdivision: '',
    PresentBarangay: '',
    PresentRegion: '',
    PresentPostalCode: ''
  })
}

function toggleSameAsPermanentAddress(event: Event) {
  sameAsPermanentAddress.value = (event.target as HTMLInputElement).checked
  if (sameAsPermanentAddress.value) syncPresentAddress()
  else clearPresentAddress()
}

function addBeneficiary() {
  beneficiaries.value.push({ Name: '', Relationship: '' })
}

function removeBeneficiary(index: number) {
  beneficiaries.value.splice(index, 1)
}

function uppercaseBeneficiary(index: number, event: Event) {
  const input = event.target as HTMLInputElement
  const uppercased = input.value.toLocaleUpperCase()
  input.value = uppercased
  if (beneficiaries.value[index]) beneficiaries.value[index].Name = uppercased
}

function toggleBeneficiaryNotApplicable() {
  if (!form.value.BeneficiaryNotApplicable) return
  beneficiaries.value = []
}

function incompleteEmployeeFields() {
  const required: Array<[keyof typeof form.value, string]> = [
    ['AgencyPositionID', 'Agency position'], ['FirstName', 'First name'], ['LastName', 'Last name'],
    ['Birthday', 'Birthday'], ['DateHired', 'Date hired'], ['Gender', 'Gender'], ['CivilStatus', 'Civil status'],
    ['Email', 'Email'], ['ContactNumber', 'Contact number'],
    ['PermanentUnitHouseNumber', 'Permanent unit/house number'], ['PermanentProvince', 'Permanent province'],
    ['PermanentStreet', 'Permanent street'], ['PermanentCityMunicipality', 'Permanent city/municipality'],
    ['PermanentSubdivision', 'Permanent subdivision'], ['PermanentBarangay', 'Permanent barangay'],
    ['PermanentRegion', 'Permanent region'], ['PermanentPostalCode', 'Permanent postal code'],
    ['PresentUnitHouseNumber', 'Present unit/house number'], ['PresentProvince', 'Present province'],
    ['PresentStreet', 'Present street'], ['PresentCityMunicipality', 'Present city/municipality'],
    ['PresentSubdivision', 'Present subdivision'], ['PresentBarangay', 'Present barangay'],
    ['PresentRegion', 'Present region'], ['PresentPostalCode', 'Present postal code'],
    ['EmergencyName', 'Emergency contact name'], ['EmergencyRelationship', 'Emergency relationship'],
    ['EmergencyContactNo', 'Emergency contact number'], ['EmergencyAddress', 'Emergency address'],
  ]
  const missing = required.filter(([key]) => !String(form.value[key] ?? '').trim()).map(([, label]) => label)
  if (!form.value.BeneficiaryNotApplicable) {
    if (!beneficiaries.value.length) missing.push('At least one beneficiary')
    beneficiaries.value.forEach((entry, index) => {
      if (!entry.Name.trim()) missing.push(`Beneficiary ${index + 1} name`)
      if (!entry.Relationship.trim()) missing.push(`Beneficiary ${index + 1} relationship`)
    })
  }
  return missing
}

function sanitizeContactNumber(event: Event) {
  const input = event.target as HTMLInputElement
  const sanitized = input.value.replace(/\D/g, '').slice(0, 11)
  input.value = sanitized
  form.value.ContactNumber = sanitized
}

function sanitizeEmergencyContactNumber(event: Event) {
  const input = event.target as HTMLInputElement
  const sanitized = input.value.replace(/\D/g, '').slice(0, 15)
  input.value = sanitized
  form.value.EmergencyContactNo = sanitized
}

function normalizeEmail() {
  form.value.Email = String(form.value.Email || '').trim().toLocaleLowerCase()
}

watch([search, () => filters.value.agencyId, () => filters.value.positionId], () => {
  visibleEmployeeCount.value = employeeBatchSize
})

watch(loadMoreSentinel, (next, previous) => {
  if (previous) employeeObserver?.unobserve(previous)
  if (next) employeeObserver?.observe(next)
})

watch(() => filters.value.agencyId, () => {
  filters.value.positionId = ''
  void load()
})

watch(() => [
  form.value.PermanentUnitHouseNumber,
  form.value.PermanentProvince,
  form.value.PermanentStreet,
  form.value.PermanentCityMunicipality,
  form.value.PermanentSubdivision,
  form.value.PermanentBarangay,
  form.value.PermanentRegion,
  form.value.PermanentPostalCode
], () => {
  if (sameAsPermanentAddress.value) syncPresentAddress()
})

function today() {
  const date = new Date()
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function onTransferClientRateChanged() {
  transferForm.value.SiteID = ''
  transferForm.value.SiteShiftID = ''
}

function clientRateLabel(rate: any) {
  return `${rate.ClientName} — ${rate.AgencyName} — ${rate.PositionName}`
}

function selectTransferClientRate(rate: any) {
  transferForm.value.ClientRateID = String(rate.ClientRateID)
  rateSearch.value = clientRateLabel(rate)
  ratePickerOpen.value = false
  onTransferClientRateChanged()
}

function onRateSearchInput() {
  ratePickerOpen.value = true
  transferForm.value.ClientRateID = ''
  onTransferClientRateChanged()
}

function searchTransferRates() {
  ratePickerOpen.value = true
}

function closeRatePicker() {
  ratePickerOpen.value = false
}

function onTransferSiteChanged() {
  transferForm.value.SiteShiftID = ''
}

async function openTransfer(item: any) {
  transferError.value = ''
  transferring.value = item
  transferForm.value = { ClientRateID: '', SiteID: '', SiteShiftID: '', StartDate: today(), Remarks: '' }
  rateSearch.value = ''
  try {
    const response: any = await $fetch('/api/employees/deployments')
    transferClientRates.value = response.clientRates || []
    transferSites.value = response.sites || []
    transferShiftCodes.value = response.shiftCodes || []
    transferOpen.value = true
  } catch (cause: any) {
    error.value = cause.data?.statusMessage || 'Unable to load transfer options.'
  }
}

async function openShiftSetup() {
  if (!transferForm.value.ClientRateID || !transferForm.value.SiteID) return
  shiftSetupBusy.value = true
  shiftSetupError.value = ''
  try {
    const response: any = await $fetch('/api/organization/site-shift')
    siteShiftCodes.value = response.shiftCodes || []
    createNewShiftCode.value = !availableSiteShiftCodes.value.length
    siteShiftForm.value = { ShiftCodeID: '', ShiftCode: '', ShiftName: '', ShiftType: 'Day', TimeIn: '08:00', TimeOut: '17:00', RegularHours: '8', RegularOTCap: '4' }
    shiftSetupOpen.value = true
  } catch (cause: any) {
    transferError.value = cause.data?.statusMessage || 'Unable to load shift setup options.'
  } finally {
    shiftSetupBusy.value = false
  }
}

async function saveSiteShift() {
  shiftSetupBusy.value = true
  shiftSetupError.value = ''
  try {
    const body: any = { ClientRateID: transferForm.value.ClientRateID, SiteID: transferForm.value.SiteID }
    if (createNewShiftCode.value) body.newShift = { ...siteShiftForm.value }
    else body.ShiftCodeID = siteShiftForm.value.ShiftCodeID
    const response: any = await $fetch('/api/employees/site-shifts', { method: 'POST', body })
    const deployments: any = await $fetch('/api/employees/deployments')
    transferShiftCodes.value = deployments.shiftCodes || []
    transferForm.value.SiteShiftID = String(response.id)
    shiftSetupOpen.value = false
  } catch (cause: any) {
    shiftSetupError.value = cause.data?.statusMessage || cause.data?.message || 'Unable to set up this site shift.'
  } finally {
    shiftSetupBusy.value = false
  }
}

async function saveTransfer() {
  if (!transferring.value) return
  transferBusy.value = true
  transferError.value = ''
  try {
    await $fetch(`/api/employees/${transferring.value.EmployeeID}/transfer`, { method: 'POST', body: transferForm.value })
    transferOpen.value = false
    transferring.value = null
    await load()
  } catch (cause: any) {
    transferError.value = cause.data?.statusMessage || cause.data?.message || 'Unable to transfer employee.'
  } finally {
    transferBusy.value = false
  }
}

onMounted(load)
onMounted(() => {
  document.addEventListener('click', closeRatePicker)
  compactViewQuery = window.matchMedia('(max-width: 980px)')
  isCompactView.value = compactViewQuery.matches
  compactViewQuery.addEventListener('change', handleCompactViewChange)
  employeeObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) loadMoreEmployees()
  }, { rootMargin: '500px 0px' })
  if (loadMoreSentinel.value) employeeObserver.observe(loadMoreSentinel.value)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', closeRatePicker)
  compactViewQuery?.removeEventListener('change', handleCompactViewChange)
  employeeObserver?.disconnect()
})
useRealtimeRefresh(() => load(true), { shouldRefresh: () => !busy.value })
</script>

<template>
  <main class="employees-page">
    <header class="page-head">
      <div>
        <p>EMPLOYEE MANAGEMENT</p>
        <h1>Employee List</h1>
      </div>
      <div class="actions-row">
        <button class="ghost" type="button" @click="emit('navigate', 'employees-documents')">Employee Documents</button>
        <button class="primary" @click="reset(); modalOpen = true">+ Add employee</button>
      </div>
    </header>

    <section class="filters">
      <label class="search-field">
        <span>Search employee</span>
        <input v-model.trim="search" placeholder="Search employee ID, name, agency, position, or site" />
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
        <select v-model="filters.positionId" @change="load">
          <option value="">All Positions</option>
          <option v-for="position in availablePositions" :key="position.PositionID" :value="position.PositionID">{{ position.PositionName }}</option>
        </select>
      </label>
    </section>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <div v-if="!isCompactView" class="table-wrap employee-table-wrap">
      <table class="employee-table">
        <colgroup>
          <col class="col-id" />
          <col class="col-number" />
          <col class="col-name" />
          <col class="col-agency" />
          <col class="col-position" />
          <col class="col-site" />
          <col class="col-deployment" />
          <col class="col-status" />
          <col class="col-actions" />
        </colgroup>
        <thead>
          <tr>
            <th>Employee ID</th>
            <th>Employee No.</th>
            <th>Name</th>
            <th>Agency</th>
            <th>Position</th>
            <th>Current Site</th>
            <th>Deployment Status</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading" class="table-message"><td colspan="9">Loading...</td></tr>
          <tr v-else-if="!filteredItems.length" class="table-message"><td colspan="9">No employees found.</td></tr>
          <tr v-for="item in visibleItems" :key="item.EmployeeID">
            <td class="employee-id" data-label="Employee ID">{{ formatEmployeeId(item.EmployeeID) }}</td>
            <td data-label="Employee No.">{{ formatEmployeeNumber(item.EmployeeNumber) }}</td>
            <td class="employee-name" data-label="Name">
              <div class="employee-identity">
                <img v-if="item.PhotoUrl" :src="item.PhotoUrl" :alt="`${displayEmployeeName(item)} photo`" />
                <span v-else class="employee-avatar-fallback" aria-hidden="true">{{ employeeInitials(item) }}</span>
                <span>{{ displayEmployeeName(item) }}</span>
              </div>
            </td>
            <td data-label="Agency">{{ format(item.AgencyName) }}</td>
            <td data-label="Position">{{ format(item.PositionName) }}</td>
            <td data-label="Current Site">{{ format(item.SiteName) }}</td>
            <td data-label="Deployment"><span class="status" :class="`status--${String(item.DeploymentStatus || 'unassigned').toLowerCase()}`">{{ item.DeploymentStatus }}</span></td>
            <td data-label="Status"><span class="status" :class="`status--${String(item.Status || '').toLowerCase()}`">{{ item.Status }}</span></td>
            <td class="row-actions" data-label="Actions">
              <button class="action-icon action-icon--edit" type="button" aria-label="Edit employee" title="Edit" @click="reset(item); modalOpen = true">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
              </button>
              <button class="action-icon action-icon--transfer" type="button" aria-label="Transfer employee" title="Transfer" :disabled="item.Status === 'Inactive'" @click="openTransfer(item)">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3l4 4-4 4"/><path d="M20 7H8a4 4 0 0 0-4 4"/><path d="M8 21l-4-4 4-4"/><path d="M4 17h12a4 4 0 0 0 4-4"/></svg>
              </button>
              <button class="action-icon action-icon--deactivate" type="button" aria-label="Deactivate employee" title="Deactivate" :disabled="item.Status === 'Inactive'" @click="deactivate(item)">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 8.5 7 7"/></svg>
              </button>
              <button class="action-icon action-icon--delete" type="button" aria-label="Delete employee permanently" title="Delete permanently" @click="openDelete(item)">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <section v-else class="mobile-employee-list" aria-label="Employee list">
      <p v-if="loading" class="mobile-list-message">Loading...</p>
      <p v-else-if="!filteredItems.length" class="mobile-list-message">No employees found.</p>
      <article v-for="item in visibleItems" :key="item.EmployeeID" class="employee-card">
        <header class="employee-card__head">
          <img v-if="item.PhotoUrl" class="employee-card__photo" :src="item.PhotoUrl" :alt="`${displayEmployeeName(item)} photo`" />
          <span v-else class="employee-card__photo employee-avatar-fallback" aria-hidden="true">{{ employeeInitials(item) }}</span>
          <div class="employee-card__identity">
            <strong>{{ displayEmployeeName(item) }}</strong>
            <span>{{ formatEmployeeId(item.EmployeeID) }} · {{ formatEmployeeNumber(item.EmployeeNumber) }}</span>
          </div>
          <span class="status" :class="`status--${String(item.Status || '').toLowerCase()}`">{{ item.Status }}</span>
        </header>

        <div class="employee-card__details">
          <p class="employee-card__agency">{{ format(item.AgencyName) }}</p>
          <p>{{ format(item.PositionName) }} <span aria-hidden="true">·</span> {{ format(item.SiteName) }}</p>
        </div>

        <footer class="employee-card__footer">
          <div class="employee-card__deployment">
            <span>Deployment</span>
            <span class="status" :class="`status--${String(item.DeploymentStatus || 'unassigned').toLowerCase()}`">{{ item.DeploymentStatus }}</span>
          </div>
          <div class="mobile-actions" aria-label="Employee actions">
            <button class="action-icon action-icon--edit" type="button" aria-label="Edit employee" title="Edit" @click="reset(item); modalOpen = true">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <button class="action-icon action-icon--transfer" type="button" aria-label="Transfer employee" title="Transfer" :disabled="item.Status === 'Inactive'" @click="openTransfer(item)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3l4 4-4 4"/><path d="M20 7H8a4 4 0 0 0-4 4"/><path d="M8 21l-4-4 4-4"/><path d="M4 17h12a4 4 0 0 0 4-4"/></svg>
            </button>
            <button class="action-icon action-icon--deactivate" type="button" aria-label="Deactivate employee" title="Deactivate" :disabled="item.Status === 'Inactive'" @click="deactivate(item)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 8.5 7 7"/></svg>
            </button>
            <button class="action-icon action-icon--delete" type="button" aria-label="Delete employee permanently" title="Delete permanently" @click="openDelete(item)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>
            </button>
          </div>
        </footer>
      </article>
    </section>

    <div v-if="!loading && filteredItems.length" class="employee-list-progress" aria-live="polite">
      <span>Showing <strong>{{ visibleItems.length }}</strong> of <strong>{{ filteredItems.length }}</strong> employees</span>
      <button v-if="hasMoreEmployees" ref="loadMoreSentinel" type="button" @click="loadMoreEmployees">
        Load more employees
      </button>
      <span v-else>All employees displayed</span>
    </div>

    <Teleport to="body">
      <div v-if="modalOpen" class="backdrop">
        <form class="modal employee-modal" @submit.prevent="save()">
          <button class="close" type="button" aria-label="Close employee form" @click="requestCloseEmployeeModal">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
          <h2>{{ editing ? 'Edit employee' : 'Add employee' }}</h2>

          <section class="employee-form-section employee-form-section--photo">
            <div class="employee-form-section__heading">
              <div><span>PROFILE PHOTO</span><h3>Employee picture</h3></div>
              <small>PNG, JPG, or WEBP up to 2MB</small>
            </div>
            <div class="employee-photo-editor">
              <img v-if="photoPreview" :src="photoPreview" alt="Employee photo preview" />
              <span v-else class="employee-photo-placeholder" aria-hidden="true">{{ form.FirstName || form.LastName ? employeeInitials(form) : 'PHOTO' }}</span>
              <div class="employee-photo-actions">
                <button type="button" class="photo-upload-button" @click="openPhotoPicker">Choose photo</button>
                <button v-if="photoPreview" type="button" class="photo-remove-button" @click="removeSelectedPhoto">Remove photo</button>
                <small class="photo-upload-hint">Upload, drag and drop, or paste an image inside the photo window.</small>
                <p v-if="photoError" class="error" role="alert">{{ photoError }}</p>
              </div>
            </div>
          </section>

          <section class="employee-form-section">
            <div class="employee-form-section__heading"><div><span>BASIC INFORMATION</span><h3>Employee details</h3></div></div>
            <div class="employee-core-grid">
              <label class="employee-core-field"><span>Employee number</span><input v-model="form.EmployeeNumber" placeholder="Assign later if unavailable" /><small>Optional badge/reference</small></label>
              <div class="employee-core-field employee-core-field--search"><SearchableSelect v-model="form.AgencyPositionID" label="Agency position" placeholder="Search agency or position" empty-text="No matching agency position." :options="agencyPositionOptions" required /><small>Required for rates and deployments.</small></div>
              <label class="employee-core-field"><span>Status</span><select v-model="form.Status"><option>Active</option><option>Inactive</option></select><small>Employee record availability.</small></label>
            </div>
            <div class="grid"><label>First name<input v-model="form.FirstName" autocomplete="given-name" required @input="uppercaseNameField('FirstName', $event)" /></label><label>Middle name<input v-model="form.MiddleName" autocomplete="additional-name" @input="uppercaseNameField('MiddleName', $event)" /></label></div>
            <div class="grid"><label>Last name<input v-model="form.LastName" autocomplete="family-name" required @input="uppercaseNameField('LastName', $event)" /></label><label>Nickname<input v-model="form.Nickname" @input="uppercaseNameField('Nickname', $event)" /></label></div>
            <div class="grid"><ModernDateField v-model="form.Birthday" label="Birthday" placeholder="Select birthday" :max="today()" :initial-year="suggestedBirthYear" required /><ModernDateField v-model="form.DateHired" label="Date hired" placeholder="Select hiring date" align="end" required /></div>
            <div class="grid"><label>Gender<input v-model="form.Gender" required /></label><label>Civil status<input v-model="form.CivilStatus" required /></label></div>
            <div class="grid">
              <label>Email<input v-model="form.Email" type="email" autocomplete="email" inputmode="email" pattern="[^@\s]+@[^@\s]+\.[^@\s]+" placeholder="name@example.com" required @blur="normalizeEmail" /><small>Use a complete email address, e.g. name@gmail.com.</small></label>
              <label>Contact number<input :value="form.ContactNumber" type="text" autocomplete="tel" inputmode="numeric" maxlength="11" pattern="[0-9]{11}" placeholder="11-digit contact number" required @input="sanitizeContactNumber" /><small>Numbers only, exactly 11 digits.</small></label>
            </div>
          </section>

          <section class="employee-form-section">
            <div class="employee-form-section__heading"><div><span>PERMANENT ADDRESS</span><h3>Permanent residence</h3></div></div>
            <div class="grid"><label>Unit/House number<input v-model="form.PermanentUnitHouseNumber" required /></label><label>Province<input v-model="form.PermanentProvince" required /></label></div>
            <div class="grid"><label>Street<input v-model="form.PermanentStreet" required /></label><label>City/Municipality<input v-model="form.PermanentCityMunicipality" required /></label></div>
            <div class="grid"><label>Subdivision<input v-model="form.PermanentSubdivision" required /></label><label>Barangay<input v-model="form.PermanentBarangay" required /></label></div>
            <div class="grid"><label>Region<input v-model="form.PermanentRegion" required /></label><label>Postal code<input v-model="form.PermanentPostalCode" inputmode="numeric" required /></label></div>
          </section>

          <section class="employee-form-section">
            <div class="employee-form-section__heading"><div><span>PRESENT ADDRESS</span><h3>Current residence</h3></div><label class="checkbox-row"><input type="checkbox" :checked="sameAsPermanentAddress" @change="toggleSameAsPermanentAddress" /> Same as permanent address</label></div>
            <div class="present-address-fields" :class="{ 'fields-disabled': sameAsPermanentAddress }">
              <div class="grid"><label>Unit/House number<input v-model="form.PresentUnitHouseNumber" :disabled="sameAsPermanentAddress" required /></label><label>Province<input v-model="form.PresentProvince" :disabled="sameAsPermanentAddress" required /></label></div>
              <div class="grid"><label>Street<input v-model="form.PresentStreet" :disabled="sameAsPermanentAddress" required /></label><label>City/Municipality<input v-model="form.PresentCityMunicipality" :disabled="sameAsPermanentAddress" required /></label></div>
              <div class="grid"><label>Subdivision<input v-model="form.PresentSubdivision" :disabled="sameAsPermanentAddress" required /></label><label>Barangay<input v-model="form.PresentBarangay" :disabled="sameAsPermanentAddress" required /></label></div>
              <div class="grid"><label>Region<input v-model="form.PresentRegion" :disabled="sameAsPermanentAddress" required /></label><label>Postal code<input v-model="form.PresentPostalCode" inputmode="numeric" :disabled="sameAsPermanentAddress" required /></label></div>
            </div>
          </section>

          <section class="employee-form-section">
            <div class="employee-form-section__heading"><div><span>BENEFICIARY INFORMATION</span><h3>Designated beneficiaries</h3></div><label class="checkbox-row"><input v-model="form.BeneficiaryNotApplicable" type="checkbox" @change="toggleBeneficiaryNotApplicable" /> Not applicable</label></div>
            <div class="beneficiary-list" :class="{ 'fields-disabled': form.BeneficiaryNotApplicable }">
              <div v-for="(beneficiary, index) in beneficiaries" :key="index" class="beneficiary-row">
                <div class="grid"><label>Beneficiary {{ index + 1 }}<input v-model="beneficiary.Name" :disabled="form.BeneficiaryNotApplicable" required @input="uppercaseBeneficiary(index, $event)" /></label><label>Relationship<select v-model="beneficiary.Relationship" :disabled="form.BeneficiaryNotApplicable" required><option value="">Select relationship</option><option v-for="relationship in relationshipOptions" :key="relationship">{{ relationship }}</option></select></label></div>
                <button type="button" class="remove-beneficiary-button" :disabled="form.BeneficiaryNotApplicable" :aria-label="`Delete beneficiary ${index + 1}`" title="Delete beneficiary" @click="removeBeneficiary(index)">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m5 5v5m4-5v5" /></svg>
                </button>
              </div>
            </div>
            <button v-if="!form.BeneficiaryNotApplicable" type="button" class="add-beneficiary-button" @click="addBeneficiary">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              Add beneficiary
            </button>
          </section>

          <section class="employee-form-section">
            <div class="employee-form-section__heading"><div><span>EMERGENCY CONTACT</span><h3>Person to contact in an emergency</h3></div></div>
            <div class="grid"><label>Full name<input v-model="form.EmergencyName" required @input="uppercaseNameField('EmergencyName', $event)" /></label><label>Relationship<select v-model="form.EmergencyRelationship" required><option value="">Select relationship</option><option v-for="relationship in relationshipOptions" :key="relationship">{{ relationship }}</option></select></label></div>
            <label>Emergency contact number<input :value="form.EmergencyContactNo" type="text" inputmode="numeric" maxlength="15" pattern="[0-9]{7,15}" placeholder="7 to 15 digits" required @input="sanitizeEmergencyContactNumber" /><small>Numbers only; mobile and telephone numbers are accepted.</small></label>
            <label>Emergency address<textarea v-model="form.EmergencyAddress" rows="3" placeholder="Complete address" required /></label>
          </section>

          <p v-if="formError" class="error">{{ formError }}</p>
          <footer><button class="cancel-button" type="button" @click="requestCloseEmployeeModal">Cancel</button><button class="primary" :disabled="busy">{{ busy ? 'Saving...' : 'Save employee' }}</button></footer>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="photoPickerOpen" class="backdrop photo-picker-backdrop">
        <section ref="photoPickerModal" class="photo-picker-modal" role="dialog" aria-modal="true" aria-labelledby="photo-picker-title" tabindex="-1" @paste="pasteEmployeePhoto">
          <button class="photo-picker-close" type="button" aria-label="Close photo picker" @click="photoPickerOpen = false">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
          <div class="photo-picker-heading">
            <span>PROFILE PHOTO</span>
            <h2 id="photo-picker-title">Upload employee picture</h2>
            <p>Drag an image here or select a file from your device.</p>
          </div>

          <div
            class="photo-drop-zone"
            :class="{ 'is-dragging': photoDragActive }"
            tabindex="0"
            @click="openPhotoFileDialog"
            @keydown.enter.prevent="openPhotoFileDialog"
            @keydown.space.prevent="openPhotoFileDialog"
            @dragenter.prevent="photoDragActive = true"
            @dragover.prevent="photoDragActive = true"
            @dragleave.prevent="photoDragActive = false"
            @drop.prevent="dropEmployeePhoto"
          >
            <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 10h32v28H8z"/><path d="m11 34 9-10 6 6 5-6 6 10"/><circle cx="31" cy="18" r="3"/></svg>
            <div><strong>Drag an image here</strong><span>or <button type="button" @click.stop="openPhotoFileDialog">upload a file</button></span></div>
            <input ref="photoFileInput" type="file" accept="image/png,image/jpeg,image/webp" tabindex="-1" @click.stop @change="selectEmployeePhoto" />
          </div>

          <small class="photo-picker-hint">PNG, JPG, or WEBP up to 2MB. You may also press Ctrl+V while this window is open.</small>
          <p v-if="photoError" class="photo-picker-error" role="alert">{{ photoError }}</p>
          <footer class="photo-picker-footer">
            <button type="button" @click="photoPickerOpen = false">Cancel</button>
          </footer>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="discardEmployeeOpen" class="backdrop discard-changes-backdrop">
        <section class="discard-changes-modal" role="alertdialog" aria-modal="true" aria-labelledby="discard-employee-title" aria-describedby="discard-employee-description">
          <div class="discard-changes-icon" aria-hidden="true">!</div>
          <div>
            <h2 id="discard-employee-title">{{ unsavedChangesWarning.title }}</h2>
            <p id="discard-employee-description">{{ unsavedChangesWarning.message }}</p>
          </div>
          <footer>
            <button type="button" class="keep-editing-button" @click="keepEditingEmployee">Keep editing</button>
            <button type="button" class="discard-button" @click="discardEmployeeChanges">Discard changes</button>
          </footer>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="duplicateReviewOpen" class="backdrop duplicate-review-backdrop">
        <section class="duplicate-review-modal" role="alertdialog" aria-modal="true" aria-labelledby="duplicate-review-title">
          <div class="duplicate-review-icon" aria-hidden="true">!</div>
          <div class="duplicate-review-copy">
            <span>EMPLOYEE CHECK</span>
            <h2 id="duplicate-review-title">{{ duplicateReviewMessage.title }}</h2>
            <p>{{ duplicateReviewMessage.message }}</p>
          </div>
          <ul class="duplicate-match-list">
            <li v-for="match in duplicateMatches" :key="match.EmployeeID">
              <strong>{{ match.EmployeeCode }} · {{ match.EmployeeName }}</strong>
              <span>{{ match.AgencyName }} · {{ match.PositionName }}</span>
              <small>{{ match.MatchReasons.join(' · ') }}</small>
            </li>
          </ul>
          <footer>
            <button type="button" class="review-details-button" @click="reviewEmployeeDetails">Review details</button>
            <button v-if="duplicateReviewKind === 'similar'" type="button" class="save-anyway-button" :disabled="busy" @click="confirmSimilarEmployee">{{ busy ? 'Saving...' : 'Save anyway' }}</button>
          </footer>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="transferOpen" class="backdrop" @click.self="!transferBusy && (transferOpen = false)">
        <form class="modal" @submit.prevent="saveTransfer">
          <button class="close" type="button" @click="transferOpen = false">x</button>
          <h2>Transfer employee</h2>
          <p class="transfer-subtitle">{{ transferring ? formatEmployeeName(transferring) : '' }}</p>
          <p class="transfer-note">The current deployment closes the day before the effective date. Previous attendance and payroll remain under that deployment.</p>

          <label class="rate-picker" @click.stop>Find new assignment
            <input v-model="rateSearch" type="search" autocomplete="off" placeholder="Search client, agency, or position" @focus="ratePickerOpen = true" @input="onRateSearchInput" />
            <button type="button" class="rate-search-button" @click="searchTransferRates">Search</button>
            <div v-if="ratePickerOpen" class="rate-picker__results">
              <button v-for="rate in filteredTransferClientRates" :key="rate.ClientRateID" type="button" @click="selectTransferClientRate(rate)">
                <strong>{{ rate.ClientName }}</strong><span>{{ rate.AgencyName }} — {{ rate.PositionName }}</span>
              </button>
              <p v-if="!filteredTransferClientRates.length">No matching client rate.</p>
            </div>
            <small v-if="selectedTransferRate">Selected: {{ clientRateLabel(selectedTransferRate) }}</small>
          </label>
          <div class="grid">
            <label>New site
              <select v-model="transferForm.SiteID" required :disabled="!transferForm.ClientRateID" @change="onTransferSiteChanged">
                <option value="">Select site</option>
                <option v-for="site in availableTransferSites" :key="site.SiteID" :value="site.SiteID">{{ site.SiteName }}</option>
              </select>
            </label>
            <label>New shift <small>Optional</small>
              <select v-model="transferForm.SiteShiftID" :disabled="!transferForm.SiteID">
                <option value="">No shift for now</option>
                <option v-for="shift in availableTransferShifts" :key="shift.SiteShiftID" :value="shift.SiteShiftID">{{ shift.ShiftCode }} — {{ shift.ShiftName }}</option>
              </select>
            </label>
          </div>
          <div v-if="transferForm.SiteID && !availableTransferShifts.length" class="shift-missing">
            <strong>No active shift is linked to this site.</strong>
            <span>You can continue without one; attendance hours will need manual review until a shift is set up.</span>
            <button type="button" @click="openShiftSetup">+ Set up shift for this site</button>
          </div>
          <label>Effective date<input v-model="transferForm.StartDate" type="date" :max="today()" required /></label>
          <label>Transfer remarks<textarea v-model="transferForm.Remarks" rows="3" placeholder="Reason or notes for this transfer" /></label>
          <p v-if="transferError" class="error">{{ transferError }}</p>
          <footer><button type="button" @click="transferOpen = false">Cancel</button><button class="primary" :disabled="transferBusy">{{ transferBusy ? 'Transferring...' : 'Save transfer' }}</button></footer>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="shiftSetupOpen" class="backdrop" @click.self="!shiftSetupBusy && (shiftSetupOpen = false)">
        <form class="modal shift-setup-modal" @submit.prevent="saveSiteShift">
          <button class="close" type="button" @click="shiftSetupOpen = false">x</button>
          <h2>Set up shift for site</h2>
          <p class="transfer-note">The shift will be available immediately for this transfer and future employees assigned to this site.</p>
          <div v-if="availableSiteShiftCodes.length" class="shift-choice">
            <button type="button" :class="{ active: !createNewShiftCode }" @click="createNewShiftCode = false">Use existing shift code</button>
            <button type="button" :class="{ active: createNewShiftCode }" @click="createNewShiftCode = true">Create new shift code</button>
          </div>
          <label v-if="!createNewShiftCode">Existing shift code
            <select v-model="siteShiftForm.ShiftCodeID" required>
              <option value="">Select shift code</option>
              <option v-for="shift in availableSiteShiftCodes" :key="shift.ShiftCodeID" :value="shift.ShiftCodeID">{{ shift.ShiftCode }} — {{ shift.ShiftName }}</option>
            </select>
          </label>
          <template v-else>
            <div class="grid"><label>Shift code<input v-model.trim="siteShiftForm.ShiftCode" placeholder="e.g. DAY-08" required /></label><label>Shift name<input v-model.trim="siteShiftForm.ShiftName" placeholder="e.g. Day shift" required /></label></div>
            <div class="grid"><label>Shift type<select v-model="siteShiftForm.ShiftType"><option>Day</option><option>Night</option><option>Split</option><option>Flexible</option></select></label><label>Regular hours<input v-model="siteShiftForm.RegularHours" type="number" min="0" max="24" step=".25" required /></label></div>
            <div class="grid"><label>Time in<input v-model="siteShiftForm.TimeIn" type="time" required /></label><label>Time out<input v-model="siteShiftForm.TimeOut" type="time" required /></label></div>
            <label>Regular OT cap<input v-model="siteShiftForm.RegularOTCap" type="number" min="0" max="24" step=".25" required /></label>
          </template>
          <p v-if="shiftSetupError" class="error">{{ shiftSetupError }}</p>
          <footer><button type="button" @click="shiftSetupOpen = false">Cancel</button><button class="primary" :disabled="shiftSetupBusy">{{ shiftSetupBusy ? 'Saving...' : 'Save site shift' }}</button></footer>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="deleteOpen" class="backdrop">
        <section class="modal delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-employee-title" aria-describedby="delete-employee-note">
          <div class="delete-modal__icon" aria-hidden="true">!</div>
          <h2 id="delete-employee-title">{{ deleteWarning.title }}</h2>
          <p v-if="deleting" class="delete-modal__employee">
            {{ formatEmployeeName(deleting) }} <span>({{ formatEmployeeId(deleting.EmployeeID) }})</span>
          </p>
          <p id="delete-employee-note" class="delete-modal__note">
            <strong>Take note:</strong> {{ deleteWarning.message }}
          </p>
          <p v-if="deleteError" class="error" role="alert">{{ deleteError }}</p>
          <footer>
            <button type="button" :disabled="deleteBusy" @click="closeDelete">No</button>
            <button type="button" class="danger" :disabled="deleteBusy" @click="confirmDelete">{{ deleteBusy ? 'Deleting...' : 'Yes' }}</button>
          </footer>
        </section>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
.employees-page{padding:32px;max-width:1400px;margin:auto;color:#162033;font-family:Inter,system-ui,sans-serif}.page-head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:22px}.page-head p{margin:0;font-size:.75rem;font-weight:800;letter-spacing:.08em;color:#5271a5}.page-head h1{margin:4px 0 0;font-size:1.8rem}.actions-row{display:flex;gap:10px;flex-wrap:wrap}.primary,.ghost{border:0;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.primary{background:#2349e6;color:#fff}.ghost{background:#eef3ff;color:#2043cc}.filters{display:grid;grid-template-columns:minmax(280px,1fr) minmax(180px,220px) minmax(180px,220px);gap:14px;margin:0 0 16px}.filters label{display:grid;min-width:0;gap:6px;font-size:.8rem;font-weight:700;color:#56657b}.filters input,.filters select{box-sizing:border-box;width:100%;min-height:40px;border:1px solid #ccd5e4;border-radius:8px;padding:8px 10px;background:#fff;font:inherit}.table-wrap{overflow:auto;border:1px solid #dce3ee;border-radius:14px;background:#fff}table{width:100%;border-collapse:collapse}th,td{padding:13px 14px;text-align:left;border-bottom:1px solid #edf1f6;font-size:.88rem;white-space:nowrap}th{background:#f8fafc;color:#526174;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em}.row-actions{display:flex;gap:8px}.row-actions button{border:1px solid #cfd8e6;border-radius:7px;background:#fff;padding:7px 9px;color:#24415f;font-weight:700;cursor:pointer}.row-actions .delete-action{border-color:#fecaca;color:#b42318;background:#fff7f7}button:disabled{opacity:.45;cursor:not-allowed}.status{padding:3px 8px;border-radius:999px;font-size:.74rem;font-weight:700}.status--active,.status--unassigned{background:#dcfce7;color:#166534}.status--inactive,.status--ended{background:#fee2e2;color:#991b1b}.error{color:#b42318;margin:0 0 12px}.backdrop{position:fixed;inset:0;z-index:300;background:rgba(15,23,42,.58);display:grid;place-items:center;padding:16px}.modal{position:relative;width:min(100%,760px);max-height:90vh;overflow:auto;background:#fff;border-radius:16px;padding:26px;display:grid;gap:12px}.modal h2{margin:0 0 4px}.modal label{display:grid;gap:6px;font-size:.8rem;font-weight:700;color:#475569}.modal input,.modal select,.modal textarea{box-sizing:border-box;width:100%;min-height:40px;border:1px solid #cfd8e6;border-radius:8px;padding:9px 10px;font:inherit}.modal textarea{resize:vertical;min-height:90px}.transfer-subtitle{margin:-5px 0 0;color:#405675;font-weight:700}.transfer-note{margin:0;padding:10px 12px;border-radius:8px;background:#eff6ff;color:#315887;font-size:.85rem;line-height:1.4}.rate-picker{position:relative}.rate-picker input{padding-right:86px}.rate-picker small{color:#637287;font-weight:600}.rate-search-button{position:absolute;right:6px;top:27px;border:0;border-radius:6px;background:#2349e6;color:#fff;padding:7px 11px;font-weight:800;cursor:pointer}.rate-picker__results{position:absolute;z-index:4;top:100%;left:0;right:0;max-height:270px;overflow:auto;border:1px solid #bfcee4;border-radius:8px;background:#fff;box-shadow:0 12px 26px rgba(15,23,42,.16)}.rate-picker__results button{display:grid;width:100%;gap:3px;padding:10px 12px;border:0;border-bottom:1px solid #edf1f6;background:#fff;text-align:left;cursor:pointer;color:#1d3557}.rate-picker__results button:hover{background:#eff6ff}.rate-picker__results span{font-size:.8rem;color:#61708a}.rate-picker__results p{margin:0;padding:12px;color:#66758b;font-weight:600}.shift-missing{display:grid;gap:5px;padding:12px;border:1px solid #f5c978;border-radius:9px;background:#fff9ed;color:#80530b;font-size:.85rem}.shift-missing span{color:#8a6a30}.shift-missing button{justify-self:start;border:0;border-radius:7px;background:#f59e0b;color:#fff;padding:7px 10px;font-weight:800;cursor:pointer}.shift-choice{display:flex;gap:8px;flex-wrap:wrap}.shift-choice button{border:1px solid #cfd8e6;border-radius:7px;background:#fff;padding:8px 10px;font-weight:700;cursor:pointer}.shift-choice button.active{border-color:#2349e6;background:#eef3ff;color:#2043cc}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.close{position:absolute;right:12px;top:10px;border:0;background:transparent;font-size:1.1rem;cursor:pointer}.modal footer{display:flex;justify-content:flex-end;gap:10px;margin-top:6px}.delete-modal{width:min(100%,540px);justify-items:center;text-align:center;gap:14px}.delete-modal__icon{display:grid;place-items:center;width:50px;height:50px;border-radius:50%;background:#fee2e2;color:#b42318;font-size:1.5rem;font-weight:900}.delete-modal__employee{margin:0;color:#1e3655;font-weight:800}.delete-modal__employee span{color:#64748b;font-weight:700}.delete-modal__note{margin:0;padding:14px 16px;border:1px solid #fecaca;border-radius:10px;background:#fff7f7;color:#7f1d1d;font-size:.88rem;line-height:1.55;text-align:left}.delete-modal footer{width:100%}.delete-modal footer button{min-width:90px;border:1px solid #cfd8e6;border-radius:8px;background:#fff;padding:9px 16px;font-weight:800;cursor:pointer}.delete-modal footer .danger{border-color:#dc2626;background:#dc2626;color:#fff}@media(max-width:760px){.employees-page{padding:20px}.filters,.grid{grid-template-columns:1fr}.page-head{flex-direction:column;align-items:flex-start}}
</style>

<style scoped>
.employee-identity {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.employee-identity img,
.employee-avatar-fallback,
.employee-card__photo {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  object-fit: cover;
}

.employee-avatar-fallback {
  display: grid;
  place-items: center;
  background: #e8efff;
  color: #244bb0;
  font-size: .68rem;
  font-weight: 900;
}

.employee-card__identity {
  flex: 1 1 auto;
}

.employee-card__photo {
  width: 42px;
  height: 42px;
}

.employee-modal {
  width: min(100%, 980px);
  gap: 16px;
  padding: 30px;
  background: #f7f9fc;
}

.employee-modal > h2 {
  padding-right: 42px;
}

.employee-form-section {
  display: grid;
  gap: 13px;
  padding: 18px;
  border: 1px solid #dce4ef;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 4px 14px rgba(30, 54, 85, .035);
}

.employee-form-section__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 10px;
  border-bottom: 1px solid #edf1f6;
}

.employee-form-section__heading span {
  color: #3767ba;
  font-size: .68rem;
  font-weight: 900;
  letter-spacing: .09em;
}

.employee-form-section__heading h3 {
  margin: 2px 0 0;
  color: #1d304d;
  font-size: 1rem;
}

.employee-form-section__heading > small {
  color: #738196;
  font-size: .74rem;
  font-weight: 650;
}

.employee-photo-editor {
  display: flex;
  align-items: center;
  gap: 16px;
}

.employee-photo-editor > img,
.employee-photo-placeholder {
  width: 92px;
  height: 92px;
  border: 2px solid #d6e1ef;
  border-radius: 18px;
  object-fit: cover;
  background: #eef3fb;
}

.employee-photo-placeholder {
  display: grid;
  place-items: center;
  color: #46658d;
  font-size: .78rem;
  font-weight: 900;
}

.employee-photo-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 9px;
}

.photo-upload-button,
.photo-remove-button {
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  border: 1px solid #c9d5e5;
  border-radius: 9px;
  padding: 8px 13px;
  background: #fff;
  color: #29486e;
  font: inherit;
  font-size: .8rem;
  font-weight: 800;
  cursor: pointer;
}

.photo-upload-button {
  border-color: #2e63d4;
  background: #2e63d4;
  color: #fff !important;
}

.photo-upload-button input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
}

.photo-remove-button {
  color: #b42318;
}

.employee-photo-actions .error {
  flex-basis: 100%;
  margin: 0;
}

.photo-upload-hint {
  flex-basis: 100%;
  color: #6d7c90;
  font-size: .73rem;
  font-weight: 600;
  line-height: 1.45;
}

.photo-picker-backdrop {
  z-index: 380;
  background: rgba(15, 23, 42, .64);
}

.photo-picker-modal {
  position: relative;
  display: grid;
  width: min(100%, 680px);
  gap: 18px;
  padding: 26px;
  border: 1px solid #d6e1ef;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 28px 70px rgba(15, 23, 42, .28);
  color: #14233c;
  font-family: Inter, system-ui, sans-serif;
  outline: none;
}

.photo-picker-heading {
  display: grid;
  gap: 4px;
  padding-right: 46px;
}

.photo-picker-heading > span {
  color: #3767ba;
  font-size: .7rem;
  font-weight: 900;
  letter-spacing: .09em;
}

.photo-picker-modal h2 {
  margin: 0;
  color: #14233c;
  font-size: 1.3rem;
}

.photo-picker-heading > p {
  margin: 0;
  color: #64748b;
  font-size: .88rem;
  line-height: 1.5;
}

.photo-picker-close {
  position: absolute;
  top: 15px;
  right: 15px;
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: #53657d;
  cursor: pointer;
}

.photo-picker-close:hover {
  background: #edf3fa;
  color: #17375f;
}

.photo-picker-close svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

.photo-drop-zone {
  display: flex;
  min-height: 220px;
  align-items: center;
  justify-content: center;
  gap: 20px;
  border: 2px dashed #b8c9e1;
  border-radius: 14px;
  background: #f7faff;
  color: #29486e;
  outline: none;
  cursor: pointer;
  transition: border-color .16s ease, background-color .16s ease, transform .16s ease;
}

.photo-drop-zone:hover,
.photo-drop-zone:focus-visible,
.photo-drop-zone.is-dragging {
  border-color: #2e63d4;
  background: #eef4ff;
}

.photo-drop-zone.is-dragging {
  transform: scale(1.01);
}

.photo-drop-zone svg {
  width: 52px;
  height: 52px;
  fill: none;
  stroke: #2e63d4;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.photo-drop-zone > div {
  display: grid;
  gap: 8px;
  font-size: .92rem;
}

.photo-drop-zone strong {
  font-size: 1rem;
}

.photo-drop-zone span {
  color: #6d7c90;
}

.photo-drop-zone button {
  border: 0;
  padding: 0;
  background: transparent;
  color: #2458c4;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.photo-drop-zone input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}

.photo-picker-hint {
  color: #6d7c90;
  font-size: .75rem;
  text-align: center;
}

.photo-picker-error {
  margin: 0 !important;
  padding: 10px 12px;
  border: 1px solid #fecaca;
  border-radius: 9px;
  background: #fff7f7;
  color: #b42318 !important;
  font-size: .8rem;
}

.photo-picker-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 2px;
}

.photo-picker-footer button {
  min-height: 40px;
  border: 1px solid #c5d0df;
  border-radius: 9px;
  padding: 8px 16px;
  background: #f8fafc;
  color: #334e6f;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.photo-picker-footer button:hover {
  border-color: #94a8c2;
  background: #eef3f8;
}

.discard-changes-backdrop {
  z-index: 420;
}

.discard-changes-modal {
  display: grid;
  grid-template-columns: auto 1fr;
  width: min(100%, 500px);
  gap: 14px;
  padding: 24px;
  border: 1px solid #d7e1ee;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 24px 60px rgba(15, 23, 42, .28);
  color: #14233c;
  font-family: Inter, system-ui, sans-serif;
}

.discard-changes-icon {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 50%;
  background: #fff3cd;
  color: #9a6700;
  font-size: 1.15rem;
  font-weight: 900;
}

.discard-changes-modal h2 {
  margin: 1px 0 6px;
  font-size: 1.15rem;
}

.discard-changes-modal p {
  margin: 0;
  color: #64748b;
  font-size: .88rem;
  line-height: 1.5;
}

.discard-changes-modal footer {
  display: flex;
  grid-column: 1 / -1;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 6px;
}

.discard-changes-modal footer button {
  min-height: 41px;
  border: 1px solid #c8d3e1;
  border-radius: 9px;
  padding: 8px 15px;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.keep-editing-button {
  background: #fff;
  color: #334e6f;
}

.discard-button {
  border-color: #dc2626 !important;
  background: #dc2626;
  color: #fff;
}

.employee-core-grid {
  display: grid;
  grid-template-columns: minmax(170px, .9fr) minmax(280px, 1.35fr) minmax(150px, .65fr);
  align-items: start;
  gap: 12px;
}

.employee-core-field {
  min-width: 0;
}

.employee-core-field--search {
  display: grid;
  gap: 6px;
}

.employee-core-field > small {
  color: #7a8799;
  font-size: .72rem;
  font-weight: 600;
}

.employee-modal input,
.employee-modal select {
  min-height: 44px;
}

.checkbox-row {
  display: inline-flex !important;
  grid-auto-flow: column;
  align-items: center;
  width: auto;
  color: #435873 !important;
  font-size: .76rem !important;
  white-space: nowrap;
  cursor: pointer;
}

.checkbox-row input {
  width: 17px !important;
  min-height: 17px !important;
  margin: 0;
  accent-color: #2857d7;
}

.fields-disabled {
  opacity: .58;
}

.present-address-fields {
  display: grid;
  gap: 13px;
  transition: opacity .16s ease;
}

.beneficiary-list {
  display: grid;
  gap: 12px;
  transition: opacity .16s ease;
}

.beneficiary-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 10px;
}

.remove-beneficiary-button,
.add-beneficiary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 42px;
  border: 1px solid #c9d5e5;
  border-radius: 9px;
  background: #f8fafc;
  color: #29486e;
  font: inherit;
  font-size: .8rem;
  font-weight: 800;
  cursor: pointer;
}

.add-beneficiary-button {
  justify-self: start;
  padding: 8px 14px;
  border-color: #aac0e5;
  background: #eef4ff;
  color: #244d91;
}

.remove-beneficiary-button {
  width: 42px;
  padding: 0;
  color: #b42318;
}

.remove-beneficiary-button svg,
.add-beneficiary-button svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.add-beneficiary-button:hover {
  border-color: #7699d5;
  background: #e1ecff;
}

.remove-beneficiary-button:hover {
  border-color: #f1aaaa;
  background: #fff5f5;
}

.duplicate-review-backdrop {
  z-index: 430;
}

.duplicate-review-modal {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  width: min(100%, 620px);
  gap: 14px;
  padding: 24px;
  border: 1px solid #d7e1ee;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 24px 60px rgba(15, 23, 42, .28);
  color: #14233c;
  font-family: Inter, system-ui, sans-serif;
}

.duplicate-review-icon {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 50%;
  background: #fff3cd;
  color: #9a6700;
  font-size: 1.15rem;
  font-weight: 900;
}

.duplicate-review-copy > span {
  color: #3767ba;
  font-size: .68rem;
  font-weight: 900;
  letter-spacing: .09em;
}

.duplicate-review-copy h2 {
  margin: 3px 0 7px;
  font-size: 1.2rem;
}

.duplicate-review-copy p {
  margin: 0;
  color: #64748b;
  font-size: .86rem;
  line-height: 1.5;
}

.duplicate-match-list {
  display: grid;
  grid-column: 1 / -1;
  max-height: 250px;
  gap: 8px;
  margin: 2px 0 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}

.duplicate-match-list li {
  display: grid;
  gap: 3px;
  padding: 12px 13px;
  border: 1px solid #dce4ef;
  border-radius: 10px;
  background: #f8fafc;
}

.duplicate-match-list strong {
  color: #17375f;
  font-size: .86rem;
}

.duplicate-match-list span,
.duplicate-match-list small {
  color: #64748b;
  font-size: .76rem;
}

.duplicate-match-list small {
  color: #9a6700;
  font-weight: 750;
}

.duplicate-review-modal footer {
  display: flex;
  grid-column: 1 / -1;
  justify-content: flex-end;
  gap: 10px;
}

.duplicate-review-modal footer button {
  min-height: 41px;
  border: 1px solid #c8d3e1;
  border-radius: 9px;
  padding: 8px 15px;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.review-details-button {
  background: #fff;
  color: #334e6f;
}

.save-anyway-button {
  border-color: #2349e6 !important;
  background: #2349e6;
  color: #fff;
}

.employee-modal > footer {
  position: sticky;
  z-index: 3;
  bottom: -30px;
  margin: 0 -30px -30px;
  padding: 15px 30px;
  border-top: 1px solid #dce4ef;
  background: rgba(255, 255, 255, .96);
  box-shadow: 0 -8px 20px rgba(30, 54, 85, .07);
  backdrop-filter: blur(8px);
}

@media (max-width: 760px) {
  .employee-modal {
    width: 100%;
    max-height: calc(100dvh - 20px);
    padding: 22px 14px;
    border-radius: 16px;
  }

  .employee-form-section {
    padding: 14px;
  }

  .employee-form-section__heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }

  .employee-photo-editor {
    align-items: flex-start;
  }

  .employee-photo-editor > img,
  .employee-photo-placeholder {
    width: 74px;
    height: 74px;
  }

  .employee-photo-actions {
    align-items: stretch;
    flex: 1;
    flex-direction: column;
  }

  .employee-core-grid {
    grid-template-columns: 1fr;
  }

  .employee-modal > footer {
    bottom: -22px;
    margin: 0 -14px -22px;
    padding: 12px 14px;
  }

  .employee-modal > .employee-form-section:last-of-type {
    margin-bottom: 76px;
  }

  .photo-picker-backdrop {
    padding: 10px;
  }

  .photo-picker-modal {
    width: 100%;
    gap: 14px;
    padding: 22px 16px;
    border-radius: 16px;
  }

  .photo-drop-zone {
    min-height: 210px;
    flex-direction: column;
    gap: 12px;
    padding: 24px 16px;
    text-align: center;
  }

  .discard-changes-modal {
    grid-template-columns: 1fr;
    padding: 20px;
  }

  .discard-changes-icon {
    width: 38px;
    height: 38px;
  }

  .discard-changes-modal footer {
    grid-column: 1;
    flex-direction: column-reverse;
  }

  .discard-changes-modal footer button {
    width: 100%;
  }

  .beneficiary-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .remove-beneficiary-button {
    width: 42px;
  }

  .duplicate-review-modal {
    grid-template-columns: 1fr;
    max-height: calc(100dvh - 20px);
    padding: 20px;
    overflow: auto;
  }

  .duplicate-review-icon,
  .duplicate-review-modal footer,
  .duplicate-match-list {
    grid-column: 1;
  }

  .duplicate-review-modal footer {
    flex-direction: column-reverse;
  }

  .duplicate-review-modal footer button {
    width: 100%;
  }
}
</style>

<style scoped>
.modal {
  font-family: Inter, system-ui, sans-serif;
}

.modal h2 {
  color: #14233c;
  font-size: 1.55rem;
  line-height: 1.2;
}

.modal label small {
  color: #7a8799;
  font-size: .72rem;
  font-weight: 600;
}

.modal footer > button {
  min-height: 42px;
  border: 1px solid #cfd8e6;
  border-radius: 9px;
  padding: 9px 17px;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.modal footer > .cancel-button {
  border-color: #c5d0df;
  background: #f8fafc;
  color: #334e6f;
}

.modal footer > .cancel-button:hover {
  border-color: #94a8c2;
  background: #eef3f8;
}

.modal .close {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 9px;
  color: #53657d;
  font-family: Inter, system-ui, sans-serif;
  font-size: 1.35rem;
}

.modal .close:hover {
  background: #edf3fa;
  color: #17375f;
}

.modal .close svg {
  width: 19px;
  height: 19px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

.employee-table-wrap {
  overflow: hidden;
}

.employee-table {
  width: 100%;
  table-layout: fixed;
}

.employee-table .col-id { width: 8%; }
.employee-table .col-number { width: 9%; }
.employee-table .col-name { width: 12%; }
.employee-table .col-agency { width: 16%; }
.employee-table .col-position { width: 10%; }
.employee-table .col-site { width: 10%; }
.employee-table .col-deployment { width: 10%; }
.employee-table .col-status { width: 7%; }
.employee-table .col-actions { width: 174px; }

.employee-table th,
.employee-table td {
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
  vertical-align: middle;
}

.employee-table .employee-id,
.employee-table .employee-name {
  color: #17375f;
  font-weight: 800;
}

.employee-table .row-actions {
  justify-content: center;
  align-items: center;
  gap: 5px;
  padding-right: 10px;
  padding-left: 10px;
}

.employee-table th:last-child {
  text-align: center;
}

.action-icon {
  display: inline-grid;
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  place-items: center;
  padding: 0;
  border-color: #d3dcea;
  border-radius: 8px;
  color: #315173;
  transition: background-color .16s ease, border-color .16s ease, color .16s ease, transform .16s ease;
}

.action-icon:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: #9cb5dc;
  background: #edf4ff;
  color: #174ea6;
}

.action-icon svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.action-icon--deactivate {
  color: #9a6700;
}

.action-icon--deactivate:hover:not(:disabled) {
  border-color: #f3c969;
  background: #fff8e5;
  color: #7a4e00;
}

.action-icon--delete {
  border-color: #fecaca;
  background: #fff7f7;
  color: #b42318;
}

.action-icon--delete:hover:not(:disabled) {
  border-color: #ef4444;
  background: #fee2e2;
  color: #991b1b;
}

.mobile-employee-list {
  display: none;
}

.employee-list-progress {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-top: 14px;
  color: #607089;
  font-size: .82rem;
}

.employee-list-progress button {
  min-height: 36px;
  border: 1px solid #d3dcea;
  border-radius: 8px;
  background: #fff;
  color: #24415f;
  font: inherit;
  font-weight: 800;
  padding: 7px 12px;
  cursor: pointer;
}

.employee-list-progress button:hover {
  border-color: #9cb5dc;
  background: #edf4ff;
  color: #174ea6;
}

.employee-card,
.mobile-list-message {
  border: 1px solid #dce3ee;
  border-radius: 13px;
  background: #fff;
  box-shadow: 0 4px 14px rgba(30, 54, 85, .045);
}

.mobile-list-message {
  margin: 0;
  padding: 20px;
  text-align: center;
  color: #607089;
}

.employee-card {
  overflow: hidden;
}

.employee-card__head,
.employee-card__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
}

.employee-card__head {
  border-bottom: 1px solid #edf1f6;
}

.employee-card__identity {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.employee-card__identity strong {
  overflow: hidden;
  color: #17375f;
  font-size: .94rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.employee-card__identity span {
  overflow: hidden;
  color: #66758b;
  font-size: .72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.employee-card__details {
  display: grid;
  gap: 4px;
  padding: 10px 14px;
  color: #53657d;
  font-size: .79rem;
}

.employee-card__details p {
  margin: 0;
}

.employee-card__agency {
  overflow: hidden;
  color: #283f5e;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.employee-card__footer {
  border-top: 1px solid #edf1f6;
  background: #fbfcfe;
}

.employee-card__deployment {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.employee-card__deployment > span:first-child {
  color: #66758b;
  font-size: .68rem;
  font-weight: 800;
  letter-spacing: .04em;
  text-transform: uppercase;
}

.mobile-actions {
  display: grid;
  grid-template-columns: repeat(4, 36px);
  gap: 6px;
}

.mobile-actions .action-icon {
  width: 36px;
  height: 36px;
}

@media (max-width: 980px) {
  .employee-table-wrap {
    display: none;
  }

  .mobile-employee-list {
    display: grid;
    gap: 10px;
  }

  .employee-table-wrap {
    overflow: visible;
    border: 0;
    border-radius: 0;
    background: transparent;
  }

  .employee-table,
  .employee-table tbody {
    display: block;
    width: 100%;
  }

  .employee-table colgroup,
  .employee-table thead {
    display: none;
  }

  .employee-table tbody {
    display: grid;
    gap: 12px;
  }

  .employee-table tbody tr:not(.table-message) {
    display: grid;
    overflow: hidden;
    border: 1px solid #dce3ee;
    border-radius: 14px;
    background: #fff;
    box-shadow: 0 5px 16px rgba(30, 54, 85, .05);
  }

  .employee-table tbody tr:not(.table-message) td {
    display: grid;
    grid-template-columns: minmax(110px, .7fr) minmax(0, 1.3fr);
    gap: 12px;
    align-items: center;
    width: auto;
    padding: 10px 14px;
    border-bottom: 1px solid #edf1f6;
    text-align: left;
  }

  .employee-table tbody tr:not(.table-message) td::before {
    content: attr(data-label);
    color: #66758b;
    font-size: .69rem;
    font-weight: 800;
    letter-spacing: .045em;
    text-transform: uppercase;
  }

  .employee-table tbody tr:not(.table-message) td:last-child {
    border-bottom: 0;
  }

  .employee-table .status {
    justify-self: start;
  }

  .employee-table .row-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 14px;
  }

  .employee-table .row-actions::before {
    margin-right: auto;
  }

  .employee-table .table-message {
    display: block;
  }

  .employee-table .table-message td {
    display: block;
    padding: 18px;
    border: 1px solid #dce3ee;
    border-radius: 14px;
    background: #fff;
    text-align: center;
  }
}

@media (max-width: 600px) {
  .employees-page {
    padding: 16px 12px;
  }

  .page-head {
    gap: 14px;
  }

  .actions-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
  }

  .actions-row .primary,
  .actions-row .ghost {
    min-width: 0;
    padding: 10px 8px;
    font-size: .83rem;
    text-align: center;
  }

  .filters {
    gap: 10px;
  }

  .employee-list-progress {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    text-align: center;
  }

  .employee-list-progress button {
    width: 100%;
  }

  .employee-table tbody tr:not(.table-message) td {
    grid-template-columns: 92px minmax(0, 1fr);
    gap: 8px;
    padding: 9px 12px;
  }

  .employee-table .row-actions {
    flex-wrap: wrap;
  }

  .row-actions .action-icon {
    flex-basis: 42px;
    width: 42px;
    height: 42px;
  }

  .action-icon svg {
    width: 19px;
    height: 19px;
  }
}

@media (max-width: 380px) {
  .actions-row {
    grid-template-columns: 1fr;
  }

  .employee-table tbody tr:not(.table-message) td {
    grid-template-columns: 1fr;
    gap: 4px;
  }

  .employee-table .row-actions::before {
    width: 100%;
    margin-bottom: 4px;
  }

  .employee-card__head {
    align-items: flex-start;
  }

  .employee-card__footer {
    display: grid;
    gap: 10px;
  }

  .mobile-actions {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .mobile-actions .action-icon {
    width: 100%;
  }
}
</style>
