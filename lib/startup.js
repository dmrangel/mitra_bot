// Momento em que o processo subiu, na mesma unidade de msg.timestamp (segundos).
// Usado para ignorar mensagens e comandos anteriores ao boot.
const startupTime = Math.floor(Date.now() / 1000);

module.exports = { startupTime };
