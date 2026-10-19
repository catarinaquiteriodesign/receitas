# Leitor do Instagram: como pôr a funcionar

Serviço grátis na Cloudflare que lê um reel público a partir do link e devolve a legenda, a imagem de capa, o vídeo e a transcrição do áudio. Faz-se uma vez só, no computador.

## 1. Criar o Worker
1. Entra em dash.cloudflare.com (cria conta grátis se ainda não tiveres).
2. No menu da esquerda, abre **Workers & Pages**.
3. Clica em **Create application**.
4. Escolhe **Start with Hello World!** e depois **Get started**.
5. No nome, escreve `leitor-receitas`.
6. Clica em **Deploy**. Espera uns segundos até aparecer a confirmação.

## 2. Pôr o código do leitor
1. Na página do Worker, clica em **Edit code** (canto superior direito).
2. Abre um editor de código. À esquerda há um ficheiro (`worker.js`) e à direita o código de exemplo.
3. Clica dentro do código, carrega em Cmd+A para selecionar tudo e apaga.
4. No teu computador, abre o ficheiro `worker.js` desta pasta com o TextEdit (botão direito, Abrir com, TextEdit). Cmd+A, Cmd+C.
5. Volta ao editor da Cloudflare e cola com Cmd+V.
6. Clica em **Deploy** no canto superior direito do editor.

## 3. Ligar a transcrição do áudio
1. Volta à página do Worker (clica no nome `leitor-receitas` no topo).
2. Abre o separador **Bindings**.
3. Clica em **Add binding**.
4. Escolhe **Workers AI** e clica em **Add binding**.
5. Em **Variable name** escreve exatamente `AI` (maiúsculas).
6. Clica em **Add binding** para guardar.

## 4. Confirmar que funciona
1. Na página do Worker há um endereço que acaba em `.workers.dev` (por exemplo `https://leitor-receitas.o-teu-nome.workers.dev`). Também o encontras em Settings, Domains & Routes.
2. Abre esse endereço numa janela nova. Deves ver um texto que começa por `{"ok":true`.
3. Copia o endereço. Vais colá-lo na app, em Definições, Leitor do Instagram.

## Atualizar o código do leitor
1. Na página do Worker, clica em **Edit code**.
2. Clica dentro do código, Cmd+A e Delete.
3. Cola o conteúdo novo de `worker.js` (abre-o com o TextEdit, Cmd+A, Cmd+C) com Cmd+V.
4. Clica em **Deploy**.

## Se o leitor deixar de encontrar o vídeo
O Instagram muda de vez em quando o pedido interno que o leitor usa. Na página do Worker, em Settings, Variables and secrets, podes juntar uma variável `DOC_ID` com um número novo sem mexer no código. Pede-me o número atualizado quando acontecer.

## Se mudares o endereço da app
No topo de `worker.js`, a lista `ALLOWED_ORIGINS` diz que sites podem usar o leitor. Junta lá o novo endereço e faz Deploy outra vez.

## Limites
- Só funciona com publicações públicas.
- O Instagram muda as páginas de vez em quando. Se o leitor deixar de encontrar a legenda, a app continua a aceitar a legenda colada ou capturas de ecrã.
- A transcrição usa o plano grátis da Cloudflare (10 000 unidades por dia, cerca de 45 por minuto de áudio).
