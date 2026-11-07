import { employeeDailySites } from './employeeStatusSheet'

export type EmployeeStatusExportInput = {
  employees: any[]
  dates: string[]
  history: any[]
  rosters: any[]
  deployments: any[]
  filters: Record<string, string>
  statusAt: (employeeId: any, date: string) => string | undefined
}

const codes: Record<string, string> = { Present: 'P', Absent: 'A', Late: 'L', 'Half-Day': 'HD', 'On-Leave': 'OL', 'Vacation Leave': 'VL', Holiday: 'H', 'Rest Day': 'RD', Reliever: 'R', 'Sick Leave': 'SL', Suspended: 'SUS' }
const employeeCode = (id: any) => `EMP-${String(id).padStart(4, '0')}`
const excelDate = (date: string) => (Date.parse(`${date}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000
const siteLabel = (site: any) => [site.ClientName, site.SiteName].filter(Boolean).join(' / ')

// The existing SheetJS CE dependency writes the data. These native OOXML styles
// and print settings supply the report features that its community writer omits.
const reportStyles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="mmm d, yyyy"/><numFmt numFmtId="165" formatCode="d ddd"/></numFmts>
<fonts count="5"><font><sz val="10"/><name val="Calibri"/><color rgb="FF172642"/></font><font><b/><sz val="16"/><name val="Calibri"/><color rgb="FF173E77"/></font><font><b/><sz val="9"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font><font><b/><sz val="10"/><name val="Calibri"/><color rgb="FF172642"/></font><font><sz val="9"/><name val="Calibri"/><color rgb="FF53647C"/></font></fonts>
<fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF173E77"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F5FA"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDF4FF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFEE2E2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFDCE4EF"/></left><right style="thin"><color rgb="FFDCE4EF"/></right><top style="thin"><color rgb="FFDCE4EF"/></top><bottom style="thin"><color rgb="FFDCE4EF"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="13">${[
  [0, 0, 0, 1, 'left'], [0, 1, 0, 0, 'left'], [0, 4, 0, 0, 'left'],
  [0, 2, 2, 1, 'center'], [0, 3, 3, 1, 'left'], [0, 3, 4, 1, 'center'],
  [0, 0, 5, 1, 'center'], [0, 4, 0, 1, 'center'], [164, 0, 0, 1, 'left'],
  [165, 2, 2, 1, 'center'], [0, 4, 3, 1, 'center'], [1, 3, 5, 1, 'right'], [0, 3, 6, 1, 'center'],
].map(([numFmtId, fontId, fillId, borderId, horizontal]) => `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="${horizontal}" vertical="center" wrapText="1"/></xf>`).join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

function formatReport(XLSX: any, workbook: any) {
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })), { type: 'buffer' })
  const replace = (path: string, transform: (xml: string) => string) => {
    const index = zip.FullPaths.findIndex((name: string) => name.endsWith(`/${path}`))
    if (index < 0) throw new Error(`Excel report part is missing: ${path}`)
    const entry = zip.FileIndex[index]
    entry.content = new TextEncoder().encode(transform(new TextDecoder().decode(entry.content)))
    entry.size = entry.content.length
  }
  replace('xl/styles.xml', () => reportStyles)
  workbook.SheetNames.forEach((name: string, index: number) => {
    const sheet = workbook.Sheets[name]
    replace(`xl/worksheets/sheet${index + 1}.xml`, xml => {
      xml = xml.replace(/<c\b([^>]*\br="([A-Z]+)(\d+)"[^>]*)>/g, (_: string, attrs: string, column: string, rowText: string) => {
        const row = Number(rowText), cell = sheet[`${column}${row}`]
        const col = XLSX.utils.decode_col(column)
        let style = row === 1 ? 1 : row < 6 ? 2 : row === 6 ? 3 : 0
        if (index === 0 && row === 6 && col >= 5) style = 9
        if (index === 0 && row >= 7) style = col < 5 ? 4 : (row - 7) % 2 ? 7 : cell?.v === 'P' ? 5 : cell?.v === 'A' ? 12 : cell?.v === 'NE' ? 10 : 6
        if (index === 1 && row >= 7 && col === 3) style = 8
        return `<c${attrs.replace(/\s+s="[^"]*"/g, '')} s="${style}">`
      })
      const frozen = index === 0 ? 5 : 2
      xml = xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, `<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane xSplit="${frozen}" ySplit="6" topLeftCell="${XLSX.utils.encode_col(frozen)}7" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>`)
      const setup = '<pageSetUpPr fitToPage="1"/>'
      xml = xml.includes('</sheetPr>') ? xml.replace('</sheetPr>', `${setup}</sheetPr>`) : xml.replace(/(<worksheet\b[^>]*>)/, `$1<sheetPr>${setup}</sheetPr>`)
      const breaks: number[] = []
      if (index === 0) {
        let usedHeight = 0
        for (let row = 6; row <= XLSX.utils.decode_range(sheet['!ref']).e.r; row += 2) {
          const height = sheet['!rows'][row].hpt + sheet['!rows'][row + 1].hpt
          if (usedHeight && usedHeight + height > 600) { breaks.push(row); usedHeight = 0 }
          usedHeight += height
        }
      }
      const layout = `<pageSetup paperSize="${index === 0 ? 8 : 9}" orientation="landscape" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;LEmployee Status&amp;RPage &amp;P of &amp;N</oddFooter></headerFooter>${breaks.length ? `<rowBreaks count="${breaks.length}" manualBreakCount="${breaks.length}">${breaks.map(id => `<brk id="${id}" max="16383" man="1"/>`).join('')}</rowBreaks>` : ''}`
      return xml.replace(/(<pageMargins\b[^>]*\/>)/, `$1${layout}`)
    })
  })
  return new Uint8Array(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip', compression: true }))
}

export async function createEmployeeStatusWorkbook(input: EmployeeStatusExportInput): Promise<Uint8Array> {
  if (!input.employees.length || !input.dates.length) throw new Error('Choose a cutoff with employees before exporting.')
  const XLSX = await import('xlsx')
  const filterText = Object.entries(input.filters).map(([key, value]) => `${key}: ${value || 'All'}`).join(' | ')
  const dateLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  const period = `${dateLabel(input.dates[0])} to ${dateLabel(input.dates[input.dates.length - 1])}`
  const grid: any[][] = [
    ['EMPLOYEE CUTOFF STATUS'], [`Cutoff: ${period} | ${input.employees.length} employees`], [filterText],
    ['P Present | A Absent | L Late | HD Half-Day | OL On-Leave | VL Vacation Leave | H Holiday | RD Rest Day | R Reliever | SL Sick Leave | SUS Suspended | NE Not yet encoded'],
    ['Sites come from dated attendance; Assigned = roster/fixed posting only. NE is not Absent. Grid prints in A3 landscape; Daily Details prints in A4 landscape.'],
    ['Employee ID', 'Employee no.', 'Name', 'Agency / position', 'Row', ...input.dates.map(excelDate)],
  ]
  const details: any[][] = [
    ['EMPLOYEE DAILY STATUS AND SITE'], [`Cutoff: ${period} | ${input.employees.length} employees`], [filterText],
    ['One row per saved attendance record/site; unencoded dates and assignment-only sites are included.'],
    ['Attendance record identifies its saved site, not proof of punches. Multiple same-day site records are retained. Status filter selects employees; all their cutoff dates are exported.'],
    ['Employee / ID', 'Employee no.', 'Agency / position', 'Date', 'Status', 'Client / site', 'Site basis', 'DTR / HR state', 'Remarks'],
  ]
  for (const employee of input.employees) {
    const identity = [employeeCode(employee.EmployeeID), String(employee.EmployeeNumber || 'Not yet assigned'), String(employee.EmployeeName || ''), [employee.AgencyName, employee.PositionName].filter(Boolean).join('\n')]
    const matches = (row: any) => String(row.EmployeeID) === String(employee.EmployeeID)
    const history = input.history.filter(matches), rosters = input.rosters.filter(matches), deployments = input.deployments.filter(matches)
    const siteCells: string[] = [], statusCells: string[] = []
    for (const date of input.dates) {
      const sites = employeeDailySites(employee.EmployeeID, date, history, rosters, deployments)
      statusCells.push(codes[input.statusAt(employee.EmployeeID, date) || ''] || 'NE')
      siteCells.push(sites.length ? sites.map(site => `${site.Source === 'Attendance record' ? '' : 'Assigned: '}${siteLabel(site)}`).join('\n') : 'No site assigned')
      const records = history.filter(row => String(row.AttendanceDate).slice(0, 10) === date)
      const dailyRows = records.length ? records : [null]
      for (const record of dailyRows) {
        const fallbackSites = record ? employeeDailySites(employee.EmployeeID, date, [], rosters, deployments) : sites
        const rowSites = record?.SiteName ? [{ ClientName: record.ClientName, SiteName: record.SiteName, Source: 'Attendance record' }]
          : fallbackSites.length ? fallbackSites : [{ ClientName: '', SiteName: 'No site assigned', Source: 'Not assigned' }]
        for (const site of rowSites) details.push([
          `${employee.EmployeeName || ''}\n${identity[0]}`, identity[1], identity[3], excelDate(date), record?.AttendanceStatus || 'Not yet encoded',
          siteLabel(site), site.Source, record?.DtrStatus || (record ? 'Pending HR status' : 'Not yet encoded'), record?.Remarks || '',
        ])
      }
    }
    grid.push([...identity, 'Status', ...statusCells], ['', '', '', '', 'Site', ...siteCells])
  }
  const workbook = XLSX.utils.book_new()
  const sheets = [XLSX.utils.aoa_to_sheet(grid), XLSX.utils.aoa_to_sheet(details)]
  const names = ['Cutoff Sheet', 'Daily Details']
  sheets.forEach((sheet: any, index) => {
    const rows = index === 0 ? grid : details, lastCol = rows[5].length - 1
    sheet['!merges'] = Array.from({ length: 5 }, (_, row) => ({ s: { r: row, c: 0 }, e: { r: row, c: lastCol } }))
    if (index === 0) for (let row = 6; row < grid.length; row += 2) for (let col = 0; col < 4; col++) sheet['!merges'].push({ s: { r: row, c: col }, e: { r: row + 1, c: col } })
    sheet['!cols'] = (index === 0 ? [12, 14, 25, 25, 8, ...input.dates.map(() => 10)] : [22, 12, 20, 14, 14, 22, 14, 16, 24]).map(wch => ({ wch }))
    sheet['!rows'] = rows.map((values, row) => {
      const wrappedHeight = (startCol = 0) => Math.max(1, ...values.slice(startCol).map((value, offset) => {
        const width = Math.max(8, sheet['!cols'][startCol + offset].wch - 2)
        return String(value ?? '').split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / width)), 0)
      })) * 12 + 8
      const hpt = row === 0 ? 28 : row === 3 || row === 4 ? 32 : row < 6 ? 24
        : index === 0 ? (row % 2 ? Math.max(56, wrappedHeight(5)) : 24) : Math.max(42, wrappedHeight())
      return { hpt }
    })
    sheet['!margins'] = { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 }
    if (index === 1) sheet['!autofilter'] = { ref: `A6:I${details.length}` }
    XLSX.utils.book_append_sheet(workbook, sheet, names[index])
  })
  workbook.Workbook = { Names: names.flatMap((name, index) => [
    { Name: '_xlnm.Print_Titles', Sheet: index, Ref: `'${name}'!$1:$6` },
    { Name: '_xlnm.Print_Area', Sheet: index, Ref: `'${name}'!$A$1:$${XLSX.utils.encode_col(XLSX.utils.decode_range(sheets[index]['!ref']!).e.c)}$${XLSX.utils.decode_range(sheets[index]['!ref']!).e.r + 1}` },
  ]) }
  return formatReport(XLSX, workbook)
}
