const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')

function evaluate(source, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, { module, require: () => ({}), ...globals })
  return module.exports
}

function harness(body) {
  const calls = []
  const alertMessages = evaluate(fs.readFileSync('components/alertmessage/messages.ts', 'utf8'))
  const api = evaluate(fs.readFileSync('server/utils/employeeCrud.ts', 'utf8'), {
    require: name => name === 'h3'
      ? {
          createError: details => Object.assign(new Error(details.statusMessage), details),
          getQuery: () => ({}),
          getRouterParam: () => '',
          readBody: async () => body,
        }
      : name.includes('dbconnect')
        ? {
            execute: async (sql, values) => {
              calls.push({ sql, values: Array.from(values || []) })
              return [{ insertId: 12, affectedRows: 1 }]
            },
          }
        : name === './auth'
          ? { requireSession: () => ({ sub: 99 }) }
          : name.includes('alertmessage/messages')
            ? alertMessages
            : {},
  })
  return { api, calls }
}

const validEmployee = {
  AgencyPositionID: 7,
  EmployeeNumber: '',
  FirstName: 'Juan',
  MiddleName: 'Santos',
  LastName: 'dela Cruz',
  Nickname: 'Jun',
  Birthday: '1995-05-08',
  Gender: 'Male',
  CivilStatus: 'Single',
  Address: 'Davao City',
  Email: ' Juan.Test@GMAIL.COM ',
  ContactNumber: '09171234567',
  DateHired: '2026-09-20',
  Status: 'Active',
  PermanentUnitHouseNumber: '12-A',
  PermanentProvince: 'Davao del Sur',
  PermanentStreet: 'Rizal Street',
  PermanentCityMunicipality: 'Davao City',
  PermanentSubdivision: 'Sample Village',
  PermanentBarangay: 'Barangay 1',
  PermanentRegion: 'Region XI',
  PermanentPostalCode: '8000',
  PresentUnitHouseNumber: '44',
  PresentProvince: 'Cebu',
  PresentStreet: 'Osmena Boulevard',
  PresentCityMunicipality: 'Cebu City',
  PresentBarangay: 'Capitol Site',
  PresentRegion: 'Region VII',
  PresentPostalCode: '6000',
  BeneficiaryNotApplicable: false,
  Beneficiary1: 'Maria dela Cruz',
  Beneficiary1Relationship: 'Spouse',
  EmergencyName: 'Pedro Santos',
  EmergencyRelationship: 'Sibling',
  EmergencyAddress: 'Davao City',
  EmergencyContactNo: '09181234567',
}

test('employee create normalizes names and email while preserving a valid numeric contact', async () => {
  const { api, calls } = harness(validEmployee)
  assert.deepEqual(JSON.parse(JSON.stringify(await api.createEmployee({}))), { id: 12 })
  const values = calls[0].values
  assert.equal(values[2], 'JUAN')
  assert.equal(values[3], 'SANTOS')
  assert.equal(values[4], 'DELA CRUZ')
  assert.equal(values[5], 'JUN')
  assert.equal(values[10], 'juan.test@gmail.com')
  assert.equal(values[11], '09171234567')
  assert.equal(values[9], '12-A, Rizal Street, Sample Village, Barangay 1, Davao City, Davao del Sur, Region XI, 8000')
  assert.equal(values[31], 'MARIA DELA CRUZ')
  assert.equal(values[35], 'PEDRO SANTOS')
  assert.equal(values[38], '09181234567')
})

test('employee create rejects unsupported employee photos before writing to the database', async () => {
  const { api, calls } = harness({ ...validEmployee, PhotoDataUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==' })
  await assert.rejects(api.createEmployee({}), error => error.statusCode === 400 && /PNG, JPG, or WEBP/.test(error.message))
  assert.equal(calls.length, 0)
})

test('employee create rejects invalid emergency contact numbers', async () => {
  for (const EmergencyContactNo of ['12345', '0918CALLNOW', '1234567890123456']) {
    const { api, calls } = harness({ ...validEmployee, EmergencyContactNo })
    await assert.rejects(api.createEmployee({}), error => error.statusCode === 400 && /7 to 15 digits/.test(error.message))
    assert.equal(calls.length, 0)
  }
})

test('employee create rejects incomplete email addresses', async () => {
  const { api, calls } = harness({ ...validEmployee, Email: 'juan.gmail.com' })
  await assert.rejects(api.createEmployee({}), error => error.statusCode === 400 && /complete address/.test(error.message))
  assert.equal(calls.length, 0)
})

test('employee create rejects letters or contact numbers that are not exactly 11 digits', async () => {
  for (const ContactNumber of ['0917ABC1234', '0917123456', '091712345678']) {
    const { api, calls } = harness({ ...validEmployee, ContactNumber })
    await assert.rejects(api.createEmployee({}), error => error.statusCode === 400 && /exactly 11 digits/.test(error.message))
    assert.equal(calls.length, 0)
  }
})
