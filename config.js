require('dotenv').config();

const path = require('path');

function lista(valor) {
    return String(valor || '')
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);
}

function inteiro(valor, padrao) {
    const n = parseInt(valor, 10);
    return Number.isFinite(n) && n > 0 ? n : padrao;
}

function texto(valor, padrao = '') {
    const v = String(valor || '').trim();
    return v || padrao;
}

const config = {
    // Identificador da sessão. VAZIO (padrão) = pasta .wwebjs_auth/session,
    // que é exatamente o que o LocalAuth() sem argumentos sempre usou.
    // Preencher cria .wwebjs_auth/session-<SESSION_ID>, uma sessão NOVA, e
    // obriga a ler o QR Code de novo.
    sessionId: texto(process.env.SESSION_ID),

    // Caminho do Chrome/Chromium. Vazio = usa o Chromium que vem com o puppeteer.
    chromePath: texto(process.env.CHROME_PATH) || undefined,

    // Versão do WhatsApp Web a fixar. Vazio = deixa a biblioteca escolher (recomendado).
    webVersion: texto(process.env.WEB_VERSION),

    // Mata processos do Chrome/Chromium antes de subir. Só use no servidor dedicado.
    limparChrome: process.env.LIMPAR_CHROME === 'true',

    // Destinos (privados - nunca versionar)
    gruposOracao: lista(process.env.GRUPOS_ORACAO),
    gruposNotificacaoHumano: lista(process.env.GRUPOS_NOTIFICACAO_HUMANO),
    numerosVerificacao: lista(process.env.NUMEROS_VERIFICACAO),
    blacklist: lista(process.env.BLACKLIST),

    // Modo teste: só responde ao NUMERO_TESTE
    modoTeste: process.env.MODO_TESTE === 'true',
    numeroTeste: texto(process.env.NUMERO_TESTE),

    // Tempos
    tempoAviso: inteiro(process.env.TEMPO_AVISO_MIN, 5) * 60 * 1000,
    tempoEncerramento: inteiro(process.env.TEMPO_ENCERRAMENTO_MIN, 5) * 60 * 1000,
    cooldownMs: inteiro(process.env.COOLDOWN_SEGUNDOS, 5) * 1000,
    // Tempo máximo que alguém fica "preso" num estado especial sem falar nada.
    expiraOracaoMs: inteiro(process.env.EXPIRA_ORACAO_MIN, 30) * 60 * 1000,
    expiraHumanoMs: inteiro(process.env.EXPIRA_HUMANO_HORAS, 6) * 60 * 60 * 1000,
    intervaloPedidoMs: inteiro(process.env.INTERVALO_PEDIDO_SEGUNDOS, 30) * 1000,
    validadePedidoMs: inteiro(process.env.VALIDADE_PEDIDO_DIAS, 7) * 24 * 60 * 60 * 1000,

    // Telefones públicos da secretaria (os mesmos que já aparecem no menu)
    telefones: lista(process.env.TELEFONES_SECRETARIA).length
        ? lista(process.env.TELEFONES_SECRETARIA)
        : ['(21) 2253-7564', '(21) 97908-2767'],

    arquivoPedidos: path.join(__dirname, 'pedidos.json'),
    pastaAuth: path.join(__dirname, '.wwebjs_auth')
};

// Mesma regra de nomenclatura usada internamente pelo LocalAuth.
config.pastaSessao = path.join(
    config.pastaAuth,
    config.sessionId ? `session-${config.sessionId}` : 'session'
);

// Um id válido termina em @c.us (pessoa), @lid (pessoa, formato novo) ou @g.us (grupo).
const ID_VALIDO = /@(c\.us|lid|g\.us)$/;

function validar() {
    const erros = [];
    const avisos = [];

    if (config.numerosVerificacao.length === 0) {
        erros.push('NUMEROS_VERIFICACAO está vazio: os pedidos de oração não teriam para onde ir.');
    }
    if (config.gruposOracao.length === 0) {
        erros.push('GRUPOS_ORACAO está vazio: pedidos aprovados não seriam publicados em lugar nenhum.');
    }
    if (config.gruposNotificacaoHumano.length === 0) {
        avisos.push('GRUPOS_NOTIFICACAO_HUMANO está vazio: os avisos de atendimento humano vão para NUMEROS_VERIFICACAO.');
    }
    if (config.modoTeste && !config.numeroTeste) {
        erros.push('MODO_TESTE=true exige NUMERO_TESTE preenchido, senão o bot ignora todo mundo.');
    }
    // O LocalAuth lança exceção com clientId fora deste formato.
    if (config.sessionId && !/^[-_\w]+$/i.test(config.sessionId)) {
        erros.push(`SESSION_ID inválido ("${config.sessionId}"): use apenas letras, números, "-" e "_".`);
    }

    const campos = {
        GRUPOS_ORACAO: config.gruposOracao,
        GRUPOS_NOTIFICACAO_HUMANO: config.gruposNotificacaoHumano,
        NUMEROS_VERIFICACAO: config.numerosVerificacao,
        BLACKLIST: config.blacklist
    };
    for (const [nome, valores] of Object.entries(campos)) {
        for (const v of valores) {
            if (!ID_VALIDO.test(v)) {
                avisos.push(`${nome}: "${v}" não termina em @c.us, @lid ou @g.us — provavelmente não vai funcionar.`);
            }
        }
    }
    if (config.numeroTeste && !ID_VALIDO.test(config.numeroTeste)) {
        avisos.push(`NUMERO_TESTE: "${config.numeroTeste}" precisa do sufixo @c.us ou @lid.`);
    }

    return { erros, avisos };
}

module.exports = { config, validar };
