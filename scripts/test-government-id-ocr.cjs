const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { transformSync } = require('esbuild')
const { parse } = require('@vue/compiler-sfc')
const vue = require('vue')
function evaluate(file, globals = {}) {
  const module = { exports: {} }
  const source = fs.readFileSync(file, 'utf8')
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, { module, Buffer, process, ...globals })
  return module.exports
}
const rules = evaluate('shared/utils/governmentIds.ts')
const parser = evaluate('shared/utils/governmentIdOcr.ts', { require: () => rules })
const h3 = { readBody: async e => e.body, createError: details => Object.assign(new Error(details.statusMessage), details) }
const auth = { requireSession: e => { if (e.anonymous) throw h3.createError({ statusCode: 401, statusMessage: 'Please sign in.' }); return e.session || { sub: 1, userType: 'Admin' } } }
const attachments = evaluate('server/utils/governmentIdCrud.ts', { require: name => name === 'h3' ? h3 : name.includes('governmentIds') ? rules : name.includes('dbconnect') ? {} : name.endsWith('/auth') ? auth : require(name) })
function backend(childProcess = { execFile }, duplicateCheck = attachments.checkGovernmentDuplicate) {
  return evaluate('server/utils/governmentIdOcr.ts', { require: name => name === 'h3' ? h3 : name === 'node:child_process' ? childProcess : name.endsWith('/auth') ? auth : name.includes('governmentIdCrud') ? { ...attachments, checkGovernmentDuplicate: duplicateCheck } : name.includes('shared/utils/governmentIdOcr') ? parser : name.includes('governmentIds') ? rules : require(name) })
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=', 'base64')
const body = { AttachmentDataUrl: 'data:image/png;base64,' + png.toString('base64'), AttachmentName: 'Synthetic.png' }

test('OCR finds known ID types and validated numbers without confusing private PSN with PCN', () => {
  for (const [text, type, number] of [
    ['PHILSYS\nPCN: 1234 5678 9012 3456', 'PhilSys / National ID', '1234567890123456'],
    ['SOCIAL SECURITY SYSTEM\nSS NUMBER: 12-3456789-0', 'SSS', '12-3456789-0'],
    ['PHILHEALTH\nPIN: 001234567890', 'PhilHealth', '00-123456789-0'],
    ['BUREAU OF INTERNAL REVENUE\nTIN: 001-234-567-00000', 'TIN', '001-234-567-00000'],
    ["LAND TRANSPORTATION OFFICE\nDRIVER'S LICENSE\nLICENSE NO: N01-23-123456", "Driver's License", 'N01-23-123456'],
  ]) {
    const result = parser.extractGovernmentId(text)
    assert.equal(result.type, type); assert.equal(result.number, number); assert.equal(result.needsReview, true)
  }
  assert.equal(parser.extractGovernmentId('PHILSYS\nPSN: 123456789012').number, null)
  assert.equal(parser.extractGovernmentId('Unreadable image 12345').number, null)
})

test('ambiguous or multiple IDs are left for manual review', () => {
  assert.equal(parser.extractGovernmentId('SSS\nSS NO: 12-3456789-0\nSS NO: 98-7654321-0').number, null)
  assert.equal(parser.extractGovernmentId('SSS\n12-3456789-0\nPHILHEALTH\n12-345678901-2').type, null)
  assert.equal(parser.extractGovernmentId('12-3456789-0', 'SSS').number, '12-3456789-0')
})

test('local OCR endpoint checks access and cleans its temporary input on success and failure', { skip: process.platform !== 'win32' }, async () => {
  const files = []
  const api = backend({ execFile: (binary, args, options, done) => {
    assert.equal(binary.endsWith('powershell.exe'), true)
    assert.equal(options.windowsHide, true)
    files.push(args.at(-1))
    done(null, JSON.stringify({ text: 'SSS\n12-3456789-0', pages: 1 }))
  } })
  await assert.rejects(() => api.recognizeGovernmentId({ anonymous: true, body }), error => error.statusCode === 401)
  await assert.rejects(() => api.recognizeGovernmentId({ session: { sub: 1, userType: 'Viewer' }, body }), error => error.statusCode === 403)
  await assert.rejects(() => api.recognizeGovernmentId({ body: {} }), error => error.statusCode === 400)
  const result = await api.recognizeGovernmentId({ body })
  assert.equal(result.number, '12-3456789-0'); assert.equal(result.local, true)
  assert.equal('text' in result, false, 'Raw OCR text is not returned or stored as an employee record')
  assert.equal(fs.existsSync(path.dirname(files[0])), false)
  let failedFile
  const failing = backend({ execFile: (binary, args, options, done) => { failedFile = args.at(-1); done(Error('Test engine failure')) } })
  await assert.rejects(() => failing.recognizeGovernmentId({ body }), error => error.statusCode === 422)
  assert.equal(fs.existsSync(path.dirname(failedFile)), false)
})

test('auto-fill populates blank fields but keeps manual entries and ignores a cleared scan', async () => {
  const scope = vue.effectScope(), pending = []
  const source = parse(fs.readFileSync('app/pages/employees/documents/index.vue', 'utf8')).descriptor.scriptSetup.content
  const module = { exports: {} }
  scope.run(() => vm.runInNewContext(transformSync(source + '\nmodule.exports={governmentKind,form,scanDataUrl,scanName,scanResult,recognizeScan,useDetectedDetails,clearNewScan,changeDocumentSection,activeSection};', { loader: 'ts', format: 'cjs' }).code, {
    module, AbortController, defineEmits: () => () => {},
    require: name => name === 'vue' ? { ...vue, onMounted() {} } : name.includes('governmentIds') ? rules : name.includes('useRealtimeRefresh') ? { useRealtimeRefresh() {} } : {},
    $fetch: () => new Promise(resolve => pending.push(resolve)),
  }))
  try {
    const state = module.exports
    state.scanDataUrl.value = body.AttachmentDataUrl
    let reading = state.recognizeScan()
    pending.shift()({ type: 'SSS', number: '12-3456789-0', message: 'Check result' })
    await reading
    assert.equal(state.governmentKind.value, 'SSS'); assert.equal(state.form.value.GovernmentNumber, '12-3456789-0')
    reading = state.recognizeScan()
    state.form.value.GovernmentNumber = '98-7654321-0'
    pending.shift()({ type: 'SSS', number: '12-3456789-0', message: 'Check result' })
    await reading
    assert.equal(state.form.value.GovernmentNumber, '98-7654321-0')
    state.useDetectedDetails(true)
    assert.equal(state.form.value.GovernmentNumber, '12-3456789-0')
    reading = state.recognizeScan()
    state.clearNewScan()
    pending.shift()({ type: 'TIN', number: '123-456-789', message: 'Old request' })
    await reading
    assert.equal(state.governmentKind.value, 'SSS', 'Old OCR response cannot change a cleared/replaced scan')
    const section = state.activeSection.value
    state.changeDocumentSection('')
    assert.equal(state.activeSection.value, section, 'Searching a dropdown cannot reset the form to an invalid section')
  } finally { scope.stop() }
})

test('OCR rejects an existing scan before recognition and a re-scanned existing number after recognition', { skip: process.platform !== 'win32' }, async () => {
  let reads = 0, directory
  const processMock = { execFile: (binary,args,options,done)=>{ reads++; directory=path.dirname(args.at(-1)); done(null,JSON.stringify({text:'SSS\n12-3456789-0',pages:1})) } }
  const checks=[]
  const duplicate = () => h3.createError({statusCode:409,statusMessage:'Already saved for EMP-0001.'})
  const exact = backend(processMock, async (...args)=>{ checks.push(args); throw duplicate() })
  await assert.rejects(()=>exact.recognizeGovernmentId({body:{...body,employeeId:2}}),error=>error.statusCode===409)
  assert.equal(reads,0,'A byte-identical duplicate never needs OCR')
  assert.equal(checks[0][4].length,64,'Scan fingerprint is computed from bytes on the server')
  const rescanned = backend(processMock, async (employee,id,type)=>{ if(type) throw duplicate() })
  await assert.rejects(()=>rescanned.recognizeGovernmentId({body:{...body,employeeId:2}}),error=>error.statusCode===409)
  assert.equal(reads,1)
  assert.equal(fs.existsSync(directory),false,'Duplicate detection still cleans the OCR input')
})

test('a duplicate scan warning blocks form saving until that scan is removed', async () => {
  const scope=vue.effectScope(), writes=[]
  const source=parse(fs.readFileSync('app/pages/employees/documents/index.vue','utf8')).descriptor.scriptSetup.content
  const module={exports:{}}
  scope.run(()=>vm.runInNewContext(transformSync(source+'\nmodule.exports={form,governmentKind,activeEmployeeId,scanDataUrl,scanError,recognizeScan,clearNewScan,save};',{loader:'ts',format:'cjs'}).code,{
    module,AbortController,defineEmits:()=>()=>{},
    require:name=>name==='vue'?{...vue,onMounted(){}}:name.includes('governmentIds')?rules:name.includes('useRealtimeRefresh')?{useRealtimeRefresh(){}}:{},
    $fetch:async(url,options)=>{if(url.endsWith('/recognize'))throw {status:409,data:{statusMessage:'This ID is already saved for EMP-0001.'}};writes.push(options);return {}},
  }))
  try {
    const state=module.exports
    state.activeEmployeeId.value='2';state.governmentKind.value='SSS';state.form.value={GovernmentNumber:'98-7654321-0'};state.scanDataUrl.value=body.AttachmentDataUrl
    await state.recognizeScan()
    assert.match(state.scanError.value,/EMP-0001/)
    await state.save('government')
    assert.equal(writes.length,0)
    state.clearNewScan()
    assert.equal(state.scanError.value,'')
  } finally {scope.stop()}
})

test('installed Windows OCR reads a synthetic image and a synthetic PDF locally', {
  skip: process.platform !== 'win32' || process.env.GOVERNMENT_OCR_TEST_WINDOWS !== '1',
}, async () => {
  const root = path.resolve('.data')
  const directory = fs.mkdtempSync(path.join(root, 'ocr-native-test-'))
  try {
    const image = path.join(directory, 'synthetic.png')
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    await promisify(execFile)(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts/test-fixtures/create-id-ocr-sample.ps1'), '-OutputPath', image], { windowsHide: true })
    const content = 'BT /F1 26 Tf 40 240 Td (SOCIAL SECURITY SYSTEM) Tj 0 -55 Td (SS NUMBER: 12-3456789-0) Tj 0 -55 Td (SYNTHETIC TEST ONLY) Tj ET'
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 650 350] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`]
    let pdf = '%PDF-1.4\n', offsets = []
    for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n` }
    const xref = Buffer.byteLength(pdf)
    pdf += `xref\n0 6\n0000000000 65535 f \n` + offsets.map(x => String(x).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    const api = backend()
    for (const [mime, data] of [['image/png', fs.readFileSync(image)], ['application/pdf', Buffer.from(pdf)]]) {
      const result = await api.recognizeGovernmentId({ body: { AttachmentDataUrl: `data:${mime};base64,${data.toString('base64')}`, AttachmentName: 'Synthetic test' } })
      assert.equal(result.type, 'SSS'); assert.equal(result.number, '12-3456789-0'); assert.equal(result.local, true)
    }
  } finally {
    if (!directory.startsWith(root + path.sep + 'ocr-native-test-')) throw Error('Unexpected fixture path')
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
