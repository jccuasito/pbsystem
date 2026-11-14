import { access, readFile } from 'node:fs/promises'

const issues = []
const [major, minor, patch] = process.versions.node.split('.').map(Number)
if (!(major === 22 && (minor > 22 || minor === 22 && patch >= 3) || major === 24 && minor >= 15 || major >= 26)) issues.push('Use Node 22.22.3+, 24.15+, or a newer supported LTS matching all dependency engines.')
for (const key of ['DB_HOST', 'DB_USER', 'DB_NAME', 'DB_PASSWORD', 'JWT_SECRET', 'APP_URL']) if (!process.env[key]) issues.push(`Configure ${key}.`)
if (process.env.JWT_SECRET && (process.env.JWT_SECRET.length < 32 || /replace-with|example/i.test(process.env.JWT_SECRET))) issues.push('Replace the placeholder JWT secret with a strong private value.')
try {
  const url = new URL(process.env.APP_URL)
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) issues.push('Public deployments require an HTTPS APP_URL.')
} catch { issues.push('APP_URL must be a complete URL.') }
try {
  await access('.output/server/index.mjs')
  const info = JSON.parse(await readFile('.output/build-info.json', 'utf8'))
  if (info.platform !== process.platform || info.arch !== process.arch) issues.push('Rebuild on this hosting platform/architecture; do not deploy Windows native modules to Linux.')
} catch { issues.push('Run npm run build on the target platform before deployment.') }
if (issues.length) {
  console.error('Deployment checks need attention:')
  for (const issue of issues) console.error(`- ${issue}`)
  process.exitCode = 1
} else console.log('Runtime, environment, and build-platform checks passed. Database access, private files and HTTPS still need the deployment smoke checks in docs/OPERATIONS.md.')
