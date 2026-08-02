import { createError, readBody } from 'h3'
import { promises as fs } from 'fs'
import path from 'path'
import crypto from 'crypto'
import pool from '../../connection/dbconnect'
import { requireSession } from '../../utils/auth'

const ALLOWED: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const MAX_BYTES = 2 * 1024 * 1024 // 2MB

export default defineEventHandler(async (event) => {
  const session = requireSession(event)
  const { image } = await readBody<{ image?: string }>(event)
  if (!image || !image.startsWith('data:')) throw createError({ statusCode: 400, statusMessage: 'No image provided.' })

  const match = image.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/)
  if (!match) throw createError({ statusCode: 400, statusMessage: 'Only PNG, JPG, or WEBP images are allowed.' })

  const mime = match[1]
  const buffer = Buffer.from(match[2], 'base64')
  if (buffer.length > MAX_BYTES) throw createError({ statusCode: 400, statusMessage: 'Image must be 2MB or smaller.' })

  const ext = ALLOWED[mime]
  const filename = `${session.sub}-${crypto.randomBytes(6).toString('hex')}.${ext}`
  const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'avatars')
  await fs.mkdir(uploadDir, { recursive: true })
  await fs.writeFile(path.join(uploadDir, filename), buffer)

  const publicPath = `/uploads/avatars/${filename}`
  await pool.execute('UPDATE `user` SET Image = ? WHERE UserID = ?', [publicPath, session.sub])

  return { message: 'Profile photo updated.', image: publicPath }
})