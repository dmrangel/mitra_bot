const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { config } = require('../config');

// Redireciona a persistência para um arquivo temporário antes de qualquer
// outro módulo ler config.arquivoPedidos, pra nunca tocar no pedidos.json real.
const arquivoTemporario = path.join(os.tmpdir(), `mitra-bot-teste-pedidos-${process.pid}.json`);
config.arquivoPedidos = arquivoTemporario;

// Mocka o envio ANTES de requerer pedidos.js: como os dois módulos
// destructuram `require('./envio')` na primeira vez que são carregados, e o
// require cacheia sempre o mesmo objeto, essa troca é enxergada por pedidos.js.
const envio = require('../lib/envio');
const enviados = [];
envio.enviar = async (destino, texto) => { enviados.push({ destino, texto }); return true; };
envio.enviarParaTodos = async (destinos, texto) => {
    for (const destino of destinos) enviados.push({ destino, texto });
    return destinos.length;
};

const pedidos = require('../lib/pedidos');

test.beforeEach(() => {
    pedidos.pedidosPendentes.clear();
    enviados.length = 0;
    if (fs.existsSync(arquivoTemporario)) fs.unlinkSync(arquivoTemporario);
});

test.after(() => {
    if (fs.existsSync(arquivoTemporario)) fs.unlinkSync(arquivoTemporario);
});

test('listarPedidos informa quando não há pendentes', () => {
    assert.equal(pedidos.listarPedidos(), 'Nenhum pedido pendente no momento.');
});

test('listarPedidos lista e trunca pedidos longos', () => {
    pedidos.pedidosPendentes.set('ID1', { nome: 'Maria', texto: 'x'.repeat(60), de: 'a@c.us', criadoEm: Date.now() });
    const lista = pedidos.listarPedidos();
    assert.match(lista, /ID: ID1/);
    assert.match(lista, /De: Maria/);
    assert.match(lista, /x{40}\.\.\./);
});

test('gerarIdPedido nunca repete um id já em uso', () => {
    const usados = new Set();
    for (let i = 0; i < 50; i++) {
        const id = pedidos.gerarIdPedido();
        assert.equal(usados.has(id), false);
        usados.add(id);
        pedidos.pedidosPendentes.set(id, { nome: 'x', texto: 'x', de: 'x', criadoEm: Date.now() });
    }
});

test('salvarPedidos/carregarPedidos fazem round-trip no disco', () => {
    pedidos.pedidosPendentes.set('ID2', { nome: 'João', texto: 'Por minha saúde', de: 'b@c.us', criadoEm: Date.now() });
    pedidos.salvarPedidos();

    pedidos.pedidosPendentes.clear();
    pedidos.carregarPedidos();

    assert.equal(pedidos.pedidosPendentes.get('ID2').nome, 'João');
});

test('carregarPedidos descarta pedidos expirados e ignora entradas corrompidas', () => {
    const agora = Date.now();
    fs.writeFileSync(arquivoTemporario, JSON.stringify({
        VELHO: { nome: 'X', texto: 'expirado', de: 'c@c.us', criadoEm: agora - config.validadePedidoMs - 1000 },
        VALIDO: { nome: 'Y', texto: 'valido', de: 'd@c.us', criadoEm: agora },
        RUIM: { semTexto: true }
    }), 'utf8');

    pedidos.carregarPedidos();

    assert.equal(pedidos.pedidosPendentes.has('VELHO'), false);
    assert.equal(pedidos.pedidosPendentes.has('VALIDO'), true);
    assert.equal(pedidos.pedidosPendentes.has('RUIM'), false);
});

test('limparPedidosExpirados remove só o que passou da validade', () => {
    const agora = Date.now();
    pedidos.pedidosPendentes.set('NOVO', { nome: 'A', texto: 't', de: 'x', criadoEm: agora });
    pedidos.pedidosPendentes.set('EXPIRADO', { nome: 'B', texto: 't', de: 'x', criadoEm: agora - config.validadePedidoMs - 1000 });

    pedidos.limparPedidosExpirados();

    assert.equal(pedidos.pedidosPendentes.has('NOVO'), true);
    assert.equal(pedidos.pedidosPendentes.has('EXPIRADO'), false);
});

test('aprovarPedido sem id pede o uso correto do comando', async () => {
    await pedidos.aprovarPedido('', 'admin@c.us');
    assert.equal(enviados.length, 1);
    assert.match(enviados[0].texto, /Use: !aprovar/);
});

test('aprovarPedido com id inexistente avisa e não publica nada', async () => {
    await pedidos.aprovarPedido('NAOEXISTE', 'admin@c.us');
    assert.equal(enviados.length, 1);
    assert.match(enviados[0].texto, /não encontrado/);
});

test('aprovarPedido publica nos grupos de oração e remove da fila', async () => {
    config.gruposOracao = ['grupo1@g.us', 'grupo2@g.us'];
    pedidos.pedidosPendentes.set('OK1', { nome: 'Ana', texto: 'Por cura', de: 'e@c.us', criadoEm: Date.now() });

    await pedidos.aprovarPedido('ok1', 'admin@c.us');

    assert.equal(pedidos.pedidosPendentes.has('OK1'), false);
    const publicados = enviados.filter(e => e.destino.endsWith('@g.us'));
    assert.equal(publicados.length, 2);
    const confirmacao = enviados.find(e => e.destino === 'admin@c.us');
    assert.match(confirmacao.texto, /aprovado e encaminhado/);
});

test('aprovarPedido mantém o pedido pendente se não conseguir publicar em nenhum grupo', async () => {
    config.gruposOracao = [];
    pedidos.pedidosPendentes.set('OK2', { nome: 'Ana', texto: 'Por cura', de: 'e@c.us', criadoEm: Date.now() });

    await pedidos.aprovarPedido('OK2', 'admin@c.us');

    assert.equal(pedidos.pedidosPendentes.has('OK2'), true);
});
