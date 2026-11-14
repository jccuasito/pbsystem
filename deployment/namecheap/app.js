// cPanel startup file: deployment/namecheap/app.js (relative to application root).
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '../..')
process.chdir(root)
process.env.NODE_ENV = 'production'
process.env.DEBUG = 'false'
import(pathToFileURL(path.join(root, '.output/server/index.mjs')).href).catch(error => {
  console.error('[startup] Application failed to start:', error.code || error.name)
  process.exitCode = 1
})
