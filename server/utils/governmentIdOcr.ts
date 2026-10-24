import { createError, readBody } from 'h3'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { requireSession } from './auth'
import { checkGovernmentDuplicate, parseGovernmentAttachment } from './governmentIdCrud'
import { governmentIdType } from '../../shared/utils/governmentIds'
import { extractGovernmentId } from '../../shared/utils/governmentIdOcr'

let activeReads = 0
export async function recognizeGovernmentId(event: any) {
  const session = requireSession(event)
  if (session.userType === 'Viewer' || event.context?.moduleCanEdit === false) throw createError({ statusCode: 403, statusMessage: 'You do not have edit access to employee documents.' })
  const body = await readBody<Record<string, unknown>>(event) || {}
  const attachment = parseGovernmentAttachment(body)
  if (!attachment) throw createError({ statusCode: 400, statusMessage: 'Choose an ID scan first.' })
  const employeeId = body.employeeId == null ? null : Number(body.employeeId)
  const recordId = body.id == null ? 0 : Number(body.id)
  if (employeeId !== null && (!Number.isSafeInteger(employeeId) || employeeId <= 0 || !Number.isSafeInteger(recordId) || recordId < 0)) throw createError({ statusCode: 400, statusMessage: 'Choose a valid employee and ID record.' })
  if (employeeId !== null) await checkGovernmentDuplicate(employeeId, recordId, undefined, undefined, attachment.hash)
  if (process.platform !== 'win32') throw createError({ statusCode: 503, statusMessage: 'Local scan reading requires Windows OCR on this server. Enter the ID details manually.' })
  const script = path.resolve(process.env.GOVERNMENT_ID_OCR_SCRIPT || 'scripts/read-government-id-ocr.ps1')
  try { await fs.access(script) } catch { throw createError({ statusCode: 503, statusMessage: 'Local scan reading is not configured. Enter the ID details manually.' }) }
  const root = path.resolve('.data', 'government-id-ocr')
  if (activeReads >= 2) throw createError({ statusCode: 429, statusMessage: 'Scan reading is busy. Try again shortly or enter details manually.' })
  let directory: string | null = null
  activeReads++
  try {
    await fs.mkdir(root, { recursive: true, mode: 0o700 })
    directory = await fs.mkdtemp(path.join(root, 'scan-'))
    const file = path.join(directory, attachment.filename)
    await fs.writeFile(file, attachment.data, { flag: 'wx', mode: 0o600 })
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-ImagePath', file], {
        windowsHide: true, timeout: 45000, maxBuffer: 512 * 1024, encoding: 'utf8',
      }, (error, result) => error ? reject(error) : resolve(result))
    })
    const recognized = JSON.parse(stdout.replace(/^\uFEFF/, '').trim())
    const hint = body.IdType ? governmentIdType(body.IdType) : ''
    const details = extractGovernmentId(recognized.text, hint)
    if (employeeId !== null && details.type && details.number) await checkGovernmentDuplicate(employeeId, recordId, details.type, details.number)
    return { ...details, engine: 'Windows OCR', pages: Number(recognized.pages || 1), local: true }
  } catch (error) {
    if ((error as any)?.statusCode === 409) throw error
    throw createError({ statusCode: 422, statusMessage: 'This scan could not be read automatically. Enter the details manually or upload a clearer image/PDF.' })
  } finally {
    activeReads--
    if (directory && path.dirname(path.resolve(directory)) === root && path.basename(directory).startsWith('scan-')) {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
