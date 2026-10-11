import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile, appendFile } from 'node:fs/promises'
import path from 'node:path'

const NAME = /^pbsystem-\d{8}-?\d{6}-[a-f0-9]{8}\.sql$/
const backupDirectory = () => path.resolve(process.env.DB_BACKUP_DIR || path.join(process.cwd(), '.data', 'database-backups'))
const database = () => process.env.DB_NAME || 'pbsystem'
const credentials = () => ({ ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || '' })
const stamp = () => {
  const digits = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  return `${digits.slice(0, 8)}-${digits.slice(8)}`
}
export const localDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

async function binary(kind) {
  const configured = process.env[kind === 'dump' ? 'MYSQLDUMP_BIN' : 'MYSQL_BIN']
  const names = kind === 'dump' ? ['mysqldump', 'mariadb-dump'] : ['mysql', 'mariadb']
  const paths = [configured, ...names.map(name => path.join('C:\\xampp\\mysql\\bin', `${name}.exe`)), ...names].filter(Boolean)
  for (const candidate of paths) {
    if (candidate.includes(path.sep) || candidate.includes('/')) {
      try { await access(candidate); return candidate } catch { continue }
    } else return candidate // PATH lookup is handled by spawn.
  }
  throw new Error(`${kind} client is unavailable. Configure ${kind === 'dump' ? 'MYSQLDUMP_BIN' : 'MYSQL_BIN'}.`)
}

function run(command, args, inputFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: credentials(), windowsHide: true, stdio: [inputFile ? 'pipe' : 'ignore', 'ignore', 'pipe'] })
    let errorText = ''
    child.stderr.on('data', chunk => { errorText = (errorText + chunk.toString()).slice(-1600) })
    child.on('error', reject)
    if (inputFile) {
      const source = createReadStream(inputFile)
      source.on('error', error => { child.kill(); reject(error) })
      child.stdin.on('error', reject)
      source.pipe(child.stdin)
    }
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`Database client exited ${code}: ${errorText.trim() || 'unknown error'}`)))
  })
}

async function hashFile(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

let running = null
let restoring = false
export const isDatabaseRestoring = () => restoring
export async function createDatabaseBackup(kind = 'manual') {
  if (restoring && kind !== 'before-restore') throw new Error('Database restore is in progress.')
  if (running) return running
  running = (async () => {
    const dir = backupDirectory()
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const name = `pbsystem-${stamp()}-${randomBytes(4).toString('hex')}.sql`
    const temporary = path.join(dir, `${name}.partial`)
    const file = path.join(dir, name)
    try {
      const executable = await binary('dump')
      await run(executable, [
        `--host=${process.env.DB_HOST || '127.0.0.1'}`, `--port=${Number(process.env.DB_PORT || 3306)}`,
        `--user=${process.env.DB_USER || 'root'}`, '--single-transaction', '--quick',
        '--routines', '--events', '--triggers', '--add-drop-table', '--no-tablespaces',
        '--default-character-set=utf8mb4', `--result-file=${temporary}`, database()
      ])
      const details = await stat(temporary)
      if (details.size < 100) throw new Error('Backup output was unexpectedly empty.')
      await rename(temporary, file)
      const metadata = { name, kind, createdAt: new Date().toISOString(), localDay: localDay(), size: details.size, sha256: await hashFile(file) }
      await writeFile(`${file}.json`, JSON.stringify(metadata), { mode: 0o600 })
      return metadata
    } catch (error) { await rm(temporary, { force: true }); throw error }
  })()
  try { return await running } finally { running = null }
}

export async function listDatabaseBackups() {
  const dir = backupDirectory()
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const names = (await readdir(dir)).filter(name => NAME.test(name))
  const records = []
  for (const name of names) {
    try {
      const metadata = JSON.parse(await readFile(path.join(dir, `${name}.json`), 'utf8'))
      if (metadata.name === name) records.push(metadata)
    } catch { /* Ignore incomplete backups. */ }
  }
  return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export async function managedBackup(name) {
  if (!NAME.test(String(name))) throw new Error('Invalid backup name.')
  const file = path.join(backupDirectory(), name)
  const metadata = JSON.parse(await readFile(`${file}.json`, 'utf8'))
  if (metadata.name !== name || metadata.sha256 !== await hashFile(file)) throw new Error('Backup integrity check failed.')
  return { file, metadata }
}

export function backupDownloadHeader(metadata) {
  const manifest = { name: metadata.name, createdAt: metadata.createdAt, size: metadata.size, sha256: metadata.sha256 }
  return `-- PBSYSTEM-BACKUP-V1 ${Buffer.from(JSON.stringify(manifest)).toString('base64')}\n`
}

export async function importDatabaseBackup(downloadedData) {
  const lineEnd = downloadedData.indexOf(10)
  if (lineEnd < 0 || lineEnd > 1024) throw new Error('Choose a backup downloaded from this system.')
  const match = /^-- PBSYSTEM-BACKUP-V1 ([A-Za-z0-9+/=]+)$/.exec(downloadedData.subarray(0, lineEnd).toString('utf8'))
  if (!match) throw new Error('Choose a backup downloaded from this system.')
  let manifest
  try { manifest = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')) }
  catch { throw new Error('Backup file is damaged.') }
  const sqlData = downloadedData.subarray(lineEnd + 1)
  if (!NAME.test(String(manifest.name)) || !/^[a-f0-9]{64}$/.test(String(manifest.sha256)) ||
      !Number.isSafeInteger(manifest.size) || manifest.size !== sqlData.length ||
      typeof manifest.createdAt !== 'string' || Number.isNaN(Date.parse(manifest.createdAt)) ||
      createHash('sha256').update(sqlData).digest('hex') !== manifest.sha256 ||
      !/^-- (MariaDB|MySQL) dump/.test(sqlData.subarray(0, 100).toString('utf8'))) {
    throw new Error('Backup file failed its integrity check.')
  }
  const dir = backupDirectory()
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const name = `pbsystem-${stamp()}-${randomBytes(4).toString('hex')}.sql`
  const file = path.join(dir, name)
  try {
    await writeFile(file, sqlData, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Please try uploading the backup again.')
    throw error
  }
  const metadata = { name, kind: 'imported', createdAt: manifest.createdAt, importedAt: new Date().toISOString(), originalName: manifest.name, size: manifest.size, sha256: manifest.sha256 }
  try { await writeFile(`${file}.json`, JSON.stringify(metadata), { flag: 'wx', mode: 0o600 }) }
  catch (error) { await rm(file, { force: true }); throw error }
  return metadata
}

export async function restoreDatabaseBackup(name, actorId) {
  if (restoring) throw new Error('Another restore is already in progress.')
  restoring = true
  try {
    const { file } = await managedBackup(name)
    const safety = await createDatabaseBackup('before-restore')
    const executable = await binary('mysql')
    await run(executable, [
      `--host=${process.env.DB_HOST || '127.0.0.1'}`, `--port=${Number(process.env.DB_PORT || 3306)}`,
      `--user=${process.env.DB_USER || 'root'}`, '--default-character-set=utf8mb4', database()
    ], file)
    await appendFile(path.join(backupDirectory(), 'restore-audit.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), actorId, restored: name, safetyBackup: safety.name })}\n`)
    return { success: true, safetyBackup: safety.name }
  } finally { restoring = false }
}

export async function ensureDailyDatabaseBackup() {
  if (restoring) return null
  const today = localDay()
  const existing = await listDatabaseBackups()
  if (existing.some(item => item.kind === 'daily' && item.localDay === today)) return null
  return createDatabaseBackup('daily')
}
