const test = require('node:test');
const assert = require('node:assert/strict');

const { config } = require('../config');
const { ehAdmin, CMD_APROVAR } = require('../lib/permissoes');

test('ehAdmin: mensagem enviada pelo próprio aparelho é sempre admin', () => {
    assert.equal(ehAdmin({ fromMe: true, from: 'qualquer@c.us' }), true);
});

test('ehAdmin: número verificado falando em DM é admin', () => {
    config.numerosVerificacao = ['5521999999999@c.us'];
    assert.equal(ehAdmin({ fromMe: false, from: '5521999999999@c.us' }), true);
});

test('ehAdmin: autor verificado dentro de um grupo é admin', () => {
    config.numerosVerificacao = ['5521999999999@c.us'];
    assert.equal(ehAdmin({ fromMe: false, from: 'grupo@g.us', author: '5521999999999@c.us' }), true);
});

test('ehAdmin: contato comum não é admin', () => {
    config.numerosVerificacao = ['5521999999999@c.us'];
    // ehAdmin só é usado em "if (ehAdmin(msg))": o contrato é truthy/falsy,
    // não booleano estrito (pode devolver undefined quando não há author).
    assert.ok(!ehAdmin({ fromMe: false, from: '5521888888888@c.us' }));
    assert.ok(!ehAdmin({ fromMe: false, from: 'grupo@g.us', author: '5521888888888@c.us' }));
});

test('CMD_APROVAR reconhece o comando com e sem argumento, e não confunde com outros comandos', () => {
    assert.equal(CMD_APROVAR.test('!aprovar'), true);
    assert.equal(CMD_APROVAR.test('!aprovar ABC123'), true);
    assert.equal(CMD_APROVAR.test('!APROVAR abc123'), true);
    assert.equal(CMD_APROVAR.test('!aprovartudo'), false);
    assert.equal(CMD_APROVAR.test('aprovar ABC'), false);
});
