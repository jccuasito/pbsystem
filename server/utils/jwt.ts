import jwt from 'jsonwebtoken'

function jwtSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must be configured with at least 32 characters.')
  return secret
}

export function signToken(payload: object) {
  return jwt.sign(payload, jwtSecret(), { expiresIn: '7d', issuer: 'pbsystem', audience: 'pbsystem-web' })
}

export function verifyToken(token: string) {
  return jwt.verify(token, jwtSecret(), { issuer: 'pbsystem', audience: 'pbsystem-web' })
}
