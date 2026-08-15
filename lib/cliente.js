const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { Client, LocalAuth } = require('whatsapp-web.js');

const { config } = require('../config');
const { log, erro } = require('./log');

// ---------------------------------------------------------------------------
// Limpeza antes de subir o navegador
// ---------------------------------------------------------------------------

function limparAntesDeSubir() {
    // Só mata o Chrome quando explicitamente autorizado (LIMPAR_CHROME=true).
    // No PC de alguém isso fecharia todas as abas abertas do usuário.
    if (config.limparChrome) {
        try {
            if (process.platform === 'win32') {
                execSync('taskkill /F /IM chrome.exe /T', { stdio: 'ignore' });
            } else {
                execSync('pkill -9 -f chromium', { stdio: 'ignore' });
            }
            log('Processos do Chrome/Chromium encerrados (LIMPAR_CHROME=true).');
        } catch (e) {
            // Nenhum processo rodando: normal.
        }
    }

    // Remove locks deixados por um encerramento sujo. O caminho agora é derivado
    // da mesma regra que o LocalAuth usa — antes estava fixo em
    // "session-santuario", pasta que nunca existiu: sem clientId o LocalAuth grava
    // em ".wwebjs_auth/session". Ou seja, o lock nunca era removido de verdade.
    for (const nome of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
        const arquivo = path.join(config.pastaSessao, nome);
        try {
            if (fs.existsSync(arquivo)) {
                fs.unlinkSync(arquivo);
                log(`Lock removido: ${nome}`);
            }
        } catch (e) {
            erro(`remover ${nome}`, e);
        }
    }
}

// ---------------------------------------------------------------------------
// Cliente
//
// Construído sob demanda (não ao dar require neste módulo): assim, requerer
// este arquivo — direto ou por lib/envio.js — nunca mata processos do Chrome
// nem mexe em locks de sessão como efeito colateral. Isso é o que permite os
// testes automatizados (test/) importarem o resto do código com segurança.
// ---------------------------------------------------------------------------

let client = null;

function obterCliente() {
    if (client) return client;

    limparAntesDeSubir();

    const puppeteerOpts = {
        headless: true,
        timeout: 120000,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-software-rasterizer',
            '--mute-audio',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
        ]
    };

    // Só define o executável se CHROME_PATH foi configurado. Antes estava fixo em
    // /usr/bin/chromium-browser, o que quebrava em qualquer máquina Windows.
    if (config.chromePath) {
        if (!fs.existsSync(config.chromePath)) {
            console.error(`ERRO: CHROME_PATH aponta para "${config.chromePath}", que não existe.`);
            console.error('Corrija o caminho no .env ou deixe a variável vazia para usar o Chromium do puppeteer.');
            process.exit(1);
        }
        puppeteerOpts.executablePath = config.chromePath;
    }

    // Sem SESSION_ID, não passa clientId: mantém a pasta de sessão que já existe
    // no servidor. Passar clientId criaria outra pasta e pediria QR Code de novo.
    const authOpts = { dataPath: config.pastaAuth };
    if (config.sessionId) authOpts.clientId = config.sessionId;

    const clientOpts = {
        authStrategy: new LocalAuth(authOpts),
        puppeteer: puppeteerOpts,
        takeoverOnConflict: true,
        authTimeoutMs: 120000
    };

    // Fixar uma versão antiga do WhatsApp Web quebra a conexão quando o WhatsApp
    // muda o protocolo. Só fixa se WEB_VERSION estiver preenchido no .env.
    if (config.webVersion) {
        clientOpts.webVersionCache = {
            type: 'remote',
            remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${config.webVersion}.html`
        };
        log(`Fixando WhatsApp Web na versão ${config.webVersion}.`);
    }

    client = new Client(clientOpts);
    return client;
}

module.exports = { obterCliente };
