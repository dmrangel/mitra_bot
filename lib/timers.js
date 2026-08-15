const { config } = require('../config');
const { enviar } = require('./envio');
const { aguardandoRespostaAviso, sessoesAtivas, limparEstado } = require('./estado');
const { erro } = require('./log');

function limparTimers(chatId) {
    aguardandoRespostaAviso.delete(chatId);
    const sessao = sessoesAtivas.get(chatId);
    if (sessao) {
        clearTimeout(sessao.avisoTimeout);
        clearTimeout(sessao.encerramentoTimeout);
        sessoesAtivas.delete(chatId);
    }
}

async function encerrarAtendimento(chatId) {
    await enviar(chatId, 'Agradecemos o contato. Que pela intercessão de Santa Rita, Deus abençoe a você e sua família.');
    limparTimers(chatId);
    limparEstado(chatId);
}

function iniciarTimers(chatId) {
    limparTimers(chatId);

    const sessao = { avisoTimeout: null, encerramentoTimeout: null };
    sessoesAtivas.set(chatId, sessao);

    sessao.avisoTimeout = setTimeout(async () => {
        await enviar(chatId, 'Podemos ajudar com algo mais?');

        // Entre o disparo do timer e o fim do envio a conversa pode ter
        // recomeçado. Sem esta checagem, o encerramento antigo fechava uma
        // conversa nova 5 minutos depois.
        if (sessoesAtivas.get(chatId) !== sessao) return;

        aguardandoRespostaAviso.add(chatId);
        sessao.encerramentoTimeout = setTimeout(() => {
            encerrarAtendimento(chatId).catch(e => erro('encerrarAtendimento', e));
        }, config.tempoEncerramento);
    }, config.tempoAviso);
}

module.exports = { limparTimers, iniciarTimers, encerrarAtendimento };
