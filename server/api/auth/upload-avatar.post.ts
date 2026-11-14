import { createError, readBody } from 'h3'
import { promises as fs } from 'fs'
import path from 'path'
import crypto from 'crypto'
import pool from '../../connection/dbconnect'
import { requireSession } from '../../utils/auth'
import { currentActor } from '../../utils/settingsAccess'
import { imageData } from '../../utils/inputValidation'
import { privateProfileDirectory } from '../../utils/privateProfileImages.mjs'

export default defineEventHandler(async (event) => {
  const session = requireSession(event)
  await currentActor(event)
  const { image } = await readBody<{ image?: string }>(event)
  const { buffer, extension: ext } = imageData(image)
  const filename = `${session.sub}-${crypto.randomBytes(6).toString('hex')}.${ext}`
  const uploadDir = privateProfileDirectory('avatars')
  await fs.mkdir(uploadDir, { recursive: true })
  await fs.writeFile(path.join(uploadDir, filename), buffer)

  const publicPath = `/uploads/avatars/${filename}`
  try { await pool.execute('UPDATE `user` SET Image = ? WHERE UserID = ?', [publicPath, session.sub]) }
  catch (error) { await fs.unlink(path.join(uploadDir, filename)).catch(() => undefined); throw error }

  return { message: 'Profile photo updated.', image: publicPath }
})
