import { createError, readBody } from 'h3'
import { verifyGoogleToken } from '../../utils/googleAuth'
import { googleSignIn } from '../../utils/googleSignIn'

/** Legacy ID-token entry point uses the same verified identity and session flow. */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  if (typeof body?.idToken !== 'string' || !body.idToken || body.idToken.length > 8192) throw createError({ statusCode: 400, statusMessage: 'Missing or invalid Google ID token.' })
  let google
  try { google = await verifyGoogleToken(body.idToken) } catch { throw createError({ statusCode: 401, statusMessage: 'Google identity could not be verified.' }) }
  return googleSignIn(event, google, body.intent || 'login')
})
