import path from 'node:path'
import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import { privateProfileDirectory, privateProfilePath } from '../server/utils/privateProfileImages.mjs'

const root = path.resolve(process.cwd())
const inside = target => target.startsWith(root + path.sep)
let migrated = 0, retained = 0
for (const kind of ['employees', 'avatars']) {
  const source = path.resolve(root, 'public', 'uploads', kind), destination = privateProfileDirectory(kind)
  if (!inside(source) || !inside(destination) || source === destination) throw new Error('Image migration paths must stay inside this project.')
  const entries = await fs.readdir(source, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  for (const entry of entries) {
    if (!entry.isFile()) throw new Error('Unexpected directory or symbolic link in the public image folder; review before migrating.')
    let target
    try { target = privateProfilePath(kind, entry.name) } catch { throw new Error('Unexpected public profile filename; review before migrating.') }
    const original = path.resolve(source, entry.name)
    if (!inside(original) || !inside(target)) throw new Error('Invalid migration path.')
    const data = await fs.readFile(original)
    await fs.mkdir(destination, { recursive: true, mode: 0o700 })
    try { await fs.writeFile(target, data, { flag: 'wx', mode: 0o600 }) } catch (error) { if (error.code !== 'EEXIST') throw error; retained++ }
    const copy = await fs.readFile(target)
    const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
    if (hash(data) !== hash(copy)) throw new Error('Private copy differs; public original was retained.')
    // Remove only this verified public copy. The full original bytes remain in private storage.
    await fs.unlink(original)
    migrated++
  }
}
console.log(`Migrated ${migrated} profile images to private storage (${retained} copies already present). No database URLs or image bytes changed.`)
