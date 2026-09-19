const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const slash = value => value.split(path.sep).join('/')
const relative = value => slash(path.relative(root, value))
const exists = value => fs.existsSync(value) && fs.statSync(value).isFile()

function walk(directory, extensions) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(full, extensions) : extensions.some(ext => entry.name.endsWith(ext)) ? [full] : []
  })
}

function routeForPage(file) {
  let route = relative(file).replace(/^app\/pages/, '').replace(/\.vue$/, '').replace(/\/index$/, '')
  route = route.replace(/\[\.\.\.([^\]]+)\]/g, ':$1*').replace(/\[([^\]]+)\]/g, ':$1')
  return route || '/'
}

function routeForHandler(file) {
  const method = path.basename(file).match(/\.(get|post|put|delete|patch)\.ts$/)?.[1]?.toUpperCase() || 'ANY'
  let route = relative(file).replace(/^server\/api/, '').replace(/\.(get|post|put|delete|patch)\.ts$/, '').replace(/\/index$/, '')
  return { method, route: `/api${route || '/'}`, file }
}

function resolveLocalImport(sourceFile, specifier) {
  if (!specifier || specifier.startsWith('#') || (!specifier.startsWith('.') && !specifier.startsWith('~/') && !specifier.startsWith('@/') && !specifier.startsWith('~~/') && !specifier.startsWith('@@/'))) return null
  let base
  if (specifier.startsWith('~~/') || specifier.startsWith('@@/')) base = path.join(root, specifier.slice(3))
  else if (specifier.startsWith('~/') || specifier.startsWith('@/')) base = path.join(root, 'app', specifier.slice(2))
  else base = path.resolve(path.dirname(sourceFile), specifier)
  const candidates = [base, ...['.vue', '.ts', '.js', '.cjs', '.css'].map(ext => `${base}${ext}`), ...['.vue', '.ts', '.js'].map(ext => path.join(base, `index${ext}`))]
  return candidates.find(exists) || null
}

function importsFrom(file) {
  const specs = []
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*import(?:\s+type)?(?:\s+.+?\s+from)?\s*['"]([^'"]+)['"]/) || line.match(/^\s*export(?:\s+type)?\s+.+?\s+from\s*['"]([^'"]+)['"]/) 
    if (match) specs.push(match[1])
  }
  return specs.map(specifier => resolveLocalImport(file, specifier)).filter(Boolean)
}

function dependencyClosure(entry, allowed) {
  const found = new Set()
  const queue = [entry]
  while (queue.length) {
    const current = queue.shift()
    for (const dependency of importsFrom(current)) {
      if (found.has(dependency) || !allowed(dependency)) continue
      found.add(dependency)
      queue.push(dependency)
    }
  }
  found.delete(entry)
  return [...found].sort((a, b) => relative(a).localeCompare(relative(b)))
}

function normalizeSingleApiExpression(expression) {
  const literals = []
  const pattern = /(['"`])([\s\S]*?)\1/g
  let match
  let previousEnd = 0
  while ((match = pattern.exec(expression))) {
    if (literals.length && expression.slice(previousEnd, match.index).replace(/[+\s()]/g, '')) literals.push('[param]')
    literals.push(match[2].replace(/\$\{[^}]+\}/g, '[param]'))
    previousEnd = pattern.lastIndex
  }
  const endpoint = literals.join('').replace(/\/+/g, '/').replace(/\/$/, '')
  return endpoint.startsWith('/api/') ? endpoint : null
}

function normalizeApiExpression(expression) {
  const question = expression.indexOf('?')
  const colon = expression.indexOf(':', question + 1)
  if (question >= 0 && colon > question) {
    return [expression.slice(question + 1, colon), expression.slice(colon + 1)].map(normalizeSingleApiExpression).filter(Boolean)
  }
  const endpoint = normalizeSingleApiExpression(expression)
  return endpoint ? [endpoint] : []
}

function apiCallsFrom(file) {
  const source = fs.readFileSync(file, 'utf8')
  const calls = new Map()
  const pattern = /\$fetch(?:<[^>]*>)?\s*\(/g
  let match
  while ((match = pattern.exec(source))) {
    const start = pattern.lastIndex
    let depth = 1
    let quote = ''
    let escaped = false
    let comma = -1
    let end = source.length
    for (let index = start; index < source.length; index++) {
      const character = source[index]
      if (quote) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === quote) quote = ''
        continue
      }
      if (character === "'" || character === '"' || character === '`') quote = character
      else if (character === '(') depth++
      else if (character === ')') {
        depth--
        if (depth === 0) { end = index; break }
      } else if (character === ',' && depth === 1 && comma < 0) comma = index
    }
    const expression = source.slice(start, comma < 0 ? end : comma)
    const callSource = source.slice(start, end)
    const methods = [...callSource.matchAll(/method\s*:\s*([^,}\n]+)/gi)].flatMap(property => [...property[1].matchAll(/['"](GET|POST|PUT|DELETE|PATCH)['"]/gi)].map(item => item[1].toUpperCase()))
    if (!methods.length) methods.push('GET')
    for (const endpoint of normalizeApiExpression(expression)) {
      for (const method of methods) calls.set(`${method} ${endpoint}`, { endpoint, method })
    }
    pattern.lastIndex = end + 1
  }
  return [...calls.values()].sort((a, b) => a.endpoint.localeCompare(b.endpoint) || a.method.localeCompare(b.method))
}

function routeScore(endpoint, handlerRoute) {
  const left = endpoint.split('/').filter(Boolean)
  const right = handlerRoute.split('/').filter(Boolean)
  if (left.length !== right.length) return -1
  let score = 0
  for (let index = 0; index < left.length; index++) {
    if (left[index] === right[index]) score += 3
    else if (left[index].startsWith('[') && right[index].startsWith('[')) score += 1
    else if (!right[index].startsWith('[')) return -1
  }
  return score
}

function assetsFrom(files) {
  const assets = new Set()
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(/["'(]((?:\/images|\/uploads)\/[^"')\s?]+)/g)) {
      const candidate = path.join(root, 'public', match[1].slice(1))
      if (exists(candidate)) assets.add(candidate)
    }
  }
  return [...assets].sort((a, b) => relative(a).localeCompare(relative(b)))
}

function linksFrom(files) {
  const links = new Set()
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(/(?:\bto=|navigateTo\()\s*["'`]([^"'`?#]+)["'`]/g)) if (match[1].startsWith('/')) links.add(match[1])
  }
  return [...links].sort()
}

const pages = walk(path.join(root, 'app', 'pages'), ['.vue']).sort((a, b) => routeForPage(a).localeCompare(routeForPage(b)))
const handlers = walk(path.join(root, 'server', 'api'), ['.ts']).map(routeForHandler)
const nuxtConfig = fs.readFileSync(path.join(root, 'nuxt.config.ts'), 'utf8')
const cssBlock = nuxtConfig.match(/css:\s*\[([\s\S]*?)\]/)?.[1] || ''
const globalStyles = [...cssBlock.matchAll(/['"](?:~~\/)?([^'"]+\.css)['"]/g)].map(match => path.join(root, match[1])).filter(exists)

const lines = [
  '# Code Route Map', '',
  '> Generated by `node scripts/generate-code-map.cjs`. Do not edit the generated relationships manually.',
  '> Run the generator whenever a page, component, style, asset, API call, API handler, or related utility is added, removed, renamed, or rewired.', '',
  'This map shows which source files belong to each Nuxt page route. `docs/API_MAP.md` remains the detailed contract for request bodies, responses, and database tables.', '',
  '## Global application files', '',
  '- `app/app.vue` — Nuxt application root.',
  '- `nuxt.config.ts` — global configuration and CSS registration.',
  ...globalStyles.map(file => `- \`${relative(file)}\` — global style loaded on every page.`), '',
  '## Page routes', ''
]

for (const page of pages) {
  const frontend = dependencyClosure(page, file => !relative(file).startsWith('server/'))
  const scannedFrontend = [page, ...frontend]
  const calls = new Map()
  for (const call of scannedFrontend.flatMap(apiCallsFrom)) calls.set(`${call.method} ${call.endpoint}`, call)
  const preliminaryHandlers = [...calls.values()].sort((a, b) => a.endpoint.localeCompare(b.endpoint) || a.method.localeCompare(b.method)).map(call => {
    const scored = handlers.filter(handler => handler.method === call.method).map(handler => ({ handler, score: routeScore(call.endpoint, handler.route) })).filter(item => item.score >= 0)
    const best = Math.max(-1, ...scored.map(item => item.score))
    return { ...call, handlers: scored.filter(item => item.score === best).map(item => item.handler) }
  })
  // A ternary can select both endpoint and method in matching branches. Static
  // analysis sees the cross-product; discard impossible pairs when that same
  // endpoint has at least one real handler match.
  const resolvedEndpoints = new Set(preliminaryHandlers.filter(item => item.handlers.length).map(item => item.endpoint))
  const matchedHandlers = preliminaryHandlers.filter(item => item.handlers.length || !resolvedEndpoints.has(item.endpoint))
  const backendEntries = [...new Set(matchedHandlers.flatMap(item => item.handlers.map(handler => handler.file)))]
  const backendDependencies = [...new Set(backendEntries.flatMap(entry => dependencyClosure(entry, file => relative(file).startsWith('server/') || relative(file).startsWith('shared/') || relative(file).startsWith('components/alertmessage/'))))]
    .filter(file => !backendEntries.includes(file)).sort((a, b) => relative(a).localeCompare(relative(b)))
  const assets = assetsFrom(scannedFrontend)
  const links = linksFrom(scannedFrontend)

  lines.push(`### \`${routeForPage(page)}\``, '', `- Page: \`${relative(page)}\``)
  lines.push(`- Global styles: ${globalStyles.map(file => `\`${relative(file)}\``).join(', ') || 'none'}`)
  lines.push('- Related frontend files:')
  if (frontend.length) frontend.forEach(file => lines.push(`  - \`${relative(file)}\``))
  else lines.push('  - None detected.')
  lines.push('- API calls and handlers:')
  if (matchedHandlers.length) {
    for (const item of matchedHandlers) {
      if (item.handlers.length) item.handlers.forEach(handler => lines.push('  - `' + item.method + ' ' + item.endpoint + '` → `' + relative(handler.file) + '`'))
      else lines.push(`  - \`${item.method} ${item.endpoint}\` → no matching handler detected`)
    }
  } else lines.push('  - None detected.')
  lines.push('- Related backend utilities:')
  if (backendDependencies.length) backendDependencies.forEach(file => lines.push(`  - \`${relative(file)}\``))
  else lines.push('  - None detected.')
  lines.push('- Static assets:')
  if (assets.length) assets.forEach(file => lines.push(`  - \`${relative(file)}\``))
  else lines.push('  - None detected.')
  lines.push(`- Links to: ${links.length ? links.map(link => `\`${link}\``).join(', ') : 'none detected.'}`, '')
}

fs.writeFileSync(path.join(root, 'docs', 'CODE_MAP.md'), `${lines.join('\n')}\n`)
console.log(`Generated docs/CODE_MAP.md for ${pages.length} page routes.`)
