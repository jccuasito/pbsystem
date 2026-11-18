/** Verified workflow knowledge. Instructions only: nothing here executes an action. */
export type AssistantGuide = { id: string; view: string; title: { en: string; fil: string }; actions: string[]; steps: { en: string[]; fil: string[] }; stepGuideIds?: string[]; relatedIds?: string[] }
const guide = (id: string, view: string, en: string, fil: string, actions: string[], english: string[], filipino: string[]): AssistantGuide => ({ id, view, title: { en, fil }, actions, steps: { en: english, fil: filipino } })
export const assistantGuides: AssistantGuide[] = [
  {
    ...guide('system-start','dashboard','Start using the payroll system step by step','Simulan ang paggamit ng payroll system nang sunod-sunod',['use','setup'],[
      'Start in Settings > Workspace access to check your View/Edit permissions. Complete the steps assigned to your role and coordinate the remaining setup with the authorized staff.',
      'Prepare Organization: agencies and positions, regions, clients, sites and site accounts. Verify the correct agency/client/site relationships before encoding employees and attendance.',
      'Create the employee profiles in Employee List and complete their applicable documents in Employee Documents. Review duplicate notices and the employee agency/position.',
      'Set up the applicable Payroll Rates and Billing Rates, then link them through Site Rates. Check effective dates and agency/position matches.',
      'Prepare the agency Shift Codes and applicable Holiday Manager dates before importing biometric attendance.',
      'If applicable, prepare the Loan & Deduction Catalog, employee issuances and agency/position contribution or recurring plans. Review repayment dates and cutoff settings.',
      'In Daily Time Records, select the correct site and cutoff, create/open the DTR and add the employees as Regular / Fixed or Reliever. Import Excel or encode attendance, manually correct missing punches and unknown shifts, and record BTR when applicable. Review before Compute to payroll.',
      'In Payroll Processing, Review the site cutoff, rates, hours, earnings and deductions. An authorized user finalizes after resolving warnings. Finalization does not pay salary or post payslips.',
      'In Payslips by Site Account, review finalized payroll sources and Post selected payslips. Only valid Posted payslips become visible in the employee portal.',
      'In Portal Accounts, review employee portal access and assist with account/recovery concerns through the existing authorized controls. An employee uses their own portal account to view posted payslips.',
      'For client billing, use Generate Billing to review applicable sources, rates and charges, then save/review/finalize through the available controls. Use Billing History to review saved bills.'
    ],[
      'Magsimula sa Settings > Workspace access para makita ang View/Edit permissions mo. Gawin ang nakatalaga sa role mo at makipag-ugnayan sa authorized staff para sa natitirang setup.',
      'Ihanda ang Organization: agencies at positions, regions, clients, sites at site accounts. Tiyakin ang tamang agency/client/site relationships bago mag-encode ng employees at attendance.',
      'Gumawa ng employee profiles sa Employee List at kumpletuhin ang applicable documents sa Employee Documents. Suriin ang duplicate notices at agency/position ng employee.',
      'I-set up ang applicable Payroll Rates at Billing Rates, saka i-link sa Site Rates. Tiyakin ang effective dates at tugmang agency/position.',
      'Ihanda ang agency Shift Codes at applicable dates sa Holiday Manager bago mag-import ng biometric attendance.',
      'Kung applicable, ihanda ang Loan & Deduction Catalog, employee issuances at agency/position contribution o recurring plans. Suriin ang repayment dates at cutoff settings.',
      'Sa Daily Time Records, piliin ang tamang site at cutoff, gumawa/buksan ang DTR at idagdag ang employees bilang Regular / Fixed o Reliever. Mag-import ng Excel o mag-encode, mano-manong ayusin ang kulang na punches at unknown shifts, at mag-record ng BTR kung kailangan. I-review bago Compute to payroll.',
      'Sa Payroll Processing, i-Review ang site cutoff, rates, hours, earnings at deductions. Authorized user ang magfa-finalize matapos maayos ang warnings. Hindi salary payment o payslip posting ang finalization.',
      'Sa Payslips by Site Account, suriin ang finalized payroll sources at piliin ang Post selected payslips. Valid na Posted payslips lang ang nakikita sa employee portal.',
      'Sa Portal Accounts, suriin ang employee portal access at tumulong sa account/recovery concerns gamit ang authorized controls. Sariling portal account ng employee ang para sa kanyang posted payslips.',
      'Para sa client billing, gamitin ang Generate Billing: suriin ang applicable sources, rates at charges bago mag-save/review/finalize sa available controls. Sa Billing History makikita ang saved bills.'
    ]),
    stepGuideIds:['settings-account','organization-agency-manage','employee-create','site-rate-link','shift-create','loan-create','dtr-create','payroll-process','payslip-post','portal-admin','billing-create'],
    relatedIds:['organization-agency-manage','employee-create','site-rate-link','shift-create','dtr-import','payroll-process','payslip-post','portal-admin','billing-create']
  },
  guide('dashboard-use','dashboard','Read the dashboard','Basahin ang dashboard',['use'],[
    'Review the overview cards. Current-status cards are snapshots, while billing uses its labelled month.',
    'Select a payroll cutoff in Payroll Run Progress to inspect finalized, pending and missing-DTR sites.',
    'Use the relevant module for the underlying records; a dashboard count is not an approval or payment.'
  ],['Suriin ang overview cards. Snapshot ang current-status cards; may sariling buwan ang billing.', 'Pumili ng cutoff sa Payroll Run Progress para makita ang finalized, pending at walang-DTR na sites.', 'Buksan ang kaugnay na module para sa detalye. Hindi approval o payment ang dashboard count.']),
  guide('employee-create','employees-list','Create an employee record','Gumawa ng employee record',['use','create','requirements'],[
    'Open Employee Management → Employee List, then click + Add employee.',
    'Choose Agency position. Enter first/last name, birthday, date hired, gender, civil status, a complete email address and an 11-digit contact number. Employee number can be left unassigned if not yet available.',
    'Choose the salary payment method and its effective date. Bank Transfer also needs bank name, account holder, account number and account type. Complete applicable addresses, emergency contacts and beneficiaries; use Not applicable only when appropriate.',
    'Click Save employee. Correct any listed missing fields. If duplicate review appears, review the matching employee details before deciding whether to continue.',
    'Use Employee Documents for ID scans and other document records; saving a profile does not automatically create a portal account or deploy the employee.'
  ],['Buksan ang Employee Management → Employee List, tapos + Add employee.', 'Piliin ang Agency position. Ilagay ang first/last name, birthday, date hired, gender, civil status, tamang email at 11-digit contact number. Puwedeng wala munang employee number kung hindi pa assigned.', 'Piliin ang salary payment method at effective date. Kapag Bank Transfer, kailangan din ang bank name, account holder, account number at account type. Kumpletuhin ang applicable addresses, emergency contacts at beneficiaries; piliin lang ang Not applicable kung naaangkop.', 'I-click ang Save employee. Ayusin ang missing fields na nakalista. Kung may duplicate review, suriin muna ang kaparehong employee bago magpatuloy.', 'Sa Employee Documents inilalagay ang ID scans at ibang dokumento. Hindi automatic na may portal account o deployment kapag na-save ang profile.']),
  guide('employee-edit','employees-list','Edit employee details','Mag-edit ng employee details',['edit'],[
    'Search the employee in Employee List and choose the pencil action labelled Edit employee.',
    'Update the applicable details and click Save employee. Review validation or duplicate notices.',
    'For a promotion or position history, use Change position / history instead of changing Agency position in the profile. Agency transfers have their own action.'
  ],['Hanapin ang employee sa Employee List at piliin ang pencil na Edit employee.', 'Baguhin ang detalye at i-click ang Save employee. Basahin ang validation o duplicate notices.', 'Para sa promotion, gamitin ang Change position / history. May hiwalay ding action para sa agency transfer.']),
  guide('employee-position','employees-list','Change position or transfer agency','Magpalit ng position o agency',['transfer','position'],[
    'Find the employee. Use Change position / history for a position change, or Transfer employee to another agency for an agency transfer.',
    'Review the target agency/position, effective date and applicable site/rate setup in the selected form.',
    'Save through that workflow so the history is retained. Do not create a second employee just to change their assignment.'
  ],['Hanapin ang employee. Piliin ang Change position / history para sa position, o Transfer employee to another agency para sa transfer.', 'Suriin ang target agency/position, effective date at applicable site/rate setup sa form.', 'I-save sa tamang workflow para manatili ang history. Huwag gumawa ng panibagong employee para lang magpalit ng assignment.']),
  guide('employee-remove','employees-list','Record employee resignation','Magtala ng employee resignation',['deactivate','resign','delete'],[
    'In Employee List, choose Deactivate / resign employee. Enter the Resignation date (today by default), review the notice, then Confirm resignation.',
    'The employee is labelled Resigned. Employee Status retains the history and summary, but daily status changes are locked. Profile editing cannot reactivate the employee.',
    'Previously Inactive employees are shown as Resigned with Date not recorded. Their resignation year is not inferred. Permanent deletion is separate and is not needed for resignation.',
    'If the employee returns, open Employment history / Rehire in Employee List. Select the return date, the same or a different agency and its active position, and a reason. Original identity and earlier history remain; assign the new site separately.'
  ],['Sa Employee List, piliin ang Deactivate / resign employee. Ilagay ang Resignation date (araw ngayon ang default), basahin ang notice, at piliin ang Confirm resignation.', 'Resigned na ang employee. Nananatili ang history at summary sa Employee Status ngunit naka-lock ang daily status updates. Hindi siya mare-reactivate sa profile editing.', 'Ang dating Inactive ay Resigned na may Date not recorded. Hindi hinuhulaan ang resignation year. Hiwalay ang permanent delete; hindi ito kailangan para sa resignation.', 'Kung bumalik ang employee, buksan ang Employment history / Rehire sa Employee List. Piliin ang return date, parehong o ibang agency at active position, at reason. Nananatili ang dating identity at history; hiwalay ang bagong site assignment.']),

  guide('deployment-create','employees-deployments','Record a deployment','Mag-record ng deployment',['use','create','edit'],[
    'Open Deployment History and choose + New deployment.',
    'Select the employee and applicable agency/client/site assignment, deployment type and dates. Ongoing deployment is for an assignment with no confirmed end date.',
    'Click Save. Use Deployment records for history and DTR cutoff rosters for actual recorded cutoff membership.'
  ],['Sa Deployment History, piliin ang + New deployment.', 'Piliin ang employee, agency/client/site assignment, deployment type at dates. Gamitin ang Ongoing deployment kung wala pang confirmed end date.', 'I-click ang Save. Deployment records ang para sa history; DTR cutoff rosters ang para sa recorded cutoff membership.']),
  guide('document-create','employees-documents','Add an employee document or ID scan','Magdagdag ng dokumento o ID scan',['use','create','upload','edit','delete'],[
    'Find the employee in Employee Documents and click View documents.',
    'Select the category, such as Government IDs, Education or License, and click + Add record.',
    'Choose the record type, complete its fields and attach the relevant scan. Check detected details yourself, or choose Enter manually.',
    'Click Save record. Use View scan to inspect the saved attachment and Edit for corrections. Basic profile details are edited in Employee List.'
  ],['Hanapin ang employee sa Employee Documents at i-click ang View documents.', 'Piliin ang category gaya ng Government IDs, Education o License, tapos + Add record.', 'Piliin ang record type, punan ang fields at ilagay ang scan. Suriin ang detected details o piliin ang Enter manually.', 'I-click ang Save record. Sa View scan makikita ang attachment; Edit para sa correction. Sa Employee List binabago ang basic profile.']),
  guide('status-update','employees-status','Update leave or daily employee status','Mag-update ng leave o daily status',['use','create','edit','export'],[
    'Select year and cutoff in Employee Status, then locate the employee.',
    'Use Update status or open the cutoff sheet and select the relevant day. Choose the status and enter a reason when required.',
    'Save status. Respect view-only or locked days. Review the summary before Export Excel; HR-approved leave/suspension is preserved by attendance imports.'
  ],['Piliin ang year at cutoff sa Employee Status at hanapin ang employee.', 'Gamitin ang Update status o buksan ang cutoff sheet at piliin ang araw. Piliin ang status at ilagay ang reason kung required.', 'I-save ang status. Sundin ang locked/view-only days. Suriin ang summary bago mag-Export Excel; pinapanatili ng attendance import ang HR-approved leave/suspension.']),
  guide('portal-admin','employees-portal-accounts','Manage employee portal access','Ayusin ang employee portal access',['use','create','edit','deactivate','recovery'],[
    'Open Employee Management → Portal Accounts. Authorized account managers can select an employee using Manage account or View employee.',
    'Review registration/access status. The employee registers in the employee portal using their HR-recorded identity; an employee profile alone is not a registered portal account.',
    'Use Activate/Deactivate access when appropriate. For a forgotten password, an authorized manager can Issue recovery code and share it securely with the verified employee.',
    'Posting payslips is a separate Payroll workflow; activating an account does not publish every payslip.'
  ],['Buksan ang Employee Management → Portal Accounts. Authorized account managers ang gumagamit ng Manage account o View employee.', 'Suriin ang registration/access status. Sa employee portal nagre-register ang employee gamit ang identity na nasa HR records; hindi portal registration ang paggawa lang ng employee profile.', 'Gamitin ang Activate/Deactivate access kung naaangkop. Para sa nakalimutang password, puwedeng mag-Issue recovery code ang authorized manager para sa verified employee.', 'Hiwalay ang payslip posting sa Payroll. Hindi lahat ng payslip ay napo-post kapag inactivate ang account.']),
  ...[
    ['organization-agency','agency','Agency name, address, email, contact number, optional logo and status','Agency name, address, email, contact number, optional logo at status'],
    ['organization-client','client','Client name, address, contract start/end and status','Client name, address, contract start/end at status'],
    ['organization-site','site','Client, Site region, Site name, Agency, Site Account, address, optional logo and status','Client, Site region, Site name, Agency, Site Account, address, optional logo at status'],
    ['organization-site-accounts','site account','Site Account name and status','Site Account name at status'],
    ['organization-region','region','two-digit PSGC code, Region name and status','two-digit PSGC code, Region name at status']
  ].map(([view, name, fields, fieldsFil]) => guide(`${view}-manage`,view,`Add or edit a ${name}`,`Magdagdag o mag-edit ng ${name}`,['use','create','edit','deactivate'],[
    `Open the ${name} page under Organization. Choose + Add ${name}, or Edit beside an existing record.`,
    `Complete the applicable form: ${fields}. Use the system lists for linked records.`,
    'Save using the form action. Use Activate/Deactivate from the list when appropriate; existing View/Edit permissions still apply.'
  ],[`Buksan ang ${name} page sa Organization. Piliin ang + Add ${name}, o Edit sa existing record.`, `Punan ang applicable fields: ${fieldsFil}. Piliin ang linked records mula sa system lists.`, 'I-save gamit ang form action. Gamitin ang Activate/Deactivate sa listahan kung naaangkop. Kailangan pa rin ang tamang View/Edit permissions.'])),
  guide('position-create','organization-position','Set up an agency position','Gumawa ng agency position',['use','create','edit','deactivate'],[
    'Open Organization → Positions and click + Add position.',
    'Select the agency. Choose an existing position, or enter a new position name and description. Set its status.',
    'Click Save. This agency-position assignment becomes available in employee setup and the applicable rates workflows.'
  ],['Sa Organization → Positions, i-click ang + Add position.', 'Piliin ang agency. Gumamit ng existing position o ilagay ang bagong position name at description. Piliin ang status.', 'I-click ang Save. Gagamitin ang agency-position assignment sa employee setup at applicable rates.']),
  guide('dtr-create','attendance-dtr','Create and prepare a DTR','Gumawa at maghanda ng DTR',['use','create'],[
    'Open Attendance → Daily Time Records and select the year/cutoff. Click + Create DTR.',
    'Complete the agency, client/site and payroll period selections, then save using the create form.',
    'Open Edit on the DTR. Add eligible employees, assign the applicable shifts and encode attendance or use Import.',
    'Review the daily cells, totals and notes before More → Compute to payroll. That sends the DTR to the existing payroll workflow; it does not release payment.'
  ],['Sa Attendance → Daily Time Records, piliin ang year/cutoff at + Create DTR.', 'Piliin ang agency, client/site at payroll period at i-save ang create form.', 'Buksan ang Edit ng DTR. Magdagdag ng eligible employees, piliin ang shifts at mag-encode o mag-Import ng attendance.', 'Suriin ang daily cells, totals at notes bago More → Compute to payroll. Papunta ito sa payroll workflow; hindi ito payment release.']),
  guide('dtr-import','attendance-dtr','Import attendance from Excel','Mag-import ng attendance mula sa Excel',['import','upload'],[
    'Open Edit on the correct site DTR and cutoff, then click Import and select the spreadsheet.',
    'Include Employee ID or Employee No. and Date. Employee ID may be a system code such as EMP-0011 or an employee number such as DJA-0001. Review the preview.',
    'Click Import attendance. Incomplete biometric rows stay blank for manual correction; missing punches are not invented. HR-approved leave/suspension is preserved.',
    'Read the result modal. If a shift code does not exist or is inactive for the DTR agency, fix the code/setup and re-import the affected rows. Review the DTR before payroll.'
  ],['Buksan ang Edit ng tamang site DTR/cutoff, tapos Import at piliin ang spreadsheet.', 'Kailangan ang Employee ID o Employee No. at Date. Puwedeng system code gaya ng EMP-0011 o employee number gaya ng DJA-0001. Suriin ang preview.', 'I-click ang Import attendance. Mananatiling blank ang kulang na biometric rows para maitama nang manual; hindi iniimbento ang missing punches. Pinapanatili ang HR-approved leave/suspension.', 'Basahin ang result modal. Kung wala o inactive ang shift code sa DTR agency, ayusin ang code/setup at i-import muli ang affected rows. I-review bago mag-payroll.']),
  guide('dtr-edit','attendance-dtr','Correct attendance or add people','Itama ang attendance o magdagdag ng tao',['edit','people'],[
    'Open Edit on a Draft/editable DTR. Use + Add employee to search eligible employees under the agency with an active site rate.',
    'Choose Regular / Fixed for a continuing fixed posting, or Reliever / Cutoff-only for this cutoff only. The fixed option can end an earlier fixed post in the same agency.',
    'Click the relevant day cell to correct attendance using the existing form. Review dates, punches, shift and status; do not assume a missing biometric punch means worked hours.',
    'If the DTR is locked by payroll, use the authorized return/cancellation or adjustment workflow instead of bypassing the lock.'
  ],['Buksan ang Edit ng Draft/editable DTR. Sa + Add employee, hanapin ang employee sa agency na may active site rate.', 'Regular / Fixed ang para sa tuloy-tuloy na fixed posting; Reliever / Cutoff-only ang para sa cutoff lang. Maaaring tapusin ng fixed option ang naunang fixed post sa parehong agency.', 'I-click ang day cell para itama ang attendance. Suriin ang dates, punches, shift at status; hindi worked hours agad ang missing biometric punch.', 'Kung locked dahil sa payroll, gamitin ang authorized return/cancellation o adjustment workflow. Huwag lampasan ang lock.']),
  guide('dtr-print','attendance-dtr','View or print a summary DTR','Tingnan o i-print ang summary DTR',['print','export','summary'],[
    'Locate the DTR and open More → View Summary DTR.',
    'Review the Compact DTR paper and use Print DTR for printing or a browser PDF printer. Its paper remains readable in either theme.',
    'For the attendance spreadsheet, use Export inside the DTR attendance workspace.'
  ],['Hanapin ang DTR at piliin ang More → View Summary DTR.', 'Suriin ang Compact DTR at piliin ang Print DTR para mag-print o gumamit ng browser PDF printer. Pareho dapat ang readable paper sa light/dark mode.', 'Para sa attendance spreadsheet, gamitin ang Export sa DTR attendance workspace.']),
  guide('btr-use','attendance-dtr','Record Break Time Reliever (BTR)','Mag-record ng Break Time Reliever (BTR)',['btr'],[
    'On the DTR list choose More → Add BTR.',
    'Select the day of the employee taking a break, choose who covered the break and enter the coverage hours.',
    'Review both BTR (covered a break) and REST (had a break covered), then click Save BTR. Both sides represent the same coverage; do not add their totals together.',
    'Use Template / Import Excel / Export in the BTR sheet when needed. BTR is saved separately from regular/OT attendance totals.'
  ],['Sa DTR list, piliin ang More → Add BTR.', 'Piliin ang araw ng employee na nag-break, ang reliever na sumalo at coverage hours.', 'Suriin ang BTR (sumalo) at REST (nasaluhan), tapos Save BTR. Parehong coverage ang dalawang side; huwag pag-add-in ang totals nila.', 'Gamitin ang Template / Import Excel / Export sa BTR sheet kung kailangan. Hiwalay itong naka-save sa regular/OT attendance totals.']),
  guide('reliever-use','attendance-dtr-reliever','Review reliever DTRs','Suriin ang reliever DTRs',['use','edit'],[
    'Choose year, cutoff and agency in DTR Reliever and search the relevant assignment.',
    'Click View DTR to inspect the attendance source. Make corrections through the editable DTR workflow.',
    'Check the Regular/Reliever assignment when preparing payroll; this helper does not transfer an employee for you.'
  ],['Piliin ang year, cutoff at agency sa DTR Reliever at hanapin ang assignment.', 'I-click ang View DTR para makita ang attendance source. Sa editable DTR workflow ginagawa ang corrections.', 'Tiyakin ang Regular/Reliever assignment sa payroll. Hindi nagta-transfer ng employee ang helper.']),
  guide('shift-create','attendance-shift-code','Create a shift code','Gumawa ng shift code',['use','create','edit','deactivate'],[
    'Open Attendance → Shift Codes and click + Add shift code.',
    'Select agency, shift code/name and shift type. Complete the time, regular-hours, OT cap, payable DTR days and night-differential settings as applicable.',
    'Save shift code. Use an Active code for the same agency when importing attendance; review overnight shift dates and times.'
  ],['Sa Attendance → Shift Codes, i-click ang + Add shift code.', 'Piliin ang agency, code/name at shift type. Kumpletuhin ang time, regular hours, OT cap, payable DTR days at night-differential settings kung applicable.', 'I-save ang shift code. Active code ng parehong agency ang gamitin sa import. Suriin ang dates/times ng overnight shift.']),
  guide('holiday-use','attendance-holiday-manager','Manage legal and special holidays','Ayusin ang legal at special holidays',['use','create','edit','deactivate'],[
    'Select the year and type in Holiday Manager and review the displayed dates.',
    'For a manual record choose + Add holiday; enter Holiday name, Date, Legal/Special type, recurrence and status, then Save holiday.',
    'Recurring fixed dates repeat their month/day. Movable holidays need the correct year-specific date. Verify the applicable locality and official declaration.',
    'Active holiday records feed DTR. Check the record and applicability before processing attendance/payroll.'
  ],['Piliin ang year at type sa Holiday Manager at suriin ang dates.', 'Para sa manual record, piliin ang + Add holiday. Ilagay ang name, Date, Legal/Special, recurrence at status, tapos Save holiday.', 'Parehong month/day ang fixed recurring dates. Kailangan ng tamang year-specific date ang movable holidays. Tiyakin ang locality at official declaration.', 'Binabasa ng DTR ang active holiday records. Suriin ang record at applicability bago mag-attendance/payroll.']),
  guide('payroll-process','payroll-processing','Review and finalize payroll','Mag-review at finalize ng payroll',['use','compute','approve','edit'],[
    'First prepare and review the site DTR, then use More → Compute to payroll in Daily Time Records.',
    'Open Payroll Processing, select the agency/client/cutoff, then Review the site.',
    'Inspect Hours & amounts, Employees and History. Review rates, attendance, deductions and any authorized cutoff overrides.',
    'Authorized users can Finalize payroll after review, or Reject and return to Draft with a reason. Finalization is not payslip posting and is not a bank payment.'
  ],['Ihanda at i-review muna ang site DTR, tapos More → Compute to payroll sa Daily Time Records.', 'Sa Payroll Processing, piliin ang agency/client/cutoff at Review ng site.', 'Suriin ang Hours & amounts, Employees at History, pati rates, attendance, deductions at authorized cutoff overrides.', 'Authorized users ang puwedeng mag-Finalize payroll o mag-Reject and return to Draft na may reason. Hindi payslip posting o bank payment ang finalization.']),
  guide('adjustment-create','payroll-adjustments','Create a payroll adjustment','Gumawa ng payroll adjustment',['use','create','edit'],[
    'Open Payroll Adjustments or use Payroll adjustments from the DTR More menu, then choose + Add adjustment.',
    'Select the employee and original cutoff. Choose Saved DTR attendance, Verified missed day or Manual amount according to the actual correction.',
    'Complete the date/hours or amount, adjustment name and reason. Review the breakdown, save and follow the existing approval/application workflow.',
    'Do not duplicate hours already included in another adjustment or paid payroll.'
  ],['Buksan ang Payroll Adjustments o ang Payroll adjustments sa More ng DTR, tapos + Add adjustment.', 'Piliin ang employee at original cutoff. Piliin ang Saved DTR attendance, Verified missed day o Manual amount ayon sa totoong correction.', 'Punan ang date/hours o amount, adjustment name at reason. Suriin ang breakdown, i-save at sundin ang approval/application workflow.', 'Huwag ulitin ang hours na nasa ibang adjustment o paid payroll na.']),
  guide('thirteenth-use','payroll-thirteenth-month','Review 13th-month test computations','Suriin ang 13th-month test computations',['use','compute','import','approve'],[
    'This module is under development and for testing. Choose year/agency and open Review earnings for the employee.',
    'Review basic earnings, coverage dates, eligibility, missing periods and adjustment classifications. Missing coverage is not assumed to be zero.',
    'Use Import Previous Earnings for verified prior records only; review overlap/duplicate checks and the existing payment history.',
    'Use the module controls only after review and with the required role. A test computation is not an approved production payout.'
  ],['Under development at for testing pa ito. Piliin ang year/agency at Review earnings ng employee.', 'Suriin ang basic earnings, coverage dates, eligibility, missing periods at adjustment classifications. Hindi automatic zero ang missing coverage.', 'Import Previous Earnings lang para sa verified prior records; suriin ang overlap/duplicates at payment history.', 'Gamitin lang ang module controls pagkatapos ng review at kung authorized. Hindi approved production payout ang test computation.']),
  guide('payslip-use','payslip','Find employee payslips','Hanapin ang payslip ng employee',['use','print','export'],[
    'Open Payroll → Payslips and search for the employee. Choose View payslips.',
    'Filter their history by year/posting status and open View payslip for the required cutoff.',
    'Review the source details and use the available print/download controls. Employee portal visibility requires a valid Posted payslip, not just finalized payroll.'
  ],['Sa Payroll → Payslips, hanapin ang employee at piliin ang View payslips.', 'I-filter ang history ayon sa year/posting status at buksan ang View payslip ng cutoff.', 'Suriin ang detalye at gamitin ang available print/download controls. Kailangan ng valid na Posted payslip para makita sa portal; hindi sapat ang finalized payroll lang.']),
  guide('payslip-post','payslip-sites','Post payslips to employee accounts','I-post ang payslips sa employee accounts',['use','post','approve'],[
    'Open Payslips by Site Account. Choose the correct account, agency and cutoff, then review its finalized payroll sources.',
    'Select the employees whose payslips should be posted and review the full grouped payslip. Acknowledge any outside-account sources when the system asks.',
    'Authorized users can choose Post selected payslips or Withdraw selected. If the review is stale, reload and select again.',
    'Posting makes valid snapshots visible to the employee portal. It does not release salary or change payroll amounts.'
  ],['Buksan ang Payslips by Site Account. Piliin ang account, agency at cutoff at suriin ang finalized payroll sources.', 'Piliin ang employees at suriin ang buong grouped payslip. Basahin ang outside-account source acknowledgement kung hinihingi.', 'Authorized users ang puwedeng mag-Post selected payslips o Withdraw selected. Kung stale ang review, mag-reload at pumili muli.', 'Nagiging visible sa portal ang valid snapshots kapag posted. Hindi ito salary release o pagbabago ng payroll amounts.']),
  guide('payroll-history-use','payroll-history','Review payroll history','Suriin ang payroll history',['use','summary'],[
    'Choose agency, cutoff and Finalized/Cancelled status in Payroll History, then Search.',
    'Use View details for current payroll and Cancelled & audit records.',
    'Cancelled postings remain in history and do not increase current totals.'
  ],['Piliin ang agency, cutoff at Finalized/Cancelled sa Payroll History, tapos Search.', 'Sa View details makikita ang current payroll at Cancelled & audit records.', 'Nananatili sa history ang cancelled postings pero hindi dinadagdag sa current totals.']),
  guide('payroll-summary-use','payroll-summary','Review payroll summary by account','Suriin ang payroll summary bawat account',['use','summary'],[
    'Select the payroll cutoff in Payroll Summary and refresh.',
    'Search for an account/site and choose View sites for its breakdown.',
    'Compare the summary with the finalized source records before using it for a business decision.'
  ],['Piliin ang payroll cutoff sa Payroll Summary at mag-refresh.', 'Hanapin ang account/site at piliin ang View sites para sa breakdown.', 'Ihambing sa finalized source records bago gamitin sa business decision.']),
  guide('billing-create','billing-generate','Prepare a billing draft','Maghanda ng billing draft',['use','create','compute','edit'],[
    'Open Generate Billing. Select agency/service dates and expand the correct client.',
    'If Setup required appears, open Set up billing / Client billing setup. Review invoice scope, grouping, charge rules and tax settings with the authorized billing owner.',
    'Select the available payroll sources and click Review selected bill.',
    'Review service lines, additional charges, billing date and notes, then Save draft. Review & finalize has a separate confirmation; inspect the totals first.'
  ],['Sa Generate Billing, piliin ang agency/service dates at buksan ang tamang client.', 'Kung Setup required, buksan ang Set up billing / Client billing setup. I-review sa authorized billing owner ang invoice scope, grouping, charge rules at tax settings.', 'Piliin ang available payroll sources at Review selected bill.', 'Suriin ang service lines, charges, billing date at notes, tapos Save draft. May hiwalay na confirmation ang Review & finalize; suriin muna ang totals.']),
  guide('billing-history-use','billing-history','Open or print saved billing','Buksan o i-print ang saved billing',['use','print','export','edit'],[
    'Open Billing History and filter by agency/client/service dates.',
    'Expand the client and choose Open bill. Review whether it is Draft or Finalized.',
    'Use Print draft or Print billing as appropriate. Authorized reopening requires Reopen as draft and a recorded reason.'
  ],['Sa Billing History, piliin ang agency/client/service dates.', 'Buksan ang client at Open bill. Tiyakin kung Draft o Finalized.', 'Gamitin ang Print draft o Print billing ayon sa status. Ang authorized Reopen as draft ay nangangailangan ng recorded reason.']),
  ...[['rates-payroll','Payroll Rates','+ Add region rate'],['rates-billing','Billing Rates','+ Add rate']].map(([view,title,button])=>guide(`${view}-manage`,view,`Set up ${title.toLowerCase()}`,`Mag-set up ng ${title.toLowerCase()}`,['use','create','edit'],[
    `Open Rates → ${title} and select ${button}. Choose the applicable agency/position and region where shown.`,
    'Complete the rate amounts and applicable date/status fields in the form, then Save rate.',
    'For changes, distinguish correcting the current rate from a dated rate update. Review effective dates and the history before saving.'
  ],[`Sa Rates → ${title}, piliin ang ${button}. Piliin ang applicable agency/position at region kung nakalista.`, 'Punan ang rate amounts at applicable date/status fields, tapos Save rate.', 'Sa pagbabago, ihiwalay ang correction ng current rate sa dated rate update. Suriin ang effective dates at history bago mag-save.'])),
  guide('site-rate-link','rates-site','Link a rate to a site','I-link ang rate sa site',['use','create','edit','deactivate'],[
    'Open Site Rates and choose + Link site rate.',
    'Select the site/client, agency and position. Choose the relevant existing payroll/billing rate, or create an applicable region rate through the form.',
    'Save link and verify its status. Missing active site-rate links can prevent employee eligibility in a site DTR.'
  ],['Sa Site Rates, piliin ang + Link site rate.', 'Piliin ang site/client, agency at position. Piliin ang existing payroll/billing rate o gumawa ng applicable region rate gamit ang form.', 'I-save ang link at tiyakin ang status. Kapag kulang ang active site-rate link, maaaring hindi lumabas ang employee sa eligible DTR list.']),
  guide('loan-create','employee-loans-deductions','Record an employee loan or deduction','Mag-record ng employee loan o deduction',['use','create','requirements'],[
    'Open Employee Loans & Deductions, find the employee and choose View profile → + Add issuance.',
    'Choose Loan or Deduction and an active Catalog entry. Enter issuance number, issuance date and original value/amount received.',
    'Set repayment start, number of periods and Deduct every (1st, 2nd or Both cutoffs). A period is a scheduled payroll cutoff, not necessarily a month.',
    'Choose Review repayment plan, inspect the dates/amounts and Save issuance. Review the existing history to avoid duplicate issuance.'
  ],['Sa Employee Loans & Deductions, hanapin ang employee at piliin ang View profile → + Add issuance.', 'Piliin ang Loan o Deduction at active Catalog entry. Ilagay ang issuance number, issuance date at original value/amount received.', 'Piliin ang repayment start, number of periods at Deduct every (1st, 2nd o Both cutoffs). Payroll cutoff ang isang period; hindi laging isang buwan.', 'Piliin ang Review repayment plan, suriin ang dates/amounts at Save issuance. Tingnan ang history para maiwasan ang duplicate issuance.']),
  guide('loan-pause','employee-loans-deductions','Review, pause or resume a repayment plan','Suriin, i-pause o i-resume ang repayment plan',['edit','pause','resume'],[
    'Open the employee profile and find the correct issuance using history/type/year filters.',
    'Choose View repayment plan to inspect installments and recorded payments. Use Pause plan with effective/resume dates when authorized; Resume now ends the pause through the existing workflow.',
    'Mark paid, Complete and Void issuance have different effects. Verify actual payment and balances before using those controls; the assistant does not change them.'
  ],['Buksan ang employee profile at hanapin ang issuance gamit ang history/type/year filters.', 'Sa View repayment plan makikita ang installments at payments. Gamitin ang Pause plan na may effective/resume dates kung authorized; Resume now ang para tapusin ang pause.', 'Magkakaiba ang Mark paid, Complete at Void issuance. Tiyakin ang totoong payment at balances bago gamitin; hindi ito binabago ng assistant.']),
  ...['deductions-loans-contributions','deductions-loans-cash-bonds'].map(view=>guide(`${view}-setup`,view,view.endsWith('cash-bonds')?'Set up refundable deduction plans':'Set up contribution plans',view.endsWith('cash-bonds')?'Mag-set up ng refundable deduction plans':'Mag-set up ng contribution plans',['use','create','edit'],[
    'This workspace uses agency/position plans, including applicable refundable deductions. Choose + Single plan, or + Bulk setup for multiple positions.',
    'Select agency, position, Catalog item, amount per employee/cutoff, deduction cutoff and the applicable effective date.',
    'Review before Save plan. Bulk setup has a preview before Save new plans. Distinguish a correction from a dated update to preserve history.'
  ],['Agency/position plans ang workspace na ito, kasama ang applicable refundable deductions. Piliin ang + Single plan, o + Bulk setup para sa maraming positions.', 'Piliin ang agency, position, Catalog item, amount per employee/cutoff, deduction cutoff at applicable effective date.', 'I-review bago Save plan. May preview ang bulk bago Save new plans. Ihiwalay ang correction sa dated update para mapanatili ang history.'])),
  guide('transaction-use','deductions-loans-transactions','Review account transaction receipts','Suriin ang account transaction receipts',['use','print','summary'],[
    'Open Account Transactions and filter by employee/reference, type, status and agency.',
    'Choose View receipt to inspect the recorded transaction and payroll references.',
    'Posted and Voided have different meanings. Compare the receipt and source record; browsing a transaction does not record a new payment.'
  ],['Sa Account Transactions, gamitin ang employee/reference, type, status at agency filters.', 'Piliin ang View receipt para sa transaction at payroll references.', 'Magkaiba ang Posted at Voided. Ihambing ang receipt at source record; hindi nagre-record ng bagong payment ang pag-view.']),
  guide('catalog-create','deductions-loans-catalog','Create a catalog classification or item','Gumawa ng catalog classification o item',['use','create','edit','deactivate'],[
    'Open Loan & Deduction Catalog and choose + Add classification, selecting the applicable Loan, Deduction, Contribution or Recurring Deduction kind.',
    'Expand the classification and choose + Add sub-classification to define the item.',
    'Save the form and check Active status. Choose the appropriate active catalog item when creating an issuance or agency plan.'
  ],['Sa Loan & Deduction Catalog, piliin ang + Add classification at tamang Loan, Deduction, Contribution o Recurring Deduction kind.', 'Buksan ang classification at piliin ang + Add sub-classification para sa item.', 'I-save at tiyakin ang Active status. Tamang active item ang piliin sa issuance o agency plan.']),
  guide('reports-use','reports','Check report availability','Tingnan ang report availability',['use','summary'],[
    'The Reports workspace currently has no implemented report component in the dashboard.',
    'Use the implemented Payroll Summary/History, Billing History, Account Transactions or module export controls for available information.',
    'This helper does not create a missing report or infer financial values.'
  ],['Wala pang implemented report component ang Reports workspace sa dashboard.', 'Gamitin ang Payroll Summary/History, Billing History, Account Transactions o module export controls para sa available information.', 'Hindi gumagawa ng nawawalang report o nanghuhula ng financial values ang helper.']),
  guide('settings-account','settings','Update your account or check access','I-update ang account o tingnan ang access',['use','edit'],[
    'Open Settings → My account and use Edit profile for your own account details.',
    'Check Workspace access to see your available modules and View/Edit rights.',
    'Ask an administrator for access changes. Hiding a menu does not replace the server permission checks.'
  ],['Sa Settings → My account, gamitin ang Edit profile para sa sariling account details.', 'Sa Workspace access makikita ang modules at View/Edit rights.', 'Administrator ang mag-aayos ng access changes. May hiwalay pa ring permission checks ang server.']),
  guide('settings-team','settings','Manage staff permissions','Ayusin ang staff permissions',['access','create'],[
    'An administrator opens Settings → Team access. Expand a department and choose Manage for the correct staff account.',
    'Review department, role, status and each module View/Edit setting before saving.',
    'Use Add department for a new department. These are staff accounts; employee portal access is managed separately.'
  ],['Administrator ang magbubukas ng Settings → Team access. Buksan ang department at Manage ng tamang staff account.', 'Suriin ang department, role, status at View/Edit bawat module bago mag-save.', 'Add department ang para sa bagong department. Staff accounts ito; hiwalay ang employee portal access.']),
  guide('settings-backup','settings','Create or review a database backup','Gumawa o sumuri ng database backup',['backup'],[
    'An administrator opens Settings → Backups and reviews the backup status/list.',
    'Use Back up now to create a copy and verify its completion before downloading or relying on it.',
    'Restore replaces database state and is a separate controlled workflow. Read its confirmation and recovery instructions; the assistant never starts a restore.'
  ],['Administrator ang magbubukas ng Settings → Backups at susuri ng status/list.', 'Gamitin ang Back up now at tiyaking completed bago mag-download o umasa sa copy.', 'Binabago ng Restore ang database state at hiwalay itong controlled workflow. Basahin ang confirmation/recovery instructions; hindi nagsisimula ng restore ang assistant.']),
  guide('portal-use','employee-portal','Use your employee payslip portal','Gamitin ang employee payslip portal',['use','print','export'],[
    'Sign in using your registered portal email and password. Search payslips or filter by year, then choose View payslip.',
    'Use Save as PNG or Print / PDF on the opened payslip. Only valid Posted payslips are visible; ask HR if an expected cutoff is missing.',
    'My information is for profile information requests; My account is for login/contact/password details. This guide does not access company-wide records.'
  ],['Mag-sign in gamit ang registered portal email at password. Hanapin ang payslip o piliin ang year, tapos View payslip.', 'Gamitin ang Save as PNG o Print / PDF sa payslip. Valid na Posted payslips lang ang nakikita; itanong sa HR kung kulang ang cutoff.', 'My information ang para sa profile information requests; My account ang para sa login/contact/password details. Hindi kumukuha ng company-wide records ang guide.']),
  guide('portal-register','employee-portal','Register or recover a portal account','Mag-register o mag-recover ng portal account',['create','recovery'],[
    'For registration choose Create account. Enter the name and government ID as recorded by HR, contact number, login email and password, then read and accept the privacy notice/account terms.',
    'If identity details do not match or access is disabled, contact HR; do not create duplicate employee identities.',
    'For recovery, ask authorized HR for a recovery code. Choose Forgot password? Use an HR recovery code and enter the registered email, code and new password. No recovery email is sent.'
  ],['Para mag-register, piliin ang Create account. Ilagay ang pangalan at government ID ayon sa HR records, contact number, login email at password, at basahin/tanggapin ang privacy notice/account terms.', 'Kung hindi tugma ang identity o disabled ang access, lumapit sa HR. Huwag gumawa ng duplicate employee identity.', 'Sa recovery, humingi ng code sa authorized HR. Piliin ang Forgot password? Use an HR recovery code at ilagay ang registered email, code at bagong password. Walang recovery email na ipinapadala.']),
  guide('portal-account','employee-portal','Change portal account details','Baguhin ang portal account details',['edit'],[
    'Sign in and choose My account. Update login email/contact number or enter a new password and confirmation.',
    'Enter the required current password and choose Save account details, then review and confirm the changes.',
    'For employee profile corrections, use My information and follow the information-request form instead of changing another employee identity.'
  ],['Mag-sign in at piliin ang My account. Baguhin ang login email/contact number o ilagay ang bagong password at confirmation.', 'Ilagay ang required current password, piliin ang Save account details at i-review/confirm ang changes.', 'Para sa employee profile correction, gamitin ang My information at information-request form. Huwag palitan ng ibang employee identity.'])
]

/** Longest explicit page name wins; a prior topic is used only for pronoun follow-ups. */
export const assistantGuideAliases: Record<string,string[]> = {
  dashboard:['dashboard','overview','payroll progress'],
  'employees-list':['employee list','employee record','employee records','resignation','resigned','resign','nag resign','nagresign','employee','employees','empleyado','personnel'],
  'employees-deployments':['deployment history','deployment','deploy','assignment','posting'],
  'employees-documents':['employee documents','government id','government ids','id scan','scan','documents','document','dokumento'],
  'employees-status':['employee status','leave','sick leave','vacation leave','suspension','suspended','on leave','absence'],
  'employees-portal-accounts':['portal accounts','portal access','employee accounts','hr recovery code'],
  'organization-agency':['agency','agencies','ahensya'], 'organization-position':['position setup','agency position','positions','position'],
  'organization-client':['client','clients'], 'organization-site':['site setup','site','sites'], 'organization-site-accounts':['site account','site accounts'], 'organization-region':['region','regions','psgc'],
  'attendance-dtr':['daily time record','daily time records','dtr','attendance','biometric','excel attendance','employee sa dtr','employee to dtr','employee in dtr','btr','break time reliever'],
  'attendance-dtr-reliever':['dtr reliever','reliever dtr'], 'attendance-shift-code':['shift code','shift codes','shift','shifts'], 'attendance-holiday-manager':['holiday manager','holiday','holidays','pista'],
  'payroll-processing':['payroll processing','payroll','salary','sahod'], 'payroll-adjustments':['payroll adjustments','adjustment','adjustments','missed day'], 'payroll-thirteenth-month':['13th month','13thmonth','thirteenth month','13th month pay'],
  payslip:['employee payslip','payslip','payslips'], 'payslip-sites':['payslips by site account','post payslip','post payslips','publish payslip','publish payslips','payslip posting'],
  'payroll-history':['payroll history','cancelled payroll'], 'payroll-summary':['payroll summary'],
  'billing-generate':['generate billing','billing','invoice','bill'], 'billing-history':['billing history','saved bill','print billing','print bill'],
  'rates-payroll':['payroll rate','payroll rates','region rate','rate'], 'rates-billing':['billing rate','billing rates'], 'rates-site':['site rate','site rates','rate link','rates sa site','rate sa site'],
  'employee-loans-deductions':['employee loan','employee loans','loan','loans','utang','deduction','issuance','repayment','installment'],
  'deductions-loans-cash-bonds':['cash bond','cash bonds','refundable deduction'], 'deductions-loans-contributions':['agency contribution','contribution','contributions','bulk setup','recurring deduction'], 'deductions-loans-transactions':['account transactions','transaction','transactions','receipt'], 'deductions-loans-catalog':['loan catalog','deduction catalog','catalog','classification','sub classification'],
  reports:['reports','report'], settings:['settings','permission','permissions','staff access','team access','backup','restore','my account','staff account'],
  'employee-portal':['employee portal','payslip portal','portal registration','portal password']
}

export function normalizeAssistantQuestion(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]/gu,' ').replace(/\b(?:pano|papano|paano)\b/g,'paano')
    .replace(/\b(?:paturo|paturuan|pakituro|pakituruan|turuan|ituro)\b/g,'guide')
    .replace(/\b(?:maidadagdag|makapagdagdag|idagdag|magdadagdag)\b/g,'add')
    .replace(/\b(?:maedit|maiupdate|maiaupdate|iupdate|iedit|mapalitan|palitan)\b/g,'edit')
    .replace(/\b(?:maimport|maiimport|makapagimport|iimport)\b/g,'import')
    .replace(/\b(?:makapagprint|maiprint|iprint)\b/g,'print')
    .replace(/\b(?:mag|i|ipa)\s*(create|add|edit|update|import|upload|export|print|post|compute|delete|register|save)\b/g,'$1').replace(/\s+/g,' ').trim()
}
function contains(text: string, phrase: string) { return (` ${text} `).includes(` ${phrase} `) }
function unrelatedQuestion(text: string) {
  // Infrastructure setup belongs to the deployment operator, not the app helper.
  if (/\b(?:xampp|mysql|nuxt|localhost|server|terminal|npm|hosting|cpanel|namecheap)\b/.test(text)) return true
  return /\b(?:translate|translation|how (?:do i |to )?say|meaning (?:ng|of)|english (?:ng|of|for)|tagalog (?:ng|of|for)|spell|spelling|synonym|antonym|weather|forecast|umuulan|panahon|jokes?|biro|recipes?|cook|cooking|luto|magluto|pizza|cake|movies?|songs?|music|sports?|basketball|horoscope|politics|javascript|python)\b/.test(text)
}
function guideReferences(text: string) {
  return Object.entries(assistantGuideAliases).flatMap(([view,aliases])=>aliases.filter(alias=>contains(text,alias)).map(alias=>({view,score:alias.split(' ').length*100+alias.length,position:(` ${text} `).indexOf(` ${alias} `)}))).sort((a,b)=>b.score-a.score)
}
/** A recognized system subject can need clarification without being outside scope. */
export function assistantTopicOptions(prompt: string) {
  const text=normalizeAssistantQuestion(prompt)
  if (unrelatedQuestion(text)) return []
  const reference=guideReferences(text).sort((a,b)=>a.position-b.position || b.score-a.score)[0]
  return reference ? assistantGuides.filter(item=>item.view===reference.view).slice(0,4) : []
}
/** Public portal instructions only. Never fall back from a staff question to a portal topic. */
export function findPortalAssistantGuide(prompt: string, contextGuide?: string) {
  const text=normalizeAssistantQuestion(prompt).replace(/^(?:hey )?dja (?:assistant|ai) /,'')
  if (!text || prompt.length>500 || /[\u0000-\u001f\u007f]/.test(prompt)) return null
  if (/\b(?:payroll|salary|salaries|sahod|sweldo|suweldo|wages?|compensation|loans?|utang|deductions?|billing|invoices?|dtr|btr|attendance|biometric|deployments?|rates?|contributions?|cash bonds?|13th|thirteenth|dashboard|staff|admin|administrator|permissions?|backups?|database|sql|select|ignore|override|pretend|bypass|hacking|hack|employee records?|employee list|employee documents?|employees|personnel|empleyado|ibang|iba|katrabaho|kasamahan|other|another|coworker|colleague|someone else)\b/.test(text)) return null
  if (/\b(?:post|publish|approve|finalize|release|compute|calculate|import|upload|delete|deactivate|disable|bank|banking|payment|ni|nina|nila|kay|kina|his|her|their|someone|anyone|everyone|all|lahat)\b/.test(text) || /\b(?:emp|dja) \d+\b/.test(text) || /\b\w+['’]s\s+(?:payslip|account)\b/i.test(prompt)) return null
  if (/\b(?:of|for) (?!(?:my|me|own|the|a|an|portal|payslip|account|email|password|registration)\b)\w+/.test(text)) return null
  const topics=assistantGuides.filter(item=>item.view==='employee-portal')
  const result=(id: string, action='use')=>{const guide=topics.find(item=>item.id===id);return guide ? {guide,unsupportedAction:false,action} : null}
  const exact=topics.find(item=>Object.values(item.title).some(title=>contains(text,normalizeAssistantQuestion(title))))
  if(exact) return result(exact.id)
  if (/^(?:help|help me|guide|steps|explain this page|how do i use this page|paano gamitin ito|paano gamitin ang page na ito|ano ang page na ito|tulong)$/.test(text)) return result('portal-use')
  const account=/\b(?:account|accounts|portal|password|email|contact|profile|my information|recovery code)\b/.test(text)
  const payslip=/\b(?:payslip|payslips)\b/.test(text)
  const followUp=topics.some(item=>item.id===contextGuide) && /^(?:paano|how) (?:do i |to )?(?:edit|print|save|download|recover|change|baguhin)(?: ng)? (?:ito|nito|iyan|niyan|it|that)\??$/.test(text)
  if ((account || followUp) && /\b(?:recovery|recover|forgot|nakalimutan|reset|register|registration|sign up|signup|create|gumawa|magdagdag|requirements|required|kailangan)\b/.test(text)) return result('portal-register','recovery')
  if ((account || followUp) && /\b(?:edit|update|change|baguhin|palitan|itama|correct|settings)\b/.test(text)) return result('portal-account','edit')
  if ((payslip || followUp) && /\b(?:view|see|find|show|open|print|save|download|export|pdf|png|tingnan|tignan|makita|hanapin|buksan|gamitin|use|missing|kulang|wala)\b/.test(text)) return result('portal-use')
  if (account && /\b(?:sign in|signin|log in|login|log out|logout|sign out|signout|use|gamitin|access)\b/.test(text)) return result('portal-use')
  return null
}
export function findAssistantGuide(prompt: string, currentView: string, contextGuide?: string) {
  if (currentView==='employee-portal') return findPortalAssistantGuide(prompt,contextGuide)
  const text=normalizeAssistantQuestion(prompt)
  // A question word or an unrelated pronoun does not establish a system topic.
  // These common general-assistant requests must not match a stray module name.
  if (unrelatedQuestion(text)) return null
  if (/\b(?:how many|how much|ilan|ilang|magkano|number of)\b/.test(text)) return null
  const knownGuide=(id: string)=>({guide:assistantGuides.find(item=>item.id===id)!,unsupportedAction:false,action:'use'})
  const wholeSystem=/\b(?:system|sistema|overall workflow|whole workflow|buong proseso|buong flow)\b/.test(text)
  if ((wholeSystem && /\b(?:step by step|steps|guide|workflow|flow|process|proseso|gamitin|use|setup|set up|start|begin|mapatakbo|patakbuhin|paandarin|simulan|magsimula|umpisahan|paggamit|paano)\b/.test(text)) || /^(?:(?:saan|paano|where|how) (?:ba |po |ako |muna |do i |to )*(?:magsisimula|magsimula|mag uumpisa|mag umpisa|start|begin)|ano (?:ba |po |ang |muna )*(?:unang gagawin|uunahin|una)|(?:getting started|get started))(?: (?:dito|po|sa system|sa sistema|naman))*$/.test(text)) return knownGuide('system-start')
  if (/^(?:ano (?:ang |yung |po |na )?(?:kasunod|susunod|next)(?: na (?:step|gagawin))?|(?:tapos|pagkatapos)(?: ano| naman)?|next(?: step| steps)?|what(?: is| s)? next)(?: (?:po|naman|dito|na))*$/.test(text)) {
    const next:Record<string,string>={'employee-create':'document-create','rates-payroll-manage':'site-rate-link','site-rate-link':'shift-create','shift-create':'dtr-create','dtr-create':'dtr-import','dtr-import':'dtr-edit','dtr-edit':'payroll-process','payroll-process':'payslip-post','payslip-post':'portal-admin','billing-create':'billing-history-use'}
    return knownGuide(contextGuide && next[contextGuide] || 'system-start')
  }
  const exactTopic=assistantGuides.flatMap(item=>Object.values(item.title).map(title=>({guide:item,title:normalizeAssistantQuestion(title)}))).filter(item=>contains(text,item.title)).sort((a,b)=>b.title.length-a.title.length)[0]
  if (exactTopic) return {guide:exactTopic.guide,unsupportedAction:false,action:'use'}
  if (!/\b(?:paano|how|where|saan|ano|what|why|bakit|help|guide|steps|turo|explain|create|add|edit|import|export|print|post|setup|set up|register|requirements|kailangan|gumawa|magdagdag|baguhin|delete|deactivate|pause|resume|compute|backup|recovery|forgot)\b/.test(text)) return null
  const references=guideReferences(text)
  const pageHelp=/^(?:help|help me|guide|steps|explain this page|how do i use this page|paano gamitin ito|paano gamitin ang page na ito|ano ang page na ito|tulong)$/.test(text)
  const followUp=assistantGuides.some(item=>item.id===contextGuide && item.view!=='employee-portal') && /^(?:paano|how(?: do i| to)?) (?:mag )?(?:create|add|edit|update|import|export|print|save|post|compute|delete|deactivate|pause|resume|recover|change|baguhin)(?: (?:ng|ang))? (?:it|this|that|ito|nito|iyan|niyan|iyon|yun)(?: naman)?$/.test(text)
  if (!references.length && !pageHelp && !followUp) return null
  let view=references[0]?.view || currentView
  if ((contains(text,'dtr') || contains(text,'btr')) && (references[0]?.score || 0) < 200) view='attendance-dtr'
  if (/\b(?:rate|rates)\b/.test(text) && /\b(?:site|sites)\b/.test(text)) view='rates-site'
  if (/\b(?:employee|employees|empleyado)\b/.test(text) && /\b(?:change position|promotion|promote|magpalit.*position)\b/.test(text)) view='employees-list'
  if (/\b(?:payslip|payslips)\b/.test(text) && /\b(?:employee|employees)\b/.test(text) && !/\bportal\b/.test(text)) view='payslip'
  if (/\b(?:payslip|payslips)\b/.test(text) && /\b(?:post|publish)\b/.test(text)) view='payslip-sites'
  if (!references.length && followUp) view=assistantGuides.find(item=>item.id===contextGuide)?.view||view
  const topics=assistantGuides.filter(item=>item.view===view && !item.id.startsWith('system-'))
  if (!topics.length) return null
  let action='use'
  const actions:[string,RegExp][]=[['resign',/\b(?:resign|resigned|resignation|nagresign)\b/],['btr',/\b(?:btr|break time reliever)\b/],['backup',/\b(?:backup|back up|restore)\b/],['access',/\b(?:permission|permissions|team access|staff access)\b/],['recovery',/\b(?:recovery|forgot|nakalimutan|recover)\b/],['position',/\b(?:change position|promotion|promote|palit ng position)\b/],['transfer',/\b(?:transfer|ilipat|lipat)\b/],['people',/\b(?:add|create|dagdag|magdagdag)\b.*\b(?:employee|employees|tao)\b.*\bdtr\b/],['import',/\b(?:import)\b/],['upload',/\b(?:upload|attach|scan)\b/],['print',/\b(?:print|pdf|png)\b/],['export',/\b(?:export|download)\b/],['post',/\b(?:post|publish|publication)\b/],['pause',/\b(?:pause|skip)\b/],['resume',/\b(?:resume)\b/],['delete',/\b(?:delete|remove|burahin)\b/],['deactivate',/\b(?:deactivate|disable)\b/],['approve',/\b(?:approve|finalize|finalise|reject)\b/],['compute',/\b(?:compute|calculate|kalkulahin|computation)\b/],['edit',/\b(?:edit|update|change|correct|baguhin|itama)\b/],['requirements',/\b(?:requirements|required|fields|kailangan)\b/],['create',/\b(?:create|add|new|gumawa|magdagdag|register|encode)\b/],['summary',/\b(?:summary|history)\b/]]
  action=actions.find(([,pattern])=>pattern.test(text))?.[0]||action
  if (view==='employees-list' && /\bmagpalit\b.*\bposition\b/.test(text)) action='position'
  const selected=topics.find(item=>item.actions.includes(action))
  return {guide:selected||topics[0], unsupportedAction:!selected&&action!=='use', action}
}
