module.exports = {
  apps: [
    {
      name: 'plaidcas-web',
      script: 'npm',
      args: 'start',
      cwd: '/root/BlessCas2',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      error_file: '/root/.pm2/logs/plaidcas-web-error.log',
      out_file: '/root/.pm2/logs/plaidcas-web-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'plaidcas-bot',
      script: './bot.js',
      cwd: '/root/BlessCas2',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production'
      },
      error_file: '/root/.pm2/logs/plaidcas-bot-error.log',
      out_file: '/root/.pm2/logs/plaidcas-bot-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};
