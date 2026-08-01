import dbconnect from '../../connection/dbconnect'
   import jwt from '../../connection/jwt'
   import googleAuth from '../../connection/googleAuth'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { idToken } = body

  if (!idToken) {
    throw createError({ statusCode: 400, statusMessage: 'Missing Google ID token' })
  }

  // 1. I-verify ang token kay Google
  const googleData = await verifyGoogleToken(idToken)

  if (!googleData.emailVerified) {
    throw createError({ statusCode: 401, statusMessage: 'Google email not verified' })
  }

  // 2. Tignan kung existing na ang user (by GoogleID o Email)
  const [existingRows]: any = await pool.query(
    'SELECT * FROM user WHERE GoogleID = ? OR Email = ? LIMIT 1',
    [googleData.googleId, googleData.email]
  )

  let user

  if (existingRows.length > 0) {
    // 3a. Existing user — i-login na lang
    user = existingRows[0]

    // Kung dating local account, i-link natin ang GoogleID kung wala pa
    if (!user.GoogleID) {
      await pool.query(
        'UPDATE user SET GoogleID = ?, AuthProvider = ? WHERE UserID = ?',
        [googleData.googleId, 'google', user.UserID]
      )
    }
  } else {
    // 3b. Bagong user — gumawa ng account
    const [result]: any = await pool.query(
      `INSERT INTO user 
        (FirstName, LastName, Gender, Email, AuthProvider, GoogleID, EmailVerified, Status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        googleData.firstName || 'N/A',
        googleData.lastName || 'N/A',
        'Prefer not to say',
        googleData.email,
        'google',
        googleData.googleId,
        1,
        'Active'
      ]
    )

    const [newRows]: any = await pool.query(
      'SELECT * FROM user WHERE UserID = ?',
      [result.insertId]
    )
    user = newRows[0]
  }

  // 4. Gumawa ng JWT session token
  const token = signToken({
    userId: user.UserID,
    email: user.Email,
    userType: user.UserType,
    departmentId: user.DepartmentID
  })

  // 5. I-set bilang httpOnly cookie
  setCookie(event, 'auth_token', token, {
    httpOnly: true,
    secure: false, // ✅ ilagay 'true' pag deployed na sa production (HTTPS)
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7 // 7 days
  })

  return {
    success: true,
    user: {
      id: user.UserID,
      firstName: user.FirstName,
      lastName: user.LastName,
      email: user.Email,
      userType: user.UserType
    }
  }
})