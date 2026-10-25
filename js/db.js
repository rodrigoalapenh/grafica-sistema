// Armazenamento local, modelos de dados e regras de negócio (preços, cobranças, fechamentos).
'use strict';

const DB_KEY = 'grafica_db_v1';

const PRODUTOS_EXEMPLO = [
  { id: 'p_adesivo_couche', nome: 'Adesivo Couché (folha A3)', categoria: 'Material', unidade: 'folha', preco: 4.00, faixas: '', aliases: 'adesivo couche, adesivo couchê, couche, couchê, adesivo papel' },
  { id: 'p_bopp_branco', nome: 'Adesivo BOPP Branco (folha A3)', categoria: 'Material', unidade: 'folha', preco: 8.00, faixas: '', aliases: 'bopp branco, bopp, adesivo bopp' },
  { id: 'p_bopp_transp', nome: 'Adesivo BOPP Transparente (folha A3)', categoria: 'Material', unidade: 'folha', preco: 9.00, faixas: '', aliases: 'bopp transparente, bopp cristal, transparente' },
  { id: 'p_vinil', nome: 'Adesivo Vinil (folha A3)', categoria: 'Material', unidade: 'folha', preco: 10.00, faixas: '', aliases: 'vinil, adesivo vinil' },
  { id: 'p_couche_150', nome: 'Papel Couché 150g (folha A3)', categoria: 'Material', unidade: 'folha', preco: 2.50, faixas: '', aliases: 'couche 150, couchê 150g, papel couche' },
  { id: 'p_couche_300', nome: 'Papel Couché 300g (folha A3)', categoria: 'Material', unidade: 'folha', preco: 3.50, faixas: '', aliases: 'couche 300, couchê 300g, cartão, papel grosso' },
  { id: 'p_sulfite', nome: 'Sulfite 75g A4 colorido', categoria: 'Material', unidade: 'folha', preco: 1.00, faixas: '', aliases: 'sulfite, papel comum, impressão a4' },
  { id: 'a_recorte', nome: 'Recorte / meio-corte (por folha)', categoria: 'Acabamento', unidade: 'folha', preco: 3.00, faixas: '', aliases: 'recortado, recortada, recorte, meio corte, corte especial, plotter de recorte' },
  { id: 'a_laminacao', nome: 'Laminação (por folha)', categoria: 'Acabamento', unidade: 'folha', preco: 2.50, faixas: '', aliases: 'laminado, laminação, plastificado' },
  { id: 'a_refile', nome: 'Corte reto / refile (por folha)', categoria: 'Acabamento', unidade: 'folha', preco: 0.50, faixas: '', aliases: 'refile, corte reto, cortado' }
];

function dbVazio() {
  return {
    versao: 1,
    atualizadoEm: new Date().toISOString(),
    seq: { pedido: 0, cobranca: 0 },
    clientes: [],
    produtos: PRODUTOS_EXEMPLO.map(p => ({ ...p })),
    pedidos: [],
    cobrancas: [],
    listas: {},
    config: {
      empresa: 'Minha Gráfica',
      apiKey: '',
      modelo: 'claude-opus-5-5',
      pixChave: '',
      pixNome: '',
      pixCidade: '',
      horaLista: '08:00',
      scriptUrl: '',
      scriptToken: '',
      prazoPadrao: 0
    }
  };
}

let DB = carregarDB();

function carregarDB() {
  try {
    const bruto = localStorage.getItem(DB_KEY);
    if (bruto) {
      const base = dbVazio();
      const d = JSON.parse(bruto);
      return { ...base, ...d, seq: { ...base.seq, ...d.seq }, config: { ...base.config, ...d.config } };
    }
  } catch (e) {
    console.error('Falha ao ler dados locais', e);
  }
  return dbVazio();
}

function salvarDB(opts = {}) {
  DB.atualizadoEm = new Date().toISOString();
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
  } catch (e) {
    alert('Não foi possível salvar no navegador: ' + e.message);
  }
  if (!opts.semSync && typeof agendarSync === 'function') agendarSync();
}

// ---------- utilidades ----------
const uid = (p) => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const hojeISO = () => dataISO(new Date());
function dataISO(d) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function parseISO(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
function somarDias(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return dataISO(d);
}
function diasEntre(aIso, bIso) {
  return Math.round((parseISO(bIso) - parseISO(aIso)) / 86400000);
}
const brl = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = iso => iso ? parseISO(iso).toLocaleDateString('pt-BR') : '';
const dataCurta = iso => iso ? dataBR(iso).slice(0, 5) : '';
const arred = v => Math.round((Number(v) || 0) * 100) / 100;
function semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- consultas ----------
const getCliente = id => DB.clientes.find(c => c.id === id);
const getProduto = id => DB.produtos.find(p => p.id === id);
const getPedido = id => DB.pedidos.find(p => p.id === id);
const getCobranca = id => DB.cobrancas.find(c => c.id === id);
const nomeCliente = id => (getCliente(id) || {}).nome || '(cliente removido)';

function encontrarClientePorNome(nome) {
  const alvo = semAcento(nome);
  if (!alvo) return null;
  return DB.clientes.find(c => {
    const nomes = [c.nome, ...(c.apelidos || '').split(',')].map(semAcento).filter(Boolean);
    return nomes.includes(alvo);
  }) || DB.clientes.find(c => {
    const nomes = [c.nome, ...(c.apelidos || '').split(',')].map(semAcento).filter(Boolean);
    return nomes.some(n => n.length > 2 && (n.includes(alvo) || alvo.includes(n)));
  }) || null;
}

// ---------- preços ----------
// faixas: "50:3.50; 100:3.00" => a partir de 50 unidades R$3,50, a partir de 100 R$3,00
function precoProduto(produto, qtd) {
  if (!produto) return 0;
  let preco = Number(produto.preco) || 0;
  const faixas = String(produto.faixas || '').split(/[;\n]/).map(f => f.split(':').map(x => x.trim().replace(',', '.')))
    .filter(f => f.length === 2 && !isNaN(f[0]) && !isNaN(f[1]))
    .map(([min, p]) => ({ min: Number(min), p: Number(p) }))
    .sort((a, b) => a.min - b.min);
  for (const f of faixas) if (qtd >= f.min) preco = f.p;
  return preco;
}

function calcularItem(item) {
  const qtd = Math.max(0, Number(item.quantidade) || 0);
  if (!item.precoManual) {
    let unit = precoProduto(getProduto(item.produtoId), qtd);
    for (const aid of item.acabamentos || []) unit += precoProduto(getProduto(aid), qtd);
    item.precoUnit = arred(unit);
  }
  item.subtotal = arred(qtd * (Number(item.precoUnit) || 0));
  return item;
}

function descricaoItem(item) {
  const prod = getProduto(item.produtoId);
  const acab = (item.acabamentos || []).map(id => (getProduto(id) || {}).nome).filter(Boolean)
    .map(n => n.replace(/\s*\(.*\)/, ''));
  const partes = [];
  if (item.arquivo) partes.push(item.arquivo);
  partes.push(`${item.quantidade} ${prod ? prod.unidade + (item.quantidade == 1 ? '' : 's') : 'un'}`);
  partes.push(prod ? prod.nome.replace(/\s*\(.*\)/, '') : (item.materialTexto || 'material a definir'));
  let s = partes.join(' – ');
  if (acab.length) s += ' + ' + acab.join(' + ');
  return s;
}

function totalPedido(p) {
  return arred((p.itens || []).reduce((s, i) => s + (Number(i.subtotal) || 0), 0));
}

// ---------- cobranças ----------
function pagoCobranca(c) {
  return arred((c.pagamentos || []).reduce((s, p) => s + (Number(p.valor) || 0), 0));
}
function saldoCobranca(c) {
  return arred((Number(c.valor) || 0) - pagoCobranca(c));
}
function atualizarStatusCobranca(c) {
  if (c.status === 'cancelada') return c;
  const saldo = saldoCobranca(c);
  c.status = saldo <= 0.009 ? 'paga' : (pagoCobranca(c) > 0 ? 'parcial' : 'aberta');
  for (const pid of c.pedidoIds) {
    const p = getPedido(pid);
    if (p) p.pago = c.status === 'paga';
  }
  return c;
}
const cobrancaEmAberto = c => c.status === 'aberta' || c.status === 'parcial';
const cobrancaVencida = (c, hoje = hojeISO()) => cobrancaEmAberto(c) && c.vencimento < hoje;

function pedidoFaturavel(p) {
  return p.tipo === 'producao' && p.status !== 'cancelado' && !p.cobrancaId;
}

function criarCobranca(clienteId, pedidoIds, opts = {}) {
  const cliente = getCliente(clienteId);
  const pedidos = pedidoIds.map(getPedido).filter(Boolean);
  if (!pedidos.length) throw new Error('Nenhum pedido para cobrar.');
  const valor = arred(pedidos.reduce((s, p) => s + totalPedido(p), 0));
  const emissao = opts.emissao || hojeISO();
  const prazo = Number(cliente?.prazoDias ?? DB.config.prazoPadrao) || 0;
  DB.seq.cobranca += 1;
  const c = {
    id: uid('cob'),
    numero: 'C' + String(DB.seq.cobranca).padStart(4, '0'),
    clienteId,
    tipo: opts.tipo || 'pedido',
    periodoInicio: opts.periodoInicio || '',
    periodoFim: opts.periodoFim || '',
    pedidoIds: pedidos.map(p => p.id),
    valor,
    emissao,
    vencimento: opts.vencimento || somarDias(emissao, prazo),
    status: 'aberta',
    pagamentos: [],
    criadaEm: new Date().toISOString()
  };
  pedidos.forEach(p => { p.cobrancaId = c.id; });
  DB.cobrancas.push(c);
  return c;
}

function cancelarCobranca(c) {
  c.status = 'cancelada';
  c.pedidoIds.forEach(pid => {
    const p = getPedido(pid);
    if (p && p.cobrancaId === c.id) { p.cobrancaId = ''; p.pago = false; }
  });
}

function registrarPagamento(cobranca, pag) {
  cobranca.pagamentos.push({ id: uid('pg'), registradoEm: new Date().toISOString(), ...pag, valor: arred(pag.valor) });
  atualizarStatusCobranca(cobranca);
}

// Distribui um valor pago entre várias cobranças (mais antigas primeiro). Retorna o que sobrou.
function baixarValor(cobrancas, valor, dadosPag) {
  let resto = arred(valor);
  const ordenadas = [...cobrancas].sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  for (const c of ordenadas) {
    if (resto <= 0) break;
    const parte = Math.min(resto, saldoCobranca(c));
    if (parte <= 0) continue;
    registrarPagamento(c, { ...dadosPag, valor: parte });
    resto = arred(resto - parte);
  }
  return resto;
}

function pagamentoDuplicado(idTransacao) {
  if (!idTransacao) return null;
  const alvo = String(idTransacao).replace(/\s/g, '').toUpperCase();
  for (const c of DB.cobrancas) {
    for (const p of c.pagamentos || []) {
      if (p.idTransacao && String(p.idTransacao).replace(/\s/g, '').toUpperCase() === alvo) return c;
    }
  }
  return null;
}

// ---------- fechamentos ----------
const FECHAMENTOS = {
  avulso: 'Avulso (cobra cada pedido)',
  quinzenal: 'Quinzenal (1–15 / 16–fim)',
  mensal: 'Mensal',
  personalizado: 'Personalizado (a cada N dias)'
};

// Período completo mais recente que já terminou antes de "hoje".
function ultimoPeriodoFechado(cliente, hoje = hojeISO()) {
  const d = parseISO(hoje);
  const tipo = cliente.fechamento;
  if (tipo === 'quinzenal') {
    if (d.getDate() > 15) {
      return { inicio: dataISO(new Date(d.getFullYear(), d.getMonth(), 1)), fim: dataISO(new Date(d.getFullYear(), d.getMonth(), 15)) };
    }
    return { inicio: dataISO(new Date(d.getFullYear(), d.getMonth() - 1, 16)), fim: dataISO(new Date(d.getFullYear(), d.getMonth(), 0)) };
  }
  if (tipo === 'mensal') {
    return { inicio: dataISO(new Date(d.getFullYear(), d.getMonth() - 1, 1)), fim: dataISO(new Date(d.getFullYear(), d.getMonth(), 0)) };
  }
  if (tipo === 'personalizado') {
    const n = Math.max(1, Number(cliente.fechamentoDias) || 7);
    const base = cliente.fechamentoBase || '2026-01-01';
    const k = Math.floor(diasEntre(base, hoje) / n);
    const inicio = somarDias(base, (k - 1) * n);
    return { inicio, fim: somarDias(inicio, n - 1) };
  }
  return null;
}

function periodoAtual(cliente, hoje = hojeISO()) {
  const ult = ultimoPeriodoFechado(cliente, hoje);
  if (!ult) return null;
  const inicio = somarDias(ult.fim, 1);
  let fim;
  if (cliente.fechamento === 'quinzenal') {
    const d = parseISO(inicio);
    fim = d.getDate() === 1 ? dataISO(new Date(d.getFullYear(), d.getMonth(), 15)) : dataISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  } else if (cliente.fechamento === 'mensal') {
    const d = parseISO(inicio);
    fim = dataISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  } else {
    fim = somarDias(inicio, Math.max(1, Number(cliente.fechamentoDias) || 7) - 1);
  }
  return { inicio, fim };
}

function pedidosAFaturar(clienteId, ate = null, desde = null) {
  return DB.pedidos.filter(p => p.clienteId === clienteId && pedidoFaturavel(p)
    && (!ate || p.data <= ate) && (!desde || p.data >= desde))
    .sort((a, b) => a.data.localeCompare(b.data));
}

// Clientes com fechamento periódico cujo período já terminou e têm pedidos sem cobrança.
function fechamentosPendentes(hoje = hojeISO()) {
  const out = [];
  for (const c of DB.clientes) {
    if (!c.fechamento || c.fechamento === 'avulso') continue;
    const per = ultimoPeriodoFechado(c, hoje);
    if (!per) continue;
    const peds = pedidosAFaturar(c.id, per.fim);
    if (peds.length) out.push({ cliente: c, periodo: per, pedidos: peds, total: arred(peds.reduce((s, p) => s + totalPedido(p), 0)) });
  }
  return out;
}

// ---------- lista diária de devedores ----------
function gerarListaDevedores(hoje = hojeISO()) {
  const porCliente = {};
  for (const c of DB.cobrancas) {
    if (!cobrancaEmAberto(c)) continue;
    const g = porCliente[c.clienteId] ||= { clienteId: c.clienteId, nome: nomeCliente(c.clienteId), emAberto: 0, vencido: 0, maiorAtraso: 0, cobrancas: [], aFaturar: 0 };
    const saldo = saldoCobranca(c);
    g.emAberto = arred(g.emAberto + saldo);
    if (c.vencimento < hoje) {
      g.vencido = arred(g.vencido + saldo);
      g.maiorAtraso = Math.max(g.maiorAtraso, diasEntre(c.vencimento, hoje));
    }
    g.cobrancas.push({ id: c.id, numero: c.numero, vencimento: c.vencimento, saldo });
  }
  for (const p of DB.pedidos) {
    if (!pedidoFaturavel(p)) continue;
    const g = porCliente[p.clienteId] ||= { clienteId: p.clienteId, nome: nomeCliente(p.clienteId), emAberto: 0, vencido: 0, maiorAtraso: 0, cobrancas: [], aFaturar: 0 };
    g.aFaturar = arred(g.aFaturar + totalPedido(p));
  }
  const itens = Object.values(porCliente).sort((a, b) => b.vencido - a.vencido || b.emAberto - a.emAberto || b.aFaturar - a.aFaturar);
  return {
    data: hoje,
    geradaEm: new Date().toISOString(),
    itens,
    totalAberto: arred(itens.reduce((s, i) => s + i.emAberto, 0)),
    totalVencido: arred(itens.reduce((s, i) => s + i.vencido, 0)),
    totalAFaturar: arred(itens.reduce((s, i) => s + i.aFaturar, 0))
  };
}

// ---------- telefone / WhatsApp ----------
function telefoneWhats(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 11) d = '55' + d;
  return d;
}
function linkWhats(tel, texto) {
  const n = telefoneWhats(tel);
  return `https://wa.me/${n}?text=${encodeURIComponent(texto)}`;
}
