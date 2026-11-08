// Keep one isolated frame alive through the native print dialog. Chromium may
// return from print() before its preview has captured the document.
const frameId = 'billing-invoice-print-frame'

export function removeBillingPrintFrame() {
  document.getElementById(frameId)?.remove()
}

export async function printBillingInvoice(html: string) {
  removeBillingPrintFrame()
  const frame = document.createElement('iframe')
  frame.id = frameId
  frame.title = 'Billing invoice print document'
  frame.tabIndex = -1
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;pointer-events:none;'
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => { frame.remove(); reject(new Error('The invoice could not be prepared. Please try printing again.')) }, 15000)
    frame.onload = async () => {
      try {
        const target = frame.contentWindow, doc = frame.contentDocument
        if (!target || !doc?.querySelector('.invoice')) return
        await doc.fonts.ready
        await new Promise<void>(ready => target.requestAnimationFrame(() => target.requestAnimationFrame(() => ready())))
        window.clearTimeout(timeout)
        const previousFocus = document.activeElement
        target.addEventListener('afterprint', () => { if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus() }, { once: true })
        target.focus()
        target.print()
        resolve()
      } catch (error) { window.clearTimeout(timeout); frame.remove(); reject(error) }
    }
    frame.srcdoc = html
    document.body.appendChild(frame)
  })
}
