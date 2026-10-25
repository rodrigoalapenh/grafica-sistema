// Catálogo de venda: dados da loja, condições e tabela de preços por pacote.
// É usado pela página catalogo.html (venda pelo WhatsApp) e pela tabela de preços do sistema (db.js).
// Para mudar um preço, altere aqui: "pacotes" = { quantidade: valor total do pacote }.
'use strict';

const LOJA = {
  nome: 'Minha Gráfica',            // troque pelo nome escolhido
  whatsapp: '5511900000000',         // DDI + DDD + número, só dígitos
  instagram: '',                     // ex.: '@minhagrafica'
  cidade: 'São Paulo/SP',
  descontoPix: 5,                    // % de desconto no PIX à vista
  parcelas: 3,                       // parcelas sem juros no cartão
  condicoes: [
    ['Arte grátis', 'Montamos a arte de impressão sem custo'],
    ['5% off no PIX', 'ou até 3x sem juros no cartão'],
    ['50% + 50%', 'Metade para iniciar, metade quando estiver pronto'],
    ['Todo o Brasil', 'Envio com rastreio, frete pelo CEP']
  ]
};

const QTDS_PADRAO = [500, 1000, 2000, 5000];

const CATALOGO = [
  {
    id: 'seda',
    nome: 'Papel seda personalizado',
    detalhes: 'Gramatura 35g · impressão em 1 cor · fundo branco',
    prazo: 'Até 12 dias úteis',
    extra: { nome: 'Segunda cor', preco: 110 },
    aliases: 'papel seda, seda, papel de seda, seda personalizada',
    variantes: [
      { id: 's_seda_32x22', nome: '32x22 cm', pacotes: { 500: 435, 1000: 590, 2000: 840, 5000: 1500 } },
      { id: 's_seda_42x32', nome: '42x32 cm', pacotes: { 500: 480, 1000: 650, 2000: 980, 5000: 1900 } },
      { id: 's_seda_64x30', nome: '64x30 cm', pacotes: { 500: 525, 1000: 710, 2000: 1080, 5000: 2250 } },
      { id: 's_seda_64x44', nome: '64x44 cm', pacotes: { 500: 565, 1000: 780, 2000: 1280, 5000: 2550 } }
    ]
  },
  {
    id: 'adesivo',
    nome: 'Adesivo personalizado',
    detalhes: '4x4 cm · impressão colorida · vinil branco ou transparente · corte circular',
    prazo: 'Até 5 dias úteis',
    aliases: 'adesivo, selo, adesivo redondo, adesivo vinil, etiqueta',
    variantes: [
      { id: 's_adesivo_4x4', nome: '4x4 cm colorido', pacotes: { 500: 180, 1000: 290, 2000: 540, 5000: 1000 } }
    ]
  },
  {
    id: 'hotstamping',
    nome: 'Adesivo hot stamping',
    detalhes: '4x4 cm · 1 cor dourado ou prata · vinil transparente · corte circular',
    prazo: 'Até 5 dias úteis',
    aliases: 'hot stamping, hotstamping, adesivo dourado, adesivo prata, metalizado',
    variantes: [
      { id: 's_hot_4x4', nome: '4x4 cm dourado ou prata', pacotes: { 500: 270, 1000: 380, 2000: 600, 5000: 1200 } }
    ]
  },
  {
    id: 'kit',
    nome: 'Kit marca completa',
    detalhes: '1.000 folhas de papel seda 64x30 cm + 1.000 adesivos + 1.000 tags 5x9 cm + 1.000 cartões de agradecimento',
    prazo: 'Até 12 dias úteis',
    aliases: 'kit, kit completo, super kit, kit personalizado',
    unidade: 'kit',
    variantes: [
      { id: 's_kit_completo', nome: '1.000 de cada item', pacotes: { 1: 1389 } }
    ]
  }
];

// Itens vendidos só sob consulta (aparecem na página com botão de orçamento).
const SOB_CONSULTA = ['Papel manteiga', 'Tags', 'Cartão de agradecimento', 'Cartão de visita',
  'Fita de cetim', 'Envelope de segurança', 'Outros tamanhos de adesivo'];

// Converte o catálogo para o formato da tabela de preços do sistema
// (preço unitário da menor quantidade + faixas "1000:0,59; 2000:0,42").
function produtosDoCatalogo() {
  const lista = [];
  for (const c of CATALOGO) {
    for (const v of c.variantes) {
      const qtds = Object.keys(v.pacotes).map(Number).sort((a, b) => a - b);
      const unit = q => Math.round(v.pacotes[q] / q * 100) / 100;
      lista.push({
        id: v.id,
        nome: `${c.nome} ${v.nome}`,
        categoria: 'Material',
        unidade: c.unidade || 'unidade',
        preco: unit(qtds[0]),
        faixas: qtds.slice(1).map(q => `${q}:${String(unit(q)).replace('.', ',')}`).join('; '),
        aliases: `${c.aliases}, ${c.nome} ${v.nome}`.toLowerCase()
      });
    }
    if (c.extra) {
      lista.push({
        id: `s_${c.id}_extra`, nome: `${c.extra.nome} – ${c.nome} (taxa por pedido)`, categoria: 'Material',
        unidade: 'pedido', preco: c.extra.preco, faixas: '', aliases: `${c.extra.nome.toLowerCase()}, 2 cores, duas cores`
      });
    }
  }
  return lista;
}
