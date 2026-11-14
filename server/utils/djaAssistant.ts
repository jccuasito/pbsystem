import { createError, readBody, setHeader } from 'h3'
import pool from '../connection/dbconnect'
import { requireSession } from './auth'
import { currentActor, accessForUser } from './settingsAccess'
import { assistantPages, assistantCanView, parseAssistantCommand, assistantGuides, findAssistantGuide, assistantGuideReply, assistantScopeReply, type AssistantAccess, type AssistantReply } from '../../shared/utils/djaAssistant'

const limits = new Map<number, { count: number; expires: number }>()
function limitUser(event: any, id: number) {
  const now = Date.now()
  for (const [key, state] of limits) if (state.expires <= now) limits.delete(key)
  let state = limits.get(id)
  if (!state) {
    if (limits.size >= 10000) throw createError({ statusCode: 503, statusMessage: 'Please try again shortly.' })
    state = { count: 0, expires: now + 60000 }; limits.set(id, state)
  }
  if (++state.count > 20) {
    setHeader(event, 'Retry-After', Math.ceil((state.expires - now) / 1000))
    throw createError({ statusCode: 429, statusMessage: 'Please wait a minute before asking again.' })
  }
}

// Fixed SELECT statements only. Never accept SQL, table names or filters from a prompt.
export const assistantTools = {
  activeLoans: { module: 'deductions', view: 'employee-loans-deductions', table: 'employee_loan', monthly: false, format: 'count', label: ['Active loan records now', 'Active loan records ngayon'], sql: 'SELECT COUNT(*) AS value FROM employee_loan WHERE Status = ?', params: () => ['Active'] },
  issuedLoans: { module: 'deductions', view: 'employee-loans-deductions', table: 'employee_loan', monthly: true, format: 'count', label: ['Loans released', 'Na-release na loans'], sql: 'SELECT COUNT(*) AS value FROM employee_loan WHERE ReleaseDate >= ? AND ReleaseDate < ? AND Status <> ?', params: (start: string, end: string) => [start, end, 'Cancelled'] },
  activeEmployees: { module: 'employees', view: 'employees-list', table: 'employee', monthly: false, format: 'count', label: ['Active employees now', 'Active employees ngayon'], sql: 'SELECT COUNT(*) AS value FROM employee WHERE Status = ?', params: () => ['Active'] },
  hiredEmployees: { module: 'employees', view: 'employees-list', table: 'employee', monthly: true, format: 'count', label: ['Employees hired', 'Mga na-hire na empleyado'], sql: 'SELECT COUNT(*) AS value FROM employee WHERE DateHired >= ? AND DateHired < ?', params: (start: string, end: string) => [start, end] },
  pendingPayroll: { module: 'payroll', view: 'payroll-processing', table: 'payroll', monthly: false, format: 'count', label: ['Payroll records for approval now', 'Payroll records na For Approval ngayon'], sql: 'SELECT COUNT(*) AS value FROM payroll WHERE Status = ?', params: () => ['For Approval'] },
  billingTotal: { module: 'billing', view: 'billing-history', table: 'billing', monthly: true, format: 'php', label: ['Recorded billing total', 'Recorded billing total'], sql: 'SELECT COALESCE(SUM(TotalAmount), 0) AS value FROM billing WHERE BillingDate >= ? AND BillingDate < ?', params: (start: string, end: string) => [start, end] },
  presentToday: { module: 'attendance', view: 'attendance-dtr', table: 'attendance', monthly: false, format: 'count', label: ['Employees recorded Present today', 'Employees na recorded Present ngayong araw'], sql: 'SELECT COUNT(DISTINCT EmployeeID) AS value FROM attendance WHERE AttendanceDate = ? AND AttendanceStatus = ?', params: (_start: string, _end: string, today: string) => [today, 'Present'] }
} as const

export async function answerAssistant(prompt: string, view: string, locale: 'auto' | 'en' | 'fil', access: AssistantAccess, now = new Date(), db = pool, options: { guideId?: string; contextGuide?: string } = {}): Promise<AssistantReply> {
  const command = parseAssistantCommand(prompt, view, locale, now), fil = command.language === 'fil'
  const reply = (text: string): AssistantReply => ({ text, generatedAt: now.toISOString() })
  if (options.guideId || command.intent === 'help' || command.intent === 'unsupported') {
    const resolved = findAssistantGuide(prompt, view, options.contextGuide)
    const explicitSelection = /^(?:show steps|show guide|ipakita ang steps)$/i.test(prompt.trim())
    const found = options.guideId
      ? (explicitSelection || resolved?.guide.id===options.guideId ? {guide:assistantGuides.find(item=>item.id===options.guideId),unsupportedAction:false} : null)
      : resolved
    if (found?.guide) {
      if (!assistantCanView(access, assistantPages[found.guide.view].module)) throw createError({ statusCode: 403, statusMessage: 'You do not have access to this page.' })
      return assistantGuideReply(found.guide, command.language, now, found.unsupportedAction)
    }
  }
  if (command.intent === 'unsupported' || command.intent === 'help') return assistantScopeReply(command.language,now)
  const tool = assistantTools[command.intent]
  if (!assistantCanView(access, tool.module)) throw createError({ statusCode: 403, statusMessage: 'You do not have view access to the requested module.' })
  if (!tool.monthly && command.dated && (command.historical || command.intent !== 'activeLoans')) {
    return reply(fil ? 'Kasalukuyang status lang ang supported para sa count na ito; hindi ito historical month-end report. Para sa monthly loans, itanong ang “Ilan ang loans released September 2026?”' : 'This count supports current status only, not a historical month-end report. For monthly loans, ask “How many loans released September 2026?”')
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const [rows] = await db.execute<any[]>(tool.sql, tool.params(command.period.start, command.period.end, today))
  const raw = rows[0]?.value, value = Number(raw)
  if (raw === null || raw === undefined || !['number', 'string'].includes(typeof raw) || String(raw).trim() === '' || !Number.isFinite(value) || (tool.format === 'count' && (!Number.isSafeInteger(value) || value < 0))) throw createError({ statusCode: 503, statusMessage: 'The summary is temporarily unavailable.' })
  let text = fil ? 'Buong system ang sakop, ayon sa module access mo. Hindi kasama ang filters ng kasalukuyang page.' : 'System-wide summary within your module access. Current page filters are not applied.'
  if (command.intent === 'activeLoans') text += fil ? ' Kasalukuyang Active records ito, kasama ang paused loans. Hindi lang mga loan na na-release ngayong buwan, at hindi historical month-end count.' : 'These are records currently marked Active, including paused loans. This is not just loans released this month or a historical month-end count.'
  if (command.intent === 'issuedLoans') text += fil ? ' Ayon sa Release Date; hindi kasama ang Cancelled. Kasama ang Paid records.' : 'By Release Date; excludes Cancelled and includes Paid records.'
  if (command.intent === 'billingTotal') text += fil ? ' Sum ng recorded Total Amount ayon sa Billing Date, gaya ng dashboard; hindi ito koleksyon o netong kita.' : 'Sum of recorded Total Amount by Billing Date, matching the dashboard basis; this is not collections or profit.'
  if (command.intent === 'presentToday') text += fil ? ' Attendance records na Present lang ang binibilang; hindi ito lahat ng posibleng worked DTR statuses.' : 'Counts attendance records marked Present only, not every possible worked DTR status.'
  return { ...reply(text), metric: { label: tool.label[fil ? 1 : 0], value, format: tool.format }, scope: tool.monthly ? command.period.label : today + ' · Asia/Manila', source: assistantPages[tool.view].title, link: { view: tool.view, label: assistantPages[tool.view].title } }
}

export async function queryAssistant(event: any) {
  const session = requireSession(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  const actor = await currentActor(event)
  const access = await accessForUser(actor.UserID, actor.UserType)
  limitUser(event, session.sub)
  const body = await readBody(event)
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['prompt', 'view', 'locale', 'guideId', 'contextGuide'].includes(key)) || typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 500 || /[\u0000-\u001f\u007f]/.test(body.prompt)) throw createError({ statusCode: 400, statusMessage: 'Ask a question of 1 to 500 characters.' })
  const view = body.view ?? 'dashboard', locale = body.locale ?? 'auto'
  if (typeof view !== 'string' || !Object.hasOwn(assistantPages, view) || !['auto', 'en', 'fil'].includes(locale)) throw createError({ statusCode: 400, statusMessage: 'Select a valid page and language.' })
  for (const key of ['guideId', 'contextGuide']) if (body[key] !== undefined && (typeof body[key] !== 'string' || !assistantGuides.some(item => item.id === body[key]))) throw createError({ statusCode: 400, statusMessage: 'Select a valid help topic.' })
  try { return await answerAssistant(body.prompt.trim(), view, locale, access, new Date(), pool, { guideId: body.guideId, contextGuide: body.contextGuide }) }
  catch (error: any) {
    if ([400, 401, 403, 429].includes(error.statusCode)) throw error
    console.error('[DJA assistant] Summary read failed', error.code || error.name)
    throw createError({ statusCode: 503, statusMessage: 'The summary is temporarily unavailable. Please try again shortly.' })
  }
}
