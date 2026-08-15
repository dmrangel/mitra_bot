const test = require('node:test');
const assert = require('node:assert/strict');

const { dadosDoContato } = require('../lib/contato');

test('usa o pushname e monta o link wa.me quando o número está disponível', async () => {
    const msg = { from: '5521999999999@c.us', getContact: async () => ({ pushname: 'Maria', number: '5521999999999' }) };
    const { nome, link } = await dadosDoContato(msg);
    assert.equal(nome, 'Maria');
    assert.equal(link, 'https://wa.me/5521999999999');
});

test('cai para o nome salvo do contato quando não há pushname', async () => {
    const msg = { from: '5521999999999@c.us', getContact: async () => ({ name: 'João' }) };
    const { nome } = await dadosDoContato(msg);
    assert.equal(nome, 'João');
});

test('contatos @lid sem número não geram link wa.me', async () => {
    const msg = { from: '128277788291105@lid', getContact: async () => ({ pushname: 'Ana' }) };
    const { link } = await dadosDoContato(msg);
    assert.equal(link, '(número não disponível)');
});

test('se getContact() falhar, cai para o id como nome e sem link', async () => {
    const msg = { from: '5521999999999', getContact: async () => { throw new Error('falhou'); } };
    const { nome, link } = await dadosDoContato(msg);
    assert.equal(nome, '5521999999999');
    assert.equal(link, '(número não disponível)');
});
