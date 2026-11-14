import { createError } from 'h3'

const invalid = (message: string) => { throw createError({ statusCode: 400, statusMessage: message }) }

/** Validate types and bounds, not SQL keywords. Apostrophes and Unicode are legitimate data. */
export function textInput(value: unknown, label: string, maximum: number, required = true) {
  if (typeof value !== 'string') return invalid(`Enter a valid ${label}.`)
  const result = value.trim()
  if ((required && !result) || result.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) return invalid(`Enter a valid ${label} of up to ${maximum} characters.`)
  return result
}

export function emailInput(value: unknown) {
  const email = textInput(value, 'email address', 190).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return invalid('Enter a valid email address.')
  return email
}

export function calendarDate(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid(`Enter a valid ${label}.`)
  const date = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return invalid(`Enter a valid ${label}.`)
  return value
}

/** Structural limits shared by every JSON API, including the employee portal. Never mutates values. */
export function validateRequestObject(value: unknown, options: { dtrImportRows?: boolean } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('Send a JSON object.')
  let nodes = 0
  const visit = (entry: unknown, depth: number, key = '', dtrImportRow = false) => {
    if (++nodes > 100000 || depth > 16) return invalid('This request is too complex.')
    if (entry != null && /(?:name|email|address|remarks|description|reason|reference|notes?|number|code|type|status|message|password|token|label)$/i.test(key) && !['string', 'number'].includes(typeof entry)) return invalid('Text fields must contain plain text.')
    if (entry != null && /(?:amount|hours|rate|minutes|quantity|balance|count|year)$/i.test(key) && !['string', 'number'].includes(typeof entry)) return invalid('Numeric fields must contain a number.')
    // Spreadsheet Employee ID cells may contain EMP-0011 or an external badge
    // number such as DJA-0001. The DTR importer resolves these to enrolled IDs.
    const employeeCode = dtrImportRow && depth === 3 && key === 'EmployeeID'
    if (employeeCode && entry != null) {
      if (!['string', 'number'].includes(typeof entry) || String(entry).length > 190) return invalid('Employee ID / Employee No. must contain plain text of up to 190 characters.')
    } else if (/(?:^id$|ID$|Id$)/.test(key) && key !== 'googleId' && entry != null && entry !== '') {
      if (!['string', 'number'].includes(typeof entry) || !/^\d+$/.test(String(entry)) || !Number.isSafeInteger(Number(entry))) return invalid('Identifiers must be whole numbers.')
    }
    if (entry == null || typeof entry === 'boolean') return
    if (typeof entry === 'number') { if (!Number.isFinite(entry)) invalid('Numeric values must be finite.'); return }
    if (typeof entry === 'string') {
      const attachment = ['image', 'PhotoDataUrl', 'LogoData', 'AttachmentDataUrl', 'pdfData'].includes(key)
      const max = attachment ? 8 * 1024 * 1024 : 16384
      if (entry.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(entry)) invalid('A field contains invalid characters or is too long.')
      return
    }
    if (Array.isArray(entry)) {
      if (entry.length > 10000) return invalid('This request contains too many rows.')
      for (const item of entry) visit(item, depth + 1, key, options.dtrImportRows === true && depth === 1 && key === 'Rows')
      return
    }
    if (typeof entry !== 'object' || Object.getPrototypeOf(entry) !== Object.prototype) return invalid('Send plain JSON values.')
    for (const [name, item] of Object.entries(entry)) {
      if (['__proto__', 'constructor', 'prototype'].includes(name) || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) return invalid('Invalid field name.')
      visit(item, depth + 1, name, dtrImportRow)
    }
  }
  visit(value, 0)
  return value as Record<string, unknown>
}

export function imageData(value: unknown, maximum = 2 * 1024 * 1024) {
  if (typeof value !== 'string' || value.length > Math.ceil(maximum / 3) * 4 + 100) return invalid('Upload a PNG, JPG, or WebP image of 2 MB or less.')
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match) return invalid('Upload a PNG, JPG, or WebP image.')
  const buffer = Buffer.from(match[2], 'base64'), mime = match[1]
  const signature = mime === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : mime === 'image/jpeg' ? buffer.subarray(0, 3).equals(Buffer.from([255,216,255]))
      : buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP'
  if (!buffer.length || buffer.length > maximum || buffer.toString('base64') !== match[2] || !signature) return invalid('Image contents do not match the selected file type, or exceed 2 MB.')
  return { buffer, mime, extension: mime === 'image/jpeg' ? 'jpg' : mime.slice(6) }
}
