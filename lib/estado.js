const { config } = require('../config');

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

module.exports = {
    emAtendimentoHumano,
    pausaManual,
    emPedidoOracao,
    aguardandoRespostaAviso,
    cooldown,
    sessoesAtivas,
    ultimoPedido,
    marcarEstado,
    estadoExpirado,
    limparEstado,
    limparMapasAuxiliares
};
