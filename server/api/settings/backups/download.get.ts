import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { createError, getQuery, sendStream, setHeader } from 'h3'
import { backupDownloadHeader, managedBackup } from '../../../utils/databaseBackup.mjs'
import { requireSession } from '../../../utils/auth'
import { requireAdmin } from '../../../utils/settingsAccess'

export default defineEventHandler(async (event) => {
  const session = requireSession(event)
  void session.sub
  await requireAdmin(event)
  const name = String(getQuery(event).name || '')
  const metadataOnly = getQuery(event).metadata === '1'
  try {
    const { file, metadata } = await managedBackup(name)
    setHeader(event, 'Content-Type', metadataOnly ? 'application/json' : 'application/sql')
    setHeader(event, 'Content-Disposition', `attachment; filename="${name}${metadataOnly ? '.json' : ''}"`)
    setHeader(event, 'Cache-Control', 'no-store')
    if (metadataOnly) return sendStream(event, createReadStream(`${file}.json`))
    const download = Readable.from((async function* () {
      yield backupDownloadHeader(metadata)
      for await (const chunk of createReadStream(file)) yield chunk
    })())
    return sendStream(event, download)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Backup is missing or its integrity check failed.' })
  }
})
