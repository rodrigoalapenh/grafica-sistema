# grafica-sistema
Sistema de gerenciamento para gráfica: lê o print do pedido do WhatsApp, lança na tabela com os preços, gera a cobrança com PIX, dá baixa pelo comprovante e monta a lista diária de devedores.

## Como funciona

1. **Ler print** – cole o print da conversa (Ctrl+V, arrastar ou escolher arquivo). A IA (Claude) identifica:
   - o cliente (nome no topo da conversa);
   - cada arquivo enviado (ex.: `Sergio.pdf`, 4 páginas) e as instruções ("1 cópia de cada folha", "3 cópias");
   - material (Bopp branco, Adesivo couchê...) e acabamento (recortado → recorte);
   - data de cada pedido ("Ontem", "Sexta-feira" viram datas), prazo combinado e observações.

   Você confere a tela de revisão, ajusta o que precisar e salva. Pedidos já lançados (mesmo cliente, data e arquivo) aparecem marcados como duplicados.
2. **Cobrança** – para clientes *avulsos* a cobrança é gerada na hora, com a mensagem pronta, PIX copia e cola, QR Code e botão para abrir no WhatsApp.
3. **Baixa pelo comprovante** – na aba *Cobranças*, cole o comprovante. A IA lê valor, data, pagador e ID da transação, o sistema sugere a cobrança (pelo valor e nome do pagador) e registra o pagamento (total ou parcial). Comprovantes repetidos são detectados pelo ID.
4. **Lista diária de devedores** – todo dia, a partir do horário configurado (padrão 08:00), o painel gera a lista de cobrança: quem deve, quanto está vencido, dias de atraso e o que falta faturar, com botão de lembrete no WhatsApp. Com a planilha Google ligada, a lista também chega por e-mail de manhã, mesmo sem abrir o sistema.
5. **Fechamentos** – cada cliente pode ser *avulso*, *quinzenal* (1–15 e 16–fim do mês), *mensal* ou *personalizado* (a cada N dias). Os pedidos desses clientes ficam "a faturar" e o painel avisa quando um período termina; o fechamento junta tudo numa cobrança só. Também dá para fechar qualquer período manualmente.

## Primeiros passos

1. Abra `index.html` no navegador (ou publique o repositório no GitHub Pages: *Settings → Pages → Branch*).
2. Em **Configurações**:
   - cole a chave da API do Claude (crie em <https://console.anthropic.com/settings/keys>);
   - informe a chave PIX, nome do recebedor e cidade;
   - ajuste o prazo padrão de pagamento e o horário da lista diária.
3. Em **Tabela de preços**, troque os valores de exemplo pelos seus. O preço de um item é `quantidade × (material + acabamentos)`; dá para cadastrar faixas de quantidade (ex.: `50:3,50; 100:3,00`) e as palavras que os clientes usam para cada material.
4. Em **Clientes**, defina o tipo de fechamento e o prazo de cada cliente (os clientes novos são criados automaticamente ao ler um print, como avulsos).

Os dados ficam salvos no navegador (localStorage). Use **Exportar backup** com frequência ou ligue a planilha Google.

## Planilha Google + lista diária por e-mail (opcional)

1. Crie uma planilha no Google Planilhas → *Extensões → Apps Script*.
2. Cole o conteúdo de [`apps-script/Code.gs`](apps-script/Code.gs) e troque `TOKEN` por uma senha longa (e, se quiser, `EMAIL_LISTA` e `HORA_LISTA`).
3. Selecione a função `instalar` e clique em *Executar* (autorize o acesso). Isso agenda a lista diária.
4. *Implantar → Nova implantação → Tipo: App da Web* – executar como **você**, acesso **qualquer pessoa**. Copie a URL.
5. No sistema, em Configurações, cole a URL e o mesmo token, salve e clique em **Enviar para a planilha**.

A partir daí cada alteração é enviada para a planilha (abas *Clientes*, *Pedidos*, *Cobranças*, *Pagamentos*), e todo dia no horário escolhido são geradas as abas *Devedores* / *Histórico Devedores* e o e-mail com a lista. Em outro computador ou celular, use **Baixar da planilha**.

## Observações

- A chave da API fica só no navegador onde foi digitada e é enviada apenas para a API da Anthropic; ela não vai para a planilha nem para o backup.
- O modelo padrão é o Claude Opus 5.5. Se a IA recusar uma imagem, a requisição tenta automaticamente outro modelo (*server-side fallback*); você também pode escolher o Sonnet 5.5, mais barato, em Configurações.
- Sempre confira a tela de revisão antes de salvar: itens com leitura duvidosa aparecem com o selo **conferir**.

## Estrutura

| Arquivo | Conteúdo |
|---|---|
| `index.html`, `css/style.css` | Interface |
| `js/db.js` | Dados, preços, cobranças, fechamentos e lista de devedores |
| `js/ia.js` | Leitura de prints e comprovantes com a API do Claude |
| `js/pix.js` | Código PIX copia e cola (BR Code) |
| `js/sync.js` | Sincronização com a planilha |
| `js/app.js` | Telas e ações |
| `apps-script/Code.gs` | Backend no Google Apps Script |
