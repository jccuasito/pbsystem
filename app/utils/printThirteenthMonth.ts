const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
const money = (value: unknown) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0))

export function thirteenthStatement(person: any, year: number) {
  const saved = person.saved, summary = saved?.summary || person.summary
  const start = saved?.coverageStart || person.coverageStart, end = saved?.coverageEnd || person.coverageEnd
  const day = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
  const months = summary.months.filter((row: any) => row.month >= Number(start.slice(5, 7)) && row.month <= Number(end.slice(5, 7)))
  const payments = person.releases.filter((row: any) => row.Status === 'Active')
  const paid = payments.reduce((sum: number, row: any) => sum + Math.round(Number(row.Amount) * 100), 0) / 100
  return `<!doctype html><html><head><meta charset="utf-8"><title>13th-Month Pay - ${escape(person.EmployeeName)}</title><style>
    @page{size:A4;margin:16mm}body{font:12px Arial,sans-serif;color:#14233a;margin:0}h1{font-size:22px;margin:6px 0 18px}h2{font-size:17px}p{line-height:1.6}table{width:100%;border-collapse:collapse;margin:18px 0}th,td{padding:8px;border:1px solid #cbd5e1;text-align:left}th{background:#f1f5f9}td:not(:first-child){text-align:right}.total{font-weight:bold;background:#f1f5f9}.note{color:#526175;font-size:11px}tr{break-inside:avoid}</style></head><body><article>
    <h2>${escape(person.AgencyName)}</h2><h1>13th-Month Pay Statement | ${year}</h1>
    <p><strong>${escape(person.EmployeeName)}</strong><br>EMP-${String(person.EmployeeID).padStart(4, '0')} | Employee no.: ${escape(person.EmployeeNumber || 'Not assigned')}<br>
    Coverage: ${escape(day(start))} to ${escape(day(end))}<br>
    ${saved ? `Saved revision ${escape(person.header.Revision)} | ${escape(person.header.Status)}` : 'UNSAVED COMPUTATION PREVIEW'}</p>
    ${person.sourceChanged ? '<p class="note">Current earnings changed after this saved computation. Review and reconcile the new sources.</p>' : ''}
    ${summary.gaps.length ? '<p class="note">Incomplete coverage: figures show recorded earnings only. Uncovered dates have not been verified as zero.</p>' : ''}
    <table><thead><tr><th>Month</th><th>Basic pay</th><th>Unpaid time</th><th>Basic adjustments</th><th>Basic earned</th></tr></thead><tbody>${months.map((row: any) => `<tr><td>${new Date(Date.UTC(year, row.month - 1, 1)).toLocaleString('en-PH', { month: 'long', timeZone: 'UTC' })}</td><td>${money(row.basic)}</td><td>${money(row.timeDeductions)}</td><td>${money(row.adjustments)}</td><td>${money(row.earned)}</td></tr>`).join('')}
    <tr class="total"><td colspan="4">Total basic earned</td><td>${money(summary.basicEarned)}</td></tr><tr class="total"><td colspan="4">13th-month entitlement (basic earned / 12)</td><td>${money(summary.entitlement)}</td></tr></tbody></table>
    <h2>Recorded payments</h2><table><thead><tr><th>Date / Reference</th><th>Gross benefit</th><th>Withholding</th><th>Net payment</th></tr></thead><tbody>${payments.length ? payments.map((row: any) => `<tr><td>${escape(day(row.PaymentDate))} / ${escape(row.Reference)}</td><td>${money(row.Amount)}</td><td>${money(row.Withholding)}</td><td>${money(row.NetAmount)}</td></tr>`).join('') : '<tr><td colspan="4">No payments recorded.</td></tr>'}</tbody></table>
    <p><strong>Gross benefit paid: ${money(paid)}<br>Remaining gross benefit: ${money(Number(summary.entitlement) - paid)}</strong></p>
    <p class="note">${escape(person.header?.ReviewNote || 'For review. Missing payroll periods are not assumed to be zero.')}<br>Partial-year coverage requires reconciliation when further basic earnings become available. Recording a release does not transfer money.</p>
    <p style="margin-top:45px">Prepared by: ____________________ &nbsp; Approved by: ____________________<br><br>Received by: ____________________ &nbsp; Date: ____________________</p>
    </article></body></html>`
}

export async function printThirteenthStatement(html: string) {
  const frameId = 'thirteenth-month-print'
  document.getElementById(frameId)?.remove()
  const frame = document.createElement('iframe')
  frame.id = frameId; frame.title = '13th-month pay print document'; frame.tabIndex = -1
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0'
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { frame.remove(); reject(new Error('Unable to prepare the statement for printing.')) }, 15000)
    frame.onload = async () => {
      try {
        if (!frame.contentWindow || !frame.contentDocument?.querySelector('article')) return
        await frame.contentDocument.fonts.ready
        await new Promise<void>(ready => frame.contentWindow!.requestAnimationFrame(() => frame.contentWindow!.requestAnimationFrame(() => ready())))
        clearTimeout(timeout); frame.contentWindow.focus(); frame.contentWindow.print(); resolve()
      } catch (error) { clearTimeout(timeout); frame.remove(); reject(error) }
    }
    frame.srcdoc = html; document.body.appendChild(frame)
  })
}
