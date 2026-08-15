const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const { config, validar } = require('./config');
const menuOptions = require('./menu');

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

function log(...args) {
    console.log(`[${new Date().toISOString()}]`, ...args);
}

function erro(contexto, e) {
    console.error(`[${new Date().toISOString()}] ERRO em ${contexto}:`, e && e.message ? e.message : e);
}

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

// ---------------------------------------------------------------------------
// Limpeza antes de subir o navegador
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

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

const client = new Client(clientOpts);

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

const emAtendimentoHumano = new Set();
const pausaManual = new Set();
const emPedidoOracao = new Set();
const aguardandoRespostaAviso = new Set();
const cooldown = new Set();
const sessoesAtivas = new Map();
const ultimoPedido = new Map();

// Momento em que o contato entrou num estado especial (oração / atendimento
// humano). Sem isto, quem entrava na opção 2 ou 8 e sumia ficava preso nesse
// estado para sempre: ao voltar dias depois, um "bom dia" virava pedido de
// oração e o menu nunca mais aparecia.
const estadoDesde = new Map();

function marcarEstado(chatId) {
    estadoDesde.set(chatId, Date.now());
}

function estadoExpirado(chatId, limiteMs) {
    const inicio = estadoDesde.get(chatId);
    return !inicio || (Date.now() - inicio) > limiteMs;
}

function limparEstado(chatId) {
    estadoDesde.delete(chatId);
    emPedidoOracao.delete(chatId);
    emAtendimentoHumano.delete(chatId);
}

/** @type {Map<string, {nome: string, texto: string, de: string, criadoEm: number}>} */
const pedidosPendentes = new Map();

const startupTime = Math.floor(Date.now() / 1000);

const MENU_PRINCIPAL = `Olá! O Santuário de Santa Rita agradece seu contato 🌹🙏🏻\n\nNão atendemos ligações neste número. Digite a opção desejada:\n\n1 - Missas e Confissões\n2 - Pedidos de Oração\n3 - Batismo e Certidões\n4 - Casamentos\n5 - Doações e PIX\n6 - Secretaria e Localização\n7 - Comunidade e Redes Sociais\n8 - Atendimento Humano`;

const AVISO_LIGACAO = `⚠️ *AVISO SOBRE LIGAÇÕES*\n\nEste número de WhatsApp não recebe chamadas. Para falar conosco por telefone, ligue para:\n\n${config.telefones.map(t => `📞 ${t}`).join('\n')}`;

// ---------------------------------------------------------------------------
// Persistência dos pedidos de oração
//
// Antes ficavam só em memória: qualquer reinício (inclusive o process.exit(1)
// automático em caso de desconexão) apagava tudo que estava esperando aprovação.
// ---------------------------------------------------------------------------

function carregarPedidos() {
    try {
        if (!fs.existsSync(config.arquivoPedidos)) return;
        const dados = JSON.parse(fs.readFileSync(config.arquivoPedidos, 'utf8'));
        const agora = Date.now();
        let expirados = 0;
        for (const [id, p] of Object.entries(dados)) {
            if (!p || typeof p.texto !== 'string') continue;
            if (agora - (p.criadoEm || 0) > config.validadePedidoMs) {
                expirados++;
                continue;
            }
            pedidosPendentes.set(id, p);
        }
        log(`Pedidos pendentes recuperados: ${pedidosPendentes.size}${expirados ? ` (${expirados} expirados descartados)` : ''}.`);
    } catch (e) {
        erro('carregar pedidos.json', e);
    }
}

function salvarPedidos() {
    try {
        const obj = Object.fromEntries(pedidosPendentes);
        fs.writeFileSync(config.arquivoPedidos, JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) {
        erro('salvar pedidos.json', e);
    }
}

function limparPedidosExpirados() {
    const agora = Date.now();
    let removidos = 0;
    for (const [id, p] of pedidosPendentes) {
        if (agora - (p.criadoEm || 0) > config.validadePedidoMs) {
            pedidosPendentes.delete(id);
            removidos++;
        }
    }
    if (removidos > 0) {
        log(`${removidos} pedido(s) expirado(s) removido(s).`);
        salvarPedidos();
    }
}

// Evita que os mapas auxiliares cresçam indefinidamente num bot que fica
// meses no ar.
function limparMapasAuxiliares() {
    const agora = Date.now();
    for (const [chatId, quando] of ultimoPedido) {
        if (agora - quando > config.intervaloPedidoMs * 10) ultimoPedido.delete(chatId);
    }
    for (const [chatId, quando] of estadoDesde) {
        const preso = emPedidoOracao.has(chatId) || emAtendimentoHumano.has(chatId);
        if (!preso && agora - quando > config.expiraHumanoMs) estadoDesde.delete(chatId);
    }
}

carregarPedidos();
setInterval(() => {
    limparPedidosExpirados();
    limparMapasAuxiliares();
}, 60 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Envio seguro (um destino que falha não derruba o resto)
// ---------------------------------------------------------------------------

async function enviar(destino, texto) {
    try {
        await client.sendMessage(destino, texto);
        return true;
    } catch (e) {
        erro(`enviar mensagem para ${destino}`, e);
        return false;
    }
}

async function enviarParaTodos(destinos, texto) {
    let enviados = 0;
    for (const destino of destinos) {
        if (await enviar(destino, texto)) enviados++;
    }
    return enviados;
}

// ---------------------------------------------------------------------------
// Reconhecimento do menu
//
// Antes era um único find(): a primeira opção da lista que batesse em qualquer
// palavra-chave vencia. Como "atendimento" está na opção 6 (Secretaria) e
// também na 8 (Atendimento Humano), quem escrevia "atendimento humano" recebia
// o endereço da secretaria em vez de ser transferido.
//
// Agora: id exato primeiro; depois pontuação, onde palavra inteira vale mais
// que trecho solto e mais palavras batendo vence menos palavras.
// ---------------------------------------------------------------------------

// Marcas de acentuacao combinantes (U+0300-U+036F), em ASCII puro para
// nao depender da codificacao do arquivo.
const ACENTOS = new RegExp('[\u0300-\u036f]', 'g');

function normalizar(valor) {
    return String(valor || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(ACENTOS, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function escaparRegex(valor) {
    return valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const OPCOES = menuOptions.map(opt => ({
    opcao: opt,
    id: normalizar(opt.id),
    termos: (opt.keywords || []).map(kw => {
        const alvo = normalizar(kw);
        return { alvo, regex: new RegExp(`(^|[^a-z0-9])${escaparRegex(alvo)}([^a-z0-9]|$)`) };
    })
}));

function encontrarOpcao(texto) {
    if (!texto) return null;

    const exata = OPCOES.find(o => o.id === texto);
    if (exata) return exata.opcao;

    let melhor = null;
    for (const entrada of OPCOES) {
        let palavras = 0, maiorPalavra = 0, trechos = 0, maiorTrecho = 0;
        for (const termo of entrada.termos) {
            if (termo.regex.test(texto)) {
                palavras++;
                maiorPalavra = Math.max(maiorPalavra, termo.alvo.length);
            } else if (texto.includes(termo.alvo)) {
                trechos++;
                maiorTrecho = Math.max(maiorTrecho, termo.alvo.length);
            }
        }
        if (palavras === 0 && trechos === 0) continue;

        const nota = [palavras, maiorPalavra, trechos, maiorTrecho];
        if (!melhor || compararNotas(nota, melhor.nota) > 0) {
            melhor = { opcao: entrada.opcao, nota };
        }
    }
    return melhor ? melhor.opcao : null;
}

/** Compara duas notas na ordem dos critérios. > 0 se `a` é melhor que `b`. */
function compararNotas(a, b) {
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
}

// ---------------------------------------------------------------------------
// Timers de inatividade
// ---------------------------------------------------------------------------

function limparTimers(chatId) {
    aguardandoRespostaAviso.delete(chatId);
    const sessao = sessoesAtivas.get(chatId);
    if (sessao) {
        clearTimeout(sessao.avisoTimeout);
        clearTimeout(sessao.encerramentoTimeout);
        sessoesAtivas.delete(chatId);
    }
}

async function encerrarAtendimento(chatId) {
    await enviar(chatId, 'Agradecemos o contato. Que pela intercessão de Santa Rita, Deus abençoe a você e sua família.');
    limparTimers(chatId);
    limparEstado(chatId);
}

function iniciarTimers(chatId) {
    limparTimers(chatId);

    const sessao = { avisoTimeout: null, encerramentoTimeout: null };
    sessoesAtivas.set(chatId, sessao);

    sessao.avisoTimeout = setTimeout(async () => {
        await enviar(chatId, 'Podemos ajudar com algo mais?');

        // Entre o disparo do timer e o fim do envio a conversa pode ter
        // recomeçado. Sem esta checagem, o encerramento antigo fechava uma
        // conversa nova 5 minutos depois.
        if (sessoesAtivas.get(chatId) !== sessao) return;

        aguardandoRespostaAviso.add(chatId);
        sessao.encerramentoTimeout = setTimeout(() => {
            encerrarAtendimento(chatId).catch(e => erro('encerrarAtendimento', e));
        }, config.tempoEncerramento);
    }, config.tempoAviso);
}

// ---------------------------------------------------------------------------
// Pedidos de oração
// ---------------------------------------------------------------------------

function listarPedidos() {
    if (pedidosPendentes.size === 0) return 'Nenhum pedido pendente no momento.';

    let lista = '*📋 PEDIDOS AGUARDANDO APROVAÇÃO*\n\n';
    for (const [id, p] of pedidosPendentes) {
        const resumo = p.texto.length > 40 ? `${p.texto.substring(0, 40)}...` : p.texto;
        lista += `- ID: ${id}\n- De: ${p.nome}\n- Pedido: ${resumo}\n\n`;
    }
    return lista;
}

async function aprovarPedido(idPedido, chatOrigem) {
    const id = String(idPedido || '').trim().toUpperCase();
    if (!id) {
        await enviar(chatOrigem, 'Use: !aprovar <ID>. Envie !pedidos para ver os IDs pendentes.');
        return;
    }
    if (!pedidosPendentes.has(id)) {
        await enviar(chatOrigem, '❌ Pedido não encontrado ou já aprovado.');
        return;
    }

    const p = pedidosPendentes.get(id);
    const texto = `*🙏 NOVO PEDIDO DE ORAÇÃO*\n\n*De:* ${p.nome}\n\n*Pedido:*\n${p.texto}`;
    const enviados = await enviarParaTodos(config.gruposOracao, texto);

    if (enviados === 0) {
        // Mantém o pedido na fila para poder tentar de novo.
        await enviar(chatOrigem, '⚠️ Não consegui publicar no grupo de oração. O pedido continua pendente — tente de novo em instantes.');
        return;
    }

    pedidosPendentes.delete(id);
    salvarPedidos();
    await enviar(chatOrigem, '✅ Pedido aprovado e encaminhado.');
    log(`Pedido ${id} aprovado e publicado em ${enviados} grupo(s).`);
}

// ---------------------------------------------------------------------------
// Permissões
// ---------------------------------------------------------------------------

const CMD_APROVAR = /^!aprovar(\s|$)/i;

function ehAdmin(msg) {
    if (msg.fromMe) return true;
    // Em grupo, msg.from é o id do grupo e msg.author é quem escreveu.
    return config.numerosVerificacao.includes(msg.from) ||
        (msg.author && config.numerosVerificacao.includes(msg.author));
}

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
        // Sem isto, um !aprovar antigo é reexecutado a cada reinício.
        if (msg.timestamp < startupTime) return;

        const comando = String(msg.body || '').trim();
        const destino = msg.to;

        if (comando === '!manual') {
            pausaManual.add(destino);
            limparEstado(destino);
            limparTimers(destino);
            return;
        }
        if (comando === '!auto') {
            pausaManual.delete(destino);
            limparEstado(destino);
            iniciarTimers(destino);
            return;
        }
        if (comando === '!pedidos') {
            await enviar(destino, listarPedidos());
            return;
        }
        if (CMD_APROVAR.test(comando)) {
            // Antes faltava o toUpperCase() aqui (só existia no outro caminho),
            // então aprovar pelo próprio aparelho nunca achava o pedido.
            await aprovarPedido(comando.split(/\s+/)[1], destino);
            return;
        }
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

async function tratarMensagem(msg) {
    // Ignora tudo que é anterior ao boot. Isto precisa vir antes dos comandos:
    // do jeito antigo, um !aprovar velho era reexecutado a cada reinício.
    if (msg.timestamp < startupTime) return;

    const corpo = String(msg.body || '').trim();

    // --- Comandos administrativos ---------------------------------------
    if (ehAdmin(msg)) {
        if (corpo === '!idgrupo') {
            await msg.reply(msg.from);
            return;
        }
        if (corpo === '!pedidos') {
            await msg.reply(listarPedidos());
            return;
        }
        if (CMD_APROVAR.test(corpo)) {
            await aprovarPedido(corpo.split(/\s+/)[1], msg.from);
            return;
        }
    }

    // --- Filtros ---------------------------------------------------------
    if (config.blacklist.includes(msg.from)) return;
    if (msg.from.endsWith('@g.us') || msg.from.endsWith('@newsletter') || msg.from === 'status@broadcast') return;
    if (msg.from.endsWith('@broadcast')) return;
    if (config.modoTeste && msg.from !== config.numeroTeste) return;
    if (pausaManual.has(msg.from)) return;

    const texto = normalizar(corpo);

    // --- "Podemos ajudar com algo mais?" ---------------------------------
    if (aguardandoRespostaAviso.has(msg.from)) {
        aguardandoRespostaAviso.delete(msg.from);
        const negativas = ['nao', 'nada', 'obrigado', 'obrigada', 'so isso', 'encerrar'];
        if (negativas.some(kw => texto === kw || texto.includes(kw))) {
            await encerrarAtendimento(msg.from);
            return;
        }
    }

    // --- Atendimento humano ----------------------------------------------
    if (emAtendimentoHumano.has(msg.from)) {
        if (estadoExpirado(msg.from, config.expiraHumanoMs)) {
            limparEstado(msg.from); // segue para o menu normal
        } else {
            if (texto === 'voltar') {
                limparEstado(msg.from);
                await enviar(msg.from, 'Atendimento automático reativado.');
                await enviar(msg.from, MENU_PRINCIPAL);
                iniciarTimers(msg.from);
            }
            return;
        }
    }

    // --- Pedido de oração -------------------------------------------------
    // Este bloco fica antes do cooldown de propósito: o cooldown era aplicado
    // ao escolher a opção 2 e engolia silenciosamente o pedido escrito logo em
    // seguida, dentro dos 5 segundos.
    if (emPedidoOracao.has(msg.from)) {
        if (estadoExpirado(msg.from, config.expiraOracaoMs)) {
            limparEstado(msg.from); // segue para o menu normal
        } else {
            await receberPedidoOracao(msg, corpo, texto);
            return;
        }
    }

    // --- Cooldown do menu -------------------------------------------------
    if (cooldown.has(msg.from)) return;
    cooldown.add(msg.from);
    setTimeout(() => cooldown.delete(msg.from), config.cooldownMs);

    limparTimers(msg.from);

    if (msg.hasMedia) {
        await enviar(msg.from, 'Olá! Este é um atendimento automático. Não conseguimos visualizar fotos, vídeos ou áudios por aqui.\n\nPor favor, envie apenas mensagens de texto.');
        iniciarTimers(msg.from);
        return;
    }

    const opcao = encontrarOpcao(texto);

    if (!opcao) {
        await enviar(msg.from, MENU_PRINCIPAL);
        iniciarTimers(msg.from);
        return;
    }

    await enviar(msg.from, opcao.reply);

    if (opcao.action === 'pause') {
        emAtendimentoHumano.add(msg.from);
        marcarEstado(msg.from);
        limparTimers(msg.from);
        await notificarAtendimentoHumano(msg);
        return;
    }

    if (opcao.action === 'oracao') {
        emPedidoOracao.add(msg.from);
        marcarEstado(msg.from);
        limparTimers(msg.from);
        return;
    }

    iniciarTimers(msg.from);
}

async function dadosDoContato(msg) {
    let nome = msg.from.split('@')[0];
    let numero = '';
    try {
        const contato = await msg.getContact();
        nome = contato.pushname || contato.name || nome;
        numero = contato.number || '';
    } catch (e) {
        erro('obter contato', e);
    }
    // Contatos no formato @lid não expõem número; nesse caso não há link wa.me.
    const link = /^\d{8,15}$/.test(numero) ? `https://wa.me/${numero}` : '(número não disponível)';
    return { nome, link };
}

async function receberPedidoOracao(msg, corpo, texto) {
    if (texto === 'voltar') {
        limparEstado(msg.from);
        await enviar(msg.from, 'Atendimento automático reativado.');
        await enviar(msg.from, MENU_PRINCIPAL);
        iniciarTimers(msg.from);
        return;
    }

    if (msg.hasMedia || !corpo) {
        await enviar(msg.from, 'Por favor, escreva seu pedido em texto para que possamos encaminhá-lo. 🙏\n\nPara voltar ao menu, digite: *voltar*');
        return;
    }

    // Anti-flood: evita que uma pessoa dispare dezenas de avisos à secretaria.
    const ultimo = ultimoPedido.get(msg.from) || 0;
    if (Date.now() - ultimo < config.intervaloPedidoMs) {
        await enviar(msg.from, 'Já recebemos seu pedido e ele está a caminho da nossa equipe. 🙏\n\nPara voltar ao menu, digite: *voltar*');
        return;
    }
    ultimoPedido.set(msg.from, Date.now());

    const { nome, link } = await dadosDoContato(msg);
    const idPedido = gerarIdPedido();

    pedidosPendentes.set(idPedido, {
        nome,
        texto: corpo,
        de: msg.from,
        criadoEm: Date.now()
    });
    salvarPedidos();

    const avisoOracao = `*📥 NOVO PEDIDO PARA AVALIAR*\n\n*De:* ${nome}\n*WhatsApp:* ${link}\n\n*Pedido:*\n${corpo}\n\n*Para aprovar, envie:*\n!aprovar ${idPedido}`;
    const enviados = await enviarParaTodos(config.numerosVerificacao, avisoOracao);
    if (enviados === 0) {
        erro('pedido de oração', `nenhum número de verificação recebeu o aviso do pedido ${idPedido}`);
    }

    await enviar(msg.from, 'Seu pedido foi recebido e encaminhado para intercessão. 🙏');

    limparEstado(msg.from);
    await enviar(msg.from, MENU_PRINCIPAL);
    iniciarTimers(msg.from);
}

function gerarIdPedido() {
    let id;
    do {
        id = (Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')).toUpperCase();
    } while (pedidosPendentes.has(id));
    return id;
}

async function notificarAtendimentoHumano(msg) {
    const { nome, link } = await dadosDoContato(msg);
    const aviso = `*⚠️ SOLICITAÇÃO DE ATENDIMENTO*\n\n*Nome:* ${nome}\n*WhatsApp:* ${link}\n\nO usuário aguarda contato humano.`;

    const destinos = config.gruposNotificacaoHumano.length
        ? config.gruposNotificacaoHumano
        : config.numerosVerificacao;

    const enviados = await enviarParaTodos(destinos, aviso);
    if (enviados === 0) {
        erro('atendimento humano', `ninguém foi avisado sobre a solicitação de ${nome}`);
    }
}

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
