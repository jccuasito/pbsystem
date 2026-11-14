// Synthetic browser QA; never signs in to real accounts or writes payroll data.
// THEME_BROWSER_TEST=1 NODE_PATH=<Playwright modules> node scripts/test-theme-ui.cjs
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const sfc = require('@vue/compiler-sfc'), esbuild = require('esbuild')
const root = path.resolve(__dirname, '..')

async function fixture() {
  const styles = ['base', 'theme', 'components', 'auth', 'dashboard', 'payroll-processing'].map(name => fs.readFileSync(path.join(root, 'assets/css', name + '.css'), 'utf8'))
  const result = await esbuild.build({
    stdin: { resolveDir: root, loader: 'ts', contents: `
      import {createApp,h,ref,watchEffect} from 'vue';
      import {provideAppTheme} from './app/composables/useAppTheme';
      import Progress from './app/components/PayrollRunProgress.vue';
      import Result from './app/components/DtrImportResultModal.vue';
      import Portal from './app/pages/employee-portal/index.vue';
      import DateField from './components/ModernDateField.vue';
      import TimeField from './components/ModernTimeField.vue';
      import CompactDtr from './app/components/DtrCompactPrintView.vue';
      import Btr from './app/components/DtrBtrModal.vue';
      const app=createApp({setup(){
        const {isDark,toggleTheme}=provideAppTheme(),scene=ref('workspace'),result=ref(null);
        window.themeTest={scene,result,toggleTheme};
        watchEffect(()=>document.documentElement.dataset.theme=isDark.value?'dark':'light');
        const dtr=window.themeDtrFixture;
        const renderDtr=()=>h('div',{class:'page dash-page','data-theme':isDark.value?'dark':'light'},h('div',{class:'dash-workspace-page'},scene.value==='compact'?h(CompactDtr,{data:dtr}):h(Btr,{dtr:dtr.batch})));
        const renderPortal=()=>h(Portal);
        return()=>scene.value==='portal'?renderPortal():['compact','btr'].includes(scene.value)?renderDtr():h('div',{class:'page dash-page','data-theme':isDark.value?'dark':'light'},[
          h('button',{onClick:toggleTheme},'Toggle theme'),h(Progress),
          h('div',{class:'dash-workspace-page'},[h(DateField,{modelValue:'2026-12-25',label:'Holiday date'}),h(TimeField,{modelValue:'07:00',label:'Time in'})]),
          h('button',{onClick:()=>result.value={imported:2,updated:1,skipped:1,blank:3,issues:[{row:21,reason:'Shift code TEST is missing.'}]}},'Show import result'),
          h(Result,{result:result.value,fileName:'test.xlsx',onClose:()=>result.value=null})]);
      }});
      app.component('NuxtLink',{props:['to'],setup:(p,{slots})=>()=>h('a',{href:p.to},slots.default?.())});app.mount('#app');
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser',
    alias: { '~~': root, '~': path.join(root, 'app') },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'theme-fixture', setup(build) {
      build.onResolve({ filter: /^#imports$/ }, () => ({ path: 'head', namespace: 'fixture' }))
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const useHead=()=>{};export const onBeforeRouteLeave=()=>{}', loader: 'js' }))
      build.onLoad({ filter: /\.vue$/ }, args => {
        const { descriptor, errors } = sfc.parse(fs.readFileSync(args.path, 'utf8'), { filename: args.path })
        assert.deepEqual(errors, [])
        const id = 'data-v-' + crypto.createHash('sha1').update(args.path).digest('hex').slice(0, 8)
        const script = sfc.compileScript(descriptor, { id, inlineTemplate: true, genDefaultAs: 'Component' })
        for (const style of descriptor.styles) {
          const compiled = sfc.compileStyle({ source: style.content, filename: args.path, id, scoped: style.scoped })
          assert.deepEqual(compiled.errors, [])
          styles.push(compiled.code)
        }
        const autoImports = /Dtr(?:CompactPrintView|BtrModal)\.vue$/.test(args.path) ? "import {ref,computed,onMounted,nextTick} from 'vue';\n" : ''
        return { contents: autoImports + script.content + `;Component.__scopeId='${id}';export default Component`, loader: 'ts', resolveDir: path.dirname(args.path) }
      })
    } }]
  })
  return { script: result.outputFiles[0].text, css: styles.join('\n') }
}

test('theme persists across views; DTR paper stays fixed, BTR adapts, and payslips print', { skip: process.env.THEME_BROWSER_TEST !== '1' }, async () => {
  const { chromium } = require('playwright'), built = await fixture()
  const browser = await chromium.launch({ headless: true, executablePath: process.env.THEME_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' })
    const page = await context.newPage(), errors = []
    page.on('pageerror', e => errors.push(e.message))
    const employee = { EmployeeID: 1, EmployeeNumber: 'TEST-ONLY', EmployeeName: 'TEST EMPLOYEE', AgencyName: 'Test Agency', PositionName: 'Guard', CurrentSites: [] }
    const cutoff = { periodStart: '2026-12-01', periodEnd: '2026-12-15', status: 'Approved', payrollIds: [1], sources: [], gross: 12000, deductions: 1000, net: 11000, lines: [{ section: 'earnings', label: 'Regular', hours: 80, amount: 12000 }] }
    await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div></body></html>' }))
    await page.goto('http://theme.test')
    await page.addStyleTag({ content: built.css })
    await page.evaluate(({ employee, cutoff }) => {
      const batch = { BatchID: 9, AgencyName: 'TEST AGENCY', ClientName: 'Test Client', SiteName: 'Test Site', PeriodStart: '2026-09-16', PeriodEnd: '2026-09-18', Status: 'Draft' }
      const people = [{ EmployeeID: 1, EmployeeName: 'TEST DAY EMPLOYEE', EmployeeNumber: 'TEST-001', PositionName: 'Guard', DefaultShiftCodeID: 1 }, { EmployeeID: 2, EmployeeName: 'TEST NIGHT EMPLOYEE', EmployeeNumber: 'TEST-002', PositionName: 'Guard', DefaultShiftCodeID: 1 }]
      const attendanceRows = [{ EmployeeID: 1, AttendanceDate: '2026-09-16', AttendanceStatus: 'Present', RegularHours: 8, OTHours: 4, ShiftType: 'DAY', ShiftCodeID: 2 }, { EmployeeID: 2, AttendanceDate: '2026-09-16', AttendanceStatus: 'Present', RegularHours: 8, OTHours: 4, ShiftType: 'NIGHT', ShiftCodeID: 3 }, { EmployeeID: 1, AttendanceDate: '2026-09-17', AttendanceStatus: 'Late', RegularHours: 7, LateHours: 1 }]
      window.themeDtrFixture = { batch, records: people, attendanceRows }
      window.$fetch = async (url, options) => {
        if (options?.method && options.method !== 'GET') throw new Error('Theme QA must not write data')
        if (url.endsWith('/btr')) return { batch, employees: people, relievers: people, attendance: attendanceRows.map(row => ({ ...row, HasWork: true })), entries: [{ BTRID: 1, ReplacedEmployeeID: 1, ReplacedEmployeeName: people[0].EmployeeName, RelieverEmployeeID: 2, RelieverEmployeeName: people[1].EmployeeName, AttendanceDate: '2026-09-16', Hours: 1, Revision: 1 }] }
        if (url.endsWith('/payroll-progress')) return { period: { PeriodStart: '2026-12-01', PeriodEnd: '2026-12-15' }, cutoffs: [], companies: [], totals: { Percent: 0, ExpectedSites: 1, CompletedSites: 0, PendingSites: 1, MissingDtrSites: 1, UnconfiguredSites: 0 } }
        if (url.endsWith('/me')) { if (window.portalAnonymous) throw { status: 401 }; return { account: employee } }
        if (url.endsWith('/payslips')) return { payslips: [{ publicationId: 1, postedAt: '2026-12-16T00:00:00Z', employee, cutoff }] }
        return { items: [], canManage: false }
      }
    }, { employee, cutoff })
    await page.addScriptTag({ content: built.script })
    async function assertSurface(selector, dark = true) {
      const rgb = await page.locator(selector).first().evaluate(el => getComputedStyle(el).backgroundColor.match(/\d+/g).slice(0, 3).map(Number))
      assert.ok(dark ? Math.max(...rgb) < 120 : Math.min(...rgb) > 210, `${selector}: ${rgb}`)
    }
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
    await assertSurface('.payroll-run-progress')
    await page.locator('.modern-date-field__trigger').click()
    await assertSurface('.modern-date-field__panel')
    await page.keyboard.press('Escape')
    await page.locator('.modern-time-field__trigger').click()
    await assertSurface('.modern-time-field__panel')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Show import result' }).click()
    await assertSurface('.dtr-import-result')
    await assertSurface('.result-notes')
    assert.equal(await page.locator('dialog').evaluate(el => el.matches(':modal')), true)
    await page.getByRole('button', { name: 'Back to DTR' }).click()
    await page.getByRole('button', { name: 'Toggle theme' }).click()
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
    await assertSurface('.payroll-run-progress', false)
    assert.equal(await page.evaluate(() => localStorage.getItem('dja-theme')), 'light')
    await page.evaluate(() => window.themeTest.scene.value = 'portal')
    await page.locator('.portal-welcome').waitFor()
    await page.getByRole('button', { name: 'Switch to dark mode' }).click()
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
    await assertSurface('.portal-filters')
    await page.getByRole('button', { name: 'View payslip', exact: true }).filter({ visible: true }).click()
    await assertSurface('.payslip-sheet', false)
    await page.emulateMedia({ media: 'print' })
    await assertSurface('.payslip-sheet', false)
    assert.equal(await page.locator('.payslip-sheet').evaluate(el => getComputedStyle(el).visibility), 'visible')
    await page.emulateMedia({ media: 'screen' })

    // Exercise the real paper under the dashboard cascade, not a standalone mock.
    await page.evaluate(() => window.themeTest.scene.value = 'compact')
    const paper = page.locator('.compact-dtr-print-root')
    await paper.waitFor()
    await page.mouse.move(0, 0)
    const readPaperPalette = () => paper.evaluate(el => [...el.querySelectorAll('h1,h2,strong,th,td,small')].map(node => {
      const css = getComputedStyle(node)
      return [css.color, css.backgroundColor, css.borderColor]
    }))
    const darkPaperPalette = await readPaperPalette()
    const darkPaper = await paper.screenshot({ animations: 'disabled' })
    await page.emulateMedia({ media: 'print' })
    const darkPrintPalette = await readPaperPalette()
    assert.equal(await paper.evaluate(el => getComputedStyle(el).visibility), 'visible')
    await page.emulateMedia({ media: 'screen' })
    await page.evaluate(() => window.themeTest.toggleTheme())
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
    assert.deepEqual(await readPaperPalette(), darkPaperPalette, 'All paper text, headers, totals and attendance colors stay identical')
    assert.ok(darkPaper.equals(await paper.screenshot({ animations: 'disabled' })), 'The DTR paper looks identical in light and dark mode')
    await page.emulateMedia({ media: 'print' })
    assert.deepEqual(await readPaperPalette(), darkPrintPalette, 'Print colors are independent of the selected theme')
    await page.emulateMedia({ media: 'screen' })

    await page.evaluate(() => { window.themeTest.toggleTheme(); window.themeTest.scene.value = 'btr' })
    await page.locator('.btr-grid tbody tr').first().waitFor()
    for (const selector of ['.btr-dialog', '.btr-grid thead th', '.btr-grid tbody .btr-grid-total', '.btr-grid tfoot th', '.btr-legend-filled', '.btr-legend-rest']) await assertSurface(selector)
    const coverageColors = await page.locator('.btr-day-portion').evaluateAll(els => els.map(el => getComputedStyle(el).backgroundColor))
    assert.equal(new Set(coverageColors).size, 2, 'BTR and REST use distinct fills in dark mode')
    // Both populated and empty cells, plus sticky totals, need readable text.
    for (const selector of ['.btr-grid thead th', '.btr-grid tbody .btr-grid-total', '.btr-grid tfoot th', '.btr-day-covered strong', '.btr-day-rest strong']) {
      const color = await page.locator(selector).first().evaluate(el => getComputedStyle(el).color.match(/\d+/g).slice(0, 3).map(Number))
      assert.ok(Math.min(...color) > 170, `${selector} uses light text in dark mode`)
    }
    await page.locator('.btr-grid-day button').first().click()
    await page.locator('.btr-cell-dialog[open]').waitFor()
    await assertSurface('.btr-cell-dialog')
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await page.evaluate(() => window.themeTest.toggleTheme())
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
    assert.equal(await page.locator('.btr-grid thead th').first().evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 247, 0)')
    assert.equal(await page.locator('.btr-grid thead th').first().evaluate(el => getComputedStyle(el).color), 'rgb(16, 24, 32)')
    await page.evaluate(() => { window.themeTest.toggleTheme(); window.themeTest.scene.value = 'portal' })
    await page.locator('.portal-welcome').waitFor()
    await page.setViewportSize({ width: 375, height: 850 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    // A change in another tab updates the existing portal without a reload.
    const otherTab = await context.newPage()
    await otherTab.goto('http://theme.test')
    await otherTab.evaluate(() => localStorage.setItem('dja-theme', 'light'))
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
    await otherTab.evaluate(() => localStorage.removeItem('dja-theme'))
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
    await otherTab.close()
    await page.emulateMedia({ colorScheme: 'light' })
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
    assert.equal(await page.evaluate(() => localStorage.getItem('dja-theme')), null)
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
    // Return to signed-out portal to check its intentionally bright action button.
    await page.evaluate(() => { window.portalAnonymous = true; window.themeTest.scene.value = 'workspace' })
    await page.locator('.payroll-run-progress').waitFor()
    await page.evaluate(() => window.themeTest.scene.value = 'portal')
    await page.locator('.portal-auth').waitFor()
    const buttonText = await page.locator('.portal-auth-panel .portal-primary').evaluate(el => getComputedStyle(el).color.match(/\d+/g).slice(0, 3).map(Number))
    assert.ok(Math.max(...buttonText) < 130, 'Bright blue sign-in button retains dark readable text')
    // Switching still works when browser storage is unavailable.
    await page.evaluate(() => Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('Storage disabled for test') } }))
    await page.getByRole('button', { name: 'Switch to light mode' }).click()
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
