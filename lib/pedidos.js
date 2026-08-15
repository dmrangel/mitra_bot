const fs = require('fs');

const { config } = require('../config');
const { log, erro } = require('./log');
const { enviar, enviarParaTodos } = require('./envio');

/** @type {Map<string, {nome: string, texto: string, de: string, criadoEm: number}>} */
const pedidosPendentes = new Map();

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

function gerarIdPedido() {
    let id;
    do {
        id = (Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')).toUpperCase();
    } while (pedidosPendentes.has(id));
    return id;
}

module.exports = {
    pedidosPendentes,
    carregarPedidos,
    salvarPedidos,
    limparPedidosExpirados,
    listarPedidos,
    aprovarPedido,
    gerarIdPedido
};
