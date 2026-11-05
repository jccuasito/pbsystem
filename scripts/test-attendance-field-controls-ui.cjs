const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { parse, compileScript } = require('@vue/compiler-sfc')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')
const root = path.resolve(__dirname, '..')
const filename = path.join(root, 'app/components/DtrAttendanceWorkspace.vue')
const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
const script = compileScript(descriptor, { id: 'attendance-field-controls', inlineTemplate: true }).content
const source = "import {ref,computed,watch,onMounted,onUnmounted,nextTick,reactive} from 'vue';\n" + script.replace("import SystemAlert from '../../components/alertmessage/SystemAlert.vue'", "const SystemAlert={render(){return null}}") + "\nimport {createApp} from 'vue';createApp(__default__,{dtr:window.fixture.batch}).mount('#app');"
// Compile a real SFC, with only the notification component stubbed.
const entry = source.replace('export default ', 'const __default__ = ')
const bundle = buildSync({ stdin: { contents: entry, loader: 'ts', resolveDir: path.dirname(filename) }, bundle: true, write: false, platform: 'browser', format: 'iife', alias: { '~~': root }, define: { 'process.env.NODE_ENV': '"production"' } }).outputFiles[0].text
// Dashboard imports many pages whose unscoped CSS also reaches this modal.
function dashboardStyles(file, seen = new Set()) {
  if (seen.has(file) || !fs.existsSync(file)) return ''
  seen.add(file)
  const source = fs.readFileSync(file, 'utf8')
  const parsed = parse(source, { filename: file }).descriptor
  let css = file === filename ? '' : parsed.styles.filter(style => !style.scoped).map(style => style.content).join('\n')
  for (const match of source.matchAll(/from\s+['"]([^'"]+\.vue)['"]/g)) {
    const target = match[1].startsWith('~~/') ? path.join(root, match[1].slice(3)) : path.resolve(path.dirname(file), match[1])
    css += '\n' + dashboardStyles(target, seen)
  }
  return css
}
const appStyles = ['base','theme','components','auth','dashboard','payroll-processing'].map(name => fs.readFileSync(path.join(root, 'assets/css/' + name + '.css'), 'utf8')).join('\n') + '\n' + dashboardStyles(path.join(root, 'app/pages/dashboard/index.vue'))
const fixture = {
  batch: { BatchID: 91, AgencyID: 1, AgencyName: 'Test Agency', ClientName: 'Test Client', SiteName: 'Test Site', PeriodStart: '2026-09-01', PeriodEnd: '2026-09-15', Status: 'Draft' },
  records: [{ EmployeeID: 1, EmployeeName: 'Test Encoder', EmployeeNumber: 'EMP-1', DeploymentType: 'Regular', PositionName: 'Security Guard' }],
  attendanceRows: [{ EmployeeID: 1, AttendanceDate: '2026-09-01', AttendanceStatus: 'Present', ShiftCodeID: 7, TimeIn: '2026-09-01 07:00', TimeOut: '2026-09-01 19:00', RegularHours: 8, OTHours: 4, OTExtHours: 0, BreakHours: 0, LateHours: 0, UndertimeHours: 0 }],
  shifts: [{ ShiftCodeID: 7, ShiftCode: 'DS0700-1900', ShiftName: 'Day', ShiftType: 'DS', TimeIn: '07:00', TimeOut: '19:00', RegularHours: 8, RegularOTCap: 4 }],
  policy: { DayShiftNDEnabled: 0, AutoBreakEnabled: 0, DefaultBreakMinutes: 0, AttendanceEditableFields: [] },
}
;(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PORTAL_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport })
      const errors = []; page.on('pageerror', error => errors.push(error.message))
      await page.setContent('<html><head><style>body{margin:0;font-family:Arial}*{box-sizing:border-box}' + descriptor.styles.map(style => style.content).join('\n') + appStyles + '</style></head><body><div id="app"></div></body></html>')
      await page.evaluate(data => {
        window.fixture = data; window.requests = []
        window.$fetch = async (url, options) => {
          if (options) window.requests.push({ url, ...options })
          if (options?.body?.FieldControlsOnly) data.policy.AttendanceEditableFields = options.body.AttendanceEditableFields
          if (options?.method === 'POST') data.attendanceRows = [{ ...data.attendanceRows[0], ...options.body }]
          return JSON.parse(JSON.stringify(data))
        }
      }, fixture)
      await page.addScriptTag({ content: bundle })
      await page.getByRole('button', { name: 'Site policy settings', exact: true }).click()
      await page.getByRole('tab', { name: 'Field controls' }).click()
      const settings = page.getByRole('dialog', { name: 'Site attendance settings' })
      assert.equal(await settings.getByRole('switch').count(), 17)
      await settings.getByRole('switch', { name: 'Night differential', exact: true }).click()
      assert.equal(await settings.getByRole('switch', { name: 'Night differential', exact: true }).getAttribute('aria-checked'), 'true')
      const geometry = await settings.evaluate(dialog => {
        const row = dialog.querySelector('.attendance-field-row'), track = row.querySelector('.attendance-field-toggle'), name = row.querySelector('.attendance-field-name')
        const r = track.getBoundingClientRect(), label = name.getBoundingClientRect()
        return { trackWidth: r.width, trackHeight: r.height, labelWidth: label.width, bodyOverflow: dialog.scrollWidth > dialog.clientWidth }
      })
      assert.equal(geometry.trackWidth, 32); assert.equal(geometry.trackHeight, 18)
      assert.ok(geometry.labelWidth > 120, JSON.stringify(geometry)); assert.equal(geometry.bodyOverflow, false)
      const save = settings.getByRole('button', { name: 'Save field controls' })
      await save.scrollIntoViewIfNeeded()
      assert.ok(await save.isVisible())
      await page.screenshot({ path: path.join(root, '.data/attendance-field-settings-' + viewport.width + '.png'), fullPage: true })
      assert.ok(await settings.getByRole('heading', { name: 'Site attendance settings' }).isVisible())
      await save.click()
      await page.getByRole('button', { name: /^Edit attendance for Test Encoder/ }).click()
      const form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Attendance input', exact: true }) })
      const nd = form.getByRole('spinbutton', { name: 'Night differential', exact: true })
      assert.equal(await nd.getAttribute('readonly'), null)
      assert.notEqual(await form.getByRole('spinbutton', { name: 'Regular hours', exact: true }).getAttribute('readonly'), null)
      await nd.fill('3'); await nd.press('Tab')
      await form.getByText('Time preview', { exact: true }).waitFor()
      assert.match(await form.locator('.attendance-time-preview').innerText(), /Time in: September 1, 2026 .* 7:00 AM/)
      assert.match(await form.locator('.attendance-time-preview').innerText(), /Time out: September 2, 2026 .* 1:00 AM/)
      assert.equal(await form.locator('input[placeholder="YYYY-MM-DD HH:mm"]').first().inputValue(), '2026-09-01 07:00')
      const saveDay = form.getByRole('button', { name: 'Save attendance' })
      await saveDay.scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(root, '.data/attendance-field-controls-' + viewport.width + '.png'), fullPage: true })
      await saveDay.click()
      const requests = await page.evaluate(() => window.requests)
      assert.equal(requests[0].body.FieldControlsOnly, true)
      assert.deepEqual(requests[0].body.AttendanceEditableFields, ['NightDiffHours'])
      assert.equal(requests[1].body.ManualFieldOverrides.NightDiffHours, 3)
      await page.getByRole('button', { name: /^Edit attendance for Test Encoder/ }).click()
      assert.equal(await form.getByRole('spinbutton', { name: 'Night differential', exact: true }).inputValue(), '3')
      await form.locator('input[placeholder="YYYY-MM-DD HH:mm"]').last().fill('2026-09-01 19:00')
      await form.locator('input[placeholder="YYYY-MM-DD HH:mm"]').last().dispatchEvent('input')
      assert.ok(await form.getByRole('button', { name: 'Save attendance' }).isDisabled())
      assert.match(await form.getByRole('alert').innerText(), /Night differential/)
      await form.getByRole('button', { name: 'Use automatic' }).click()
      assert.equal(await nd.inputValue(), '0')
      assert.equal(await form.getByRole('button', { name: 'Save attendance' }).isDisabled(), false)
      await form.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.evaluate(() => Object.assign(window.fixture.attendanceRows[0], { TimeIn:'2026-09-01 07:00', TimeOut:'2026-09-01 19:00', RegularHours:8, OTHours:4, OTExtHours:0, NightDiffHours:0, LateHours:0, UndertimeHours:0, ManualFieldOverrides:{} }))
      await page.getByRole('button', { name: 'Site policy settings', exact: true }).click()
      await page.getByRole('tab', { name: 'Field controls' }).click()
      for (const name of ['Regular OT', 'OT extension', 'Late minutes', 'Undertime minutes']) await settings.getByRole('switch', { name, exact: true }).click()
      await settings.getByRole('button', { name: 'Save field controls' }).click()
      await page.getByRole('button', { name: /^Edit attendance for Test Encoder/ }).click()
      await form.getByRole('spinbutton', { name:'Regular OT', exact:true }).fill('5.6')
      await form.getByRole('spinbutton', { name:'Regular OT', exact:true }).press('Tab')
      await form.getByRole('spinbutton', { name:'Undertime (minutes)', exact:true }).fill('60')
      assert.equal(await form.getByRole('spinbutton', { name:'Regular hours', exact:true }).inputValue(), '8')
      assert.equal(await form.getByRole('spinbutton', { name:'Regular OT', exact:true }).inputValue(), '5.6')
      assert.match(await form.locator('.attendance-time-preview').innerText(), /7:36 PM/)
      await form.getByRole('spinbutton', { name:'Late (minutes)', exact:true }).fill('60')
      assert.equal(await form.locator('input[placeholder="YYYY-MM-DD HH:mm"]').first().inputValue(), '2026-09-01 08:00')
      assert.equal(await form.locator('input[placeholder="YYYY-MM-DD HH:mm"]').last().inputValue(), '2026-09-01 19:36')
      assert.equal(await form.getByRole('spinbutton', { name:'Regular OT', exact:true }).inputValue(), '5.6')
      await form.getByRole('button', { name:'Save attendance' }).click()
      const finalPayload = await page.evaluate(() => window.requests.filter(request => request.method==='POST').at(-1).body)
      assert.equal(finalPayload.RegularHours,8); assert.equal(finalPayload.OTHours,5.6); assert.equal(finalPayload.UndertimeHours,1); assert.equal(finalPayload.LateHours,1); assert.equal(finalPayload.TimeIn,'2026-09-01 08:00')
      assert.deepEqual(errors, [])
      console.log('PASS: field settings, overnight preview, save and reload at ' + viewport.width + 'px (mock API, no real data writes)')
      await page.close()
    }
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })

