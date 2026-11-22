import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import mysql from 'mysql2/promise'
import { localConfig, root } from './helpers/scale-fixture.mjs'
import { seedMillionFixture } from './helpers/million-fixture.mjs'
const database = process.argv.find(arg => arg.startsWith('--database='))?.slice(11)
if (!/^pbsystem_scale_\d{14}_[a-f0-9]{4}$/.test(database || '') || database === process.env.DB_NAME) throw Error('Exact generated synthetic database required')
const folder = path.join(root, database), db = await mysql.createConnection({ ...localConfig(), database })
try {
  let state; try { state = JSON.parse(await readFile(path.join(folder, 'seed-state.json'), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const details = await seedMillionFixture(db, { folder, resume: true, portalSeed: state?.portalSeed })
  await writeFile(path.join(folder, 'manifest.json'), JSON.stringify({ database, sourceSchema: process.env.DB_NAME, createdAt: new Date().toISOString(), ...details, syntheticOnly: true, seedComplete: true }, null, 2))
  console.log('Million fixture seed complete; original database unchanged')
} finally { await db.end() }
