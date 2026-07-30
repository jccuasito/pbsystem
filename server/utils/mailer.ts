import nodemailer from 'nodemailer'

function mailer() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) throw new Error('Gmail SMTP is not configured.')
  return nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } })
}

export async function sendVerificationEmail(to: string, code: string) {
  await mailer().sendMail({ from: `DJA Payroll <${process.env.GMAIL_USER}>`, to, subject: 'Your DJA Payroll verification code', text: `Your DJA Payroll verification code is: ${code}. It expires in 15 minutes.`, html: `<p>Welcome to DJA Payroll.</p><p>Your verification code is:</p><h1 style="letter-spacing:6px">${code}</h1><p>This code expires in 15 minutes. Do not share it with anyone.</p>` })
}

export async function sendPasswordResetEmail(to: string, token: string) {
  const appUrl = process.env.APP_URL || 'http://localhost:3000'
  const link = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`
  await mailer().sendMail({ from: `DJA Payroll <${process.env.GMAIL_USER}>`, to, subject: 'Reset your DJA Payroll password', text: `Reset your password: ${link}. It expires in one hour.`, html: `<p><a href="${link}">Reset your password</a></p><p>This link expires in one hour.</p>` })
}
