const { obterCliente } = require('./cliente');
const { erro } = require('./log');

async function enviar(destino, texto) {
    try {
        await obterCliente().sendMessage(destino, texto);
        return true;
    } catch (e) {
        erro(`enviar mensagem para ${destino}`, e);
        return false;
    }
}

async function enviarParaTodos(destinos, texto) {
    let enviados = 0;
    for (const destino of destinos) {
        if (await enviar(destino, texto)) enviados++;
    }
    return enviados;
}

module.exports = { enviar, enviarParaTodos };
