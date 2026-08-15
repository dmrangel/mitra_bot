const { config } = require('../config');

const CMD_APROVAR = /^!aprovar(\s|$)/i;

function ehAdmin(msg) {
    if (msg.fromMe) return true;
    // Em grupo, msg.from é o id do grupo e msg.author é quem escreveu.
    return config.numerosVerificacao.includes(msg.from) ||
        (msg.author && config.numerosVerificacao.includes(msg.author));
}

module.exports = { CMD_APROVAR, ehAdmin };
