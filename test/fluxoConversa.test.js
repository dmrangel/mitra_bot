const test = require('node:test');
const assert = require('node:assert/strict');

const { config } = require('../config');
const { startupTime } = require('../lib/startup');
const { MENU_PRINCIPAL } = require('../lib/textos');

// Mocka o envio ANTES de requerer qualquer módulo que dependa dele (estado,
// timers, pedidos, fluxoConversa): o require cacheia o mesmo objeto, então a
// troca feita aqui é enxergada por todo mundo. Isso evita que os testes
// cheguem perto do whatsapp-web.js / Puppeteer de verdade.
const envio = require('../lib/envio');
const enviados = [];
envio.enviar = async (destino, texto) => { enviados.push({ destino, texto }); return true; };
envio.enviarParaTodos = async (destinos, texto) => {
    for (const destino of destinos) enviados.push({ destino, texto });
    return destinos.length;
};

const estado = require('../lib/estado');
const { limparTimers } = require('../lib/timers');
const pedidos = require('../lib/pedidos');
const { tratarMensagem } = require('../lib/fluxoConversa');

let contador = 0;
function novoChatId() {
    contador += 1;
    return `55219${contador}0000000@c.us`;
}

function criarMsg(overrides) {
    return {
        from: novoChatId(),
        author: undefined,
        fromMe: false,
        hasMedia: false,
        body: '',
        timestamp: startupTime + 10,
        reply: async () => {},
        getContact: async () => ({ pushname: 'Contato Teste', number: '5521000000000' }),
        ...overrides
    };
}

test.beforeEach(() => {
    enviados.length = 0;
    config.blacklist = [];
    config.modoTeste = false;
    config.numeroTeste = '';
    config.numerosVerificacao = ['5521999999999@c.us'];
    config.gruposOracao = ['grupo-oracao@g.us'];
    config.gruposNotificacaoHumano = ['grupo-humano@g.us'];
    config.cooldownMs = 50; // pequeno só pra não segurar o processo de teste
    config.expiraHumanoMs = 6 * 60 * 60 * 1000;
    config.expiraOracaoMs = 30 * 60 * 1000;
    config.intervaloPedidoMs = 30 * 1000;
});

// Roda sempre, mesmo se o teste falhar no meio: sem isso, um assert que
// estoura no meio do teste pula a limpeza manual e deixa timers reais de
// minutos (config.tempoAviso) pendurados, travando o processo de teste.
test.afterEach(() => {
    for (const chatId of estado.sessoesAtivas.keys()) limparTimers(chatId);
    estado.emAtendimentoHumano.clear();
    estado.emPedidoOracao.clear();
    estado.aguardandoRespostaAviso.clear();
    estado.pausaManual.clear();
    estado.cooldown.clear();
    estado.ultimoPedido.clear();
    pedidos.pedidosPendentes.clear();
});

test('"atendimento humano" cai na opção 8, não na 6 (regressão documentada)', async () => {
    const msg = criarMsg({ body: 'atendimento humano' });
    await tratarMensagem(msg);

    assert.equal(estado.emAtendimentoHumano.has(msg.from), true);
    const respostaCliente = enviados.find(e => e.destino === msg.from);
    assert.match(respostaCliente.texto, /atendido por um de nossos secretários/);
    const aviso = enviados.find(e => e.destino === 'grupo-humano@g.us');
    assert.ok(aviso, 'deveria notificar o grupo de atendimento humano');
});

test('pedido de oração escrito logo após escolher a opção 2 não é engolido pelo cooldown', async () => {
    const msg1 = criarMsg({ body: '2' });
    await tratarMensagem(msg1);
    assert.equal(estado.emPedidoOracao.has(msg1.from), true);

    const msg2 = criarMsg({ from: msg1.from, body: 'Por favor rezem pela minha mãe', timestamp: startupTime + 11 });
    await tratarMensagem(msg2);

    assert.equal(estado.emPedidoOracao.has(msg1.from), false);
    const confirmacao = enviados.find(e => e.destino === msg1.from && /recebido e encaminhado/.test(e.texto));
    assert.ok(confirmacao, 'deveria confirmar o recebimento do pedido');
    const notificacao = enviados.find(e => e.destino === '5521999999999@c.us' && /NOVO PEDIDO PARA AVALIAR/.test(e.texto));
    assert.ok(notificacao, 'deveria notificar quem verifica pedidos');
    const pendente = [...pedidos.pedidosPendentes.values()].find(p => p.de === msg1.from);
    assert.ok(pendente, 'o pedido deveria estar na fila de aprovação');
});

test('segundo pedido dentro do intervalo anti-flood não duplica o aviso à secretaria', async () => {
    const chatId = novoChatId();
    // Simula quem já está no modo pedido de oração e acabou de enviar um.
    estado.emPedidoOracao.add(chatId);
    estado.marcarEstado(chatId);
    estado.ultimoPedido.set(chatId, Date.now());

    const msg = criarMsg({ from: chatId, body: 'outro pedido rápido demais' });
    await tratarMensagem(msg);

    assert.equal(enviados.some(e => /NOVO PEDIDO PARA AVALIAR/.test(e.texto)), false);
    assert.ok(enviados.some(e => e.destino === chatId && /a caminho da nossa equipe/.test(e.texto)));
});

test('estado especial expirado (silêncio prolongado) libera o menu de novo', async () => {
    const chatId = novoChatId();
    estado.emAtendimentoHumano.add(chatId);
    config.expiraHumanoMs = -1; // qualquer tempo decorrido já expira
    estado.marcarEstado(chatId);

    const msg = criarMsg({ from: chatId, body: 'bom dia' });
    await tratarMensagem(msg);

    assert.equal(estado.emAtendimentoHumano.has(chatId), false);
    const resposta = enviados.find(e => e.destino === chatId);
    assert.equal(resposta.texto, MENU_PRINCIPAL);
});

test('"voltar" durante atendimento humano reativa o menu automático', async () => {
    const chatId = novoChatId();
    estado.emAtendimentoHumano.add(chatId);
    estado.marcarEstado(chatId);

    const msg = criarMsg({ from: chatId, body: 'voltar' });
    await tratarMensagem(msg);

    assert.equal(estado.emAtendimentoHumano.has(chatId), false);
    assert.ok(enviados.some(e => e.destino === chatId && /reativado/.test(e.texto)));
    assert.ok(enviados.some(e => e.destino === chatId && e.texto === MENU_PRINCIPAL));
});

test('mensagem com mídia pede texto em vez de tentar interpretar', async () => {
    const msg = criarMsg({ hasMedia: true, body: '' });
    await tratarMensagem(msg);

    const resposta = enviados.find(e => e.destino === msg.from);
    assert.match(resposta.texto, /Não conseguimos visualizar fotos/);
});

test('texto sem opção reconhecida recebe o menu principal', async () => {
    const msg = criarMsg({ body: 'aaaaaaaaaa' });
    await tratarMensagem(msg);

    const resposta = enviados.find(e => e.destino === msg.from);
    assert.equal(resposta.texto, MENU_PRINCIPAL);
});

test('blacklist, grupos, broadcast e modo teste são ignorados silenciosamente', async () => {
    const emBlacklist = criarMsg({ body: 'oi' });
    config.blacklist = [emBlacklist.from];
    await tratarMensagem(emBlacklist);
    assert.equal(enviados.length, 0);
    config.blacklist = [];

    const deGrupo = criarMsg({ from: 'algumgrupo@g.us', body: 'oi' });
    await tratarMensagem(deGrupo);
    assert.equal(enviados.length, 0);

    const statusBroadcast = criarMsg({ from: 'status@broadcast', body: 'oi' });
    await tratarMensagem(statusBroadcast);
    assert.equal(enviados.length, 0);

    const listaBroadcast = criarMsg({ from: '123@broadcast', body: 'oi' });
    await tratarMensagem(listaBroadcast);
    assert.equal(enviados.length, 0);

    config.modoTeste = true;
    config.numeroTeste = '5521000000001@c.us';
    const foraDoTeste = criarMsg({ body: 'oi' });
    await tratarMensagem(foraDoTeste);
    assert.equal(enviados.length, 0);
});

test('contato em pausa manual (!manual) não recebe respostas automáticas', async () => {
    const chatId = novoChatId();
    estado.pausaManual.add(chatId);

    const msg = criarMsg({ from: chatId, body: 'oi' });
    await tratarMensagem(msg);

    assert.equal(enviados.length, 0);
});

test('comando !idgrupo do próprio aparelho responde com o id da conversa', async () => {
    const respostas = [];
    const msg = criarMsg({ fromMe: true, body: '!idgrupo', reply: async (texto) => respostas.push(texto) });
    await tratarMensagem(msg);
    assert.deepEqual(respostas, [msg.from]);
});

test('mensagem anterior ao boot do processo é ignorada', async () => {
    const msg = criarMsg({ body: '1', timestamp: startupTime - 100 });
    await tratarMensagem(msg);
    assert.equal(enviados.length, 0);
});
