const { erro } = require('./log');

async function dadosDoContato(msg) {
    let nome = msg.from.split('@')[0];
    let numero = '';
    try {
        const contato = await msg.getContact();
        nome = contato.pushname || contato.name || nome;
        numero = contato.number || '';
    } catch (e) {
        erro('obter contato', e);
    }
    // Contatos no formato @lid não expõem número; nesse caso não há link wa.me.
    const link = /^\d{8,15}$/.test(numero) ? `https://wa.me/${numero}` : '(número não disponível)';
    return { nome, link };
}

module.exports = { dadosDoContato };
