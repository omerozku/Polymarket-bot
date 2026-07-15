module.exports = {
  apps: [{
    name: 'polymarket-bot',
    script: 'start.cjs',
    args: '',
    cwd: __dirname,
    watch: false,
    autorestart: true,
    max_restarts: 0,  // Sınırsız yeniden başlatma (7/24 sistem için)
    restart_delay: 5000,
    env: {
      NODE_ENV: 'production',
      LOG_LEVEL: 'warn',
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
  }]
};
