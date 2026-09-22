const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const { parse, compileScript, compileTemplate, compileStyle } = require('@vue/compiler-sfc')
const vue = require('vue')

function evaluate(source, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, { module, require: () => ({}), ...globals })
  return module.exports
}

const alertMessages = evaluate(fs.readFileSync('components/alertmessage/messages.ts', 'utf8'))
const employeeHelpers = evaluate(fs.readFileSync('app/utils/employee.ts', 'utf8'))

function backend({ found = true, failEmployeeDelete = false } = {}) {
  const calls = []
  const connection = {
    async beginTransaction() { calls.push('begin') },
    async commit() { calls.push('commit') },
    async rollback() { calls.push('rollback') },
    release() { calls.push('release') },
    async execute(sql, args) {
      calls.push({ sql, args })
      if (sql.startsWith('SELECT EmployeeID, PhotoPath FROM employee')) return [found ? [{ EmployeeID: args[0], PhotoPath: null }] : []]
      if (sql.startsWith('DELETE FROM attendance_dtr_btr')) return [{ affectedRows: 3 }]
      if (sql.startsWith('DELETE FROM employee')) {
        if (failEmployeeDelete) throw new Error('delete failed')
        return [{ affectedRows: 1 }]
      }
      throw new Error(`Unexpected query: ${sql}`)
    },
  }
  const api = evaluate(fs.readFileSync('server/utils/employeeCrud.ts', 'utf8'), {
    require: name => name === 'h3'
      ? {
          createError: details => Object.assign(new Error(details.statusMessage), details),
          getQuery: () => ({}),
          getRouterParam: event => event.id,
          readBody: async event => event.body,
        }
      : name.includes('dbconnect')
        ? { getConnection: async () => connection }
        : name === './auth'
          ? { requireSession: () => ({ sub: 1 }) }
          : name.includes('alertmessage/messages')
            ? alertMessages
            : {},
  })
  return { api, calls }
}

test('permanent delete removes both BTR roles before the employee and commits once', async () => {
  const harness = backend()
  const result = await harness.api.permanentlyDeleteEmployee({ id: '7' })
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { success: true, deletedEmployeeId: 7, deletedBtrRows: 3 })
  const queries = harness.calls.filter(call => call.sql)
  assert.match(queries[0].sql, /FOR UPDATE$/)
  assert.deepEqual(Array.from(queries[0].args), [7])
  assert.match(queries[1].sql, /ReplacedEmployeeID = \? OR RelieverEmployeeID = \?/)
  assert.deepEqual(Array.from(queries[1].args), [7, 7])
  assert.equal(queries[2].sql, 'DELETE FROM employee WHERE EmployeeID = ?')
  assert.deepEqual(harness.calls.filter(call => typeof call === 'string'), ['begin', 'commit', 'release'])
})

test('missing employee and delete failures roll back the whole transaction', async () => {
  const missing = backend({ found: false })
  await assert.rejects(missing.api.permanentlyDeleteEmployee({ id: '9' }), error => error.statusCode === 404)
  assert.deepEqual(missing.calls.slice(-2), ['rollback', 'release'])
  assert.equal(missing.calls.filter(call => call.sql?.startsWith('DELETE')).length, 0)

  const failed = backend({ failEmployeeDelete: true })
  await assert.rejects(failed.api.permanentlyDeleteEmployee({ id: '7' }), /delete failed/)
  assert.deepEqual(failed.calls.slice(-2), ['rollback', 'release'])
  assert.ok(!failed.calls.includes('commit'))
})

function frontend(fetch) {
  const descriptor = parse(fs.readFileSync('app/pages/employees/index.vue', 'utf8')).descriptor
  const scope = vue.effectScope()
  const state = scope.run(() => evaluate(
    `${descriptor.scriptSetup.content}\nmodule.exports={openDelete,closeDelete,confirmDelete,deleteOpen,deleting,deleteBusy,deleteError,deleteWarning,reset,requestCloseEmployeeModal,keepEditingEmployee,discardEmployeeChanges,modalOpen,discardEmployeeOpen,form,sameAsPermanentAddress,showBeneficiary2,toggleSameAsPermanentAddress,addBeneficiary,removeBeneficiary2};`,
    {
      defineEmits: () => () => {},
      $fetch: fetch,
      require: name => name === 'vue'
        ? { ...vue, onMounted() {}, onBeforeUnmount() {} }
        : name.includes('useRealtimeRefresh')
          ? { useRealtimeRefresh() {} }
          : name.includes('utils/employee')
            ? employeeHelpers
            : name.includes('alertmessage/messages')
              ? alertMessages
              : {},
    },
  ))
  return { state, close: () => scope.stop() }
}

test('employee list requires explicit Yes and prevents repeated delete requests', async () => {
  let deleteRequests = 0
  let finishDelete
  const harness = frontend(async (url, options) => {
    if (options?.method === 'DELETE') {
      deleteRequests++
      await new Promise(resolve => { finishDelete = resolve })
      return { success: true }
    }
    return { items: [], agencies: [], positions: [], agencyPositions: [] }
  })
  try {
    const employee = { EmployeeID: 7, FirstName: 'Ian', LastName: 'De Jesus' }
    harness.state.openDelete(employee)
    assert.equal(harness.state.deleteOpen.value, true)
    assert.equal(deleteRequests, 0)
    harness.state.closeDelete()
    assert.equal(harness.state.deleteOpen.value, false)

    harness.state.openDelete(employee)
    const first = harness.state.confirmDelete()
    await harness.state.confirmDelete()
    assert.equal(deleteRequests, 1)
    assert.equal(harness.state.deleteOpen.value, true)
    finishDelete()
    await first
    assert.equal(harness.state.deleteOpen.value, false)
    assert.equal(harness.state.deleting.value, null)
  } finally {
    harness.close()
  }
})

test('failed permanent delete stays open and displays the server error', async () => {
  const harness = frontend(async (url, options) => {
    if (options?.method === 'DELETE') throw { data: { statusMessage: 'Related records could not be deleted.' } }
    return { items: [], agencies: [], positions: [], agencyPositions: [] }
  })
  try {
    harness.state.openDelete({ EmployeeID: 7 })
    await harness.state.confirmDelete()
    assert.equal(harness.state.deleteOpen.value, true)
    assert.equal(harness.state.deleteError.value, 'Related records could not be deleted.')
    assert.equal(harness.state.deleteBusy.value, false)
  } finally {
    harness.close()
  }
})

test('employee form only closes explicitly and protects unsaved changes', () => {
  const harness = frontend(async () => ({ items: [], agencies: [], positions: [], agencyPositions: [] }))
  try {
    harness.state.reset()
    harness.state.modalOpen.value = true
    harness.state.requestCloseEmployeeModal()
    assert.equal(harness.state.modalOpen.value, false)
    assert.equal(harness.state.discardEmployeeOpen.value, false)

    harness.state.reset()
    harness.state.modalOpen.value = true
    harness.state.form.value.FirstName = 'JUAN'
    harness.state.requestCloseEmployeeModal()
    assert.equal(harness.state.modalOpen.value, true)
    assert.equal(harness.state.discardEmployeeOpen.value, true)

    harness.state.keepEditingEmployee()
    assert.equal(harness.state.modalOpen.value, true)
    assert.equal(harness.state.discardEmployeeOpen.value, false)

    harness.state.requestCloseEmployeeModal()
    harness.state.discardEmployeeChanges()
    assert.equal(harness.state.modalOpen.value, false)
    assert.equal(harness.state.discardEmployeeOpen.value, false)
    assert.equal(harness.state.form.value.FirstName, '')
  } finally {
    harness.close()
  }
})

test('same-address state is restored, kept in sync, and cleared when unchecked', () => {
  const harness = frontend(async () => ({ items: [], agencies: [], positions: [], agencyPositions: [] }))
  try {
    harness.state.reset({
      PermanentStreet: 'Rizal Street',
      PermanentCityMunicipality: 'Davao City',
      PresentStreet: 'Rizal Street',
      PresentCityMunicipality: 'Davao City'
    })
    assert.equal(harness.state.sameAsPermanentAddress.value, true)

    harness.state.toggleSameAsPermanentAddress({ target: { checked: false } })
    assert.equal(harness.state.sameAsPermanentAddress.value, false)
    assert.equal(harness.state.form.value.PresentStreet, '')
    assert.equal(harness.state.form.value.PresentCityMunicipality, '')

    harness.state.toggleSameAsPermanentAddress({ target: { checked: true } })
    assert.equal(harness.state.form.value.PresentStreet, 'Rizal Street')
    assert.equal(harness.state.form.value.PresentCityMunicipality, 'Davao City')
  } finally {
    harness.close()
  }
})

test('second beneficiary is added on demand and removed cleanly', () => {
  const harness = frontend(async () => ({ items: [], agencies: [], positions: [], agencyPositions: [] }))
  try {
    harness.state.reset()
    assert.equal(harness.state.showBeneficiary2.value, false)
    harness.state.addBeneficiary()
    assert.equal(harness.state.showBeneficiary2.value, true)
    harness.state.form.value.Beneficiary2 = 'MARIA CRUZ'
    harness.state.form.value.Beneficiary2Relationship = 'Spouse'
    harness.state.removeBeneficiary2()
    assert.equal(harness.state.showBeneficiary2.value, false)
    assert.equal(harness.state.form.value.Beneficiary2, '')
    assert.equal(harness.state.form.value.Beneficiary2Relationship, '')
  } finally {
    harness.close()
  }
})

test('employee page compiles with guarded employee and themed image-picker modals', () => {
  const filename = 'app/pages/employees/index.vue'
  const source = fs.readFileSync(filename, 'utf8')
  const { descriptor, errors } = parse(source, { filename })
  assert.deepEqual(errors, [])
  assert.match(source, /class="photo-picker-modal"/)
  assert.match(source, /Drag an image here/)
  assert.match(source, /employeeUnsavedChanges\(\)/)
  assert.match(source, /Add beneficiary/)
  assert.match(source, /employeeDuplicate\(\)/)
  assert.match(source, /Save anyway/)
  assert.match(source, /requestCloseEmployeeModal/)
  assert.doesNotMatch(source, /v-if="modalOpen" class="backdrop" @click\.self/)
  assert.doesNotMatch(source, />Paste image(?: from clipboard)?</)
  assert.ok(source.indexOf('Emergency contact number') < source.indexOf('Emergency address'))
  const script = compileScript(descriptor, { id: 'employee-delete' })
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: 'employee-delete', compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
  for (const style of descriptor.styles) assert.deepEqual(compileStyle({ source: style.content, filename, id: 'employee-delete', scoped: style.scoped }).errors, [])
})
