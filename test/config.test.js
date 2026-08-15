const test = require('node:test');
const assert = require('node:assert/strict');

const { config, validar } = require('../config');

// Cada teste mexe em campos do config (que é um singleton compartilhado) e
// devolve tudo como estava, pra não vazar estado entre os testes.
function comConfigTemporaria(alteracoes, fn) {
    const original = {};
    for (const chave of Object.keys(alteracoes)) original[chave] = config[chave];
    Object.assign(config, alteracoes);
    try {
        return fn();
    } finally {
        Object.assign(config, original);
    }
}

test('config válida não produz erros bloqueantes', () => {
    comConfigTemporaria({
        numerosVerificacao: ['5521999999999@c.us'],
        gruposOracao: ['grupo@g.us'],
        gruposNotificacaoHumano: ['grupo@g.us'],
        modoTeste: false,
        sessionId: ''
    }, () => {
        const { erros } = validar();
        assert.deepEqual(erros, []);
    });
});

test('sem NUMEROS_VERIFICACAO, validar() bloqueia', () => {
    comConfigTemporaria({ numerosVerificacao: [], gruposOracao: ['grupo@g.us'] }, () => {
        const { erros } = validar();
        assert.ok(erros.some(e => e.includes('NUMEROS_VERIFICACAO')));
    });
});

test('sem GRUPOS_ORACAO, validar() bloqueia', () => {
    comConfigTemporaria({ numerosVerificacao: ['5521999999999@c.us'], gruposOracao: [] }, () => {
        const { erros } = validar();
        assert.ok(erros.some(e => e.includes('GRUPOS_ORACAO')));
    });
});

test('sem GRUPOS_NOTIFICACAO_HUMANO, validar() só avisa (não bloqueia)', () => {
    comConfigTemporaria({
        numerosVerificacao: ['5521999999999@c.us'],
        gruposOracao: ['grupo@g.us'],
        gruposNotificacaoHumano: []
    }, () => {
        const { erros, avisos } = validar();
        assert.equal(erros.length, 0);
        assert.ok(avisos.some(a => a.includes('GRUPOS_NOTIFICACAO_HUMANO')));
    });
});

test('MODO_TESTE ligado sem NUMERO_TESTE bloqueia', () => {
    comConfigTemporaria({
        numerosVerificacao: ['5521999999999@c.us'],
        gruposOracao: ['grupo@g.us'],
        modoTeste: true,
        numeroTeste: ''
    }, () => {
        const { erros } = validar();
        assert.ok(erros.some(e => e.includes('MODO_TESTE')));
    });
});

test('SESSION_ID com caracteres inválidos bloqueia', () => {
    comConfigTemporaria({
        numerosVerificacao: ['5521999999999@c.us'],
        gruposOracao: ['grupo@g.us'],
        sessionId: 'tem espaço!'
    }, () => {
        const { erros } = validar();
        assert.ok(erros.some(e => e.includes('SESSION_ID')));
    });
});

test('ids fora do formato @c.us/@lid/@g.us geram aviso, não erro', () => {
    comConfigTemporaria({
        numerosVerificacao: ['numero-sem-sufixo'],
        gruposOracao: ['grupo@g.us']
    }, () => {
        const { erros, avisos } = validar();
        assert.equal(erros.length, 0);
        assert.ok(avisos.some(a => a.includes('numero-sem-sufixo')));
    });
});
