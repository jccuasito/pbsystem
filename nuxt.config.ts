// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: [
    '~~/assets/css/base.css',
    '~~/assets/css/theme.css',
    '~~/assets/css/components.css',
    '~~/assets/css/auth.css',
    '~~/assets/css/dashboard.css'
  ],
  runtimeConfig: {
    jwtSecret: process.env.JWT_SECRET,
    appUrl: process.env.APP_URL || 'http://localhost:3000',
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    gmailUser: process.env.GMAIL_USER,
    gmailAppPassword: process.env.GMAIL_APP_PASSWORD,
    public: {
      googleClientId: process.env.GOOGLE_CLIENT_ID
    }
  }
})
