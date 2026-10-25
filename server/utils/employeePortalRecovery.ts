import crypto from 'node:crypto'

export const newPortalRecoveryCode=()=>crypto.randomInt(0,1000000).toString().padStart(6,'0')
export const recoveryAttemptKey=(accountId:number)=>crypto.createHash('sha256').update(`portal-recovery-attempts:${accountId}`).digest('hex')

// A keyed hash protects the small numeric code space if the database is exposed.
// Account binding permits independent employee codes without global-code lookup.
export function portalRecoveryHash(accountId:number,code:string){
  const secret=process.env.JWT_SECRET
  if(!secret||secret.length<32)throw new Error('JWT_SECRET must be configured with at least 32 characters.')
  return crypto.createHmac('sha256',secret).update(`portal-recovery:v1:${accountId}:${code}`).digest('hex')
}
