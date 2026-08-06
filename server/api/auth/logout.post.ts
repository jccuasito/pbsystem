import pool from '../../connection/dbconnect'
import { clearSession, requireSession } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  try {
    const session = requireSession(event)
    if (session.historyId) {
      await pool.execute(
        'UPDATE user_history SET LogoutDateTime = UTC_TIMESTAMP() WHERE HistoryID = ? AND UserID = ?',
        [session.historyId, session.sub]
      )
    }
  } catch {
    // walang valid session o walang historyId -> okay lang, tuloy pa rin mag-clear ng cookie
  }

  clearSession(event)
  return { message: 'Signed out.' }
})