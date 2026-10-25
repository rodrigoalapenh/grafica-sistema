// Geração do código PIX "copia e cola" (BR Code estático, padrão EMV do Banco Central).
'use strict';

function pixLimpar(s, max) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .\-]/g, '').toUpperCase().trim().slice(0, max);
}

function pixCampo(id, valor) {
  return id + String(valor.length).padStart(2, '0') + valor;
}

function pixCRC16(payload) {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function gerarPix({ chave, nome, cidade, valor, txid }) {
  if (!chave) return '';
  const conta = pixCampo('00', 'br.gov.bcb.pix') + pixCampo('01', String(chave).trim());
  let p = pixCampo('00', '01')
    + pixCampo('26', conta)
    + pixCampo('52', '0000')
    + pixCampo('53', '986');
  if (valor && Number(valor) > 0) p += pixCampo('54', Number(valor).toFixed(2));
  p += pixCampo('58', 'BR')
    + pixCampo('59', pixLimpar(nome, 25) || 'RECEBEDOR')
    + pixCampo('60', pixLimpar(cidade, 15) || 'BRASIL')
    + pixCampo('62', pixCampo('05', (String(txid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25)) || '***'))
    + '6304';
  return p + pixCRC16(p);
}

function pixDaCobranca(cob) {
  const cfg = DB.config;
  return gerarPix({ chave: cfg.pixChave, nome: cfg.pixNome || cfg.empresa, cidade: cfg.pixCidade, valor: saldoCobranca(cob), txid: cob.numero });
}
