// Gera as imagens da tabela de preços (imagens/*.png, 1080x1350) a partir de tabela.html.
// Uso: node scripts/gerar-imagens.js   (requer o pacote playwright)
'use strict';
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const raiz = path.resolve(__dirname, '..');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, deviceScaleFactor: 2 });
  await page.goto('file://' + path.join(raiz, 'tabela.html'));
  for (const arte of await page.$$('.arte')) {
    const nome = await arte.getAttribute('data-nome');
    await arte.screenshot({ path: path.join(raiz, 'imagens', nome + '.png') });
    console.log('imagens/' + nome + '.png');
  }
  await browser.close();
})();
