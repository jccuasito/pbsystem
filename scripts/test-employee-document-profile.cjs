const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const { parse, compileScript, compileTemplate, compileStyle } = require('@vue/compiler-sfc')
const vue = require('vue')
const filename = 'app/pages/employees/documents/index.vue'
const source = fs.readFileSync(filename, 'utf8')
function evaluate(source, requireMock) {
  const module = { exports: {} }
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, { module, require: requireMock, defineEmits: () => () => {}, confirm: () => { throw Error('Profile viewing must not request a deletion') } })
  return module.exports
}
const identity = evaluate(fs.readFileSync('app/utils/employee.ts', 'utf8'), () => ({}))
const rules = evaluate(fs.readFileSync('shared/utils/governmentIds.ts', 'utf8'), () => ({}))
const selectDescriptor = parse(fs.readFileSync('components/SearchableSelect.vue', 'utf8')).descriptor
const selectComponent = evaluate(compileScript(selectDescriptor, { id: 'select-test', inlineTemplate: true }).content, () => vue).default
function profile() {
  const scope = vue.effectScope()
  const state = scope.run(() => evaluate(parse(source).descriptor.scriptSetup.content + '\nmodule.exports={employee,bundle,profileGroups,profilePhoto,profileInitials,profileBeneficiaries,documentSections,activeSection,formOpen,openAdd,openEdit,save,remove};', name => name === 'vue' ? { ...vue, onMounted() {} } : name.includes('governmentIds') ? rules : name.includes('useRealtimeRefresh') ? { useRealtimeRefresh() {} } : name.includes('utils/employee') ? identity : {}))
  return { state, close: () => scope.stop() }
}

async function renderDetails(section = 'profile') {
  const fixture = { EmployeeID: 11, FirstName: 'MARIA', MiddleName: 'REYES', LastName: 'GARCIA', Email: 'test@example.invalid', AgencyName: 'Test agency', PositionName: 'Supervisor', Status: 'Active' }
  const prepared = source.replace('const employee = ref<any>(null)', `const employee = ref<any>(${JSON.stringify(fixture)})`)
    .replace('const detailOpen = ref(false)', 'const detailOpen = ref(true)')
    .replace("const activeSection = ref<SectionKey>('profile')", `const activeSection = ref<SectionKey>('${section}')`)
  const { descriptor } = parse(prepared, { filename })
  const script = compileScript(descriptor, { id: filename, inlineTemplate: true })
  const component = evaluate(script.content, name => name === 'vue' ? vue : name.includes('SearchableSelect') ? selectComponent : name.includes('governmentIds') ? rules : name.includes('useRealtimeRefresh') ? { useRealtimeRefresh() {} } : name.includes('utils/employee') ? identity : {})
  const context = {}
  await require('@vue/server-renderer').renderToString(vue.createSSRApp(component.default), context)
  return context.teleports.body
}

test('rendered profile has saved information without record actions; other document tabs keep their actions', async () => {
  const html = await renderDetails()
  const start = html.indexOf('class="records-panel profile-view"')
  assert.ok(start >= 0)
  const profileHtml = html.slice(start, html.indexOf('<footer class="drawer-footer"', start))
  assert.ok(profileHtml.includes('test@example.invalid'))
  assert.ok(profileHtml.includes('Employment details'))
  assert.ok(profileHtml.includes('Supervisor'))
  assert.ok(!/<button|<input|<select|<textarea/.test(profileHtml))
  assert.ok(!html.includes('No employee profile records yet'))
  const government = await renderDetails('government')
  assert.ok(government.includes('+ Add record'))
  assert.ok(government.includes('Government IDs'))
})

test('employee documents script, template, and responsive styles compile', () => {
  const { descriptor, errors } = parse(source, { filename })
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: filename })
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: filename, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
  for (const style of descriptor.styles) assert.deepEqual(compileStyle({ source: style.content, filename, id: filename, scoped: style.scoped }).errors, [])
})

test('profile displays saved employee information even without a separate employee_profile record', () => {
  const h = profile()
  try {
    h.state.employee.value = {
      EmployeeID: 11, FirstName: 'MARIA', MiddleName: 'REYES', LastName: 'GARCIA', Nickname: 'MARI',
      AgencyName: 'Test agency', PositionName: 'Supervisor', Status: 'Active', Birthday: '1995-03-15T00:00:00.000Z', DateHired: '2026-01-01',
      Gender: 'Female', CivilStatus: 'Single', Email: 'test@example.invalid', ContactNumber: '09170000000',
      PermanentUnitHouseNumber: '12', PermanentStreet: 'Test Street', PermanentBarangay: 'Test Barangay', PermanentCityMunicipality: 'Pasig', PermanentPostalCode: '1600',
      PresentCityMunicipality: 'Makati', EmergencyName: 'Test Contact', EmergencyRelationship: 'Sibling', EmergencyContactNo: '09171111111', EmergencyAddress: 'Test address',
      Beneficiaries: JSON.stringify([{ Name: 'Test beneficiary', Relationship: 'Parent' }]), PhotoPath: '/uploads/employees/test.webp',
    }
    h.state.bundle.value = { profile: null }
    const fields = Object.fromEntries(h.state.profileGroups.value.flatMap(group => group.fields).map(field => [field.label, field.value]))
    assert.equal(fields['Employee ID'], 'EMP-0011')
    assert.equal(fields['Employee number'], 'Not yet assigned')
    assert.equal(fields.Birthday, 'Mar 15, 1995')
    assert.equal(fields['Date hired'], 'Jan 1, 2026')
    assert.equal(fields['First name'], 'MARIA')
    assert.equal(fields.Position, 'Supervisor')
    assert.equal(fields['Permanent address'], '12, Test Street, Test Barangay, Pasig, 1600')
    assert.equal(fields['Present address'], 'Makati')
    assert.equal(h.state.profileGroups.value.find(group => group.key === 'personal').fields.find(field => field.label === 'Contact number').value, '09170000000')
    assert.equal(h.state.profileGroups.value.find(group => group.key === 'emergency').fields.find(field => field.label === 'Contact number').value, '09171111111')
    assert.equal(h.state.profilePhoto.value, '/uploads/employees/test.webp')
    assert.equal(h.state.profileInitials.value, 'MG')
    assert.equal(h.state.profileBeneficiaries.value[0].Name, 'Test beneficiary')
    h.state.employee.value = { EmployeeID: 12, FirstName: 'OTHER', LastName: 'EMPLOYEE', Address: 'Legacy address' }
    const next = h.state.profileGroups.value.find(group => group.key === 'addresses').fields
    assert.equal(next[0].value, 'Legacy address')
    assert.equal(next[1].value, '')
    assert.equal(h.state.profilePhoto.value, '')
    assert.equal(h.state.profileBeneficiaries.value.length, 0, 'Switching employees does not retain previous beneficiary data')
  } finally { h.close() }
})

test('payment and beneficiary details reuse saved data, and profile cannot open editing or write records', async () => {
  const h = profile()
  try {
    h.state.employee.value = { EmployeeID: 1, Beneficiary1: 'Legacy beneficiary', Beneficiary1Relationship: 'Parent', Beneficiaries: 'invalid legacy JSON' }
    assert.equal(h.state.profileBeneficiaries.value[0].Name, 'Legacy beneficiary')
    h.state.employee.value.BeneficiaryNotApplicable = 1
    assert.equal(h.state.profileBeneficiaries.value.length, 0)
    h.state.bundle.value = { profile: { PaymentMethod: 'Cash', PaymentMethodEffectiveDate: '2026-10-01', Height: '165.25', Weight: '60.50' } }
    const personal = h.state.profileGroups.value.find(group => group.key === 'personal').fields
    assert.equal(personal.find(field => field.label === 'Height').value, '165.25 cm')
    assert.equal(personal.find(field => field.label === 'Weight').value, '60.5 kg')
    const payment = h.state.profileGroups.value.find(group => group.key === 'payment').fields
    assert.equal(payment[0].value, 'Cash'); assert.equal(payment[1].value, 'Oct 1, 2026')
    assert.equal(h.state.documentSections.value.length, 7)
    assert.ok(!h.state.documentSections.value.some(section => section.key === 'profile'))
    h.state.openEdit('profile', { ProfileID: 99 })
    await h.state.save('profile')
    await h.state.remove('profile', { ProfileID: 99 })
    assert.equal(h.state.formOpen.value, false)
    // No $fetch is provided in this harness: any attempted profile write fails.
  } finally { h.close() }
})
