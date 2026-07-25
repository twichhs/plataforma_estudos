/* ============================================================================
   QA — Testes E2E com Chrome headless (puppeteer-core + Chrome do sistema).
   Sobe um servidor estático local, abre a aplicação real e exercita os fluxos
   de usuário: CRUD, cronômetro, persistência, calendário, livros, canvas, XSS.
   ========================================================================== */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'tests', 'screenshots');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };

let server, port, browser, page;
const pageErrors = [];

before(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });

  server = http.createServer((req, res) => {
    const file = path.join(ROOT, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;

  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--force-device-scale-factor=1'],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 940 });
  page.on('dialog', d => d.accept());
  page.on('pageerror', e => pageErrors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForSelector('.stat-card');
});

after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});

/* helpers */
const setValue = (sel, value) => page.$eval(sel, (el, v) => {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, value);

const modalSubmit = async () => {
  await page.click('.modal-actions button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#modal-root').hidden, { timeout: 4000 });
};

const text = (sel) => page.$eval(sel, el => el.textContent);
const count = (sel) => page.$$eval(sel, els => els.length);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ============================================================ */

test('boot: seed carregado, persistido no localStorage, sem erros', async () => {
  const phases = await page.evaluate(() => window.App.state.phases.length);
  assert.equal(phases, 5);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('trajeto:v1')).phases.length);
  assert.equal(stored, 5);
  const title = await page.title();
  assert.match(title, /Trajeto/);
});

test('dashboard: stats e heatmap renderizados', async () => {
  assert.equal(await count('.stat-card'), 4);
  assert.ok(await count('.hm-cell') > 100, 'heatmap com ~140 células');
  assert.match(await text('#tab-dashboard'), /Total estudado/);
  await page.screenshot({ path: path.join(SHOTS, '1-dashboard-inicial.png') });
});

test('navegação: todas as abas abrem o painel correto', async () => {
  for (const tab of ['roadmap', 'reminders', 'books', 'share', 'dashboard']) {
    await page.click(`.tab[data-tab="${tab}"]`);
    const visible = await page.$eval(`#tab-${tab}`, el => !el.hidden && el.innerHTML.length > 50);
    assert.ok(visible, `aba ${tab} visível e com conteúdo`);
  }
});

test('roadmap: abrir tema, criar tarefa, ciclar status, progresso reage', async () => {
  await page.click('.tab[data-tab="roadmap"]');
  const themeId = await page.evaluate(() => window.App.state.phases[0].themes[0].id);
  const T = `[data-theme="${themeId}"]`;

  await page.click(`${T} .theme-head`);
  await page.waitForSelector(`${T}.is-open .task-add input`);

  const before = await count(`${T} .task`);
  await page.type(`${T} .task-add input`, 'Tarefa criada pelo E2E');
  await page.keyboard.press('Enter');
  await page.waitForFunction((sel, n) => document.querySelectorAll(sel).length === n + 1, {}, `${T} .task`, before);

  // ciclo de status na tarefa recém-criada (última da lista)
  const last = `${T} .task:last-child`;
  assert.match(await page.$eval(last, el => el.className), /st-todo/);
  await page.click(`${last} .task-status`);
  assert.match(await page.$eval(last, el => el.className), /st-doing/);
  await page.click(`${last} .task-status`);
  await sleep(450); // animação de conclusão + re-render
  const cls = await page.$eval(`${T} .task:last-child`, el => el.className);
  assert.match(cls, /st-done/);

  // barra de progresso do tema saiu de 0
  const width = await page.$eval(`${T} .theme-head .progress i`, el => el.style.width);
  assert.notEqual(width, '0%');
});

test('roadmap: reordenar tarefa com botões e excluir', async () => {
  const themeId = await page.evaluate(() => window.App.state.phases[0].themes[0].id);
  const T = `[data-theme="${themeId}"]`;
  const titles = () => page.$$eval(`${T} .task-title`, els => els.map(e => e.textContent));

  const beforeOrder = await titles();
  await page.click(`${T} .task:last-child [data-act="task-up"]`);
  const afterOrder = await titles();
  assert.equal(afterOrder[afterOrder.length - 2], beforeOrder[beforeOrder.length - 1], 'tarefa subiu uma posição');

  const n = await count(`${T} .task`);
  await page.click(`${T} .task:last-child [data-act="task-del"]`); // confirm auto-aceito
  await page.waitForFunction((sel, k) => document.querySelectorAll(sel).length === k - 1, {}, `${T} .task`, n);
});

test('notas: markdown renderiza e HTML malicioso não executa', async () => {
  const themeId = await page.evaluate(() => window.App.state.phases[0].themes[0].id);
  const T = `[data-theme="${themeId}"]`;
  await page.click(`${T} [data-act="note-add"]`);
  await page.waitForSelector('#modal-form textarea[name=text]');
  await setValue('#modal-form textarea[name=text]',
    '**QA note** com `codigo`\n- ponto um\n- ponto dois\n<script>window.__xssNote=1</script><img src=x onerror="window.__xssImg=1">');
  await modalSubmit();

  await page.waitForSelector(`${T} .note`);
  const noteHTML = await page.$eval(`${T} .note .note-body`, el => el.innerHTML);
  assert.ok(noteHTML.includes('<strong>QA note</strong>'));
  assert.ok(noteHTML.includes('<li>ponto um</li>'));
  assert.ok(!noteHTML.includes('<script'), 'script não injetado');
  assert.ok(!noteHTML.includes('<img'), 'img não injetada');
  await sleep(300);
  const xss = await page.evaluate(() => [typeof window.__xssNote, typeof window.__xssImg]);
  assert.deepEqual(xss, ['undefined', 'undefined']);
});

test('XSS: título de tarefa com HTML é exibido literalmente', async () => {
  const themeId = await page.evaluate(() => window.App.state.phases[0].themes[0].id);
  const T = `[data-theme="${themeId}"]`;
  await page.type(`${T} .task-add input`, '<img src=x onerror="window.__xssTask=1">');
  await page.keyboard.press('Enter');
  await sleep(300);
  assert.equal(await page.evaluate(() => window.__xssTask), undefined);
  const label = await page.$eval(`${T} .task:last-child .task-title`, el => el.textContent);
  assert.ok(label.includes('<img'), 'texto exibido como literal');
  await page.click(`${T} .task:last-child [data-act="task-del"]`);
  await sleep(150);
});

test('cronômetro: iniciar, pílula global, sessão de 25min registrada', async () => {
  const themeId = await page.evaluate(() => window.App.state.phases[0].themes[0].id);
  const T = `[data-theme="${themeId}"]`;

  await page.click(`${T} [data-act="timer-toggle"]`);
  await page.waitForSelector('#timer-pill:not([hidden])');
  assert.ok(await page.evaluate(() => window.App.state.timer !== null));
  assert.match(await page.$eval(T, el => el.className), /is-running/);

  // simula 25 minutos decorridos e para
  await page.evaluate(() => { window.App.state.timer.startedAt -= 25 * 60000; window.App.save(); });
  await page.click(`${T} [data-act="timer-toggle"]`);
  await page.waitForSelector('#timer-pill[hidden]');

  const minutes = await page.evaluate((id) => {
    const f = window.App.Logic.findTheme(window.App.state, id);
    return window.App.Logic.themeMinutes(f.theme);
  }, themeId);
  assert.equal(minutes, 25);
  assert.match(await text(`${T} .theme-time`), /25m/);
});

test('cronômetro: sessão curta é descartada', async () => {
  const themeId = await page.evaluate(() => window.App.state.phases[0].themes[1].id);
  await page.evaluate((id) => {
    const f = document.querySelector(`[data-theme="${id}"] .theme-head`);
    f.click();
  }, themeId);
  await page.click(`[data-theme="${themeId}"] [data-act="timer-toggle"]`);
  await sleep(400); // < 30s
  await page.click(`[data-theme="${themeId}"] [data-act="timer-toggle"]`);
  const minutes = await page.evaluate((id) => {
    const f = window.App.Logic.findTheme(window.App.state, id);
    return window.App.Logic.themeMinutes(f.theme);
  }, themeId);
  assert.equal(minutes, 0);
});

test('tempo manual: modal registra 45m somando ao total do tema', async () => {
  const themeId = await page.evaluate(() => window.App.state.phases[0].themes[0].id);
  const T = `[data-theme="${themeId}"]`;
  await page.click(`${T} [data-act="time-manual"]`);
  await page.waitForSelector('#modal-form input[name=minutes]');
  await setValue('#modal-form input[name=minutes]', '45');
  await modalSubmit();
  const minutes = await page.evaluate((id) => {
    const f = window.App.Logic.findTheme(window.App.state, id);
    return window.App.Logic.themeMinutes(f.theme);
  }, themeId);
  assert.equal(minutes, 70); // 25 + 45
  assert.match(await text(`${T} .theme-time`), /1h 10m/);
  await page.screenshot({ path: path.join(SHOTS, '2-roadmap-tema-aberto.png') });
});

test('dashboard: reflete tempo, streak e distribuição', async () => {
  await page.click('.tab[data-tab="dashboard"]');
  const heroText = await text('.stat-hero');
  assert.match(heroText, /1h 10m/);
  const dash = await text('#tab-dashboard');
  assert.match(dash, /1 dia/); // streak de hoje
  assert.ok(await count('.bar-row') >= 1, 'distribuição tem barras');
  // célula de hoje no heatmap com nível > 0 (70min => l3)
  assert.ok(await count('.hm-cell.l3') >= 1, 'célula de hoje pintada');
});

test('persistência: reload mantém todos os dados', async () => {
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.stat-card');
  const check = await page.evaluate(() => {
    const s = window.App.state;
    const theme = s.phases[0].themes[0];
    return {
      minutes: window.App.Logic.themeMinutes(theme),
      hasTask: theme.tasks.some(t => t.title === 'Tarefa criada pelo E2E'),
      notes: theme.notes.length,
    };
  });
  assert.equal(check.minutes, 70);
  assert.ok(check.hasTask);
  assert.ok(check.notes >= 2); // nota do seed + nota do QA
});

test('lembretes: criar via modal, dot no calendário, lista de próximos', async () => {
  await page.click('.tab[data-tab="reminders"]');
  await page.waitForSelector('.cal-grid');

  await page.click('[data-act="rem-add"]');
  await page.waitForSelector('#modal-form input[name=title]');
  await setValue('#modal-form input[name=title]', 'Revisão E2E de SQL');
  await setValue('#modal-form input[name=time]', '14:30');
  await modalSubmit();

  assert.match(await text('.cal-daypanel'), /Revisão E2E de SQL/);
  assert.match(await text('.cal-daypanel'), /14:30/);
  assert.ok(await count('.cal-day.is-sel .cal-dots') === 1, 'dot no dia selecionado');
  assert.match(await text('.rem-side'), /Revisão E2E de SQL/);
  assert.match(await text('.rem-side'), /hoje/);
});

test('calendário: navegação de mês e volta para hoje; dia estudado destacado', async () => {
  const month = await text('.cal-head h3');
  await page.click('[data-act="cal-next"]');
  assert.notEqual(await text('.cal-head h3'), month);
  await page.click('[data-act="cal-prev"]');
  await page.click('[data-act="cal-prev"]');
  assert.notEqual(await text('.cal-head h3'), month);
  await page.click('[data-act="cal-today"]');
  assert.equal(await text('.cal-head h3'), month);
  assert.ok(await count('.cal-day.is-today.has-study') === 1, 'hoje marcado como dia estudado');
});

test('meta semanal: alterar meta atualiza barra e texto', async () => {
  await setValue('#goal-hours', '10');
  await page.waitForFunction(() => document.querySelector('.goal-big').textContent.includes('de 10h'));
  const pct = await page.evaluate(() => window.App.Logic.weeklyGoal(window.App.state, window.App.U.todayISO()).pct);
  assert.equal(pct, 12); // 70min / 600min = 11.7 -> 12
  await page.screenshot({ path: path.join(SHOTS, '3-lembretes.png') });
});

test('livros: cadastrar, registrar progresso, ritmo e conclusão', async () => {
  await page.click('.tab[data-tab="books"]');
  await page.click('[data-act="book-add"]');
  await page.waitForSelector('#modal-form input[name=title]');
  await setValue('#modal-form input[name=title]', 'Designing Data-Intensive Applications');
  await setValue('#modal-form input[name=author]', 'Martin Kleppmann');
  await setValue('#modal-form input[name=totalPages]', '616');
  await setValue('#modal-form input[name=pagesPerDay]', '20');
  await setValue('#modal-form select[name=status]', 'lendo');
  await modalSubmit();

  await page.waitForSelector('.book');
  assert.match(await text('.book'), /Kleppmann/);
  assert.match(await text('.book .st-chip'), /lendo/);

  // registrar leitura: página 62 => 10%, adiantado (meta começou hoje)
  await setValue('.book-update input[name=page]', '62');
  await page.click('.book-update button[type=submit]');
  await page.waitForFunction(() => document.querySelector('.book').textContent.includes('62/616'));
  const bookText = await text('.book');
  assert.match(bookText, /10%/);
  assert.match(bookText, /termina ~/);
  assert.match(bookText, /adiantado/);
  assert.ok(await count('.book-chart') === 1, 'mini-gráfico de leitura aparece');
  assert.match(await text('#tab-books'), /Lendo agora/);
  await page.screenshot({ path: path.join(SHOTS, '4-livros.png') });

  // concluir o livro
  await setValue('.book-update input[name=page]', '616');
  await page.click('.book-update button[type=submit]');
  await page.waitForFunction(() => document.querySelector('.book .st-chip').textContent.includes('lido'));
  assert.match(await text('#tab-books'), /concluído/);
  const ov = await page.evaluate(() => window.App.Logic.booksOverview(window.App.state, window.App.U.todayISO()));
  assert.equal(ov.finishedThisYear, 1);
  assert.equal(ov.pagesThisYear, 616);
});

test('livros: anotações salvam sem re-render (blur/change)', async () => {
  await page.click('.book-notes summary');
  await setValue('.book-notes textarea', 'Citação registrada pelo QA');
  const saved = await page.evaluate(() => window.App.state.books[0].notes);
  assert.equal(saved, 'Citação registrada pelo QA');
});

test('compartilhar: canvas desenha em todos os templates e formatos', async () => {
  await page.click('.tab[data-tab="share"]');
  await page.waitForSelector('#share-canvas');

  const probe = () => page.evaluate(() => {
    const c = document.querySelector('#share-canvas');
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let colored = 0, accent = 0;
    for (let i = 0; i < data.length; i += 40) { // amostragem
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      if (r + g + b > 60) colored++;
      if (g > 190 && r > 130 && b < 120) accent++; // pixels na cor accent
    }
    return { w: c.width, h: c.height, colored, accent };
  });

  let p = await probe();
  assert.equal(p.w, 1080);
  assert.equal(p.h, 1080);
  assert.ok(p.colored > 500, 'card tem conteúdo desenhado');
  assert.ok(p.accent > 5, 'card usa a cor de destaque');

  for (const tpl of ['grade', 'impacto', 'aurora']) {
    await page.click(`[data-act="share-tpl"][data-v="${tpl}"]`);
    p = await probe();
    assert.ok(p.colored > 500, `template ${tpl} desenhado`);
  }

  await page.click('[data-act="share-fmt"][data-v="story"]');
  p = await probe();
  assert.equal(p.h, 1920, 'formato stories 9:16');

  for (const period of ['today', 'month', 'all', 'week']) {
    await page.click(`[data-act="share-period"][data-v="${period}"]`);
    p = await probe();
    assert.ok(p.colored > 500, `período ${period} desenhado`);
  }

  // PNG real é gerado com tamanho plausível
  const blobSize = await page.evaluate(() => new Promise(res => {
    document.querySelector('#share-canvas').toBlob(b => res(b ? b.size : 0), 'image/png');
  }));
  assert.ok(blobSize > 20000, `PNG gerado (${blobSize} bytes)`);
  await page.click('[data-act="share-fmt"][data-v="square"]');
  await page.screenshot({ path: path.join(SHOTS, '5-compartilhar.png') });
});

test('backup: export/import round-trip e rejeição de arquivo inválido', async () => {
  const result = await page.evaluate(() => {
    const exported = window.App.serialize();
    const data = JSON.parse(exported);
    data.settings.weeklyGoalHours = 7;
    const ok = window.App.importJSON(JSON.stringify(data));
    const badJson = window.App.importJSON('isto não é json');
    const badShape = window.App.importJSON('{"foo": 1}');
    return {
      ok, badJson, badShape,
      goal: window.App.state.settings.weeklyGoalHours,
      phases: window.App.state.phases.length,
      books: window.App.state.books.length,
    };
  });
  assert.equal(result.ok.ok, true);
  assert.equal(result.goal, 7);
  assert.equal(result.badJson.ok, false);
  assert.equal(result.badShape.ok, false);
  assert.equal(result.phases, 5, 'import inválido não destruiu o estado');
  assert.equal(result.books, 1);
});

test('responsivo: layout mobile renderiza sem estouro horizontal', async () => {
  await page.setViewport({ width: 390, height: 844 });
  await page.click('.tab[data-tab="dashboard"]');
  await sleep(250);
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 2, `sem scroll horizontal (delta=${overflow}px)`);
  await page.screenshot({ path: path.join(SHOTS, '6-mobile-dashboard.png') });
  await page.setViewport({ width: 1440, height: 940 });
});

test('zero erros de console/página durante toda a suíte', () => {
  assert.deepEqual(pageErrors, []);
});
