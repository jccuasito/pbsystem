import type { PoolConnection } from 'mysql2/promise'

/** Keep the user ID/name for historical foreign keys; remove the sign-in identity. Caller owns the transaction and locks. */
export async function deleteStaffIdentity(connection: Pick<PoolConnection, 'execute'>, userId: number, actorId: number) {
  await connection.execute(`UPDATE \`user\` SET Status = 'Inactive', DeletedAt = UTC_TIMESTAMP(), DeletedBy = ?,
    Email = NULL, Password = NULL, GoogleID = NULL, EmailVerified = 0,
    VerificationToken = NULL, VerificationTokenExpiry = NULL, ResetPasswordToken = NULL, ResetPasswordExpiry = NULL
    WHERE UserID = ? AND DeletedAt IS NULL`, [actorId, userId])
  // Close every open sign-in, preserving its original ID, device, IP and login time.
  await connection.execute('UPDATE user_history SET LogoutDateTime = UTC_TIMESTAMP() WHERE UserID = ? AND LogoutDateTime IS NULL', [userId])
}
