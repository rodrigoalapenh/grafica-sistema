// Interface: navegação, leitura de prints, pedidos, cobranças, fechamentos, clientes e configurações.
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

let secaoAtual = 'painel';
let imagensPedido = [];
let imagensComprov = [];
let revisao = null;

// ---------- utilidades de interface ----------
function toast(msg, erro = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = erro ? 'err' : 'ok';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = ''; }, erro ? 6000 : 3000);
}

function abrirModal(titulo, html) {
  $('#modal-titulo').textContent = titulo;
  $('#modal-corpo').innerHTML = html;
  $('#modal').classList.add('open');
  return $('#modal-corpo');
}
function fecharModal() { $('#modal').classList.remove('open'); }

function mostrarSecao(sec) {
  secaoAtual = sec;
  $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.sec === sec));
  $$('.section').forEach(s => s.classList.toggle('active', s.id === sec));
  renderSecao(sec);
}

function renderSecao(sec = secaoAtual) {
  ({
    painel: renderPainel,
    novo: renderNovo,
    pedidos: renderPedidos,
    cobrancas: renderCobrancas,
    fechamentos: renderFechamentos,
    clientes: renderClientes,
    produtos: renderProdutos,
    config: renderConfig
  }[sec] || (() => {}))();
}

function opcoesClientes(selecionado = '', vazio = '— selecione —') {
  return `<option value="">${esc(vazio)}</option>` + [...DB.clientes].sort((a, b) => a.nome.localeCompare(b.nome))
    .map(c => `<option value="${c.id}" ${c.id === selecionado ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
}

function badgeCobranca(c) {
  if (cobrancaVencida(c)) return '<span class="badge b-vencida">vencida</span>';
  return `<span class="badge b-${c.status}">${c.status}</span>`;
}

function badgeFinanceiro(p) {
  if (p.tipo === 'orcamento') return '<span class="badge b-orc">orçamento</span>';
  if (p.status === 'cancelado') return '<span class="badge b-cancelado">cancelado</span>';
  const c = p.cobrancaId && getCobranca(p.cobrancaId);
  if (!c) return '<span class="badge b-afaturar">a faturar</span>';
  return `${badgeCobranca(c)} <small>${c.numero}</small>`;
}

function qrImg(texto) {
  if (!texto || typeof qrcode === 'undefined') return '';
  const qr = qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  return `<img alt="QR Code PIX" src="${qr.createDataURL(5, 2)}">`;
}

async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    toast('Copiado!');
  } catch {
    prompt('Copie o texto:', texto);
  }
}

// ---------- área de colar/arrastar imagens ----------
function configurarDropzone(zona, input, thumbs, lista, multiplo) {
  const adicionar = async (arquivos) => {
    for (const f of arquivos) {
      if (!f.type.startsWith('image/')) continue;
      const img = await imagemParaBase64(f);
      if (!multiplo) lista.length = 0;
      lista.push(img);
    }
    desenhar();
  };
  const desenhar = () => {
    thumbs.innerHTML = lista.map((im, i) => `<div class="t"><img src="${im.url}"><button data-i="${i}" title="Remover">×</button></div>`).join('');
  };
  thumbs.addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    e.stopPropagation();
    lista.splice(Number(b.dataset.i), 1);
    desenhar();
  });
  zona.addEventListener('click', e => { if (!e.target.closest('.thumbs')) input.click(); });
  input.addEventListener('change', () => { adicionar([...input.files]); input.value = ''; });
  zona.addEventListener('dragover', e => { e.preventDefault(); zona.classList.add('over'); });
  zona.addEventListener('dragleave', () => zona.classList.remove('over'));
  zona.addEventListener('drop', e => { e.preventDefault(); zona.classList.remove('over'); adicionar([...e.dataTransfer.files]); });
  return { adicionar, desenhar };
}

// ================= PAINEL =================
function renderPainel() {
  const hoje = hojeISO();
  const abertas = DB.cobrancas.filter(cobrancaEmAberto);
  const aReceber = arred(abertas.reduce((s, c) => s + saldoCobranca(c), 0));
  const vencido = arred(abertas.filter(c => c.vencimento < hoje).reduce((s, c) => s + saldoCobranca(c), 0));
  const aFaturar = arred(DB.pedidos.filter(pedidoFaturavel).reduce((s, p) => s + totalPedido(p), 0));
  const mes = hoje.slice(0, 7);
  const recebidoMes = arred(DB.cobrancas.flatMap(c => c.pagamentos || []).filter(p => (p.data || '').startsWith(mes)).reduce((s, p) => s + p.valor, 0));
  const emProducao = DB.pedidos.filter(p => p.tipo === 'producao' && p.status === 'Em produção').length;
  $('#stats').innerHTML = [
    [brl(aReceber), 'A receber (cobranças em aberto)'],
    [brl(vencido), 'Vencido', vencido > 0],
    [brl(aFaturar), 'A faturar (aguardando fechamento)'],
    [brl(recebidoMes), 'Recebido neste mês'],
    [emProducao, 'Pedidos em produção']
  ].map(([n, l, red]) => `<div class="stat"><div class="n ${red ? 'red' : ''}">${n}</div><div class="l">${l}</div></div>`).join('');

  $('#alertas-fechamento').innerHTML = fechamentosPendentes().map(f => `
    <div class="alerta">
      <div>⏰ <b>${esc(f.cliente.nome)}</b> – fechamento ${f.cliente.fechamento} de ${dataBR(f.periodo.inicio)} a ${dataBR(f.periodo.fim)}:
      ${f.pedidos.length} pedido(s), <b>${brl(f.total)}</b></div>
      <button class="btn btn-primary btn-sm" data-fechar="${f.cliente.id}" data-ini="${f.periodo.inicio}" data-fim="${f.periodo.fim}">Fazer fechamento</button>
    </div>`).join('');

  const lista = DB.listas[hoje];
  $('#lista-data').textContent = lista ? `– gerada em ${new Date(lista.geradaEm).toLocaleString('pt-BR').slice(0, 17)}` : '';
  if (!lista) {
    $('#lista-devedores').innerHTML = `<div class="vazio">A lista de hoje será gerada às ${DB.config.horaLista}. Clique em "Atualizar agora" para gerar já.</div>`;
    return;
  }
  if (!lista.itens.length) {
    $('#lista-devedores').innerHTML = '<div class="vazio">🎉 Nenhum cliente devendo.</div>';
    return;
  }
  $('#lista-devedores').innerHTML = `
    <p class="hint">Em aberto: <b>${brl(lista.totalAberto)}</b> · Vencido: <b style="color:var(--vermelho)">${brl(lista.totalVencido)}</b> · A faturar: <b>${brl(lista.totalAFaturar)}</b></p>
    ${lista.itens.map(i => {
      const cli = getCliente(i.clienteId);
      const saldoAgora = arred(DB.cobrancas.filter(c => c.clienteId === i.clienteId && cobrancaEmAberto(c)).reduce((s, c) => s + saldoCobranca(c), 0));
      const quitado = i.emAberto > 0 && saldoAgora <= 0;
      return `<div class="devedor">
        <div class="info"><b>${esc(i.nome)}</b> ${quitado ? '<span class="badge b-paga">pago desde a lista</span>' : ''}
          <small>${i.emAberto ? `Em aberto ${brl(i.emAberto)}` : ''}${i.vencido ? ` · <span style="color:var(--vermelho)">vencido ${brl(i.vencido)} (${i.maiorAtraso} dia(s) de atraso)</span>` : ''}${i.aFaturar ? ` · a faturar ${brl(i.aFaturar)}` : ''}</small>
          <small>${i.cobrancas.map(c => `${c.numero} venc. ${dataCurta(c.vencimento)} ${brl(c.saldo)}`).join(' · ')}</small>
        </div>
        <div class="actions">
          ${saldoAgora > 0 ? `<button class="btn btn-whats btn-sm" data-lembrete="${i.clienteId}">Lembrete WhatsApp</button>` : ''}
          ${cli ? `<button class="btn btn-light btn-sm" data-extrato="${i.clienteId}">Extrato</button>` : ''}
        </div>
      </div>`;
    }).join('')}`;
}

function textoListaDevedores(lista) {
  const linhas = [`*Lista de cobrança – ${dataBR(lista.data)}*`, ''];
  for (const i of lista.itens) {
    let l = `• ${i.nome}: `;
    const partes = [];
    if (i.emAberto) partes.push(`em aberto ${brl(i.emAberto)}`);
    if (i.vencido) partes.push(`vencido ${brl(i.vencido)} (${i.maiorAtraso}d)`);
    if (i.aFaturar) partes.push(`a faturar ${brl(i.aFaturar)}`);
    linhas.push(l + partes.join(', '));
  }
  linhas.push('', `Total em aberto: ${brl(lista.totalAberto)} | Vencido: ${brl(lista.totalVencido)} | A faturar: ${brl(lista.totalAFaturar)}`);
  return linhas.join('\n');
}

function gerarListaDoDia(forcar = false) {
  const hoje = hojeISO();
  if (DB.listas[hoje] && !forcar) return false;
  DB.listas[hoje] = gerarListaDevedores(hoje);
  const datas = Object.keys(DB.listas).sort();
  while (datas.length > 60) delete DB.listas[datas.shift()];
  salvarDB();
  return true;
}

function verificarListaDiaria() {
  const agora = new Date();
  const hhmm = agora.toTimeString().slice(0, 5);
  if (hhmm >= (DB.config.horaLista || '08:00') && gerarListaDoDia()) {
    toast('📋 Lista de cobrança do dia gerada');
    if (secaoAtual === 'painel') renderPainel();
  }
}

function mensagemLembrete(clienteId) {
  const cli = getCliente(clienteId);
  const abertas = DB.cobrancas.filter(c => c.clienteId === clienteId && cobrancaEmAberto(c)).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  const total = arred(abertas.reduce((s, c) => s + saldoCobranca(c), 0));
  const pix = gerarPix({ chave: DB.config.pixChave, nome: DB.config.pixNome || DB.config.empresa, cidade: DB.config.pixCidade, valor: total, txid: 'ABERTO' });
  const linhas = [
    `Olá, ${cli ? cli.nome : ''}! Tudo bem?`,
    `Passando para lembrar dos valores em aberto com a ${DB.config.empresa}:`,
    '',
    ...abertas.map(c => `• ${c.numero} – venc. ${dataBR(c.vencimento)} – ${brl(saldoCobranca(c))}${c.vencimento < hojeISO() ? ' (vencida)' : ''}`),
    '',
    `*Total: ${brl(total)}*`
  ];
  if (pix) linhas.push('', 'PIX copia e cola:', pix);
  linhas.push('', 'Se já pagou, por favor envie o comprovante. Obrigado!');
  return { texto: linhas.join('\n'), pix, total, cli };
}

function abrirLembrete(clienteId) {
  const { texto, pix, cli } = mensagemLembrete(clienteId);
  const corpo = abrirModal('Lembrete de cobrança', `
    <textarea class="msg-box" id="msg-txt">${esc(texto)}</textarea>
    ${pix ? `<div class="qr">${qrImg(pix)}</div>` : '<p class="hint">Cadastre a chave PIX em Configurações para incluir o PIX.</p>'}
    <div class="actions">
      <button class="btn btn-light" id="m-copiar">Copiar mensagem</button>
      ${cli?.telefone ? `<a class="btn btn-whats" id="m-whats" target="_blank" rel="noopener">Abrir no WhatsApp</a>` : '<span class="hint">Cadastre o telefone do cliente para enviar direto pelo WhatsApp.</span>'}
    </div>`);
  const atualizarLink = () => { const a = $('#m-whats', corpo); if (a) a.href = linkWhats(cli.telefone, $('#msg-txt', corpo).value); };
  atualizarLink();
  $('#msg-txt', corpo).addEventListener('input', atualizarLink);
  $('#m-copiar', corpo).onclick = () => copiar($('#msg-txt', corpo).value);
}

function abrirExtrato(clienteId) {
  const cli = getCliente(clienteId);
  const peds = DB.pedidos.filter(p => p.clienteId === clienteId).sort((a, b) => b.data.localeCompare(a.data));
  const cobs = DB.cobrancas.filter(c => c.clienteId === clienteId).sort((a, b) => b.emissao.localeCompare(a.emissao));
  abrirModal('Extrato – ' + cli.nome, `
    <h4>Cobranças</h4>
    <div class="table-wrap"><table><thead><tr><th>Nº</th><th>Venc.</th><th class="num">Valor</th><th class="num">Saldo</th><th>Status</th></tr></thead><tbody>
    ${cobs.map(c => `<tr><td>${c.numero}</td><td>${dataBR(c.vencimento)}</td><td class="num">${brl(c.valor)}</td><td class="num">${brl(saldoCobranca(c))}</td><td>${badgeCobranca(c)}</td></tr>`).join('') || '<tr><td colspan="5" class="vazio">Nenhuma</td></tr>'}
    </tbody></table></div>
    <h4 style="margin-top:14px">Pedidos</h4>
    <div class="table-wrap"><table><thead><tr><th>Nº</th><th>Data</th><th>Itens</th><th class="num">Total</th><th></th></tr></thead><tbody>
    ${peds.map(p => `<tr><td>${p.numero}</td><td>${dataBR(p.data)}</td><td>${p.itens.map(i => esc(descricaoItem(i))).join('<br>')}</td><td class="num">${brl(totalPedido(p))}</td><td>${badgeFinanceiro(p)}</td></tr>`).join('') || '<tr><td colspan="5" class="vazio">Nenhum</td></tr>'}
    </tbody></table></div>`);
}

// ================= LER PRINT / NOVO PEDIDO =================
function renderNovo() {
  if (!$('#data-print').value) $('#data-print').value = hojeISO();
  const sel = $('#cliente-print').value;
  $('#cliente-print').innerHTML = opcoesClientes(sel, 'Deixar a IA identificar');
}

async function lerPrint() {
  if (!imagensPedido.length) return toast('Cole ou escolha o print primeiro.', true);
  const btn = $('#btn-ler-print');
  btn.disabled = true;
  $('#revisao').innerHTML = '<div class="card loading">🤖 Lendo o print... (leva alguns segundos)</div>';
  try {
    const res = await lerPrintPedido(imagensPedido, $('#data-print').value || hojeISO());
    const forcado = $('#cliente-print').value;
    if (forcado) res.cliente_id = forcado;
    montarRevisao(res);
  } catch (e) {
    console.error(e);
    $('#revisao').innerHTML = '';
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

function itemVazio(base = {}) {
  return calcularItem({
    incluir: true, arquivo: '', paginas: 1, copias: 1, quantidade: 1, produtoId: '', acabamentos: [],
    materialTexto: '', acabamentoTexto: '', observacoes: '', confianca: 'alta', precoUnit: 0, precoManual: false, ...base
  });
}

function montarRevisao(res) {
  let cliente = (res.cliente_id && getCliente(res.cliente_id)) || encontrarClientePorNome(res.cliente_nome);
  const grupos = {};
  for (const it of res.itens || []) {
    const data = /^\d{4}-\d{2}-\d{2}$/.test(it.data) ? it.data : ($('#data-print').value || hojeISO());
    const tipo = it.tipo === 'orcamento' ? 'orcamento' : 'producao';
    const chave = data + '|' + tipo;
    grupos[chave] ||= { data, tipo, itens: [] };
    const acabs = (it.acabamentos_ids || []).filter(id => getProduto(id));
    const item = itemVazio({
      arquivo: it.arquivo, paginas: it.paginas || 1, copias: it.copias || 1,
      quantidade: it.quantidade || (it.paginas || 1) * (it.copias || 1),
      produtoId: getProduto(it.produto_id) ? it.produto_id : '', acabamentos: acabs,
      materialTexto: it.material_texto, acabamentoTexto: it.acabamento_texto,
      observacoes: [it.hora ? 'msg ' + it.hora : '', it.observacoes].filter(Boolean).join(' – '),
      confianca: it.confianca
    });
    grupos[chave].itens.push(item);
  }
  if (!Object.keys(grupos).length) {
    grupos.x = { data: $('#data-print').value || hojeISO(), tipo: 'producao', itens: [itemVazio()] };
  }
  revisao = {
    clienteId: cliente ? cliente.id : '',
    novoNome: cliente ? '' : (res.cliente_nome || ''),
    telefone: res.cliente_telefone || '',
    prazo: res.prazo_entrega || '',
    obs: res.observacoes_gerais || '',
    grupos: Object.values(grupos).sort((a, b) => a.data.localeCompare(b.data))
  };
  marcarDuplicados();
  renderRevisao();
}

function marcarDuplicados() {
  if (!revisao.clienteId) return;
  for (const g of revisao.grupos) {
    for (const it of g.itens) {
      if (!it.arquivo) continue;
      const dup = DB.pedidos.find(p => p.clienteId === revisao.clienteId && p.data === g.data
        && p.itens.some(i => semAcento(i.arquivo) === semAcento(it.arquivo)));
      it.duplicado = dup ? dup.numero : '';
      if (dup) it.incluir = false;
    }
  }
}

function linhaItemEditor(it, gi, ii, comIncluir = true) {
  const materiais = DB.produtos.filter(p => p.categoria !== 'Acabamento');
  const acabamentos = DB.produtos.filter(p => p.categoria === 'Acabamento');
  return `<tr class="${it.duplicado ? 'dup' : ''}" data-g="${gi}" data-i="${ii}">
    ${comIncluir ? `<td><input type="checkbox" data-f="incluir" ${it.incluir ? 'checked' : ''}></td>` : ''}
    <td><input data-f="arquivo" value="${esc(it.arquivo)}" placeholder="arquivo/descrição">
      ${it.duplicado ? `<small style="color:var(--laranja)">⚠ parece já lançado no pedido ${it.duplicado}</small>` : ''}
      ${it.observacoes ? `<small class="hint">${esc(it.observacoes)}</small>` : ''}</td>
    <td><input class="n" type="number" min="1" data-f="paginas" value="${it.paginas}"></td>
    <td><input class="n" type="number" min="1" data-f="copias" value="${it.copias}"></td>
    <td><input class="n" type="number" min="0" data-f="quantidade" value="${it.quantidade}"></td>
    <td><select data-f="produtoId"><option value="">${it.materialTexto ? '❓ ' + esc(it.materialTexto) : '— material —'}</option>
      ${materiais.map(p => `<option value="${p.id}" ${p.id === it.produtoId ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select>
      ${it.confianca === 'baixa' ? '<span class="badge b-baixa">conferir</span>' : ''}</td>
    <td><div class="acab">${acabamentos.map(a => `<label><input type="checkbox" data-acab="${a.id}" ${it.acabamentos.includes(a.id) ? 'checked' : ''}>${esc(a.nome.replace(/\s*\(.*\)/, ''))}</label>`).join('')}</div></td>
    <td><input class="n" type="number" step="0.01" min="0" data-f="precoUnit" value="${it.precoUnit}" title="Preço unitário (edite para preço especial)"></td>
    <td class="num"><b>${brl(it.subtotal)}</b></td>
    ${comIncluir ? '' : `<td><button class="btn btn-danger btn-sm" data-rm="1">×</button></td>`}
  </tr>`;
}

function cabecalhoItens(comIncluir = true) {
  return `<thead><tr>${comIncluir ? '<th>✓</th>' : ''}<th>Arquivo</th><th>Págs</th><th>Cópias</th><th>Qtd cobrada</th><th>Material</th><th>Acabamento</th><th>Unit.</th><th class="num">Subtotal</th>${comIncluir ? '' : '<th></th>'}</tr></thead>`;
}

// Liga os eventos de uma tabela de itens; "obter(gi, ii)" devolve o objeto item correspondente.
function ligarEditorItens(raiz, obter, aoMudar) {
  raiz.addEventListener('change', e => {
    const tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    const it = obter(Number(tr.dataset.g), Number(tr.dataset.i));
    const f = e.target.dataset.f;
    if (e.target.dataset.acab) {
      const id = e.target.dataset.acab;
      it.acabamentos = e.target.checked ? [...new Set([...it.acabamentos, id])] : it.acabamentos.filter(x => x !== id);
      it.precoManual = false;
    } else if (f === 'incluir') {
      it.incluir = e.target.checked;
    } else if (f === 'precoUnit') {
      it.precoUnit = Number(e.target.value) || 0;
      it.precoManual = true;
    } else if (f === 'paginas' || f === 'copias') {
      it[f] = Math.max(1, Number(e.target.value) || 1);
      it.quantidade = it.paginas * it.copias;
    } else if (f === 'quantidade') {
      it.quantidade = Math.max(0, Number(e.target.value) || 0);
    } else if (f === 'produtoId') {
      it.produtoId = e.target.value;
      it.precoManual = false;
    } else if (f) {
      it[f] = e.target.value;
    }
    calcularItem(it);
    aoMudar();
  });
}

function renderRevisao() {
  const r = revisao;
  const cli = getCliente(r.clienteId);
  const avulso = !cli || !cli.fechamento || cli.fechamento === 'avulso';
  const totalGeral = arred(r.grupos.flatMap(g => g.itens.filter(i => i.incluir)).reduce((s, i) => s + i.subtotal, 0));
  const temProducao = r.grupos.some(g => g.tipo === 'producao' && g.itens.some(i => i.incluir));
  if (r.gerarCobranca === undefined) r.gerarCobranca = avulso;
  $('#revisao').innerHTML = `
    <div class="card">
      <h3>2. Confira e ajuste</h3>
      <div class="form-grid">
        <div class="form-group"><label>Cliente</label>
          <select id="rv-cliente">${opcoesClientes(r.clienteId, r.novoNome ? `➕ Cadastrar novo: ${r.novoNome}` : '— selecione —')}</select>
        </div>
        ${!r.clienteId ? `<div class="form-group"><label>Nome do novo cliente</label><input id="rv-novo" value="${esc(r.novoNome)}"></div>
          <div class="form-group"><label>Telefone (WhatsApp)</label><input id="rv-tel" value="${esc(r.telefone)}" placeholder="(11) 99999-9999"></div>` : ''}
        <div class="form-group"><label>Prazo de entrega</label><input id="rv-prazo" value="${esc(r.prazo)}"></div>
        <div class="form-group"><label>Observações</label><input id="rv-obs" value="${esc(r.obs)}"></div>
      </div>
      ${cli ? `<p class="hint" style="margin-top:8px">Fechamento do cliente: <b>${FECHAMENTOS[cli.fechamento || 'avulso']}</b>${!avulso ? ' – os pedidos ficam "a faturar" até o fechamento.' : ''}</p>` : ''}
      <div id="rv-grupos" style="margin-top:12px">
        ${r.grupos.map((g, gi) => `
          <div class="grupo">
            <div class="actions" style="margin-bottom:8px">
              <label>Data do pedido</label><input type="date" data-gdata="${gi}" value="${g.data}">
              <label>Tipo</label><select data-gtipo="${gi}">
                <option value="producao" ${g.tipo === 'producao' ? 'selected' : ''}>Produção</option>
                <option value="orcamento" ${g.tipo === 'orcamento' ? 'selected' : ''}>Orçamento</option>
              </select>
              <button class="btn btn-light btn-sm" data-additem="${gi}">+ item</button>
            </div>
            <div class="table-wrap"><table class="itens-edit">${cabecalhoItens()}<tbody>
              ${g.itens.map((it, ii) => linhaItemEditor(it, gi, ii)).join('')}
            </tbody></table></div>
          </div>`).join('')}
      </div>
      <div class="total-linha">Total: ${brl(totalGeral)}</div>
      ${temProducao ? `<label style="display:flex;gap:6px;align-items:center;margin-bottom:10px">
        <input type="checkbox" id="rv-cobrar" ${r.gerarCobranca ? 'checked' : ''}> Gerar cobrança agora ${!avulso ? '(cliente tem fechamento periódico – normalmente deixe desmarcado)' : ''}</label>` : ''}
      <div class="actions">
        <button class="btn btn-success" id="rv-salvar">💾 Salvar pedido</button>
        <button class="btn btn-light" id="rv-cancelar">Descartar</button>
      </div>
    </div>`;

  const raiz = $('#revisao');
  $('#rv-cliente').onchange = e => {
    r.clienteId = e.target.value;
    r.gerarCobranca = undefined;
    marcarDuplicados();
    renderRevisao();
  };
  const ligar = (sel, campo) => { const el = $(sel); if (el) el.oninput = () => { r[campo] = el.value; }; };
  ligar('#rv-novo', 'novoNome'); ligar('#rv-tel', 'telefone'); ligar('#rv-prazo', 'prazo'); ligar('#rv-obs', 'obs');
  const chk = $('#rv-cobrar');
  if (chk) chk.onchange = () => { r.gerarCobranca = chk.checked; };
  $$('[data-gdata]', raiz).forEach(el => el.onchange = () => { r.grupos[el.dataset.gdata].data = el.value; marcarDuplicados(); renderRevisao(); });
  $$('[data-gtipo]', raiz).forEach(el => el.onchange = () => { r.grupos[el.dataset.gtipo].tipo = el.value; renderRevisao(); });
  $$('[data-additem]', raiz).forEach(el => el.onclick = () => { r.grupos[el.dataset.additem].itens.push(itemVazio()); renderRevisao(); });
  ligarEditorItens($('#rv-grupos'), (gi, ii) => r.grupos[gi].itens[ii], renderRevisao);
  $('#rv-salvar').onclick = salvarRevisao;
  $('#rv-cancelar').onclick = () => { revisao = null; $('#revisao').innerHTML = ''; };
}

function salvarRevisao() {
  const r = revisao;
  let cliente = getCliente(r.clienteId);
  if (!cliente) {
    const nome = (r.novoNome || '').trim();
    if (!nome) return toast('Informe o cliente.', true);
    cliente = { id: uid('cli'), nome, apelidos: nome, telefone: r.telefone || '', email: '', documento: '', fechamento: 'avulso', fechamentoDias: 7, fechamentoBase: hojeISO(), prazoDias: Number(DB.config.prazoPadrao) || 0, obs: '' };
    DB.clientes.push(cliente);
  }
  const criados = [];
  for (const g of r.grupos) {
    const itens = g.itens.filter(i => i.incluir && i.quantidade > 0);
    if (!itens.length) continue;
    const semPreco = itens.find(i => !i.precoUnit);
    if (semPreco && !confirm(`O item "${semPreco.arquivo || 'sem nome'}" está sem preço. Salvar mesmo assim?`)) return;
    DB.seq.pedido += 1;
    const p = {
      id: uid('ped'),
      numero: '#' + String(DB.seq.pedido).padStart(4, '0'),
      clienteId: cliente.id,
      data: g.data,
      tipo: g.tipo,
      status: g.tipo === 'orcamento' ? 'Orçamento' : 'Em produção',
      prazo: r.prazo,
      obs: r.obs,
      itens: itens.map(({ incluir, duplicado, ...resto }) => ({ ...resto })),
      cobrancaId: '',
      pago: false,
      criadoEm: new Date().toISOString()
    };
    DB.pedidos.push(p);
    criados.push(p);
  }
  if (!criados.length) return toast('Nenhum item selecionado.', true);
  let cob = null;
  const producao = criados.filter(p => p.tipo === 'producao');
  if (r.gerarCobranca && producao.length) {
    cob = criarCobranca(cliente.id, producao.map(p => p.id));
  }
  salvarDB();
  revisao = null;
  imagensPedido.length = 0;
  dzPedido.desenhar();
  $('#revisao').innerHTML = '';
  toast(`${criados.length} pedido(s) salvo(s): ${criados.map(p => p.numero).join(', ')}`);
  if (cob) abrirCobranca(cob.id);
  else if (criados.some(p => p.tipo === 'orcamento')) abrirOrcamento(criados.find(p => p.tipo === 'orcamento').id);
}

// ================= PEDIDOS =================
function renderPedidos() {
  const busca = semAcento($('#busca-pedido').value);
  const tipo = $('#filtro-tipo').value;
  const st = $('#filtro-status-pedido').value;
  const fat = $('#filtro-fat').value;
  const lista = DB.pedidos.filter(p => {
    if (tipo && p.tipo !== tipo) return false;
    if (st && p.status !== st) return false;
    const c = p.cobrancaId && getCobranca(p.cobrancaId);
    if (fat === 'afaturar' && !pedidoFaturavel(p)) return false;
    if (fat === 'aberto' && !(c && cobrancaEmAberto(c))) return false;
    if (fat === 'pago' && !(c && c.status === 'paga')) return false;
    if (busca) {
      const txt = semAcento([p.numero, nomeCliente(p.clienteId), ...p.itens.map(i => i.arquivo)].join(' '));
      if (!txt.includes(busca)) return false;
    }
    return true;
  }).sort((a, b) => b.data.localeCompare(a.data) || b.numero.localeCompare(a.numero));
  $('#tb-pedidos').innerHTML = lista.map(p => `<tr>
    <td>${p.numero}</td>
    <td>${dataBR(p.data)}</td>
    <td>${esc(nomeCliente(p.clienteId))}</td>
    <td>${p.itens.map(i => esc(descricaoItem(i))).join('<br>')}${p.prazo ? `<br><small class="hint">Prazo: ${esc(p.prazo)}</small>` : ''}</td>
    <td class="num">${brl(totalPedido(p))}</td>
    <td>${p.tipo === 'orcamento' ? 'Orçamento' : `<select data-status="${p.id}">
      ${['Em produção', 'Pronto', 'Entregue', 'cancelado'].map(s => `<option ${s === p.status ? 'selected' : ''}>${s}</option>`).join('')}</select>`}</td>
    <td>${badgeFinanceiro(p)}</td>
    <td><div class="actions">
      <button class="btn btn-light btn-sm" data-editar="${p.id}">Editar</button>
      ${p.tipo === 'orcamento' ? `<button class="btn btn-light btn-sm" data-orc="${p.id}">Enviar</button><button class="btn btn-success btn-sm" data-aprovar="${p.id}">Aprovar</button>` : ''}
      ${pedidoFaturavel(p) ? `<button class="btn btn-primary btn-sm" data-cobrar="${p.id}">Cobrar</button>` : ''}
      ${p.cobrancaId ? `<button class="btn btn-light btn-sm" data-vercob="${p.cobrancaId}">Cobrança</button>` : ''}
    </div></td>
  </tr>`).join('') || '<tr><td colspan="8" class="vazio">Nenhum pedido.</td></tr>';
}

function editarPedido(id) {
  const p = getPedido(id);
  const copia = JSON.parse(JSON.stringify(p.itens));
  const travado = p.cobrancaId && getCobranca(p.cobrancaId) && getCobranca(p.cobrancaId).status !== 'aberta';
  // Div própria para não acumular ouvintes no corpo do modal entre aberturas.
  const corpo = abrirModal(`Pedido ${p.numero}`, '<div></div>').firstElementChild;
  const desenhar = () => {
    const total = arred(copia.reduce((s, i) => s + (i.subtotal || 0), 0));
    corpo.innerHTML = `
      <div class="form-grid">
        <div class="form-group"><label>Cliente</label><select id="ep-cli">${opcoesClientes(p.clienteId)}</select></div>
        <div class="form-group"><label>Data</label><input type="date" id="ep-data" value="${p.data}"></div>
        <div class="form-group"><label>Prazo</label><input id="ep-prazo" value="${esc(p.prazo || '')}"></div>
      </div>
      <div class="table-wrap" style="margin-top:10px"><table class="itens-edit">${cabecalhoItens(false)}<tbody>
        ${copia.map((it, ii) => linhaItemEditor(it, 0, ii, false)).join('')}
      </tbody></table></div>
      <button class="btn btn-light btn-sm" id="ep-add" style="margin-top:6px">+ item</button>
      <div class="total-linha">Total: ${brl(total)}</div>
      ${travado ? '<p class="hint">⚠ Este pedido já tem pagamento registrado; alterações mudam o valor da cobrança.</p>' : ''}
      <div class="actions">
        <button class="btn btn-success" id="ep-salvar">Salvar</button>
        <button class="btn btn-danger" id="ep-excluir">Excluir pedido</button>
      </div>`;
    $('#ep-add', corpo).onclick = () => { copia.push(itemVazio()); desenhar(); };
    $$('[data-rm]', corpo).forEach(b => b.onclick = () => { copia.splice(Number(b.closest('tr').dataset.i), 1); desenhar(); });
    $('#ep-salvar', corpo).onclick = () => {
      p.clienteId = $('#ep-cli', corpo).value || p.clienteId;
      p.data = $('#ep-data', corpo).value || p.data;
      p.prazo = $('#ep-prazo', corpo).value;
      p.itens = copia.map(({ incluir, duplicado, ...resto }) => resto);
      recalcularCobrancaDoPedido(p);
      salvarDB();
      fecharModal();
      renderSecao();
      toast('Pedido atualizado');
    };
    $('#ep-excluir', corpo).onclick = () => {
      if (!confirm(`Excluir o pedido ${p.numero}?`)) return;
      const c = p.cobrancaId && getCobranca(p.cobrancaId);
      if (c) {
        c.pedidoIds = c.pedidoIds.filter(x => x !== p.id);
        if (!c.pedidoIds.length && !(c.pagamentos || []).length) DB.cobrancas = DB.cobrancas.filter(x => x !== c);
        else recalcularValorCobranca(c);
      }
      DB.pedidos = DB.pedidos.filter(x => x !== p);
      salvarDB();
      fecharModal();
      renderSecao();
    };
  };
  ligarEditorItens(corpo, (gi, ii) => copia[ii], desenhar);
  desenhar();
}

function recalcularValorCobranca(c) {
  c.valor = arred(c.pedidoIds.map(getPedido).filter(Boolean).reduce((s, p) => s + totalPedido(p), 0));
  atualizarStatusCobranca(c);
}
function recalcularCobrancaDoPedido(p) {
  const c = p.cobrancaId && getCobranca(p.cobrancaId);
  if (c) recalcularValorCobranca(c);
}

function mensagemOrcamento(p) {
  const cli = getCliente(p.clienteId);
  return [
    `Olá, ${cli ? cli.nome : ''}! Segue o orçamento da ${DB.config.empresa}:`,
    '',
    ...p.itens.map(i => `• ${descricaoItem(i)} – ${brl(i.subtotal)}`),
    '',
    `*Total: ${brl(totalPedido(p))}*`,
    p.prazo ? `Prazo: ${p.prazo}` : '',
    '',
    'Podemos seguir com a produção?'
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

function abrirOrcamento(id) {
  const p = getPedido(id);
  const cli = getCliente(p.clienteId);
  const corpo = abrirModal(`Orçamento ${p.numero}`, `
    <textarea class="msg-box" id="msg-txt">${esc(mensagemOrcamento(p))}</textarea>
    <div class="actions" style="margin-top:8px">
      <button class="btn btn-light" id="m-copiar">Copiar</button>
      ${cli?.telefone ? `<a class="btn btn-whats" id="m-whats" target="_blank" rel="noopener">Abrir no WhatsApp</a>` : ''}
    </div>`);
  const link = () => { const a = $('#m-whats', corpo); if (a) a.href = linkWhats(cli.telefone, $('#msg-txt', corpo).value); };
  link();
  $('#msg-txt', corpo).oninput = link;
  $('#m-copiar', corpo).onclick = () => copiar($('#msg-txt', corpo).value);
}

function aprovarOrcamento(id) {
  const p = getPedido(id);
  p.tipo = 'producao';
  p.status = 'Em produção';
  const cli = getCliente(p.clienteId);
  let cob = null;
  if ((!cli || !cli.fechamento || cli.fechamento === 'avulso') && confirm('Orçamento aprovado. Gerar a cobrança agora?')) {
    cob = criarCobranca(p.clienteId, [p.id]);
  }
  salvarDB();
  renderSecao();
  if (cob) abrirCobranca(cob.id);
}

// ================= COBRANÇAS =================
function mensagemCobranca(c) {
  const cli = getCliente(c.clienteId);
  const pix = pixDaCobranca(c);
  const pedidos = c.pedidoIds.map(getPedido).filter(Boolean);
  const linhas = [
    `Olá, ${cli ? cli.nome : ''}! Segue a cobrança ${c.numero} da ${DB.config.empresa}${c.tipo === 'fechamento' ? ` – fechamento de ${dataBR(c.periodoInicio)} a ${dataBR(c.periodoFim)}` : ''}:`,
    ''
  ];
  for (const p of pedidos) for (const i of p.itens) linhas.push(`• ${dataCurta(p.data)} – ${descricaoItem(i)} – ${brl(i.subtotal)}`);
  linhas.push('', `*Total: ${brl(c.valor)}*`);
  const pago = pagoCobranca(c);
  if (pago > 0) linhas.push(`Já pago: ${brl(pago)} · *Saldo: ${brl(saldoCobranca(c))}*`);
  linhas.push(`Vencimento: ${dataBR(c.vencimento)}`);
  if (pix) linhas.push('', 'PIX copia e cola:', pix);
  linhas.push('', 'Após o pagamento, envie o comprovante por aqui. Obrigado!');
  return linhas.join('\n');
}

function abrirCobranca(id) {
  const c = getCobranca(id);
  const cli = getCliente(c.clienteId);
  const pix = pixDaCobranca(c);
  const corpo = abrirModal(`Cobrança ${c.numero} – ${cli ? cli.nome : ''}`, `
    <p>Valor: <b>${brl(c.valor)}</b> · Saldo: <b>${brl(saldoCobranca(c))}</b> · Vencimento: <b>${dataBR(c.vencimento)}</b> ${badgeCobranca(c)}</p>
    ${pix ? `<div class="qr">${qrImg(pix)}</div>` : '<p class="hint">⚠ Cadastre sua chave PIX em Configurações para gerar o QR Code e o copia e cola.</p>'}
    <textarea class="msg-box" id="msg-txt">${esc(mensagemCobranca(c))}</textarea>
    <div class="actions" style="margin-top:8px">
      <button class="btn btn-light" id="m-copiar">Copiar mensagem</button>
      ${pix ? '<button class="btn btn-light" id="m-pix">Copiar só o PIX</button>' : ''}
      ${cli?.telefone ? `<a class="btn btn-whats" id="m-whats" target="_blank" rel="noopener">Enviar no WhatsApp</a>` : '<span class="hint">Sem telefone cadastrado.</span>'}
      ${cobrancaEmAberto(c) ? `<button class="btn btn-success" id="m-baixa">Dar baixa manual</button>` : ''}
    </div>
    ${(c.pagamentos || []).length ? `<h4 style="margin-top:14px">Pagamentos</h4><table><tbody>
      ${c.pagamentos.map(pg => `<tr><td>${dataBR(pg.data)}</td><td>${esc(pg.meio || '')}</td><td>${esc(pg.pagador || '')}</td><td class="num">${brl(pg.valor)}</td><td><button class="btn btn-danger btn-sm" data-estornar="${pg.id}">Estornar</button></td></tr>`).join('')}
    </tbody></table>` : ''}`);
  const link = () => { const a = $('#m-whats', corpo); if (a) a.href = linkWhats(cli.telefone, $('#msg-txt', corpo).value); };
  link();
  $('#msg-txt', corpo).oninput = link;
  $('#m-copiar', corpo).onclick = () => copiar($('#msg-txt', corpo).value);
  if ($('#m-pix', corpo)) $('#m-pix', corpo).onclick = () => copiar(pix);
  if ($('#m-baixa', corpo)) $('#m-baixa', corpo).onclick = () => baixaManual(c.id);
  $$('[data-estornar]', corpo).forEach(b => b.onclick = () => {
    if (!confirm('Estornar este pagamento?')) return;
    c.pagamentos = c.pagamentos.filter(pg => pg.id !== b.dataset.estornar);
    atualizarStatusCobranca(c);
    salvarDB();
    abrirCobranca(c.id);
    renderSecao();
  });
}

function baixaManual(id) {
  const c = getCobranca(id);
  const corpo = abrirModal(`Baixa manual – ${c.numero}`, `
    <div class="form-grid">
      <div class="form-group"><label>Valor recebido</label><input type="number" step="0.01" id="bm-valor" value="${saldoCobranca(c)}"></div>
      <div class="form-group"><label>Data</label><input type="date" id="bm-data" value="${hojeISO()}"></div>
      <div class="form-group"><label>Forma</label><select id="bm-meio">${['pix', 'dinheiro', 'ted', 'boleto', 'cartao', 'outro'].map(m => `<option>${m}</option>`).join('')}</select></div>
    </div>
    <div class="actions" style="margin-top:12px"><button class="btn btn-success" id="bm-ok">Confirmar baixa</button></div>`);
  $('#bm-ok', corpo).onclick = () => {
    const valor = Number($('#bm-valor', corpo).value) || 0;
    if (valor <= 0) return toast('Informe o valor.', true);
    registrarPagamento(c, { valor, data: $('#bm-data', corpo).value, meio: $('#bm-meio', corpo).value, origem: 'manual' });
    salvarDB();
    fecharModal();
    renderSecao();
    toast(`Baixa registrada em ${c.numero} (${c.status})`);
  };
}

function renderCobrancas() {
  const busca = semAcento($('#busca-cob').value);
  const f = $('#filtro-cob').value;
  const hoje = hojeISO();
  const lista = DB.cobrancas.filter(c => {
    if (f === 'abertas' && !cobrancaEmAberto(c)) return false;
    if (f === 'vencidas' && !cobrancaVencida(c, hoje)) return false;
    if (f === 'paga' && c.status !== 'paga') return false;
    if (busca && !semAcento(c.numero + ' ' + nomeCliente(c.clienteId)).includes(busca)) return false;
    return true;
  }).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  $('#tb-cobrancas').innerHTML = lista.map(c => `<tr>
    <td>${c.numero}</td>
    <td>${esc(nomeCliente(c.clienteId))}</td>
    <td>${c.tipo === 'fechamento' ? `Fechamento ${dataCurta(c.periodoInicio)}–${dataCurta(c.periodoFim)}` : `${c.pedidoIds.length} pedido(s)`}</td>
    <td>${dataBR(c.emissao)}</td>
    <td>${dataBR(c.vencimento)}</td>
    <td class="num">${brl(c.valor)}</td>
    <td class="num">${brl(saldoCobranca(c))}</td>
    <td>${badgeCobranca(c)}</td>
    <td><div class="actions">
      <button class="btn btn-light btn-sm" data-vercob="${c.id}">Abrir / enviar</button>
      ${cobrancaEmAberto(c) ? `<button class="btn btn-success btn-sm" data-baixa="${c.id}">Baixa</button>` : ''}
      ${c.status === 'aberta' ? `<button class="btn btn-danger btn-sm" data-cancelcob="${c.id}">Cancelar</button>` : ''}
    </div></td>
  </tr>`).join('') || '<tr><td colspan="9" class="vazio">Nenhuma cobrança.</td></tr>';
}

async function lerComprov() {
  if (!imagensComprov.length) return toast('Cole o comprovante primeiro.', true);
  const btn = $('#btn-ler-comprov');
  btn.disabled = true;
  $('#baixa-revisao').innerHTML = '<div class="loading">🤖 Lendo comprovante...</div>';
  try {
    const d = await lerComprovante(imagensComprov);
    if (!d.eh_comprovante) toast('A imagem não parece um comprovante. Confira os dados.', true);
    renderBaixa(d);
  } catch (e) {
    console.error(e);
    $('#baixa-revisao').innerHTML = '';
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

function similaridadeNome(a, b) {
  const ta = new Set(semAcento(a).split(/\s+/).filter(t => t.length > 2));
  const tb = new Set(semAcento(b).split(/\s+/).filter(t => t.length > 2));
  if (!ta.size || !tb.size) return 0;
  let comum = 0;
  ta.forEach(t => { if (tb.has(t)) comum++; });
  return comum / Math.min(ta.size, tb.size);
}

// Ordena as cobranças em aberto pela chance de corresponderem ao comprovante.
function candidatosBaixa(d) {
  const abertas = DB.cobrancas.filter(cobrancaEmAberto);
  const porCliente = {};
  abertas.forEach(c => { porCliente[c.clienteId] = arred((porCliente[c.clienteId] || 0) + saldoCobranca(c)); });
  return abertas.map(c => {
    const cli = getCliente(c.clienteId) || {};
    const nomes = [cli.nome, cli.documento, ...(cli.apelidos || '').split(',')].filter(Boolean);
    const nome = Math.max(0, ...nomes.map(n => similaridadeNome(d.pagador, n)));
    let score = nome * 2;
    if (Math.abs(saldoCobranca(c) - d.valor) < 0.01) score += 3;
    else if (Math.abs(porCliente[c.clienteId] - d.valor) < 0.01) score += 2.5;
    return { c, score };
  }).sort((a, b) => b.score - a.score || a.c.vencimento.localeCompare(b.c.vencimento));
}

function renderBaixa(d) {
  const cand = candidatosBaixa(d);
  const marcados = new Set();
  if (cand.length && cand[0].score >= 2) {
    const melhor = cand[0].c;
    if (Math.abs(saldoCobranca(melhor) - d.valor) < 0.01) marcados.add(melhor.id);
    else cand.filter(x => x.c.clienteId === melhor.clienteId).forEach(x => marcados.add(x.c.id));
  }
  const dup = pagamentoDuplicado(d.id_transacao);
  const raiz = $('#baixa-revisao');
  raiz.innerHTML = `
    <h4 style="margin:14px 0 8px">Dados do comprovante</h4>
    ${dup ? `<p class="alerta">⚠ Este comprovante (ID ${esc(d.id_transacao)}) já foi usado na cobrança ${dup.numero}.</p>` : ''}
    <div class="form-grid">
      <div class="form-group"><label>Valor</label><input type="number" step="0.01" id="bx-valor" value="${d.valor || 0}"></div>
      <div class="form-group"><label>Data</label><input type="date" id="bx-data" value="${/^\d{4}-\d{2}-\d{2}$/.test(d.data) ? d.data : hojeISO()}"></div>
      <div class="form-group"><label>Pagador</label><input id="bx-pagador" value="${esc(d.pagador)}"></div>
      <div class="form-group"><label>Forma</label><input id="bx-meio" value="${esc(d.meio)}"></div>
      <div class="form-group"><label>Banco</label><input id="bx-banco" value="${esc(d.instituicao)}"></div>
      <div class="form-group"><label>ID da transação</label><input id="bx-id" value="${esc(d.id_transacao)}"></div>
    </div>
    ${d.recebedor ? `<p class="hint" style="margin-top:6px">Recebedor no comprovante: <b>${esc(d.recebedor)}</b></p>` : ''}
    <h4 style="margin:14px 0 8px">Baixar em quais cobranças?</h4>
    <div class="table-wrap"><table><thead><tr><th>✓</th><th>Nº</th><th>Cliente</th><th>Venc.</th><th class="num">Saldo</th></tr></thead><tbody>
      ${cand.map(({ c }) => `<tr><td><input type="checkbox" data-bx="${c.id}" ${marcados.has(c.id) ? 'checked' : ''}></td><td>${c.numero}</td><td>${esc(nomeCliente(c.clienteId))}</td><td>${dataBR(c.vencimento)} ${cobrancaVencida(c) ? '<span class="badge b-vencida">vencida</span>' : ''}</td><td class="num">${brl(saldoCobranca(c))}</td></tr>`).join('') || '<tr><td colspan="5" class="vazio">Nenhuma cobrança em aberto.</td></tr>'}
    </tbody></table></div>
    <p id="bx-resumo" class="hint" style="margin-top:8px"></p>
    <div class="actions"><button class="btn btn-success" id="bx-ok">✅ Confirmar baixa</button></div>`;
  const resumo = () => {
    const sel = $$('[data-bx]:checked', raiz).map(x => getCobranca(x.dataset.bx));
    const soma = arred(sel.reduce((s, c) => s + saldoCobranca(c), 0));
    const v = Number($('#bx-valor').value) || 0;
    let t = `Selecionado: ${brl(soma)} · Comprovante: ${brl(v)}`;
    if (sel.length && v < soma - 0.009) t += ' → baixa parcial (pagamento abatido das mais antigas primeiro)';
    if (sel.length && v > soma + 0.009) t += ` → ⚠ sobra ${brl(v - soma)} sem cobrança`;
    $('#bx-resumo').textContent = t;
  };
  raiz.onchange = resumo;
  $('#bx-valor').oninput = resumo;
  resumo();
  $('#bx-ok').onclick = () => {
    const sel = $$('[data-bx]:checked', raiz).map(x => getCobranca(x.dataset.bx));
    const valor = Number($('#bx-valor').value) || 0;
    if (!sel.length) return toast('Marque ao menos uma cobrança.', true);
    if (valor <= 0) return toast('Valor inválido.', true);
    const idt = $('#bx-id').value.trim();
    if (pagamentoDuplicado(idt) && !confirm('Este comprovante já foi usado. Registrar de novo?')) return;
    const sobra = baixarValor(sel, valor, {
      data: $('#bx-data').value, pagador: $('#bx-pagador').value, meio: $('#bx-meio').value,
      banco: $('#bx-banco').value, idTransacao: idt, origem: 'comprovante'
    });
    salvarDB();
    imagensComprov.length = 0;
    dzComprov.desenhar();
    raiz.innerHTML = '';
    renderCobrancas();
    toast(`Baixa registrada: ${sel.map(c => `${c.numero} (${c.status})`).join(', ')}${sobra > 0 ? ` · sobrou ${brl(sobra)}` : ''}`);
  };
}

// ================= FECHAMENTOS =================
function renderFechamentos() {
  const pend = fechamentosPendentes();
  $('#fech-pendentes').innerHTML = pend.length ? `<div class="card"><h3>⏰ Fechamentos pendentes</h3>${pend.map(f => `
    <div class="alerta"><div><b>${esc(f.cliente.nome)}</b> – ${FECHAMENTOS[f.cliente.fechamento]} – período até ${dataBR(f.periodo.fim)}: ${f.pedidos.length} pedido(s), <b>${brl(f.total)}</b></div>
    <button class="btn btn-primary btn-sm" data-fechar="${f.cliente.id}" data-ini="${f.pedidos[0].data}" data-fim="${f.periodo.fim}">Preparar</button></div>`).join('')}</div>` : '';
  const sel = $('#fech-cliente').value;
  $('#fech-cliente').innerHTML = opcoesClientes(sel);
  previewFechamento();
}

function prepararFechamento(clienteId, ini, fim) {
  mostrarSecao('fechamentos');
  $('#fech-cliente').value = clienteId;
  $('#fech-inicio').value = ini;
  $('#fech-fim').value = fim;
  previewFechamento();
}

function aplicarPreset(preset) {
  const hoje = parseISO(hojeISO());
  const cli = getCliente($('#fech-cliente').value);
  let ini, fim;
  if (preset === 'quinzena') {
    const p = ultimoPeriodoFechado({ fechamento: 'quinzenal' });
    ini = p.inicio; fim = p.fim;
  } else if (preset === 'mes') {
    const p = ultimoPeriodoFechado({ fechamento: 'mensal' });
    ini = p.inicio; fim = p.fim;
  } else if (preset === 'mesatual') {
    ini = dataISO(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
    fim = hojeISO();
  } else if (preset === 'cliente') {
    if (!cli) return toast('Escolha o cliente.', true);
    const p = ultimoPeriodoFechado(cli);
    if (!p) return toast('Este cliente é avulso (sem período). Defina o fechamento no cadastro.', true);
    ini = p.inicio; fim = p.fim;
  } else if (preset === 'tudo') {
    ini = '2000-01-01'; fim = hojeISO();
  }
  $('#fech-inicio').value = ini;
  $('#fech-fim').value = fim;
  previewFechamento();
}

function previewFechamento() {
  const cid = $('#fech-cliente').value;
  const ini = $('#fech-inicio').value;
  const fim = $('#fech-fim').value;
  const alvo = $('#fech-preview');
  if (!cid || !ini || !fim) { alvo.innerHTML = '<p class="hint">Escolha o cliente e o período.</p>'; return; }
  const peds = pedidosAFaturar(cid, fim, ini);
  if (!peds.length) { alvo.innerHTML = '<div class="vazio">Nenhum pedido a faturar nesse período.</div>'; return; }
  alvo.innerHTML = `
    <div class="table-wrap"><table><thead><tr><th>✓</th><th>Nº</th><th>Data</th><th>Itens</th><th class="num">Total</th></tr></thead><tbody>
    ${peds.map(p => `<tr><td><input type="checkbox" data-fp="${p.id}" checked></td><td>${p.numero}</td><td>${dataBR(p.data)}</td><td>${p.itens.map(i => esc(descricaoItem(i))).join('<br>')}</td><td class="num">${brl(totalPedido(p))}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="total-linha" id="fp-total"></div>
    <button class="btn btn-success" id="fp-gerar">Gerar cobrança do fechamento</button>`;
  const total = () => {
    const ids = $$('[data-fp]:checked', alvo).map(x => x.dataset.fp);
    $('#fp-total').textContent = 'Total: ' + brl(ids.reduce((s, id) => s + totalPedido(getPedido(id)), 0));
    return ids;
  };
  alvo.onchange = total;
  total();
  $('#fp-gerar').onclick = () => {
    const ids = total();
    if (!ids.length) return toast('Nenhum pedido marcado.', true);
    const cob = criarCobranca(cid, ids, { tipo: 'fechamento', periodoInicio: ini === '2000-01-01' ? getPedido(ids[0]).data : ini, periodoFim: fim });
    salvarDB();
    renderFechamentos();
    abrirCobranca(cob.id);
  };
}

// ================= CLIENTES =================
function renderClientes() {
  const busca = semAcento($('#busca-cliente').value);
  const lista = DB.clientes.filter(c => !busca || semAcento(c.nome + ' ' + (c.apelidos || '') + ' ' + (c.telefone || '')).includes(busca))
    .sort((a, b) => a.nome.localeCompare(b.nome));
  $('#tb-clientes').innerHTML = lista.map(c => {
    const aberto = arred(DB.cobrancas.filter(x => x.clienteId === c.id && cobrancaEmAberto(x)).reduce((s, x) => s + saldoCobranca(x), 0));
    const afat = arred(pedidosAFaturar(c.id).reduce((s, p) => s + totalPedido(p), 0));
    return `<tr>
      <td><b>${esc(c.nome)}</b>${c.apelidos && c.apelidos !== c.nome ? `<br><small class="hint">${esc(c.apelidos)}</small>` : ''}</td>
      <td>${esc(c.telefone || '')}</td>
      <td>${FECHAMENTOS[c.fechamento || 'avulso']}${c.fechamento === 'personalizado' ? ` (${c.fechamentoDias} dias)` : ''}</td>
      <td>${c.prazoDias ? c.prazoDias + ' dias' : 'à vista'}</td>
      <td class="num">${aberto ? brl(aberto) : '-'}</td>
      <td class="num">${afat ? brl(afat) : '-'}</td>
      <td><div class="actions">
        <button class="btn btn-light btn-sm" data-editcli="${c.id}">Editar</button>
        <button class="btn btn-light btn-sm" data-extrato="${c.id}">Extrato</button>
        ${aberto ? `<button class="btn btn-whats btn-sm" data-lembrete="${c.id}">Lembrete</button>` : ''}
      </div></td></tr>`;
  }).join('') || '<tr><td colspan="7" class="vazio">Nenhum cliente. Eles são criados automaticamente ao ler um print.</td></tr>';
}

function editarCliente(id) {
  const c = id ? getCliente(id) : { nome: '', apelidos: '', telefone: '', email: '', documento: '', fechamento: 'avulso', fechamentoDias: 7, fechamentoBase: hojeISO(), prazoDias: Number(DB.config.prazoPadrao) || 0, obs: '' };
  const corpo = abrirModal(id ? 'Editar cliente' : 'Novo cliente', `
    <div class="form-grid">
      <div class="form-group"><label>Nome</label><input id="ec-nome" value="${esc(c.nome)}"></div>
      <div class="form-group"><label>Nomes no WhatsApp / pagador (separe por vírgula)</label><input id="ec-apelidos" value="${esc(c.apelidos || '')}"></div>
      <div class="form-group"><label>Telefone (WhatsApp)</label><input id="ec-tel" value="${esc(c.telefone || '')}"></div>
      <div class="form-group"><label>E-mail</label><input id="ec-email" value="${esc(c.email || '')}"></div>
      <div class="form-group"><label>CPF/CNPJ</label><input id="ec-doc" value="${esc(c.documento || '')}"></div>
      <div class="form-group"><label>Fechamento</label><select id="ec-fech">${Object.entries(FECHAMENTOS).map(([k, v]) => `<option value="${k}" ${k === (c.fechamento || 'avulso') ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="form-group pers"><label>A cada quantos dias</label><input type="number" min="1" id="ec-dias" value="${c.fechamentoDias || 7}"></div>
      <div class="form-group pers"><label>Contando a partir de</label><input type="date" id="ec-base" value="${c.fechamentoBase || hojeISO()}"></div>
      <div class="form-group"><label>Prazo para pagar (dias após a cobrança)</label><input type="number" min="0" id="ec-prazo" value="${c.prazoDias || 0}"></div>
    </div>
    <div class="form-group" style="margin-top:10px"><label>Observações</label><textarea id="ec-obs">${esc(c.obs || '')}</textarea></div>
    <div class="actions" style="margin-top:12px">
      <button class="btn btn-success" id="ec-ok">Salvar</button>
      ${id ? '<button class="btn btn-danger" id="ec-del">Excluir</button>' : ''}
    </div>`);
  const pers = () => $$('.pers', corpo).forEach(el => { el.style.display = $('#ec-fech', corpo).value === 'personalizado' ? '' : 'none'; });
  $('#ec-fech', corpo).onchange = pers;
  pers();
  $('#ec-ok', corpo).onclick = () => {
    const nome = $('#ec-nome', corpo).value.trim();
    if (!nome) return toast('Informe o nome.', true);
    Object.assign(c, {
      nome, apelidos: $('#ec-apelidos', corpo).value, telefone: $('#ec-tel', corpo).value, email: $('#ec-email', corpo).value,
      documento: $('#ec-doc', corpo).value, fechamento: $('#ec-fech', corpo).value, fechamentoDias: Number($('#ec-dias', corpo).value) || 7,
      fechamentoBase: $('#ec-base', corpo).value || hojeISO(), prazoDias: Number($('#ec-prazo', corpo).value) || 0, obs: $('#ec-obs', corpo).value
    });
    if (!id) { c.id = uid('cli'); DB.clientes.push(c); }
    salvarDB();
    fecharModal();
    renderSecao();
  };
  if (id) $('#ec-del', corpo).onclick = () => {
    if (DB.pedidos.some(p => p.clienteId === id)) return toast('Cliente tem pedidos; não pode ser excluído.', true);
    if (!confirm('Excluir cliente?')) return;
    DB.clientes = DB.clientes.filter(x => x.id !== id);
    salvarDB();
    fecharModal();
    renderSecao();
  };
}

// ================= PRODUTOS =================
function renderProdutos() {
  $('#tb-produtos').innerHTML = [...DB.produtos].sort((a, b) => a.categoria.localeCompare(b.categoria) || a.nome.localeCompare(b.nome)).map(p => `<tr>
    <td>${esc(p.nome)}</td><td>${esc(p.categoria)}</td><td>${esc(p.unidade)}</td><td class="num">${brl(p.preco)}</td>
    <td>${esc(p.faixas || '-')}</td><td><small>${esc(p.aliases || '')}</small></td>
    <td><button class="btn btn-light btn-sm" data-editprod="${p.id}">Editar</button></td></tr>`).join('');
}

function editarProduto(id) {
  const p = id ? getProduto(id) : { nome: '', categoria: 'Material', unidade: 'folha', preco: 0, faixas: '', aliases: '' };
  const corpo = abrirModal(id ? 'Editar item' : 'Novo item da tabela', `
    <div class="form-grid">
      <div class="form-group"><label>Nome</label><input id="pp-nome" value="${esc(p.nome)}"></div>
      <div class="form-group"><label>Categoria</label><select id="pp-cat">
        ${['Material', 'Acabamento', 'Serviço'].map(c => `<option ${c === p.categoria ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="form-group"><label>Unidade</label><input id="pp-un" value="${esc(p.unidade)}" placeholder="folha, unidade, m²"></div>
      <div class="form-group"><label>Preço (R$)</label><input type="number" step="0.01" id="pp-preco" value="${p.preco}"></div>
    </div>
    <div class="form-group" style="margin-top:10px"><label>Faixas de quantidade (opcional) – ex.: 50:3,50; 100:3,00</label><input id="pp-faixas" value="${esc(p.faixas || '')}"></div>
    <div class="form-group" style="margin-top:10px"><label>Palavras que o cliente usa (a IA usa para reconhecer)</label><input id="pp-alias" value="${esc(p.aliases || '')}"></div>
    <div class="actions" style="margin-top:12px">
      <button class="btn btn-success" id="pp-ok">Salvar</button>
      ${id ? '<button class="btn btn-danger" id="pp-del">Excluir</button>' : ''}
    </div>`);
  $('#pp-ok', corpo).onclick = () => {
    Object.assign(p, {
      nome: $('#pp-nome', corpo).value.trim(), categoria: $('#pp-cat', corpo).value, unidade: $('#pp-un', corpo).value.trim() || 'unidade',
      preco: Number($('#pp-preco', corpo).value) || 0, faixas: $('#pp-faixas', corpo).value, aliases: $('#pp-alias', corpo).value
    });
    if (!p.nome) return toast('Informe o nome.', true);
    if (!id) { p.id = uid('prod'); DB.produtos.push(p); }
    salvarDB();
    fecharModal();
    renderProdutos();
  };
  if (id) $('#pp-del', corpo).onclick = () => {
    if (!confirm('Excluir este item da tabela? Pedidos antigos mantêm o valor já calculado.')) return;
    DB.produtos = DB.produtos.filter(x => x.id !== id);
    salvarDB();
    fecharModal();
    renderProdutos();
  };
}

// ================= CONFIGURAÇÕES =================
const CAMPOS_CFG = ['empresa', 'pixChave', 'pixNome', 'pixCidade', 'prazoPadrao', 'horaLista', 'apiKey', 'modelo', 'scriptUrl', 'scriptToken'];
function renderConfig() {
  CAMPOS_CFG.forEach(k => { const el = $('#cfg-' + k); if (el) el.value = DB.config[k] ?? ''; });
}
function salvarConfig() {
  CAMPOS_CFG.forEach(k => { const el = $('#cfg-' + k); if (el) DB.config[k] = el.type === 'number' ? Number(el.value) || 0 : el.value.trim(); });
  salvarDB();
  aplicarNomeEmpresa();
  toast('Configurações salvas');
}
function aplicarNomeEmpresa() {
  $('#nome-empresa').textContent = DB.config.empresa || 'Sistema Gráfica';
  document.title = DB.config.empresa || 'Sistema Gráfica';
  if (DB.config.scriptUrl) statusSync('Planilha conectada');
}

// ================= INICIALIZAÇÃO =================
let dzPedido, dzComprov;

function iniciar() {
  $('#nav').addEventListener('click', e => { const b = e.target.closest('button[data-sec]'); if (b) mostrarSecao(b.dataset.sec); });
  $('#modal-fechar').onclick = fecharModal;
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') fecharModal(); });

  dzPedido = configurarDropzone($('#drop-pedido'), $('#file-pedido'), $('#thumbs-pedido'), imagensPedido, true);
  dzComprov = configurarDropzone($('#drop-comprov'), $('#file-comprov'), $('#thumbs-comprov'), imagensComprov, false);

  // Ctrl+V em qualquer lugar: na aba Cobranças vira comprovante; nas outras, print de pedido.
  document.addEventListener('paste', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    const arquivos = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    if (!arquivos.length || ((tag === 'input' || tag === 'textarea') && !e.target.closest('.dropzone'))) return;
    e.preventDefault();
    if (secaoAtual === 'cobrancas') dzComprov.adicionar(arquivos);
    else {
      if (secaoAtual !== 'novo') mostrarSecao('novo');
      dzPedido.adicionar(arquivos);
    }
  });

  $('#btn-ler-print').onclick = lerPrint;
  $('#btn-pedido-manual').onclick = () => montarRevisao({ cliente_id: $('#cliente-print').value, cliente_nome: '', itens: [] });
  $('#btn-limpar-print').onclick = () => { imagensPedido.length = 0; dzPedido.desenhar(); revisao = null; $('#revisao').innerHTML = ''; };
  $('#btn-ler-comprov').onclick = lerComprov;
  $('#btn-limpar-comprov').onclick = () => { imagensComprov.length = 0; dzComprov.desenhar(); $('#baixa-revisao').innerHTML = ''; };

  ['#busca-pedido', '#filtro-tipo', '#filtro-status-pedido', '#filtro-fat'].forEach(s => $(s).addEventListener('input', renderPedidos));
  ['#busca-cob', '#filtro-cob'].forEach(s => $(s).addEventListener('input', renderCobrancas));
  $('#busca-cliente').addEventListener('input', renderClientes);
  ['#fech-cliente', '#fech-inicio', '#fech-fim'].forEach(s => $(s).addEventListener('change', previewFechamento));
  $$('[data-preset]').forEach(b => b.onclick = () => aplicarPreset(b.dataset.preset));

  $('#btn-novo-cliente').onclick = () => editarCliente(null);
  $('#btn-novo-produto').onclick = () => editarProduto(null);
  $('#btn-regerar-lista').onclick = () => { gerarListaDoDia(true); renderPainel(); toast('Lista atualizada'); };
  $('#btn-copiar-lista').onclick = () => {
    const l = DB.listas[hojeISO()];
    if (!l) return toast('Gere a lista primeiro.', true);
    copiar(textoListaDevedores(l));
  };

  $('#btn-salvar-config').onclick = salvarConfig;
  $('#btn-sync-enviar').onclick = async () => { salvarConfig(); try { await enviarParaPlanilha(); toast('Enviado para a planilha'); } catch (e) { toast(e.message, true); } };
  $('#btn-sync-baixar').onclick = async () => {
    salvarConfig();
    if (!confirm('Substituir os dados deste navegador pelos da planilha?')) return;
    try { await baixarDaPlanilha(); renderSecao(); toast('Dados carregados'); } catch (e) { toast(e.message, true); }
  };
  $('#btn-exportar').onclick = () => {
    const blob = new Blob([JSON.stringify({ ...DB, config: { ...DB.config, apiKey: '' } }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `grafica-backup-${hojeISO()}.json`;
    a.click();
  };
  $('#file-importar').onchange = async e => {
    const f = e.target.files[0];
    if (!f || !confirm('Substituir todos os dados pelo backup?')) return;
    const d = JSON.parse(await f.text());
    const apiKey = DB.config.apiKey;
    DB = { ...dbVazio(), ...d, config: { ...dbVazio().config, ...d.config, apiKey } };
    salvarDB();
    renderSecao();
    toast('Backup importado');
  };
  $('#btn-apagar-tudo').onclick = () => {
    if (!confirm('Apagar TODOS os pedidos, clientes e cobranças deste navegador?')) return;
    const config = DB.config;
    DB = dbVazio();
    DB.config = config;
    salvarDB();
    renderSecao();
  };

  // Botões criados dinamicamente nas tabelas e modais.
  document.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.editar) editarPedido(d.editar);
    else if (d.orc) abrirOrcamento(d.orc);
    else if (d.aprovar) aprovarOrcamento(d.aprovar);
    else if (d.cobrar) { const p = getPedido(d.cobrar); const c = criarCobranca(p.clienteId, [p.id]); salvarDB(); renderSecao(); abrirCobranca(c.id); }
    else if (d.vercob) abrirCobranca(d.vercob);
    else if (d.baixa) baixaManual(d.baixa);
    else if (d.cancelcob) { if (confirm('Cancelar a cobrança? Os pedidos voltam para "a faturar".')) { cancelarCobranca(getCobranca(d.cancelcob)); salvarDB(); renderSecao(); } }
    else if (d.lembrete) abrirLembrete(d.lembrete);
    else if (d.extrato) abrirExtrato(d.extrato);
    else if (d.editcli) editarCliente(d.editcli);
    else if (d.editprod) editarProduto(d.editprod);
    else if (d.fechar) prepararFechamento(d.fechar, d.ini, d.fim);
  });
  document.addEventListener('change', e => {
    const s = e.target.dataset?.status;
    if (!s) return;
    const p = getPedido(s);
    if (e.target.value === 'cancelado' && p.cobrancaId) {
      const c = getCobranca(p.cobrancaId);
      if (c && (c.pagamentos || []).length) { toast('Pedido com pagamento registrado; estorne antes de cancelar.', true); e.target.value = p.status; return; }
      if (c) { c.pedidoIds = c.pedidoIds.filter(x => x !== p.id); if (!c.pedidoIds.length) c.status = 'cancelada'; else recalcularValorCobranca(c); }
      p.cobrancaId = '';
    }
    p.status = e.target.value;
    salvarDB();
    renderPedidos();
  });

  aplicarNomeEmpresa();
  verificarListaDiaria();
  setInterval(verificarListaDiaria, 5 * 60 * 1000);
  renderSecao('painel');
  if (!DB.config.apiKey) toast('Bem-vindo! Configure a chave da IA e o PIX em Configurações.');
}

document.addEventListener('DOMContentLoaded', iniciar);
