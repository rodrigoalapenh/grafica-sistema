// Sincronização opcional com Google Planilhas via Web App do Google Apps Script.
'use strict';

let _timerSync = null;

function agendarSync() {
  if (!DB.config.scriptUrl) return;
  clearTimeout(_timerSync);
  _timerSync = setTimeout(() => enviarParaPlanilha().catch(e => statusSync('Erro ao sincronizar: ' + e.message, true)), 2500);
}

function statusSync(msg, erro) {
  const el = document.getElementById('sync-status');
  if (el) { el.textContent = msg; el.style.color = erro ? '#ffcdd2' : ''; }
}

// Envia como text/plain para evitar o preflight CORS que o Apps Script não responde.
async function chamarScript(corpo) {
  const { scriptUrl, scriptToken } = DB.config;
  if (!scriptUrl) throw new Error('Configure a URL do Web App.');
  const r = await fetch(scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: scriptToken, ...corpo })
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.erro || 'falha no script');
  return j;
}

async function enviarParaPlanilha() {
  statusSync('Sincronizando...');
  const semChave = { ...DB, config: { ...DB.config, apiKey: '' } };
  await chamarScript({ acao: 'salvar', db: semChave, lista: gerarListaDevedores() });
  statusSync('Sincronizado ' + new Date().toLocaleTimeString('pt-BR').slice(0, 5));
}

async function baixarDaPlanilha() {
  const j = await chamarScript({ acao: 'carregar' });
  if (!j.db) throw new Error('A planilha ainda não tem dados.');
  const { apiKey, scriptUrl, scriptToken } = DB.config;
  DB = { ...dbVazio(), ...j.db };
  DB.config = { ...dbVazio().config, ...j.db.config, apiKey, scriptUrl, scriptToken };
  salvarDB({ semSync: true });
  statusSync('Dados baixados da planilha');
}
