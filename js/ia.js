// Leitura de prints (pedidos do WhatsApp) e de comprovantes de pagamento com a API do Claude.
'use strict';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.132.0/+esm';
let _clienteIA = null;

async function clienteIA() {
  const chave = DB.config.apiKey;
  if (!chave) throw new Error('Configure a chave da API do Claude em Configurações.');
  if (_clienteIA && _clienteIA.chave === chave) return _clienteIA.client;
  const { default: Anthropic } = await import(SDK_URL);
  // A chave fica só neste navegador (localStorage) e vai direto para api.anthropic.com.
  const client = new Anthropic({ apiKey: chave, dangerouslyAllowBrowser: true });
  _clienteIA = { chave, client };
  return client;
}

// Lê um File/Blob de imagem e devolve {media_type, data} em base64, reduzindo se for grande.
async function imagemParaBase64(arquivo) {
  const tiposOk = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  const url = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(arquivo);
  });
  if (tiposOk.includes(arquivo.type) && arquivo.size < 3.5 * 1024 * 1024) {
    return { media_type: arquivo.type, data: url.split(',')[1], url };
  }
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
  const escala = Math.min(1, 2000 / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.width * escala);
  cv.height = Math.round(img.height * escala);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  const jpg = cv.toDataURL('image/jpeg', 0.88);
  return { media_type: 'image/jpeg', data: jpg.split(',')[1], url: jpg };
}

async function chamarClaude({ system, imagens, texto, schema }) {
  const client = await clienteIA();
  const content = [
    ...imagens.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } })),
    { type: 'text', text: texto }
  ];
  const params = {
    model: DB.config.modelo || 'claude-opus-5-5',
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } }
  };
  let resp;
  try {
    // Se o modelo recusar, o servidor tenta automaticamente um modelo alternativo.
    resp = await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  } catch (e) {
    if (e?.status === 400 && /fallback/i.test(e.message || '')) {
      resp = await client.messages.create(params);
    } else {
      throw traduzirErroIA(e);
    }
  }
  if (resp.stop_reason === 'refusal') throw new Error('A IA recusou a leitura desta imagem. Lance o pedido manualmente.');
  if (resp.stop_reason === 'max_tokens') throw new Error('A resposta da IA ficou incompleta. Tente com menos prints por vez.');
  const bloco = resp.content.find(b => b.type === 'text');
  if (!bloco) throw new Error('A IA não retornou dados.');
  return JSON.parse(bloco.text);
}

function traduzirErroIA(e) {
  const st = e?.status;
  if (st === 401) return new Error('Chave da API inválida. Confira em Configurações.');
  if (st === 429) return new Error('Limite de uso da API atingido. Aguarde um pouco e tente de novo.');
  if (st >= 500) return new Error('A API do Claude está instável no momento. Tente de novo em instantes.');
  return new Error('Erro ao chamar a IA: ' + (e?.message || e));
}

// ---------- pedidos ----------
const SCHEMA_PEDIDO = {
  type: 'object',
  additionalProperties: false,
  required: ['cliente_nome', 'cliente_id', 'cliente_telefone', 'itens', 'prazo_entrega', 'observacoes_gerais'],
  properties: {
    cliente_nome: { type: 'string', description: 'Nome do contato no topo da conversa (quem fez o pedido).' },
    cliente_id: { type: 'string', description: 'id do cliente cadastrado que corresponde ao contato, ou "" se nenhum.' },
    cliente_telefone: { type: 'string', description: 'Telefone se aparecer no print, senão "".' },
    prazo_entrega: { type: 'string', description: 'Prazo combinado, ex. "segunda-feira 27/10", ou "".' },
    observacoes_gerais: { type: 'string' },
    itens: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['data', 'hora', 'tipo', 'arquivo', 'paginas', 'copias', 'quantidade', 'material_texto', 'produto_id', 'acabamento_texto', 'acabamentos_ids', 'observacoes', 'confianca'],
        properties: {
          data: { type: 'string', description: 'Data da mensagem no formato AAAA-MM-DD.' },
          hora: { type: 'string', description: 'Hora da mensagem HH:MM.' },
          tipo: { type: 'string', enum: ['producao', 'orcamento'] },
          arquivo: { type: 'string', description: 'Nome do arquivo enviado (ex.: Sergio.pdf) ou "".' },
          paginas: { type: 'integer', description: 'Número de páginas do arquivo (1 se for imagem ou desconhecido).' },
          copias: { type: 'integer', description: 'Cópias de cada página.' },
          quantidade: { type: 'integer', description: 'Total de unidades a cobrar (normalmente paginas × copias).' },
          material_texto: { type: 'string', description: 'Material como o cliente escreveu.' },
          produto_id: { type: 'string', description: 'id do material na tabela de preços, ou "" se não encontrar.' },
          acabamento_texto: { type: 'string' },
          acabamentos_ids: { type: 'array', items: { type: 'string' } },
          observacoes: { type: 'string' },
          confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] }
        }
      }
    }
  }
};

function promptSistemaPedido() {
  const produtos = DB.produtos.map(p => `- id="${p.id}" | ${p.categoria} | ${p.nome} | apelidos: ${p.aliases || '-'}`).join('\n');
  const clientes = DB.clientes.map(c => `- id="${c.id}" | ${c.nome}${c.apelidos ? ' | apelidos: ' + c.apelidos : ''}`).join('\n') || '(nenhum cadastrado)';
  return `Você lê prints de conversas de WhatsApp entre uma gráfica e seus clientes e extrai os pedidos de impressão.

Como ler o print:
- O nome no topo da conversa é o cliente (quem pede). Balões à esquerda (cinza) são do cliente; balões verdes à direita são da gráfica.
- Cada arquivo enviado (cartão com nome .pdf/.jpg, "N páginas", tamanho) seguido do texto com as instruções forma um item. O texto pode vir na legenda do próprio arquivo ou na mensagem logo abaixo.
- "1 cópia de cada folha" = copias 1 para cada página. "3 cópias" de um PDF de 2 páginas = 3 cópias de cada página, quantidade 6. Se não houver número de páginas, use 1.
- "Recortado/Recortada" é acabamento de recorte. Identifique o material (Bopp branco, Adesivo couchê, etc.).
- Separadores como "Hoje", "Ontem", "Sexta-feira" indicam a data das mensagens abaixo deles; converta para AAAA-MM-DD usando a data de referência informada. Dias da semana se referem à ocorrência mais recente antes da data de referência.
- tipo = "orcamento" se o cliente só pergunta preço/valor; caso contrário "producao".
- Frases como "depois vai fazer em quantidade" vão em observacoes do item. O prazo prometido pela gráfica ("consigo para segunda") vai em prazo_entrega.
- Não invente itens: extraia só pedidos visíveis. Se um campo não aparecer, use "" (ou 1 para números).
- confianca "baixa" quando material, quantidade ou páginas estiverem ilegíveis ou ambíguos.

Tabela de preços (use exatamente estes ids em produto_id e acabamentos_ids):
${produtos}

Clientes cadastrados (use o id em cliente_id se o contato for um deles, comparando nome e apelidos):
${clientes}`;
}

async function lerPrintPedido(imagens, dataReferencia) {
  const ref = parseISO(dataReferencia);
  const diaSemana = ref.toLocaleDateString('pt-BR', { weekday: 'long' });
  return chamarClaude({
    system: promptSistemaPedido(),
    imagens,
    texto: `Data de referência (dia em que o print foi tirado): ${dataReferencia} (${diaSemana}). Extraia o cliente e todos os itens de pedido visíveis.`,
    schema: SCHEMA_PEDIDO
  });
}

// ---------- comprovantes ----------
const SCHEMA_COMPROVANTE = {
  type: 'object',
  additionalProperties: false,
  required: ['eh_comprovante', 'valor', 'data', 'hora', 'pagador', 'recebedor', 'instituicao', 'id_transacao', 'meio', 'observacoes'],
  properties: {
    eh_comprovante: { type: 'boolean', description: 'true se a imagem for um comprovante de pagamento/transferência.' },
    valor: { type: 'number', description: 'Valor pago em reais.' },
    data: { type: 'string', description: 'AAAA-MM-DD' },
    hora: { type: 'string' },
    pagador: { type: 'string', description: 'Nome de quem pagou (origem).' },
    recebedor: { type: 'string', description: 'Nome de quem recebeu (destino).' },
    instituicao: { type: 'string', description: 'Banco/instituição de origem.' },
    id_transacao: { type: 'string', description: 'ID/E2E/autenticação da transação, ou "".' },
    meio: { type: 'string', enum: ['pix', 'ted', 'doc', 'boleto', 'deposito', 'cartao', 'dinheiro', 'outro'] },
    observacoes: { type: 'string' }
  }
};

async function lerComprovante(imagens) {
  return chamarClaude({
    system: 'Você extrai dados de comprovantes de pagamento brasileiros (PIX, TED, boleto, depósito). Responda só com os dados que aparecem na imagem; use "" ou 0 quando não houver.',
    imagens,
    texto: `Hoje é ${hojeISO()}. Extraia os dados deste comprovante.`,
    schema: SCHEMA_COMPROVANTE
  });
}
