// Configuração do pm2. Use:  pm2 start ecosystem.config.js
module.exports = {
    apps: [{
        name: 'mitra_bot',
        script: 'index.js',
        cwd: __dirname,
        autorestart: true,
        // O bot chama process.exit(1) quando o WhatsApp desconecta; o pm2
        // reinicia sozinho. O delay evita loop de reinício rápido.
        restart_delay: 10000,
        max_restarts: 50,
        min_uptime: 30000,
        max_memory_restart: '600M',
        time: true,
        error_file: 'logs/erro.log',
        out_file: 'logs/saida.log'
    }]
};
