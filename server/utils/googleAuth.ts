import { OAuth2Client } from 'google-auth-library'

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)

export async function verifyGoogleAuthorizationCode(code: string) {
  const exchangeClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET)
  const { tokens } = await exchangeClient.getToken({ code, redirect_uri: 'postmessage' })
  if (!tokens.id_token) throw new Error('Google did not return an ID token.')
  return verifyGoogleToken(tokens.id_token)
}

export async function verifyGoogleToken(idToken: string) {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID
  })

  const payload = ticket.getPayload()

  if (!payload) {
    throw new Error('Invalid Google token payload')
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    firstName: payload.given_name || '',
    lastName: payload.family_name || '',
    emailVerified: payload.email_verified
  }
}
