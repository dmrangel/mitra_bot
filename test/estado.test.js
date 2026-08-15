const test = require('node:test');
const assert = require('node:assert/strict');

const { config } = require('../config');
const estado = require('../lib/estado');

test('marcarEstado/estadoExpirado: recém-marcado não expirou, mas expira com limite negativo', () => {
    estado.marcarEstado('chatA');
    assert.equal(estado.estadoExpirado('chatA', 999999999), false);
    assert.equal(estado.estadoExpirado('chatA', -1), true);
});

test('estadoExpirado: quem nunca foi marcado é tratado como expirado', () => {
    assert.equal(estado.estadoExpirado('nunca-marcado', 999999999), true);
});

test('limparEstado remove de emPedidoOracao, emAtendimentoHumano e zera a marcação', () => {
    estado.emPedidoOracao.add('chatB');
    estado.emAtendimentoHumano.add('chatB');
    estado.marcarEstado('chatB');

    estado.limparEstado('chatB');

    assert.equal(estado.emPedidoOracao.has('chatB'), false);
    assert.equal(estado.emAtendimentoHumano.has('chatB'), false);
    assert.equal(estado.estadoExpirado('chatB', 999999999), true);
});

test('limparMapasAuxiliares remove ultimoPedido velho e mantém o recente', () => {
    const original = config.intervaloPedidoMs;
    config.intervaloPedidoMs = 100; // limiar de remoção = 1000ms

    estado.ultimoPedido.set('chatRecente', Date.now());
    estado.ultimoPedido.set('chatVelho', Date.now() - 999999);

    estado.limparMapasAuxiliares();

    assert.equal(estado.ultimoPedido.has('chatRecente'), true);
    assert.equal(estado.ultimoPedido.has('chatVelho'), false);

    config.intervaloPedidoMs = original;
});

test('limparMapasAuxiliares não apaga quem ainda está "preso" num estado especial', () => {
    const original = config.expiraHumanoMs;
    config.expiraHumanoMs = -5; // qualquer tempo decorrido já conta como expirado

    estado.emAtendimentoHumano.add('chatPreso');
    estado.marcarEstado('chatPreso');

    estado.limparMapasAuxiliares();

    // Preso == continua marcado mesmo com o prazo estourado, exatamente para
    // não perder o controle de quem está em atendimento humano.
    assert.equal(estado.estadoExpirado('chatPreso', 999999999), false);

    estado.emAtendimentoHumano.delete('chatPreso');
    config.expiraHumanoMs = original;
});

test('limparMapasAuxiliares apaga quem não está mais preso e já expirou', () => {
    const original = config.expiraHumanoMs;
    config.expiraHumanoMs = -5;

    estado.marcarEstado('chatLivre');
    estado.limparMapasAuxiliares();

    assert.equal(estado.estadoExpirado('chatLivre', 999999999), true);

    config.expiraHumanoMs = original;
});
