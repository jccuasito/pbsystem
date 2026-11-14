/** Curated system help and bounded bilingual commands. No prompt becomes SQL or HTML. */
import { assistantGuides, findAssistantGuide, findPortalAssistantGuide, normalizeAssistantQuestion, type AssistantGuide } from './djaAssistantGuides.ts'
export { assistantGuides, findAssistantGuide } from './djaAssistantGuides.ts'
export type AssistantLanguage = 'en' | 'fil'
export type AssistantAccess = Record<string, { canView: boolean; canEdit?: boolean }>
export type AssistantPage = { title: string; module: string; en: string; fil: string }
const page = (title: string, module: string, en: string, fil: string): AssistantPage => ({ title, module, en, fil })
export const assistantPages: Record<string, AssistantPage> = {
  dashboard: page('Dashboard', 'dashboard', 'Review current overview cards and payroll run progress. Choose a cutoff in Payroll Run Progress to review site completion.', 'Makikita rito ang overview at payroll run progress. Pumili ng cutoff sa Payroll Run Progress para makita ang completion ng mga site.'),
  'employees-list': page('Employee List', 'employees', 'Find employee profiles here. Use the existing add or edit controls to maintain employee details.', 'Hanapin dito ang employee profiles. Gamitin ang add o edit para sa employee details.'),
  'employees-deployments': page('Deployment History', 'employees', 'Review employee assignments and their deployment dates.', 'Suriin ang assignments at deployment dates ng employee.'),
  'employees-documents': page('Employee Documents', 'employees', 'Open an employee to review their profile and document categories. Profile details are maintained in Employee List.', 'Buksan ang employee para makita ang profile at dokumento. Sa Employee List ina-update ang profile details.'),
  'employees-status': page('Employee Status', 'employees', 'Review employee status and the existing status workflow here.', 'Suriin dito ang employee status at ang kasalukuyang status workflow.'),
  'employees-portal-accounts': page('Portal Accounts', 'employees', 'Authorized account managers maintain employee portal access here. Payslip posting is managed separately under Payroll.', 'Dito inaasikaso ng authorized account managers ang portal access. Hiwalay ang payslip posting sa Payroll.'),
  'organization-agency': page('Agencies', 'organization', 'Maintain agency records used by employee assignments, attendance and payroll.', 'Dito inaayos ang agency records para sa assignments, attendance at payroll.'),
  'organization-position': page('Positions', 'organization', 'Maintain the positions available for employee and agency setup.', 'Dito inaayos ang positions para sa employee at agency setup.'),
  'organization-client': page('Clients', 'organization', 'Maintain client records used by sites and billing.', 'Dito inaayos ang client records para sa sites at billing.'),
  'organization-site': page('Sites', 'organization', 'Review sites and their agency/client assignments before preparing attendance.', 'Suriin ang sites at agency/client assignments bago maghanda ng attendance.'),
  'organization-site-accounts': page('Site Accounts', 'organization', 'Maintain site account groupings used by related site workflows.', 'Dito inaayos ang site account groupings para sa mga kaugnay na site workflow.'),
  'organization-region': page('Regions', 'organization', 'Maintain region records used by the system setup.', 'Dito inaayos ang region records na ginagamit sa system setup.'),
  'attendance-dtr': page('Daily Time Records', 'attendance', 'Choose a payroll cutoff and open a site DTR. Excel imports allow incomplete biometric punches for manual correction; missing punches are not filled automatically. Review attendance before payroll processing.', 'Pumili ng cutoff at buksan ang site DTR. Puwedeng may kulang na biometric punch sa Excel; mano-manong itama sa DTR. Hindi awtomatikong pinupunan ang kulang na punch. Suriin bago mag-payroll.'),
  'attendance-dtr-reliever': page('DTR Reliever', 'attendance', 'Review reliever attendance using the existing reliever workflow.', 'Suriin ang reliever attendance gamit ang kasalukuyang reliever workflow.'),
  'attendance-shift-code': page('Shift Codes', 'attendance', 'Maintain agency shift codes. An imported shift must exist and be active for its DTR agency.', 'Dito inaayos ang agency shift codes. Kailangang existing at active sa DTR agency ang imported shift code.'),
  'attendance-holiday-manager': page('Holiday Manager', 'attendance', 'Review legal and special holiday dates for the selected year. Active holiday records are used by DTR; verify the applicable location and official dates before payroll.', 'Suriin ang legal at special holidays sa napiling taon. Binabasa ng DTR ang active records; tiyakin ang sakop na lugar at petsa bago mag-payroll.'),
  'payroll-processing': page('Payroll Processing', 'payroll', 'Review attendance, rates and computed amounts before using the existing approval/finalization controls.', 'Suriin ang attendance, rates at computed amounts bago gamitin ang approval/finalization controls.'),
  'payroll-adjustments': page('Payroll Adjustments', 'payroll', 'Review payroll adjustments and their applicable periods here.', 'Suriin dito ang payroll adjustments at ang sakop na period.'),
  'payroll-thirteenth-month': page('13th-Month Pay', 'payroll', 'This module is under development and for testing. Review annual basic earnings, computation coverage and release history; do not treat test results as an approved payout.', 'Under development at for testing pa ang module. Suriin ang annual basic earnings, coverage at release history; hindi approved payout ang test results.'),
  payslip: page('Payslips', 'payslips', 'Review employee payslip history and publication status. Only valid Posted payslips are visible in the employee portal.', 'Suriin ang payslip history at publication status. Valid na Posted payslips lang ang nakikita sa employee portal.'),
  'payslip-sites': page('Payslips by Site Account', 'payslips', 'Choose an account, agency and cutoff, review finalized sources, then use the existing posting controls. Finalizing payroll does not automatically post payslips.', 'Pumili ng account, agency at cutoff at suriin ang finalized sources bago mag-post. Hindi automatic na posted ang payslip kapag finalized ang payroll.'),
  'payroll-history': page('Payroll History', 'payroll', 'Review finalized payroll and cancelled posting history by site and cutoff.', 'Suriin ang finalized payroll at cancelled posting history ayon sa site at cutoff.'),
  'payroll-summary': page('Payroll Summary', 'payroll', 'Review payroll summaries and use the page filters to select the relevant records.', 'Suriin ang payroll summaries gamit ang filters ng page.'),
  'billing-generate': page('Generate Billing', 'billing', 'Review the billing period, site and applicable billing rates before generating or finalizing a billing record.', 'Suriin ang billing period, site at billing rates bago gumawa o mag-finalize ng billing record.'),
  'billing-history': page('Billing History', 'billing', 'Find billing records and review their recorded amounts and dates.', 'Hanapin ang billing records at suriin ang recorded amounts at dates.'),
  'rates-payroll': page('Payroll Rates', 'rates', 'Maintain payroll rates and verify their applicability before processing payroll.', 'Ayusin at tiyakin ang applicable payroll rates bago mag-process ng payroll.'),
  'rates-billing': page('Billing Rates', 'rates', 'Maintain billing rates used by billing preparation.', 'Dito inaayos ang billing rates para sa billing preparation.'),
  'rates-site': page('Site Rates', 'rates', 'Review site rate assignments and applicability.', 'Suriin ang rate assignments at applicability sa site.'),
  'employee-loans-deductions': page('Employee Loans & Deductions', 'deductions', 'Review employee loans, balances and repayment schedules. Active loans means loan records with current status Active, including paused records; it is not a historical month-end balance.', 'Suriin ang loans, balances at repayment schedules. Ang active loans ay records na kasalukuyang Active, kasama ang paused; hindi ito historical month-end balance.'),
  'deductions-loans-cash-bonds': page('Cash Bonds', 'deductions', 'Review cash bond records using the existing cash bond workflow.', 'Suriin ang cash bond records gamit ang kasalukuyang workflow.'),
  'deductions-loans-contributions': page('Contributions', 'deductions', 'Review agency contribution setup and applicable contribution records.', 'Suriin ang agency contribution setup at applicable records.'),
  'deductions-loans-transactions': page('Account Transactions', 'deductions', 'Review recorded employee account transactions and their payroll references.', 'Suriin ang employee account transactions at payroll references.'),
  'deductions-loans-catalog': page('Loan & Deduction Catalog', 'deductions', 'Maintain classifications and items used by employee loans and deductions.', 'Dito inaayos ang classifications at items para sa employee loans at deductions.'),
  reports: page('Reports', 'reports', 'Report availability depends on the implemented report controls. This helper does not generate a custom report.', 'Depende sa implemented controls ang available reports. Hindi gumagawa ng custom report ang helper.'),
  settings: page('Settings', 'settings', 'Manage your account preferences here. Team access, backups and database controls require an administrator.', 'Dito inaayos ang account preferences. Administrator ang kailangan para sa team access, backups at database controls.'),
  'employee-portal': page('Employee Portal', 'portal', 'Use your own employee payslip portal and account controls.', 'Gamitin ang sariling employee payslip portal at account controls.')
}
export function assistantCanView(access: AssistantAccess, module: string) {
  return module === 'settings' || access[module]?.canView === true || (module === 'portal' && access.employees?.canView === true)
}
export type AssistantIntent = 'help' | 'activeLoans' | 'issuedLoans' | 'activeEmployees' | 'hiredEmployees' | 'pendingPayroll' | 'billingTotal' | 'presentToday' | 'unsupported'
export type AssistantCommand = { intent: AssistantIntent; language: AssistantLanguage; view: string; period: { start: string; end: string; label: string }; historical: boolean; dated: boolean }
export type AssistantReply = { text: string; generatedAt: string; source?: string; scope?: string; heading?: string; steps?: string[]; topic?: string; related?: { id: string; label: string }[]; metric?: { label: string; value: number; format: 'count' | 'php' }; link?: { view: string; label: string } }
export function assistantScopeReply(language: AssistantLanguage, now = new Date()): AssistantReply {
  return {
    heading: language==='fil' ? 'Saklaw at limitasyon' : 'Scope and limitations',
    text: language==='fil'
      ? 'Paumanhin, hindi sakop ng aking mga suportadong gawain ang tanong na ito. Nakalaan ang DJA Assistant sa pagbibigay ng gabay sa paggamit ng DJA Payroll Management System at mga suportadong buod ng datos, alinsunod sa iyong access permissions. Mangyaring magtanong tungkol sa mga module ng system o pumili ng paksa sa Help topics.'
      : 'This request is outside the supported scope of DJA Assistant. I provide guidance on using the DJA Payroll Management System and supported data summaries, subject to your access permissions. Please ask a question about the system’s modules or select a topic under Help topics.',
    source: 'DJA Assistant', generatedAt: now.toISOString()
  }
}
export function assistantLanguage(prompt: string, locale: 'auto' | AssistantLanguage = 'auto'): AssistantLanguage {
  return locale === 'auto' ? /\b(ilan|ilang|magkano|ngayong|nakaraang|paano|pano|papano|ano|bakit|saan|pakita|ipakita|empleyado|pahiram|tulong|gumawa|magdagdag)\b/.test(normalizeAssistantQuestion(prompt)) ? 'fil' : 'en' : locale
}
export function assistantGuideReply(guide: AssistantGuide, language: AssistantLanguage, now = new Date(), unsupportedAction = false): AssistantReply {
  const page = assistantPages[guide.view], fil = language === 'fil'
  const text = unsupportedAction
    ? fil ? 'Wala pang verified steps para sa partikular na action na iyan. Narito ang available page guide; piliin ang kaugnay na topic kung ito ang kailangan mo.' : 'Verified steps for that particular action are not available yet. Here is the available page guide; choose a related topic if that is what you need.'
    : fil ? 'Narito ang proseso sa system. Gagawin mo ang mga hakbang gamit ang existing controls at permissions mo; walang record na binago ng assistant.' : 'Here are the steps in the system. Use the existing controls with your permissions; the assistant has not changed any records.'
  return { text, generatedAt: now.toISOString(), heading: guide.title[language], steps: guide.steps[language], topic: guide.id, scope: page.title, source: 'DJA workflow guide', related: assistantGuides.filter(item => item.view === guide.view && item.id !== guide.id).map(item => ({ id: item.id, label: item.title[language] })), ...(guide.view === 'employee-portal' ? {} : { link: { view: guide.view, label: page.title } }) }
}
/** Portal help runs locally and can only return public portal instructions, never staff data. */
export function portalAssistantReply(prompt: string, locale: 'auto' | AssistantLanguage, guideId?: string, contextGuide?: string, now = new Date()): AssistantReply {
  const language = assistantLanguage(prompt, locale)
  const found = findPortalAssistantGuide(prompt,contextGuide)
  const selected = guideId ? assistantGuides.find(item=>item.id===guideId && item.view==='employee-portal') : found?.guide
  const explicitSelection = /^(?:show steps|show guide|ipakita ang steps)$/.test(normalizeAssistantQuestion(prompt))
  if (selected && (found || (guideId && explicitSelection))) {
    const answer=assistantGuideReply(selected,language,now)
    return {...answer,text:language==='fil' ? 'Narito ang gabay para sa sarili mong portal account at payslip. Ikaw ang gagamit ng portal controls; walang personal na record na binabasa o binabago ng assistant.' : 'Here is a guide for your own portal account and payslips. Use the portal controls yourself; the assistant does not read or change personal records.'}
  }
  return { text: language === 'fil' ? 'Portal account at sariling payslip lang ang sakop ng helper dito: registration, password recovery, account details, at pagtingin o pag-save ng payslip. Hindi ako nagbibigay ng sahod, payslip, personal na impormasyon ng ibang empleyado, o gabay sa staff payroll system. Piliin ang Help topics para sa portal guides; para sa payroll concerns, makipag-ugnayan sa HR.' : 'This helper provides portal guides only: registration, password recovery, account details, and viewing or saving your own payslips. I cannot provide another employee’s salary, payslips or personal information, or instructions for the staff payroll system. Choose Help topics for portal guides; contact HR about payroll concerns.', generatedAt: now.toISOString(), source: 'Employee Portal guide' }
}

/** Deliberately accepts complete known questions only; extra filters are never silently ignored. */
export function parseAssistantCommand(prompt: string, view = 'dashboard', locale: 'auto' | AssistantLanguage = 'auto', now = new Date()): AssistantCommand {
  let text = prompt.toLowerCase().normalize('NFKC').replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ').trim()
  const language = assistantLanguage(prompt, locale)
  text = text.replace(/^(?:hey\s+)?dja\s*(?:ai|assistant)?\s*/, '').replace(/^(?:please\s+)?(?:can you |could you )?(?:please )?(?:show me |tell me |ipakita mo |ipakita |pakita mo |pakita )/, '').replace(/\s+please$/, '')
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Manila', year: 'numeric', month: 'numeric' }).formatToParts(now)
  const currentYear = Number(parts.find(p => p.type === 'year')!.value), currentMonth = Number(parts.find(p => p.type === 'month')!.value)
  let year = currentYear, month = currentMonth, dated = false
  if (/\s+(?:this month|ngayong buwan)$/.test(text)) { dated = true; text = text.replace(/\s+(?:this month|ngayong buwan)$/, '') }
  else if (/\s+(?:last month|nakaraang buwan)$/.test(text)) { dated = true; month--; if (!month) { month = 12; year-- }; text = text.replace(/\s+(?:last month|nakaraang buwan)$/, '') }
  else {
    const match = /\s+(?:in |noong |sa )?(january|february|march|april|may|june|july|august|september|october|november|december) (20\d{2})$/.exec(text)
    if (match) { dated = true; month = ['january','february','march','april','may','june','july','august','september','october','november','december'].indexOf(match[1]) + 1; year = Number(match[2]); text = text.slice(0, match.index) }
  }
  const start = `${year}-${String(month).padStart(2,'0')}-01`
  const end = `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2,'0')}-01`
  const label = new Intl.DateTimeFormat(language === 'fil' ? 'fil-PH' : 'en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(start + 'T00:00:00Z'))
  let intent: AssistantIntent = 'unsupported'
  if (/^(?:help|help me|explain this page|how do i use this page|paano gamitin ito|paano gamitin ang page na ito|ano ang page na ito|tulong)$/.test(text) && !dated) intent = 'help'
  else if (/^(?:(?:how many|number of|ilan ang|ilang) )?active loans(?: are there)?$/.test(text)) intent = 'activeLoans'
  else if (/^(?:(?:how many|number of|ilan ang|ilang) )?(?:loans (?:issued|released)|na release na loans)$/.test(text)) intent = 'issuedLoans'
  else if (/^(?:(?:how many|number of|ilan ang|ilang) )?(?:active employees|aktibong empleyado)(?: are there)?$/.test(text)) intent = 'activeEmployees'
  else if (/^(?:(?:how many|number of|ilan ang|ilang) )?(?:employees hired|bagong empleyado)$/.test(text)) intent = 'hiredEmployees'
  else if (/^(?:(?:how many|number of|ilan ang|ilang) )?(?:pending payroll|payroll for approval)(?: are there)?$/.test(text)) intent = 'pendingPayroll'
  else if (/^(?:(?:how much is|magkano ang|what is) )?(?:total billing|billing total)$/.test(text)) intent = 'billingTotal'
  else if (/^(?:(?:how many|number of|ilan ang|ilang) )?(?:present today|employees present today)$/.test(text) && !dated) intent = 'presentToday'
  return { intent, language, view, period: { start, end, label }, historical: year !== currentYear || month !== currentMonth, dated }
}

export function assistantSuggestions(view: string, access: AssistantAccess, language: AssistantLanguage) {
  const fil = language === 'fil'
  const local = assistantGuides.filter(item => item.view === view).slice(0, 2).map(item => ({ module: assistantPages[view]?.module || 'dashboard', text: `${fil ? 'Paano: ' : 'How to: '}${item.title[language]}?` }))
  const items = [{ module: assistantPages[view]?.module || 'dashboard', text: fil ? 'Paano gamitin ito?' : 'Explain this page' }, ...local,
    { module: 'deductions', text: fil ? 'Ilan ang active loans ngayong buwan?' : 'How many active loans this month?' },
    { module: 'employees', text: fil ? 'Ilan ang active employees?' : 'How many active employees?' },
    { module: 'billing', text: fil ? 'Magkano ang total billing ngayong buwan?' : 'Total billing this month' },
    { module: 'payroll', text: fil ? 'Ilan ang pending payroll?' : 'How many pending payroll?' }]
  return items.filter(item => assistantCanView(access, item.module)).map(item => item.text)
}
