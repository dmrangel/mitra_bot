const menuOptions = require('../menu');

// Marcas de acentuacao combinantes (U+0300-U+036F), em ASCII puro para
// nao depender da codificacao do arquivo.
const ACENTOS = new RegExp('[\\u0300-\\u036f]', 'g');

function normalizar(valor) {
    return String(valor || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(ACENTOS, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function escaparRegex(valor) {
    return valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Reconhecimento do menu
//
// Antes era um único find(): a primeira opção da lista que batesse em qualquer
// palavra-chave vencia. Como "atendimento" está na opção 6 (Secretaria) e
// também na 8 (Atendimento Humano), quem escrevia "atendimento humano" recebia
// o endereço da secretaria em vez de ser transferido.
//
// Agora: id exato primeiro; depois pontuação, onde palavra inteira vale mais
// que trecho solto e mais palavras batendo vence menos palavras.
// ---------------------------------------------------------------------------

const OPCOES = menuOptions.map(opt => ({
    opcao: opt,
    id: normalizar(opt.id),
    termos: (opt.keywords || []).map(kw => {
        const alvo = normalizar(kw);
        return { alvo, regex: new RegExp(`(^|[^a-z0-9])${escaparRegex(alvo)}([^a-z0-9]|$)`) };
    })
}));

function encontrarOpcao(texto) {
    if (!texto) return null;

    const exata = OPCOES.find(o => o.id === texto);
    if (exata) return exata.opcao;

    let melhor = null;
    for (const entrada of OPCOES) {
        let palavras = 0, maiorPalavra = 0, trechos = 0, maiorTrecho = 0;
        for (const termo of entrada.termos) {
            if (termo.regex.test(texto)) {
                palavras++;
                maiorPalavra = Math.max(maiorPalavra, termo.alvo.length);
            } else if (texto.includes(termo.alvo)) {
                trechos++;
                maiorTrecho = Math.max(maiorTrecho, termo.alvo.length);
            }
        }
        if (palavras === 0 && trechos === 0) continue;

        const nota = [palavras, maiorPalavra, trechos, maiorTrecho];
        if (!melhor || compararNotas(nota, melhor.nota) > 0) {
            melhor = { opcao: entrada.opcao, nota };
        }
    }
    return melhor ? melhor.opcao : null;
}

/** Compara duas notas na ordem dos critérios. > 0 se `a` é melhor que `b`. */
function compararNotas(a, b) {
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
}

module.exports = { normalizar, encontrarOpcao };
