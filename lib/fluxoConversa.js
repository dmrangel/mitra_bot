const { config } = require('../config');
const { erro } = require('./log');
const { startupTime } = require('./startup');
const { MENU_PRINCIPAL } = require('./textos');
const { enviar, enviarParaTodos } = require('./envio');
const {
    emAtendimentoHumano,
    pausaManual,
    emPedidoOracao,
    aguardandoRespostaAviso,
    cooldown,
    ultimoPedido,
    marcarEstado,
    estadoExpirado,
    limparEstado
} = require('./estado');
const { limparTimers, iniciarTimers, encerrarAtendimento } = require('./timers');
const { normalizar, encontrarOpcao } = require('./menuMatcher');
const { ehAdmin, CMD_APROVAR } = require('./permissoes');
const { dadosDoContato } = require('./contato');
const { pedidosPendentes, listarPedidos, aprovarPedido, gerarIdPedido, salvarPedidos } = require('./pedidos');

// Comandos enviados pelo próprio aparelho do Santuário (client.on('message_create')).
async function tratarComandoDoAparelho(msg) {
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
}

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

module.exports = { tratarMensagem, tratarComandoDoAparelho };
