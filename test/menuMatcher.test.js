const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizar, encontrarOpcao } = require('../lib/menuMatcher');

test('normalizar remove acentos, baixa a caixa e colapsa espaços', () => {
    assert.equal(normalizar('  Missa   Amanhã '), 'missa amanha');
    assert.equal(normalizar(undefined), '');
    assert.equal(normalizar(null), '');
});

test('encontrarOpcao reconhece o id exato do menu', () => {
    assert.equal(encontrarOpcao(normalizar('1')).id, '1');
    assert.equal(encontrarOpcao(normalizar('8')).id, '8');
});

test('encontrarOpcao reconhece palavra-chave dentro de uma frase', () => {
    assert.equal(encontrarOpcao(normalizar('quero saber o horario da missa')).id, '1');
    assert.equal(encontrarOpcao(normalizar('quero fazer uma doação via pix')).id, '5');
});

test('"atendimento humano" cai na opção 8, não na 6 (regressão documentada)', () => {
    // "atendimento" é palavra-chave tanto da opção 6 (Secretaria) quanto da 8
    // (Atendimento Humano). Um find() ingênuo sempre escolhia a 6 primeiro.
    assert.equal(encontrarOpcao(normalizar('atendimento humano')).id, '8');
    assert.equal(encontrarOpcao(normalizar('quero atendimento humano por favor')).id, '8');
});

test('uma palavra ambígua sozinha cai na primeira opção que a contém', () => {
    assert.equal(encontrarOpcao(normalizar('atendimento')).id, '6');
});

test('trecho parcial (substring) vale menos que palavra inteira batendo', () => {
    // "gracas" é keyword inteira da opção 1 ("ação de graças"); já em "gracas"
    // sozinho isso deve favorecer a opção 1 por palavra inteira.
    assert.equal(encontrarOpcao(normalizar('quero agradecer, graças a Deus')).id, '1');
});

test('texto sem nenhuma palavra-chave não encontra opção', () => {
    assert.equal(encontrarOpcao(normalizar('xyzxyz não existe em lugar nenhum')), null);
    assert.equal(encontrarOpcao(''), null);
    assert.equal(encontrarOpcao(null), null);
});
