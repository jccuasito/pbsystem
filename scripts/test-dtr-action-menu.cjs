const assert = require('node:assert/strict')
const fs = require('node:fs')
const { test } = require('node:test')
const { parse, compileScript, compileTemplate, compileStyle } = require('@vue/compiler-sfc')
const { dtrActionMenuPosition } = require('../shared/utils/dtrActionMenu.ts')

for (const fixture of [
  { name: 'last table row opens upward', anchor: { top: 930, bottom: 968, left: 1740, right: 1810 }, viewport: { width: 1850, height: 1050 }, contentHeight: 306, opensUp: true },
  { name: 'first row uses available space below', anchor: { top: 150, bottom: 188, left: 1100, right: 1170 }, viewport: { width: 1200, height: 850 }, contentHeight: 306, opensUp: false },
  { name: 'short screen scrolls only within the menu', anchor: { top: 180, bottom: 218, left: 260, right: 330 }, viewport: { width: 360, height: 350 }, contentHeight: 306, opensUp: true },
  { name: 'narrow viewport keeps both menu edges visible', anchor: { top: 40, bottom: 78, left: 20, right: 90 }, viewport: { width: 200, height: 700 }, contentHeight: 306, opensUp: false },
]) test(fixture.name, () => {
  const result = dtrActionMenuPosition(fixture.anchor, fixture.viewport, fixture.contentHeight)
  const height = Math.min(fixture.contentHeight, result.maxHeight)
  const top = result.opensUp ? fixture.anchor.top - 6 - height : fixture.anchor.bottom + 6
  const left = fixture.anchor.left + result.left
  assert.equal(result.opensUp, fixture.opensUp)
  assert.ok(top >= 8)
  assert.ok(top + height <= fixture.viewport.height - 8)
  assert.ok(left >= 8)
  assert.ok(left + result.width <= fixture.viewport.width - 8)
})

test('DTR page compiles with the adaptive menu and keeps its existing actions', () => {
  const filename = 'app/pages/attendance/daily-time-records/index.vue'
  const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename })
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: filename })
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: filename, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
  for (const style of descriptor.styles) assert.deepEqual(compileStyle({ source: style.content, filename, id: filename }).errors, [])
})
