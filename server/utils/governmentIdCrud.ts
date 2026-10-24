import { createError, getRouterParam, setHeader } from 'h3'
import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'
import { formatGovernmentNumber, governmentAttachmentMaxBytes, governmentIdIdentity, governmentIdType, validateGovernmentId } from '../../shared/utils/governmentIds'

const fileTypes: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }
const storageDirectory = () => path.resolve(process.env.GOVERNMENT_ID_STORAGE_DIR || path.join(process.cwd(), '.data', 'employee-government-ids'))
function id(value: unknown, label: string) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) throw createError({ statusCode: 400, statusMessage: `${label} is required.` })
  return number
}
function storedFile(value: unknown) {
  const name = String(value || '')
  if (!/^[a-f0-9]{32}\.(jpg|png|webp|pdf)$/.test(name)) throw createError({ statusCode: 404, statusMessage: 'ID attachment not found.' })
  return path.join(storageDirectory(), name)
}
export async function listGovernmentIds(employeeId: number) {
  const [rows] = await pool.execute<any[]>('SELECT GovernmentID,EmployeeID,GovernmentType,GovernmentNumber,AttachmentName,AttachmentMimeType,AttachmentSize,AttachmentPath IS NOT NULL AS HasAttachment FROM government WHERE EmployeeID=? ORDER BY GovernmentID DESC', [employeeId])
  return rows.map(row => ({ ...row, AttachmentUrl: row.HasAttachment ? `/api/employees/documents/government/${row.GovernmentID}/attachment` : null }))
}
export function parseGovernmentAttachment(body: Record<string, unknown>) {
  if (body.AttachmentDataUrl == null || body.AttachmentDataUrl === '') return null
  const raw = String(body.AttachmentDataUrl)
  if (raw.length > Math.ceil(governmentAttachmentMaxBytes / 3) * 4 + 100) throw createError({ statusCode: 400, statusMessage: 'ID scan must be 5 MB or smaller.' })
  const match = /^data:(image\/jpeg|image\/png|image\/webp|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/.exec(raw)
  if (!match) throw createError({ statusCode: 400, statusMessage: 'Upload a JPG, PNG, WebP, or PDF ID scan.' })
  const mime = match[1], data = Buffer.from(match[2], 'base64')
  if (!data.length || data.length > governmentAttachmentMaxBytes || data.toString('base64') !== match[2]) throw createError({ statusCode: 400, statusMessage: 'ID scan is invalid or exceeds 5 MB.' })
  const valid = mime === 'image/jpeg' ? data.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    : mime === 'image/png' ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mime === 'image/webp' ? data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP'
    : data.subarray(0, 5).toString() === '%PDF-'
  if (!valid) throw createError({ statusCode: 400, statusMessage: 'The file contents do not match the selected image or PDF type.' })
  const name = String(body.AttachmentName || `ID scan.${fileTypes[mime]}`).split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g, '').trim()
  if (!name || name.length > 255) throw createError({ statusCode: 400, statusMessage: 'Attachment filename must be 1-255 characters.' })
  return { data, mime, name, hash: crypto.createHash('sha256').update(data).digest('hex'), filename: `${crypto.randomBytes(16).toString('hex')}.${fileTypes[mime]}` }
}

export async function checkGovernmentDuplicate(employeeId: number, governmentId: number, typeValue?: unknown, numberValue?: unknown, scanHash?: string, connection: any = pool) {
  const checks: Array<{ sql: string; args: unknown[]; scan: boolean }> = []
  if (typeValue && numberValue) {
    const key = governmentIdIdentity(typeValue, numberValue)
    checks.push({ sql: 'GovernmentTypeKey=? AND GovernmentNumberKey=?', args: [key.typeKey, key.numberKey], scan: false })
  }
  if (scanHash) checks.push({ sql: 'AttachmentSHA256=?', args: [scanHash], scan: true })
  for (const check of checks) {
    const [[duplicate]] = await connection.execute(`SELECT GovernmentID,EmployeeID FROM government WHERE (${check.sql}) AND NOT (GovernmentID=? AND EmployeeID=?) LIMIT 1`, [...check.args, governmentId, employeeId])
    if (!duplicate) continue
    const owner = Number(duplicate.EmployeeID) === employeeId ? 'this employee' : `EMP-${String(duplicate.EmployeeID).padStart(4, '0')}`
    throw createError({ statusCode: 409, statusMessage: check.scan
      ? `This exact ID scan is already saved for ${owner}. Choose the correct employee or a different scan; edit the existing record to update it.`
      : `This government ID type and number is already saved for ${owner}. It cannot be assigned again. Edit the existing record if it needs correction.` })
  }
}

export async function saveGovernmentId(event: any, mode: 'create' | 'update' | 'delete', body: Record<string, unknown>) {
  const session = requireSession(event)
  if (session.userType === 'Viewer' || event.context?.moduleCanEdit === false) throw createError({ statusCode: 403, statusMessage: 'You do not have edit access to employee documents.' })
  const employeeId = id(body.employeeId ?? body.EmployeeID, 'Employee')
  const governmentId = mode === 'create' ? 0 : id(body.id, 'Government ID record')
  const validation = mode === 'delete' ? '' : validateGovernmentId(body.GovernmentType, body.GovernmentNumber)
  if (validation) throw createError({ statusCode: 400, statusMessage: validation })
  const type = governmentIdType(body.GovernmentType)
  const typeName = type === 'Other' ? String(body.GovernmentType || '').trim() : type
  const number = formatGovernmentNumber(type, body.GovernmentNumber).trim()
  const attachment = mode === 'delete' ? null : parseGovernmentAttachment(body)
  if (attachment && body.RemoveAttachment === true) throw createError({ statusCode: 400, statusMessage: 'Choose either a replacement scan or Remove attachment.' })
  const connection = await pool.getConnection()
  let createdFile: string | null = null, oldFile: string | null = null, committed = false, locked = false
  try {
    const [[lock]] = await connection.execute("SELECT GET_LOCK('pbsystem:government-id-write',10) AS acquired")
    if (Number(lock.acquired) !== 1) throw createError({ statusCode: 503, statusMessage: 'Government IDs are being updated. Please try saving again shortly.' })
    locked = true
    await connection.beginTransaction()
    const [[employee]] = await connection.execute<any[]>('SELECT EmployeeID FROM employee WHERE EmployeeID=? FOR UPDATE', [employeeId])
    if (!employee) throw createError({ statusCode: 404, statusMessage: 'Employee not found.' })
    const [[current]] = governmentId ? await connection.execute<any[]>('SELECT GovernmentID,AttachmentPath FROM government WHERE GovernmentID=? AND EmployeeID=? FOR UPDATE', [governmentId, employeeId]) : [[]]
    if (mode !== 'create' && !current) throw createError({ statusCode: 404, statusMessage: 'Government ID record not found.' })
    if (mode === 'delete') {
      await connection.execute('DELETE FROM government WHERE GovernmentID=? AND EmployeeID=?', [governmentId, employeeId])
      oldFile = current.AttachmentPath
      await connection.commit(); committed = true
      return { success: true }
    }
    await checkGovernmentDuplicate(employeeId, governmentId, typeName, number, attachment?.hash, connection)
    let recordId = governmentId
    if (mode === 'create') {
      const [result] = await connection.execute<any>('INSERT INTO government (EmployeeID,GovernmentType,GovernmentNumber) VALUES (?,?,?)', [employeeId, typeName, number])
      recordId = Number(result.insertId)
    } else await connection.execute('UPDATE government SET GovernmentType=?,GovernmentNumber=? WHERE GovernmentID=? AND EmployeeID=?', [typeName, number, recordId, employeeId])
    if (attachment) {
      await fs.mkdir(storageDirectory(), { recursive: true, mode: 0o700 })
      const newFile = storedFile(attachment.filename)
      await fs.writeFile(newFile, attachment.data, { flag: 'wx', mode: 0o600 })
      createdFile = newFile
      await connection.execute('UPDATE government SET AttachmentPath=?,AttachmentName=?,AttachmentMimeType=?,AttachmentSize=?,AttachmentSHA256=? WHERE GovernmentID=? AND EmployeeID=?', [attachment.filename, attachment.name, attachment.mime, attachment.data.length, attachment.hash, recordId, employeeId])
      oldFile = current?.AttachmentPath || null
    } else if (body.RemoveAttachment === true) {
      await connection.execute('UPDATE government SET AttachmentPath=NULL,AttachmentName=NULL,AttachmentMimeType=NULL,AttachmentSize=NULL,AttachmentSHA256=NULL WHERE GovernmentID=? AND EmployeeID=?', [recordId, employeeId])
      oldFile = current?.AttachmentPath || null
    }
    await connection.commit(); committed = true
    return { success: true, id: recordId }
  } catch (error) {
    await connection.rollback()
    if (createdFile) await fs.unlink(createdFile).catch(() => undefined)
    if ((error as any)?.code === 'ER_DUP_ENTRY') throw createError({ statusCode: 409, statusMessage: 'This government ID number or exact scan is already saved. Review the existing employee record before trying again.' })
    throw error
  } finally {
    if (locked) await connection.execute("SELECT RELEASE_LOCK('pbsystem:government-id-write')").catch(() => undefined)
    connection.release()
    if (committed && oldFile) {
      try { await fs.unlink(storedFile(oldFile)) } catch { /* A missing old scan must not undo a committed ID update. */ }
    }
  }
}

export async function governmentIdAttachment(event: any) {
  const session = requireSession(event)
  void session.sub
  const recordId = id(getRouterParam(event, 'id'), 'Government ID record')
  const [[record]] = await pool.execute<any[]>('SELECT AttachmentPath,AttachmentName,AttachmentMimeType FROM government WHERE GovernmentID=?', [recordId])
  if (!record?.AttachmentPath || !fileTypes[record.AttachmentMimeType]) throw createError({ statusCode: 404, statusMessage: 'ID attachment not found.' })
  let data: Buffer
  try { data = await fs.readFile(storedFile(record.AttachmentPath)) } catch { throw createError({ statusCode: 404, statusMessage: 'ID attachment file is missing.' }) }
  setHeader(event, 'Content-Type', record.AttachmentMimeType)
  setHeader(event, 'Content-Length', String(data.length))
  setHeader(event, 'Content-Disposition', `inline; filename="id-scan.${fileTypes[record.AttachmentMimeType]}"; filename*=UTF-8''${encodeURIComponent(record.AttachmentName || 'ID scan')}`)
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'")
  return data
}
