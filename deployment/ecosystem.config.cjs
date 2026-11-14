const path = require('node:path')

// Optional local/VPS production supervisor. cPanel uses Passenger instead.
module.exports = { apps: [{
  name: 'pbsystem',
  cwd: path.resolve(__dirname, '..'),
  script: '.output/server/index.mjs',
  node_args: '--env-file=.env',
  instances: 1,
  exec_mode: 'fork',
  autorestart: true,
  max_memory_restart: '768M',
  min_uptime: '10s',
  max_restarts: 10,
  exp_backoff_restart_delay: 1000,
  kill_timeout: 30000,
  env: { NODE_ENV: 'production', DEBUG: 'false', PORT: '3000', HOST: '127.0.0.1' },
}] }
