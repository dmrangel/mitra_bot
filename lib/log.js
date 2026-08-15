function log(...args) {
    console.log(`[${new Date().toISOString()}]`, ...args);
}

function erro(contexto, e) {
    console.error(`[${new Date().toISOString()}] ERRO em ${contexto}:`, e && e.message ? e.message : e);
}

module.exports = { log, erro };
