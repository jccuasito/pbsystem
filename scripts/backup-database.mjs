import { ensureDailyDatabaseBackup } from '../server/utils/databaseBackup.mjs'

try {
  const backup = await ensureDailyDatabaseBackup()
  console.log(backup ? `Daily SQL backup saved: ${backup.name}` : 'Today\'s SQL backup already exists.')
} catch (error) {
  console.error('Daily SQL backup failed:', error.message)
  process.exitCode = 1
}
