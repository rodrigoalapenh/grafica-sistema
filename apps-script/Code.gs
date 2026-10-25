/**
 * Backend opcional do Sistema Gráfica no Google Planilhas.
 *
 * - Guarda os dados do sistema (backup JSON no Google Drive) e monta abas legíveis na planilha.
 * - Todo dia de manhã gera a aba "Devedores" e envia a lista de cobrança por e-mail.
 *
 * Instalação: veja o README do repositório (seção "Planilha Google").
 */

// ======== CONFIGURE AQUI ========
const TOKEN = 'troque-por-uma-senha-longa';   // o mesmo valor do campo "Token secreto" no sistema
const EMAIL_LISTA = '';                        // e-mail que recebe a lista diária ('' = dono da planilha)
const HORA_LISTA = 7;                          // hora (0–23) da lista diária
// ================================

const ARQUIVO_DB = 'grafica-sistema-db.json';

function doGet() {
  return json_({ ok: true, msg: 'Sistema Gráfica – backend ativo' });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.token !== TOKEN) return json_({ ok: false, erro: 'Token inválido' });
    if (req.acao === 'salvar') {
      salvarDb_(req.db);
      escreverPlanilhas_(req.db);
      return json_({ ok: true });
    }
    if (req.acao === 'carregar') {
      return json_({ ok: true, db: carregarDb_() });
    }
    return json_({ ok: false, erro: 'Ação desconhecida' });
  } catch (err) {
    return json_({ ok: false, erro: String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- armazenamento ----------
function arquivoDb_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('DB_FILE_ID');
  if (id) {
    try { return DriveApp.getFileById(id); } catch (e) { /* arquivo apagado: cria outro */ }
  }
  const f = DriveApp.createFile(ARQUIVO_DB, '{}', 'application/json');
  props.setProperty('DB_FILE_ID', f.getId());
  return f;
}

function salvarDb_(db) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    arquivoDb_().setContent(JSON.stringify(db));
  } finally {
    lock.releaseLock();
  }
}

function carregarDb_() {
  const txt = arquivoDb_().getBlob().getDataAsString();
  const db = JSON.parse(txt || '{}');
  return db.clientes ? db : null;
}

// ---------- abas da planilha ----------
function aba_(nome, cabecalho) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(nome) || ss.insertSheet(nome);
  sh.clearContents();
  sh.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]).setFontWeight('bold').setBackground('#e8eaf6');
  sh.setFrozenRows(1);
  return sh;
}

function gravar_(sh, linhas) {
  if (linhas.length) sh.getRange(2, 1, linhas.length, linhas[0].length).setValues(linhas);
  sh.autoResizeColumns(1, sh.getLastColumn());
}

function escreverPlanilhas_(db) {
  const cli = {};
  db.clientes.forEach(c => { cli[c.id] = c; });
  const prod = {};
  db.produtos.forEach(p => { prod[p.id] = p; });
  const cob = {};
  db.cobrancas.forEach(c => { cob[c.id] = c; });

  gravar_(aba_('Clientes', ['Nome', 'Apelidos', 'Telefone', 'E-mail', 'CPF/CNPJ', 'Fechamento', 'Dias (personalizado)', 'Prazo pagamento']),
    db.clientes.map(c => [c.nome, c.apelidos || '', c.telefone || '', c.email || '', c.documento || '', c.fechamento || 'avulso', c.fechamentoDias || '', c.prazoDias || 0]));

  const linhasPed = [];
  db.pedidos.forEach(p => p.itens.forEach(i => linhasPed.push([
    p.numero, p.data, (cli[p.clienteId] || {}).nome || '', p.tipo, p.status, i.arquivo || '', i.paginas, i.copias, i.quantidade,
    (prod[i.produtoId] || {}).nome || i.materialTexto || '', (i.acabamentos || []).map(a => (prod[a] || {}).nome || a).join(' + '),
    i.precoUnit, i.subtotal, (cob[p.cobrancaId] || {}).numero || 'a faturar', (cob[p.cobrancaId] || {}).status || ''
  ])));
  gravar_(aba_('Pedidos', ['Nº', 'Data', 'Cliente', 'Tipo', 'Status', 'Arquivo', 'Págs', 'Cópias', 'Qtd', 'Material', 'Acabamento', 'Unitário', 'Subtotal', 'Cobrança', 'Situação']), linhasPed);

  gravar_(aba_('Cobranças', ['Nº', 'Cliente', 'Tipo', 'Período', 'Emissão', 'Vencimento', 'Valor', 'Pago', 'Saldo', 'Status']),
    db.cobrancas.map(c => {
      const pago = pago_(c);
      return [c.numero, (cli[c.clienteId] || {}).nome || '', c.tipo, c.periodoInicio ? c.periodoInicio + ' a ' + c.periodoFim : '',
        c.emissao, c.vencimento, c.valor, pago, round_(c.valor - pago), c.status];
    }));

  const linhasPag = [];
  db.cobrancas.forEach(c => (c.pagamentos || []).forEach(p => linhasPag.push([
    p.data, c.numero, (cli[c.clienteId] || {}).nome || '', p.valor, p.meio || '', p.pagador || '', p.banco || '', p.idTransacao || '', p.origem || ''
  ])));
  gravar_(aba_('Pagamentos', ['Data', 'Cobrança', 'Cliente', 'Valor', 'Forma', 'Pagador', 'Banco', 'ID transação', 'Origem']), linhasPag);
}

function pago_(c) {
  return round_((c.pagamentos || []).reduce((s, p) => s + (Number(p.valor) || 0), 0));
}
function round_(v) { return Math.round(v * 100) / 100; }

// ---------- lista diária de devedores ----------
function rotinaDiaria() {
  const db = carregarDb_();
  if (!db) return;
  const tz = Session.getScriptTimeZone();
  const hoje = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const cli = {};
  db.clientes.forEach(c => { cli[c.id] = c; });

  const grupos = {};
  const g = id => grupos[id] = grupos[id] || { nome: (cli[id] || {}).nome || '?', telefone: (cli[id] || {}).telefone || '', aberto: 0, vencido: 0, atraso: 0, aFaturar: 0, nums: [] };
  db.cobrancas.forEach(c => {
    if (c.status !== 'aberta' && c.status !== 'parcial') return;
    const saldo = round_(c.valor - pago_(c));
    const x = g(c.clienteId);
    x.aberto = round_(x.aberto + saldo);
    x.nums.push(c.numero + ' venc. ' + c.vencimento.split('-').reverse().join('/'));
    if (c.vencimento < hoje) {
      x.vencido = round_(x.vencido + saldo);
      x.atraso = Math.max(x.atraso, Math.round((new Date(hoje) - new Date(c.vencimento)) / 86400000));
    }
  });
  db.pedidos.forEach(p => {
    if (p.tipo !== 'producao' || p.status === 'cancelado' || p.cobrancaId) return;
    const x = g(p.clienteId);
    x.aFaturar = round_(x.aFaturar + p.itens.reduce((s, i) => s + (Number(i.subtotal) || 0), 0));
  });
  const lista = Object.keys(grupos).map(k => grupos[k]).sort((a, b) => b.vencido - a.vencido || b.aberto - a.aberto);

  const sh = aba_('Devedores', ['Cliente', 'Telefone', 'Em aberto', 'Vencido', 'Dias de atraso', 'A faturar', 'Cobranças']);
  gravar_(sh, lista.map(x => [x.nome, x.telefone, x.aberto, x.vencido, x.atraso, x.aFaturar, x.nums.join(' | ')]));
  sh.getRange(1, 9).setValue('Gerada em ' + Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm'));

  const ss = SpreadsheetApp.getActive();
  const hist = ss.getSheetByName('Histórico Devedores') || ss.insertSheet('Histórico Devedores');
  if (hist.getLastRow() === 0) hist.appendRow(['Data', 'Cliente', 'Em aberto', 'Vencido', 'Dias de atraso', 'A faturar']);
  lista.forEach(x => hist.appendRow([hoje, x.nome, x.aberto, x.vencido, x.atraso, x.aFaturar]));

  const devedores = lista.filter(x => x.aberto > 0 || x.aFaturar > 0);
  if (!devedores.length) return;
  const brl = v => 'R$ ' + v.toFixed(2).replace('.', ',');
  const total = k => devedores.reduce((s, x) => s + x[k], 0);
  const corpo = ['Lista de cobrança – ' + hoje.split('-').reverse().join('/'), ''].concat(
    devedores.map(x => '• ' + x.nome + ': em aberto ' + brl(x.aberto) + (x.vencido ? ', VENCIDO ' + brl(x.vencido) + ' (' + x.atraso + ' dias)' : '') + (x.aFaturar ? ', a faturar ' + brl(x.aFaturar) : '')),
    ['', 'Total em aberto: ' + brl(total('aberto')) + ' | Vencido: ' + brl(total('vencido')) + ' | A faturar: ' + brl(total('aFaturar')), '', ss.getUrl()]
  ).join('\n');
  MailApp.sendEmail(EMAIL_LISTA || Session.getEffectiveUser().getEmail(), 'Lista de cobrança do dia – ' + hoje.split('-').reverse().join('/'), corpo);
}

/** Rode esta função UMA vez (menu Executar) para agendar a lista diária. */
function instalar() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'rotinaDiaria').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('rotinaDiaria').timeBased().everyDays(1).atHour(HORA_LISTA).create();
  arquivoDb_();
}
