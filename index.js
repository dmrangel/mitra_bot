const qrcode = require('qrcode-terminal');

const { config, validar } = require('./config');
const { log, erro } = require('./lib/log');

// ---------------------------------------------------------------------------
// Validação da configuração (falha cedo, com mensagem clara)
// ---------------------------------------------------------------------------

const { erros, avisos } = validar();
avisos.forEach(a => log('AVISO:', a));
if (erros.length > 0) {
    erros.forEach(e => console.error('ERRO DE CONFIGURAÇÃO:', e));
    console.error('\nCorrija o arquivo .env (use o .env.example como modelo) e rode de novo.');
    process.exit(1);
}

// A limpeza do Chrome/locks e a criação do Client (ver lib/cliente.js) só
// acontecem aqui, na primeira chamada — não como efeito colateral do require.
const { obterCliente } = require('./lib/cliente');
const client = obterCliente();

const { AVISO_LIGACAO } = require('./lib/textos');
const { enviar } = require('./lib/envio');
const { limparMapasAuxiliares } = require('./lib/estado');
const { carregarPedidos, salvarPedidos, limparPedidosExpirados } = require('./lib/pedidos');
const { tratarMensagem, tratarComandoDoAparelho } = require('./lib/fluxoConversa');

carregarPedidos();
setInterval(() => {
    limparPedidosExpirados();
    limparMapasAuxiliares();
}, 60 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Eventos do cliente
// ---------------------------------------------------------------------------

client.on('qr', qr => {
    log('Leia o QR Code abaixo com o WhatsApp do Santuário:');
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => log('Autenticado.'));
client.on('auth_failure', m => erro('autenticação', m));
client.on('ready', () => log(`Bot conectado. Sessão em ${config.pastaSessao}.`));
client.on('loading_screen', (percent, message) => log(`Carregando: ${percent}% ${message || ''}`));

client.on('disconnected', motivo => {
    log(`Desconectado (${motivo}). Encerrando para o pm2 reiniciar.`);
    salvarPedidos();
    process.exit(1);
});

client.on('call', async call => {
    try {
        await call.reject();
    } catch (e) {
        erro('rejeitar chamada', e);
    }
    await enviar(call.from, AVISO_LIGACAO);
});

// Comandos enviados pelo próprio aparelho do Santuário.
client.on('message_create', async msg => {
    try {
        if (!msg.fromMe) return;
        await tratarComandoDoAparelho(msg);
    } catch (e) {
        erro('message_create', e);
    }
});

client.on('message', async msg => {
    try {
        await tratarMensagem(msg);
    } catch (e) {
        erro('tratar mensagem', e);
    }
});

// ---------------------------------------------------------------------------
// Encerramento e erros não tratados
// ---------------------------------------------------------------------------

let encerrando = false;
async function encerrar(sinal) {
    if (encerrando) return;
    encerrando = true;
    log(`Recebido ${sinal}. Encerrando...`);
    salvarPedidos();
    try {
        await client.destroy();
    } catch (e) {
        erro('destruir cliente', e);
    }
    process.exit(0);
}

process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));

process.on('unhandledRejection', motivo => erro('promise não tratada', motivo));
process.on('uncaughtException', e => {
    erro('exceção não tratada', e);
    salvarPedidos();
    process.exit(1);
});

// ---------------------------------------------------------------------------

client.initialize().catch(e => {
    erro('inicialização', e);
    process.exit(1);
});
