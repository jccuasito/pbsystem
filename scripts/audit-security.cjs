const fs = require('node:fs'), path = require('node:path'), parser = require('@babel/parser')
const root = process.cwd(), findings = [], queries = [], routes = []
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : /\.(ts|mjs)$/.test(e.name) ? [path.join(dir, e.name)] : []) }
function walk(node, fn) { if (!node || typeof node !== 'object') return; if (node.type) fn(node); for (const [key, value] of Object.entries(node)) if (!['loc', 'start', 'end', 'extra'].includes(key)) if (Array.isArray(value)) value.forEach(v => walk(v, fn)); else if (value && typeof value === 'object') walk(value, fn) }
for (const absolute of files(path.join(root, 'server'))) {
  const file = path.relative(root, absolute).replaceAll('\\', '/'), text = fs.readFileSync(absolute, 'utf8')
  if (file.startsWith('server/api/') || file.startsWith('server/routes/')) routes.push(file)
  let ast
  try { ast = parser.parse(text, { sourceType: 'module', plugins: ['typescript'] }) } catch (error) { findings.push({ file, issue: error.message }); continue }
  walk(ast, node => {
    if (node.type === 'ImportDeclaration' && node.source.value.startsWith('.')) {
      const target = path.resolve(path.dirname(absolute), node.source.value)
      if (![target, target + '.ts', target + '.mjs', target + '.js', path.join(target, 'index.ts')].some(p => fs.existsSync(p))) findings.push({ file, line: node.loc.start.line, issue: 'Missing import: ' + node.source.value })
    }
    if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression' || !['query', 'execute'].includes(node.callee.property.name)) return
    const sql = node.arguments[0], source = sql ? text.slice(sql.start, sql.end) : ''
    queries.push({ file, line: node.loc.start.line, method: node.callee.property.name, sql: source, parameterized: node.arguments.length > 1 })
    if (node.callee.property.name === 'query') findings.push({ file, line: node.loc.start.line, issue: 'Use execute for runtime SQL.' })
    const expressions = sql?.type === 'TemplateLiteral' ? sql.expressions.map(e => text.slice(e.start, e.end)) : []
    if (expressions.some(e => /\b(?:body|query|params|event)\s*[.[]/.test(e))) findings.push({ file, line: node.loc.start.line, issue: 'Request value directly interpolated into SQL.' })
    if (node.arguments.length === 1 && sql?.type === 'StringLiteral' && sql.value.includes('?')) findings.push({ file, line: node.loc.start.line, issue: 'Missing bind values.' })
  })
}
const report = { note: 'Source inventory and regression checks; not a substitute for reviewing dynamic SQL data flow or penetration testing.', routeCount: routes.length, sqlCallCount: queries.length, findings, routes, queries }
fs.mkdirSync('.data', { recursive: true }); fs.writeFileSync('.data/security-source-audit.json', JSON.stringify(report, null, 2))
console.log(`${routes.length} API route files; ${queries.length} SQL calls; ${findings.length} source findings.`)
for (const finding of findings) console.log(`${finding.file}:${finding.line || 1}: ${finding.issue}`)
process.exitCode = findings.length ? 1 : 0
