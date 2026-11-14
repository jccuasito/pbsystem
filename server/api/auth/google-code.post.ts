import { createError, readBody } from 'h3'
import { verifyGoogleAuthorizationCode } from '../../utils/googleAuth'
import { googleSignIn } from '../../utils/googleSignIn'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  if (typeof body?.code !== 'string' || !body.code || body.code.length > 4096) throw createError({ statusCode: 400, statusMessage: 'Missing or invalid Google authorization code.' })
  if (body.intent !== undefined && !['login', 'signup'].includes(body.intent)) throw createError({ statusCode: 400, statusMessage: 'Choose login or signup.' })
  let google
  try { google = await verifyGoogleAuthorizationCode(body.code) } catch { throw createError({ statusCode: 401, statusMessage: 'Google authorization could not be verified.' }) }
  return googleSignIn(event, google, body.intent || 'login')
})
