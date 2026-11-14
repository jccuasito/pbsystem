import { setHeader, setResponseStatus } from 'h3'
import { databaseReady } from '../../utils/serviceHealth'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ready = await databaseReady()
  if (!ready) { setResponseStatus(event, 503); setHeader(event, 'Retry-After', '3') }
  return { status: ready ? 'ok' : 'unavailable' }
})
