import nodemailer from 'nodemailer'

function mailer() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) throw new Error('Gmail SMTP is not configured.')
  return nodemailer.createTransport({ service: 'gmail', connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000, auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } })
}

export async function sendVerificationEmail(to: string, token: string) {
  const appUrl = process.env.APP_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000')
  if (!appUrl) throw new Error('APP_URL is required for verification emails in production.')
  const link = new URL('/verify-email', appUrl)
  if (!['https:', 'http:'].includes(link.protocol)) throw new Error('APP_URL must be an HTTP or HTTPS URL.')
  link.searchParams.set('token', token)
  const href = link.href.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  await mailer().sendMail({ from: `DJA Payroll <${process.env.GMAIL_USER}>`, to, subject: 'Verify your DJA Payroll email', text: `Verify your email: ${link.href}\nThis link expires in 15 minutes. If you did not create this account, ignore this email.`, html: `<p>Welcome to DJA Payroll.</p><p><a href="${href}">Verify email address</a></p><p>This link expires in 15 minutes. If you did not create this account, ignore this email.</p>` })
}

export async function sendPasswordResetEmail(to: string, token: string) {
  const appUrl = process.env.APP_URL || 'http://localhost:3000'
  const link = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`
  await mailer().sendMail({ from: `DJA Payroll <${process.env.GMAIL_USER}>`, to, subject: 'Reset your DJA Payroll password', text: `Reset your password: ${link}. It expires in one hour.`, html: `<p><a href="${link}">Reset your password</a></p><p>This link expires in one hour.</p>` })
}
