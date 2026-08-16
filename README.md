# mitra-bot

Bot de atendimento automático do WhatsApp do Santuário de Santa Rita.

Feito com [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js).
**Não usa nenhuma API paga e não precisa de API key.** A autenticação é feita
lendo um QR Code com o celular do Santuário, e a sessão fica salva na pasta
`.wwebjs_auth/`.

---

## 1. Instalação

Requisitos: **Node.js 18 ou superior** e, opcionalmente, **pm2** para manter o
bot rodando em segundo plano.

```bash
npm install
npm install -g pm2      # opcional, recomendado no servidor
```

## 2. Configuração

Todos os números, grupos e tempos ficam no arquivo `.env`, que **nunca vai para
o Git**. Copie o modelo e preencha:

```bash
cp .env.example .env
```

Variáveis obrigatórias:

| Variável | O que é |
|---|---|
| `GRUPOS_ORACAO` | Grupo(s) onde os pedidos **aprovados** são publicados |
| `NUMEROS_VERIFICACAO` | Quem recebe os pedidos para aprovar e pode usar `!pedidos` / `!aprovar` |

O bot **não sobe** se essas duas estiverem vazias — ele avisa exatamente o que
falta em vez de rodar quebrado.

### Como descobrir os IDs

Com o bot no ar, envie `!idgrupo` dentro do grupo desejado, a partir de um
número que já esteja em `NUMEROS_VERIFICACAO`. O bot responde com o ID.

Formatos:
- Pessoa: `5521999999999@c.us` (ou `000000000000000@lid`, formato novo)
- Grupo: `120363000000000000@g.us`

## 3. Rodando

```bash
npm start                          # primeiro plano, mostra o QR Code
pm2 start ecosystem.config.js      # segundo plano (servidor)
pm2 logs mitra_bot                 # ver o QR Code / os logs
pm2 stop mitra_bot
```

No Windows, `ligar_bot.bat` faz tudo isso (checa o `.env`, instala as
dependências se faltarem e sobe pelo pm2).

Na **primeira execução** aparece um QR Code no terminal. Leia com o WhatsApp do
Santuário em *Aparelhos conectados*. Depois disso a sessão fica salva e o QR
não aparece mais.

Verificar se os arquivos estão sem erro de sintaxe:

```bash
npm run check
```

## 4. Comandos administrativos

Do próprio aparelho do Santuário, dentro da conversa:

| Comando | Efeito |
|---|---|
| `!manual` | Pausa o bot **nesta conversa** para atender à mão |
| `!auto` | Devolve a conversa para o bot |

De qualquer número listado em `NUMEROS_VERIFICACAO` (ou do próprio aparelho):

| Comando | Efeito |
|---|---|
| `!pedidos` | Lista os pedidos de oração aguardando aprovação |
| `!aprovar <ID>` | Publica o pedido no grupo de oração |
| `!idgrupo` | Responde com o ID do grupo/conversa atual |

## 5. Fluxo dos pedidos de oração

1. A pessoa escolhe a opção **2** e escreve o pedido.
2. O pedido vai para `NUMEROS_VERIFICACAO` com um ID.
3. Alguém revisa e envia `!aprovar <ID>`.
4. Só então ele é publicado em `GRUPOS_ORACAO`.

A fila fica salva em `pedidos.json`, então **um reinício não perde pedidos**.
Pedidos não aprovados são descartados após `VALIDADE_PEDIDO_DIAS` (padrão: 7).

## 6. Testando sem incomodar os fiéis

No `.env`:

```
MODO_TESTE=true
NUMERO_TESTE=5521999999999@c.us
```

Assim o bot só responde a esse número.

## 7. Onde mexer em cada coisa

| Arquivo | Conteúdo |
|---|---|
| `menu.js` | Textos das respostas e palavras-chave (informação pública) |
| `.env` | Números, grupos e tempos (**privado**) |
| `config.js` | Leitura e validação do `.env` |
| `index.js` | Lógica do atendimento |

Para mudar um horário ou um valor, mexa **só no `menu.js`**.

## 8. Problemas comuns

**O QR Code não aparece / fica reconectando**
O WhatsApp mudou de versão. Deixe `WEB_VERSION=` vazio (padrão) para a
biblioteca escolher sozinha. Se ainda assim quebrar, atualize a biblioteca:

```bash
npm install whatsapp-web.js@latest
```

**`Failed to launch the browser process`**
`CHROME_PATH` está errado. Deixe **vazio** para usar o Chromium que já vem com
o puppeteer, ou aponte para o caminho certo:
- Linux: `/usr/bin/chromium-browser`
- Windows: `C:\Program Files\Google\Chrome\Application\chrome.exe`

**O bot não responde ninguém**
Confira se `MODO_TESTE` está `false`, e se o número não caiu na `BLACKLIST`.

**Pedi para o bot parar numa conversa e ele não volta**
Envie `!auto` naquela conversa.

**Perdi a sessão e quero ler o QR de novo**
Apague a pasta `.wwebjs_auth/` e suba o bot novamente.

> `LIMPAR_CHROME=true` mata **todos** os processos do Chrome da máquina. Use
> apenas no servidor dedicado, nunca num computador de uso pessoal.
