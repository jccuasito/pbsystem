import { billingLineAmount, calculateBillingDraft, normalizeBillingDraft } from './billingDraft'

export type BillingInvoicePrintInput = {
  metadata: Record<string, any>
  lines: unknown
  settings: unknown
  billingDate: string
  reference: string
  finalized: boolean
  title?: string
}

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
const number = (value: number) => new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
const amount = (value: number) => value < 0 ? `(${number(Math.abs(value))})` : number(value)
const day = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  ? new Date(`${value}T00:00:00`).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' }) : ''

// A self-contained document: dashboard/DTR print rules must never hide this invoice.
// All business text is escaped; no internal notes, remote assets or scripts are copied.
export function renderBillingInvoice(input: BillingInvoicePrintInput) {
  const { lines, settings } = normalizeBillingDraft(input.lines, input.settings)
  const totals = calculateBillingDraft(lines, settings), meta = input.metadata
  const status = input.finalized ? 'FINALIZED BILLING STATEMENT' : 'DRAFT - FOR REVIEW'
  const row = (label: string, total: number, quantity = '', rate = '', className = '') =>
    `<tr class="${className}"><td>${escape(label)}</td><td class="numeric">${quantity}</td><td class="numeric">${rate}</td><td class="numeric">${amount(total)}</td></tr>`
  const serviceRows = lines.map(line => row(line.description, billingLineAmount(line),
    `${number(line.quantity)} <small>${line.unit === 'hour' ? 'hrs' : line.unit === 'day' ? 'days' : line.quantity === 1 ? 'item' : 'items'}</small>`, number(line.rate))).join('')
  const blankRows = Array.from({ length: Math.max(0, 8 - lines.length) }, () => '<tr class="blank-row"><td>&nbsp;</td><td></td><td></td><td></td></tr>').join('')
  const charges = row('TOTAL SERVICE CHARGES', Math.round((totals.serviceSubtotal + totals.additionalCharges) * 100) / 100, '', '', 'service-total')
    + row(`Administrative cost (AC) - ${settings.adminPercent}%`, totals.administrative)
    + row(`VAT - ${settings.vatPercent}%`, totals.vat)
    + (totals.retirement ? row('Add: Retirement pay', totals.retirement, `${number(settings.retirementQuantity)} <small>days</small>`, number(settings.retirementRate)) : '')
    + (totals.uniform ? row('Uniform allowance', totals.uniform, `${number(settings.uniformQuantity)} <small>days</small>`, number(settings.uniformRate)) : '')
    + row('GROSS AMOUNT DUE', totals.gross, '', '', 'gross-total')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(input.reference)} - ${escape(meta.ClientName)} - ${input.finalized ? 'Billing' : 'Draft'}</title>
<style>
@page{size:A4 portrait;margin:12mm}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#17354a;font-family:Arial,Helvetica,sans-serif;font-size:10pt;line-height:1.3}
.invoice{max-width:186mm;margin:0 auto}.invoice-header{display:flex;justify-content:space-between;gap:9mm;padding:2mm 0 4mm;border-bottom:2px solid #294858}
.agency{flex:1;min-width:0}.agency h1{font-family:Georgia,'Times New Roman',serif;font-size:19pt;line-height:1.12;margin:0 0 3mm;color:#182c35;text-transform:uppercase;overflow-wrap:anywhere}.agency p{margin:1mm 0;font-size:9pt;white-space:pre-line;overflow-wrap:anywhere}
.document-heading{flex:0 0 57mm;text-align:right}.document-heading h2{font-family:Georgia,'Times New Roman',serif;font-size:23pt;line-height:1.05;margin:0 0 3mm;color:#182c35}.document-heading .reference{font-size:11pt;font-weight:bold;letter-spacing:.04em}.status{margin-top:2mm;font-size:8pt;font-weight:bold;letter-spacing:.06em;color:#855c32}.status.finalized{color:#28614b}.custom-title{font-size:8pt;margin-top:1mm}
.invoice-meta{display:flex;justify-content:space-between;gap:5mm;border-bottom:1px solid #7b8d96;padding:3mm 0;font-size:9pt}.invoice-meta span{color:#657781}.invoice-meta strong{margin-left:2mm;color:#17354a}
.bill-to{border:1px solid #7b8d96;margin:4mm 0 5mm;padding:3mm 4mm}.party-row{display:grid;grid-template-columns:24mm 1fr;gap:2mm;margin:1.5mm 0;font-size:9pt}.party-row>span{font-size:8pt;color:#596e79}.party-row strong{font-size:10pt}.party-row p{margin:0;white-space:pre-line;overflow-wrap:anywhere}.period-line{display:flex;justify-content:space-between;align-items:baseline;gap:5mm;margin:0 0 2mm;font-size:9pt}.period-line>span{font-size:8pt;color:#607580}
table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #82949e;padding:1.2mm 2.5mm;overflow-wrap:anywhere}thead{display:table-header-group}thead th{font-size:8.5pt;font-weight:normal;text-align:center;color:#334e5e;background:#f2f5f6}tbody td{font-size:9pt;height:7mm}.description{width:54%}.quantity{width:16%}.price{width:15%}.total{width:15%}.numeric{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.numeric small{font-size:7pt;color:#617783}.blank-row td{height:6mm;padding:0}.service-total td{font-weight:bold;background:#f0f4f6;border-top:2px solid #425f70}.gross-total td{font-weight:bold;border-top:2px solid #425f70}.charges{break-inside:avoid}.charges td:first-child{font-weight:bold}.charges td{height:7mm}.charges .gross-total td{background:#eef3f5}
.invoice-bottom{display:grid;grid-template-columns:1fr 84mm;gap:10mm;align-items:end;margin-top:5mm;break-inside:avoid}.signatures{padding:0 1mm 3mm}.signature-line{margin-top:24mm;border-bottom:1px solid #617682;width:100%;height:5mm}.signatures p{font-size:7.5pt;text-align:center;margin:2mm 0 0;text-transform:uppercase;letter-spacing:.03em}.tax-summary td{padding:2mm 2.5mm;font-size:8.5pt}.tax-summary td:first-child{width:63%}.tax-summary .net-total td{font-weight:bold;background:#eaf0f3;border-top:2px solid #425f70;font-size:10pt;padding-top:3mm;padding-bottom:3mm}.net-total .numeric{font-size:12pt}
.footnote{border-top:1px solid #acb8bf;margin-top:6mm;padding-top:2.5mm;font-size:7pt;color:#6a7c87;line-height:1.5}.footnote p{margin:0 0 1mm}.invoice-reference{display:flex;justify-content:space-between;gap:4mm;font-size:7pt;color:#6a7c87;margin-top:3mm}tr{break-inside:avoid}h1,h2{break-after:avoid}
@media screen{body{padding:8mm;background:#e9edf1}.invoice{padding:10mm;background:white;box-shadow:0 2px 15px #26384920;max-width:210mm}}
@media print{html,body{width:auto!important;height:auto!important;overflow:visible!important}.invoice{max-width:none;margin:0}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><main class="invoice">
<header class="invoice-header"><div class="agency"><h1>${escape(meta.AgencyName)}</h1>${meta.AgencyAddress ? `<p>${escape(meta.AgencyAddress)}</p>` : ''}${meta.AgencyContact ? `<p>Contact: ${escape(meta.AgencyContact)}</p>` : ''}</div><div class="document-heading"><h2>SERVICE<br>INVOICE</h2><div class="reference">${escape(input.reference)}</div><div class="status ${input.finalized ? 'finalized' : ''}">${status}</div>${input.title && input.title !== 'Billing statement' ? `<div class="custom-title">${escape(input.title)}</div>` : ''}</div></header>
<div class="invoice-meta"><div><span>Service period</span><strong>${escape(day(meta.PeriodStart))} - ${escape(day(meta.PeriodEnd))}</strong></div><div><span>Date</span><strong>${escape(day(input.billingDate))}</strong></div></div>
<section class="bill-to"><div class="party-row"><span>SOLD TO</span><strong>${escape(meta.ClientName)}</strong></div>${meta.ClientAddress ? `<div class="party-row"><span>ADDRESS</span><p>${escape(meta.ClientAddress)}</p></div>` : ''}<div class="party-row"><span>SITE / LOCATION</span><p>${escape(meta.SiteName)}</p></div></section>
<div class="period-line"><strong>Service charges</strong><span>All amounts in Philippine pesos (PHP)</span></div>
<table class="service-table"><colgroup><col class="description"><col class="quantity"><col class="price"><col class="total"></colgroup><thead><tr><th>Item description / Nature of service</th><th>Quantity</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>${serviceRows}${blankRows}</tbody><tbody class="charges">${charges}</tbody></table>
<div class="invoice-bottom"><div class="signatures"><div class="signature-line"></div><p>Cashier / Authorized representative</p></div><table class="tax-summary"><tbody><tr><td>VAT base</td><td class="numeric">${amount(totals.vatableSales)}</td></tr><tr><td>VAT (${settings.vatPercent}%)</td><td class="numeric">${amount(totals.vat)}</td></tr><tr><td>Outside configured VAT base</td><td class="numeric">${amount(totals.vatExemptSales)}</td></tr><tr><td>Less: Withholding (${settings.withholdingPercent}%)</td><td class="numeric">(${number(totals.withholding)})</td></tr><tr class="net-total"><td>TOTAL AMOUNT DUE</td><td class="numeric">&#8369;${amount(totals.totalDue)}</td></tr></tbody></table></div>
<footer class="footnote"><p>${input.finalized ? 'Finalized billing statement.' : 'DRAFT ONLY - For review. This billing has not been finalized.'} The bill reference is an internal reference, not an official invoice serial.</p><p>Charges and tax bases follow the saved billing configuration.</p></footer><div class="invoice-reference"><span>${escape(input.reference)}</span><span>${escape(meta.ClientName)}</span></div>
</main></body></html>`
}
