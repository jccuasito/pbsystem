const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')
const vue = require('vue')
function evaluate(source, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, { module, Buffer, process, AbortController, ...globals })
  return module.exports
}
const rules = evaluate(fs.readFileSync('shared/utils/governmentIds.ts', 'utf8'))
const identities = evaluate(fs.readFileSync('app/utils/employee.ts', 'utf8'))
const selectDescriptor = parse(fs.readFileSync('components/SearchableSelect.vue', 'utf8')).descriptor
const selectComponent = evaluate(compileScript(selectDescriptor, { id: 'select-test', inlineTemplate: true }).content, { require: () => vue }).default
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=', 'base64')
const upload = { AttachmentDataUrl: 'data:image/png;base64,' + png.toString('base64'), AttachmentName: 'Front ID.png' }
const h3 = { createError: value => Object.assign(new Error(value.statusMessage), value), getRouterParam: (e, key) => e.params?.[key], setHeader: (e, key, value) => { (e.headers ||= {})[key] = value } }
const auth = { requireSession: e => { if (e.anonymous) throw h3.createError({ statusCode: 401, statusMessage: 'Please sign in.' }); return e.session || { sub: 1, userType: 'Admin' } } }
function loadApi(pool) {
  return evaluate(fs.readFileSync('server/utils/governmentIdCrud.ts', 'utf8'), { require: name => name === 'h3' ? h3 : name.includes('dbconnect') ? pool : name.endsWith('/auth') ? auth : name.includes('governmentIds') ? rules : require(name) })
}

test('known ID types format and validate dynamically without losing leading zeroes or overlong input', () => {
  for (const [type, raw, expected] of [
    ['PhilSys / National ID', '1234-5678-9012-3456', '1234567890123456'],
    ['SSS', '0012345678', '00-1234567-8'], ['PhilHealth', '001234567890', '00-123456789-0'],
    ['TIN', '001234567', '001-234-567'], ['TIN', '001234567000', '001-234-567-000'],
    ['TIN', '0012345670000', '001-234-567-0000'], ['TIN', '00123456700000', '001-234-567-00000'],
    ["Driver's License", 'n0123123456', 'N01-23-123456'],
    ['Other', 'ABC-123 / 45', 'ABC-123 / 45'],
  ]) {
    assert.equal(rules.formatGovernmentNumber(type, raw), expected)
    assert.equal(rules.validateGovernmentId(type === 'Other' ? 'Passport' : type, expected), '')
  }
  assert.ok(rules.validateGovernmentId('National ID', '123456789012'), 'Private PSN is not accepted in place of PCN')
  assert.ok(rules.validateGovernmentId('SSS', '12-3456789-A'))
  assert.ok(rules.validateGovernmentId('PhilHealth', '12345'))
  assert.ok(rules.validateGovernmentId('Other', 'ABC123'))
  assert.equal(rules.governmentIdType('Pag-IBIG'), 'Other')
  assert.equal(rules.validateGovernmentId('Pag-IBIG', '1234-ABC'), '')
  const overlong = rules.formatGovernmentNumber('SSS', '1234567890123')
  assert.equal(overlong.replace(/\D/g, '').length, 13)
  assert.ok(rules.validateGovernmentId('SSS', overlong))
})

test('scan content, size, and file type are checked before storing a file', () => {
  const api = loadApi({})
  const parsed = api.parseGovernmentAttachment(upload)
  assert.equal(parsed.mime, 'image/png'); assert.deepEqual(parsed.data, png)
  assert.match(parsed.filename, /^[a-f0-9]{32}\.png$/)
  assert.equal(api.parseGovernmentAttachment({}), null)
  for (const AttachmentDataUrl of [
    'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64'),
    'data:image/png;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64'),
    'data:application/pdf;base64,' + png.toString('base64'),
    'data:image/png;base64,' + Buffer.alloc(rules.governmentAttachmentMaxBytes + 1).toString('base64'),
  ]) assert.throws(() => api.parseGovernmentAttachment({ AttachmentDataUrl }), error => error.statusCode === 400)
})

test('global identity keys ignore formatting and known aliases while preserving license prefixes and ID types', () => {
  assert.deepEqual(rules.governmentIdIdentity('sss','00 1234567 8'), rules.governmentIdIdentity('SSS','00-1234567-8'))
  assert.deepEqual(rules.governmentIdIdentity('Drivers License','n0123123456'), rules.governmentIdIdentity("Driver's License",'N01-23-123456'))
  assert.deepEqual(rules.governmentIdIdentity('PCN','1234-5678-9012-3456'), rules.governmentIdIdentity('PhilSys / National ID','1234567890123456'))
  assert.deepEqual(rules.governmentIdIdentity('TIN','123-456-789-000'), rules.governmentIdIdentity('TIN','123-456-789-00001'))
  assert.notDeepEqual(rules.governmentIdIdentity("Driver's License",'N01-23-123456'), rules.governmentIdIdentity("Driver's License",'A01-23-123456'))
  assert.notDeepEqual(rules.governmentIdIdentity('Passport','ABC123'), rules.governmentIdIdentity('Other ID','ABC123'))
})

test('dynamic form sends formatted ID and selected file, and preserves an unchanged existing scan', async () => {
  const requests = [], scope = vue.effectScope()
  const source = parse(fs.readFileSync('app/pages/employees/documents/index.vue', 'utf8')).descriptor.scriptSetup.content
  const state = scope.run(() => evaluate(source + '\nmodule.exports={form,governmentKind,otherGovernmentName,governmentValidation,scanDataUrl,scanName,scanMime,scanError,readingScan,activeEmployeeId,editingId,save,inputGovernmentNumber,changeGovernmentKind,resetGovernmentForm,chooseGovernmentScan,clearNewScan};', {
    require: name => name === 'vue' ? { ...vue, onMounted() {} } : name.includes('SearchableSelect') ? selectComponent : name.includes('governmentIds') ? rules : name.includes('useRealtimeRefresh') ? { useRealtimeRefresh() {} } : identities,
    defineEmits: () => () => {},
    $fetch: async (url, options) => { if (url.endsWith('/recognize')) return { type: 'SSS', number: '00-1234567-8', message: 'Review the detected number.' }; if (options?.method) requests.push(options); return { employees: [] } },
    FileReader: class { readAsDataURL(file) { this.result = file.dataUrl; this.onload() } },
  }))
  try {
    state.activeEmployeeId.value = '1'
    state.form.value = { EmployeeID: 1, GovernmentNumber: '' }
    state.governmentKind.value = 'SSS'
    await state.save('government')
    assert.equal(requests.length, 0, 'Invalid ID cannot be submitted')
    state.inputGovernmentNumber({ target: { value: '0012345678' } })
    assert.equal(state.form.value.GovernmentNumber, '00-1234567-8')
    await state.chooseGovernmentScan({ target: { files: [{ name: 'Front ID.png', type: 'image/png', size: png.length, dataUrl: upload.AttachmentDataUrl }] } })
    await state.save('government')
    assert.equal(requests.length, 1)
    assert.equal(requests[0].body.GovernmentType, 'SSS')
    assert.equal(requests[0].body.AttachmentDataUrl, upload.AttachmentDataUrl)
    state.editingId.value = 1
    state.form.value = { EmployeeID: 1, GovernmentType: 'Pag-IBIG', GovernmentNumber: 'ABC-123', HasAttachment: 1, AttachmentUrl: '/private/scan' }
    state.resetGovernmentForm(state.form.value)
    assert.equal(state.governmentKind.value, 'Other')
    assert.equal(state.otherGovernmentName.value, 'Pag-IBIG')
    await state.save('government')
    assert.equal(requests[1].method, 'PUT')
    assert.equal(requests[1].body.AttachmentDataUrl, null)
    assert.equal(requests[1].body.RemoveAttachment, false)
    state.changeGovernmentKind()
    assert.equal(state.form.value.GovernmentNumber, '')
    await state.chooseGovernmentScan({ target: { files: [{ name: 'fake.svg', type: 'image/svg+xml', size: 20 }] } })
    assert.ok(state.scanError.value)
  } finally { scope.stop() }
})

test('rendered Government ID form and cards include dynamic hints and private scan viewing', async () => {
  const source = fs.readFileSync('app/pages/employees/documents/index.vue', 'utf8')
  async function render(kind, number, formOpen) {
    const { compileScript } = require('@vue/compiler-sfc')
    const prepared = source.replace('const employee = ref<any>(null)', "const employee = ref<any>({EmployeeID:1,FirstName:'Test',LastName:'Employee'})")
      .replace('const detailOpen = ref(false)', 'const detailOpen = ref(true)')
      .replace('const formOpen = ref(false)', `const formOpen = ref(${formOpen})`)
      .replace("const activeSection = ref<SectionKey>('profile')", "const activeSection = ref<SectionKey>('government')")
      .replace("const governmentKind = ref<GovernmentIdType | ''>('')", `const governmentKind = ref<GovernmentIdType | ''>(${JSON.stringify(kind)})`)
      .replace('const form = ref<Record<string, any>>({})', `const form = ref<Record<string, any>>({GovernmentNumber:'${number}'})`)
      .replace('const bundle = ref<any>({})', `const bundle = ref<any>({government:[{GovernmentID:1,GovernmentType:'SSS',GovernmentNumber:'0012345678',AttachmentUrl:'/api/employees/documents/government/1/attachment',AttachmentName:'Test scan.png',AttachmentMimeType:'image/png',AttachmentSize:100}]})`)
    const { descriptor } = parse(prepared)
    const script = compileScript(descriptor, { id: 'government-ids', inlineTemplate: true })
    const component = evaluate(script.content, { require: name => name === 'vue' ? vue : name.includes('SearchableSelect') ? selectComponent : name.includes('governmentIds') ? rules : name.includes('useRealtimeRefresh') ? { useRealtimeRefresh() {} } : identities })
    const context = {}
    await require('@vue/server-renderer').renderToString(vue.createSSRApp(component.default), context)
    return context.teleports.body
  }
  const sss = await render('SSS', '00-1234567-8', true)
  assert.ok(sss.includes('10 digits, displayed as 12-3456789-0.'))
  assert.ok(sss.includes('type="file"'))
  assert.ok(sss.includes('role="combobox"'))
  assert.ok(sss.includes('Browse files'))
  assert.ok(!sss.includes('<select'))
  assert.ok(sss.includes('View scan'))
  assert.ok(sss.includes('src="/api/employees/documents/government/1/attachment"'))
  const other = await render('Other', 'ABC-123', true)
  assert.ok(other.includes('Other ID name'))
  assert.ok(other.includes('No fixed mask.'))
  const driver = await render("Driver's License", 'N01-23-123456', true)
  assert.ok(driver.includes('N01-23-123456'))
})

test('private scan CRUD, authorization, duplicates, replacement, rollback, and removal use isolated records and files', {
  skip: process.env.GOVERNMENT_ID_TEST_DATABASE !== '1',
}, async () => {
  const root = path.resolve('.data')
  fs.mkdirSync(root, { recursive: true })
  const storage = fs.mkdtempSync(path.join(root, 'government-id-test-'))
  const previousStorage = process.env.GOVERNMENT_ID_STORAGE_DIR
  process.env.GOVERNMENT_ID_STORAGE_DIR = storage
  const db = await require('mysql2/promise').createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME })
  try {
    await db.query('CREATE TEMPORARY TABLE employee (EmployeeID INT PRIMARY KEY)')
    const [[definition]] = await db.query('SHOW CREATE TABLE government')
    await db.query(definition['Create Table'].replace(/^CREATE TABLE/, 'CREATE TEMPORARY TABLE').split('\n').filter(line => !/^\s*CONSTRAINT/.test(line)).join('\n').replace(/,\s*\n\)/g, '\n)'))
    await db.query('INSERT INTO employee (EmployeeID) VALUES (1),(2)')
    let failAttachmentUpdate = false
    const connection = { execute: (sql, args) => {
      if (failAttachmentUpdate && sql.startsWith('UPDATE government SET AttachmentPath=')) throw Error('Simulated write failure')
      return db.execute(sql, args)
    }, beginTransaction: () => db.beginTransaction(), commit: () => db.commit(), rollback: () => db.rollback(), release() {} }
    const api = loadApi({ execute: connection.execute, getConnection: async () => connection })
    const body = { employeeId: 1, GovernmentType: 'SSS', GovernmentNumber: '0012345678', ...upload }
    await assert.rejects(() => api.saveGovernmentId({ session: { sub: 1, userType: 'Viewer' } }, 'create', body), error => error.statusCode === 403)
    await assert.rejects(() => api.saveGovernmentId({ context: { moduleCanEdit: false } }, 'create', body), error => error.statusCode === 403)
    const created = await api.saveGovernmentId({}, 'create', body)
    const id = created.id
    await assert.rejects(() => api.saveGovernmentId({}, 'create', { ...body, employeeId: 2, GovernmentNumber: '00 1234567 8', AttachmentDataUrl: null }), error => error.statusCode === 409 && error.message.includes('EMP-0001'))
    await assert.rejects(() => db.execute('INSERT INTO government (EmployeeID,GovernmentType,GovernmentNumber) VALUES (?,?,?)', [2,'sss','0012345678']), error => error.code === 'ER_DUP_ENTRY', 'The database also blocks a duplicate when application checks are bypassed')
    const beforeConflictFiles = fs.readdirSync(storage)
    await assert.rejects(() => api.saveGovernmentId({}, 'create', { ...body, employeeId: 2, GovernmentNumber: '98-7654321-0', AttachmentName: 'Different filename.png' }), error => error.statusCode === 409 && error.message.includes('exact ID scan'))
    assert.deepEqual(fs.readdirSync(storage), beforeConflictFiles, 'Rejected duplicates must not create a new file')
    const other = await api.saveGovernmentId({}, 'create', { employeeId: 2, GovernmentType: 'SSS', GovernmentNumber: '98-7654321-0' })
    await assert.rejects(() => api.saveGovernmentId({}, 'update', { employeeId: 2, id: other.id, GovernmentType: 'SSS', GovernmentNumber: '0012345678' }), error => error.statusCode === 409)
    assert.equal((await api.listGovernmentIds(2))[0].GovernmentNumber, '98-7654321-0', 'Rejected update retains the original ID')
    await api.saveGovernmentId({}, 'delete', { employeeId: 2, id: other.id })
    const items = await api.listGovernmentIds(1)
    assert.equal(items.length, 1); assert.equal(items[0].GovernmentNumber, '00-1234567-8')
    assert.ok(items[0].AttachmentUrl.endsWith('/attachment'))
    assert.equal(items[0].AttachmentPath, undefined, 'List response must not reveal disk paths')
    const get = { params: { id: String(id) } }
    assert.deepEqual(await api.governmentIdAttachment(get), png)
    assert.equal(get.headers['Content-Type'], 'image/png')
    assert.equal(get.headers['Cache-Control'], 'private, no-store')
    await assert.rejects(() => api.governmentIdAttachment({ ...get, anonymous: true }), error => error.statusCode === 401)
    await assert.rejects(() => api.saveGovernmentId({}, 'create', { ...body, GovernmentNumber: '00-1234567-8' }), error => error.statusCode === 409)
    await assert.rejects(() => api.saveGovernmentId({}, 'update', { ...body, id, employeeId: 2 }), error => error.statusCode === 404)
    const originalFiles = fs.readdirSync(storage)
    failAttachmentUpdate = true
    await assert.rejects(() => api.saveGovernmentId({}, 'update', { ...body, id }), /Simulated write failure/)
    failAttachmentUpdate = false
    assert.deepEqual(fs.readdirSync(storage), originalFiles)
    assert.deepEqual(await api.governmentIdAttachment(get), png)
    const pdf = Buffer.from('%PDF-1.4\nTest scan reference\n%%EOF')
    await api.saveGovernmentId({}, 'update', { ...body, id, AttachmentDataUrl: 'data:application/pdf;base64,' + pdf.toString('base64'), AttachmentName: 'Reference.pdf' })
    assert.equal(fs.readdirSync(storage).length, 1)
    assert.deepEqual(await api.governmentIdAttachment(get), pdf)
    await api.saveGovernmentId({}, 'update', { employeeId: 1, id, GovernmentType: 'SSS', GovernmentNumber: '0012345678' })
    assert.deepEqual(await api.governmentIdAttachment(get), pdf, 'An unchanged attachment is retained')
    await api.saveGovernmentId({}, 'update', { employeeId: 1, id, GovernmentType: 'SSS', GovernmentNumber: '0012345678', RemoveAttachment: true })
    assert.equal(fs.readdirSync(storage).length, 0)
    await assert.rejects(() => api.governmentIdAttachment(get), error => error.statusCode === 404)
    await api.saveGovernmentId({}, 'update', { ...body, id })
    await api.saveGovernmentId({}, 'delete', { employeeId: 1, id })
    assert.equal((await api.listGovernmentIds(1)).length, 0)
    assert.equal(fs.readdirSync(storage).length, 0)
    const firstDriver = await api.saveGovernmentId({}, 'create', { employeeId: 1, GovernmentType: "Driver's License", GovernmentNumber: 'N01-23-123456' })
    const secondDriver = await api.saveGovernmentId({}, 'create', { employeeId: 1, GovernmentType: "Driver's License", GovernmentNumber: 'A01-23-123456' })
    assert.notEqual(firstDriver.id, secondDriver.id, 'License prefixes are part of the identifier and cannot be discarded')
    await api.saveGovernmentId({}, 'update', { employeeId: 1, id: firstDriver.id, GovernmentType: "Driver's License", GovernmentNumber: 'N01-23-123456', ...upload })
    await api.checkGovernmentDuplicate(1, firstDriver.id, 'Drivers License', 'N0123123456', api.parseGovernmentAttachment(upload).hash)
    await assert.rejects(() => api.checkGovernmentDuplicate(2, 0, 'Drivers License','N0123123456'), error => error.statusCode === 409)
    await assert.rejects(() => api.saveGovernmentId({}, 'create', { employeeId: 2, GovernmentType: 'Passport', GovernmentNumber: 'ABC-9876', ...upload }), error => error.statusCode === 409)
    const [[scanRow]] = await db.execute('SELECT AttachmentSHA256 FROM government WHERE GovernmentID=?',[firstDriver.id])
    await assert.rejects(() => db.execute('INSERT INTO government (EmployeeID,GovernmentType,GovernmentNumber,AttachmentSHA256) VALUES (?,?,?,?)',[2,'Passport','ABC-9876',scanRow.AttachmentSHA256]), error=>error.code==='ER_DUP_ENTRY')
    await assert.rejects(() => db.execute('INSERT INTO government (EmployeeID,GovernmentType,GovernmentNumber) VALUES (?,?,?)',[2,'Drivers License','N0123123456']), error=>error.code==='ER_DUP_ENTRY')
    await api.saveGovernmentId({}, 'create', { employeeId: 1, GovernmentType: 'TIN', GovernmentNumber: '123-456-789' })
    await assert.rejects(() => api.saveGovernmentId({}, 'create', { employeeId: 2, GovernmentType: 'TIN', GovernmentNumber: '123-456-789-00001' }),error=>error.statusCode===409)
    await assert.rejects(() => db.execute('INSERT INTO government (EmployeeID,GovernmentType,GovernmentNumber) VALUES (?,?,?)',[2,'TIN','123-456-789-00000']),error=>error.code==='ER_DUP_ENTRY')
    // The same numeral in distinct custom ID namespaces is not a duplicate.
    await api.saveGovernmentId({}, 'create', { employeeId: 1, GovernmentType: 'Example A', GovernmentNumber: 'ABC-9876' })
    await api.saveGovernmentId({}, 'create', { employeeId: 2, GovernmentType: 'Example B', GovernmentNumber: 'ABC-9876' })
  } finally {
    await db.end()
    if (previousStorage == null) delete process.env.GOVERNMENT_ID_STORAGE_DIR; else process.env.GOVERNMENT_ID_STORAGE_DIR = previousStorage
    if (!storage.startsWith(root + path.sep + 'government-id-test-')) throw Error('Unexpected test storage path; refusing cleanup')
    fs.rmSync(storage, { recursive: true, force: true })
  }
})
