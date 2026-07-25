/* ============================================================================
   QA — Testes unitários da lógica pura (Node, sem dependências).
   Carrega app.js via require: a camada de navegador é ignorada pelo guard
   `typeof window !== 'undefined'`, sobrando U, Logic, Actions e a normalização.
   ========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const App = require('../app.js');
const {
  U, Logic, Actions, buildSeed, normalizeState, validateImport,
  TASK_STATUS, MAX_DAY_MINUTES, PHRASES,
} = App;

const TODAY = '2026-07-25'; // sábado — semana (seg-dom): 2026-07-20 a 2026-07-26

/** estado mínimo: 1 fase, 2 temas */
function tinyState() {
  const state = normalizeState({ phases: [] });
  const phase = Actions.addPhase(state, 'Fase X');
  const t1 = Actions.addTheme(state, phase.id, 'Tema A');
  const t2 = Actions.addTheme(state, phase.id, 'Tema B');
  return { state, phase, t1, t2 };
}

/* ============================================================
   01. Utilitários de data e formatação
   ============================================================ */
test('U: toISO/parseISO são inversos e estáveis', () => {
  assert.equal(U.toISO(U.parseISO('2026-07-25')), '2026-07-25');
  assert.equal(U.toISO(U.parseISO('2024-02-29')), '2024-02-29'); // bissexto
});

test('U.addDaysISO cruza mês e ano corretamente', () => {
  assert.equal(U.addDaysISO('2026-07-31', 1), '2026-08-01');
  assert.equal(U.addDaysISO('2026-01-01', -1), '2025-12-31');
  assert.equal(U.addDaysISO('2026-07-25', 0), '2026-07-25');
});

test('U.diffDays', () => {
  assert.equal(U.diffDays('2026-07-20', '2026-07-25'), 5);
  assert.equal(U.diffDays('2026-07-25', '2026-07-20'), -5);
  assert.equal(U.diffDays('2025-12-31', '2026-01-01'), 1);
});

test('U.startOfWeekISO retorna a segunda-feira', () => {
  assert.equal(U.startOfWeekISO('2024-01-10'), '2024-01-08'); // qua -> seg
  assert.equal(U.startOfWeekISO('2024-01-08'), '2024-01-08'); // seg -> seg
  assert.equal(U.startOfWeekISO('2024-01-14'), '2024-01-08'); // dom -> seg
  // propriedade: resultado sempre é segunda e no máximo 6 dias antes
  const r = U.startOfWeekISO(TODAY);
  assert.equal(U.parseISO(r).getDay(), 1);
  assert.ok(U.diffDays(r, TODAY) >= 0 && U.diffDays(r, TODAY) <= 6);
});

test('U.fmtMin formata minutos', () => {
  assert.equal(U.fmtMin(0), '0m');
  assert.equal(U.fmtMin(59), '59m');
  assert.equal(U.fmtMin(60), '1h');
  assert.equal(U.fmtMin(65), '1h 05m');
  assert.equal(U.fmtMin(605), '10h 05m');
  assert.equal(U.fmtMin(-10), '0m'); // nunca negativo
});

test('U.fmtHMS formata cronômetro', () => {
  assert.equal(U.fmtHMS(0), '0:00');
  assert.equal(U.fmtHMS(155000), '2:35');
  assert.equal(U.fmtHMS(3725000), '1:02:05');
});

test('U.isISO valida formato de data', () => {
  assert.ok(U.isISO('2026-07-25'));
  assert.ok(!U.isISO('25/07/2026'));
  assert.ok(!U.isISO('2026-7-5'));
  assert.ok(!U.isISO(null));
});

/* ============================================================
   02. Seed
   ============================================================ */
test('buildSeed: roadmap completo do prompt', () => {
  const s = buildSeed();
  assert.equal(s.phases.length, 5);
  assert.match(s.phases[0].name, /Fase 0/);
  assert.match(s.phases[4].name, /Arquitetura/);
  assert.deepEqual(s.phases.map(p => p.themes.length), [4, 5, 5, 4, 3]);
  const allTasks = s.phases.flatMap(p => p.themes.flatMap(t => t.tasks));
  assert.ok(allTasks.length >= 40, 'temas pré-populados com tarefas');
  assert.ok(allTasks.every(t => t.status === 'todo'));
  assert.equal(s.settings.weeklyGoalHours, 20);
  assert.equal(s.timer, null);
  // validação estrutural: o seed passa no próprio validador de import
  assert.equal(validateImport(s).ok, true);
});

/* ============================================================
   03. Validação e normalização (import)
   ============================================================ */
test('validateImport rejeita estruturas inválidas', () => {
  assert.equal(validateImport(null).ok, false);
  assert.equal(validateImport([1, 2]).ok, false);
  assert.equal(validateImport({}).ok, false);
  assert.equal(validateImport({ phases: 'x' }).ok, false);
  assert.equal(validateImport({ phases: [{ name: 1, themes: [] }] }).ok, false);
  assert.equal(validateImport({ phases: [] }).ok, true);
});

test('normalizeState(seed) é identidade (roundtrip de backup sem perdas)', () => {
  const seed = buildSeed();
  const round = normalizeState(JSON.parse(JSON.stringify(seed)));
  assert.deepEqual(round, seed);
});

test('normalizeState saneia dados sujos sem lançar', () => {
  const dirty = {
    version: 'x',
    settings: { weeklyGoalHours: -5 },
    phases: [
      null,
      {
        name: 'F1',
        themes: [{
          name: 'T1',
          tasks: [
            { title: '  ok  ', status: 'invalido' },
            { title: '' },            // descartada (sem título)
            'lixo',                    // descartada
          ],
          notes: [{ text: '' }, { text: 'nota válida' }],
          time: { '2026-07-25': 120, 'data-ruim': 30, '2026-07-24': -10, '2026-07-23': 99999 },
        }],
      },
    ],
    reminders: [
      { title: 'ok', date: '2026-08-01', time: '25:99', themeId: 'nao-existe' },
      { title: '', date: '2026-08-01' },       // descartado
      { title: 'sem data', date: 'xx' },        // descartado
    ],
    books: [
      { title: 'Livro', totalPages: 100, currentPage: 500, status: 'x', log: { '2026-07-01': 10 } },
      { title: '' },                             // descartado
    ],
    timer: { themeId: 'fantasma', startedAt: 123 },
  };
  const s = normalizeState(dirty);
  assert.equal(s.settings.weeklyGoalHours, 1); // clamp mínimo
  assert.equal(s.phases.length, 1);
  const theme = s.phases[0].themes[0];
  assert.equal(theme.tasks.length, 1);
  assert.equal(theme.tasks[0].title, 'ok');
  assert.equal(theme.tasks[0].status, 'todo');
  assert.equal(theme.notes.length, 1);
  assert.deepEqual(theme.time, { '2026-07-25': 120, '2026-07-23': MAX_DAY_MINUTES });
  assert.equal(s.reminders.length, 1);
  assert.equal(s.reminders[0].time, '');       // horário inválido vira vazio
  assert.equal(s.reminders[0].themeId, null);  // tema fantasma anulado
  assert.equal(s.books.length, 1);
  assert.equal(s.books[0].currentPage, 100);   // clamp ao total
  assert.equal(s.books[0].status, 'quero');
  assert.equal(s.timer, null);                 // timer de tema inexistente
});

test('normalizeState reancora timer com startedAt no futuro', () => {
  const seed = buildSeed();
  const themeId = seed.phases[0].themes[0].id;
  seed.timer = { themeId, startedAt: Date.now() + 9999999 };
  const s = normalizeState(seed);
  assert.ok(s.timer.startedAt <= Date.now());
  assert.equal(s.timer.themeId, themeId);
});

/* ============================================================
   04. Progresso e tempo
   ============================================================ */
test('progresso: tema vazio é 0%, contagem correta', () => {
  const { state, t1 } = tinyState();
  assert.deepEqual(Logic.themeProgress(t1), { done: 0, total: 0, pct: 0 });
  Actions.addTask(state, t1.id, 'a');
  Actions.addTask(state, t1.id, 'b');
  Actions.addTask(state, t1.id, 'c');
  Actions.updateTask(state, t1.tasks[0].id, { status: 'done' });
  Actions.updateTask(state, t1.tasks[1].id, { status: 'doing' });
  assert.deepEqual(Logic.themeProgress(t1), { done: 1, total: 3, pct: 33 });
  const overall = Logic.overallProgress(state);
  assert.equal(overall.total, 3);
  assert.equal(overall.done, 1);
});

test('logTime: soma, mescla no mesmo dia, rejeita inválidos e respeita teto diário', () => {
  const { state, t1 } = tinyState();
  assert.equal(Actions.logTime(state, t1.id, TODAY, 30), 30);
  assert.equal(Actions.logTime(state, t1.id, TODAY, 45), 45);
  assert.equal(t1.time[TODAY], 75);
  assert.equal(Actions.logTime(state, t1.id, TODAY, 0), 0);
  assert.equal(Actions.logTime(state, t1.id, TODAY, -5), 0);
  assert.equal(Actions.logTime(state, t1.id, 'data-ruim', 10), 0);
  assert.equal(Actions.logTime(state, 'tema-fantasma', TODAY, 10), 0);
  // teto: já tem 75, só cabem 1365
  assert.equal(Actions.logTime(state, t1.id, TODAY, 99999), MAX_DAY_MINUTES - 75);
  assert.equal(t1.time[TODAY], MAX_DAY_MINUTES);
  assert.equal(Actions.logTime(state, t1.id, TODAY, 10), 0); // dia cheio
});

test('totalMinutes e minutesByDate agregam entre temas', () => {
  const { state, t1, t2 } = tinyState();
  Actions.logTime(state, t1.id, TODAY, 30);
  Actions.logTime(state, t2.id, TODAY, 20);
  Actions.logTime(state, t2.id, '2026-07-20', 60);
  assert.equal(Logic.totalMinutes(state), 110);
  assert.equal(Logic.minutesByDate(state).get(TODAY), 50);
});

test('heatLevel: limiares 0/30/60/120', () => {
  assert.equal(Logic.heatLevel(0), 0);
  assert.equal(Logic.heatLevel(1), 1);
  assert.equal(Logic.heatLevel(29), 1);
  assert.equal(Logic.heatLevel(30), 2);
  assert.equal(Logic.heatLevel(59), 2);
  assert.equal(Logic.heatLevel(60), 3);
  assert.equal(Logic.heatLevel(119), 3);
  assert.equal(Logic.heatLevel(120), 4);
  assert.equal(Logic.heatLevel(1000), 4);
});

/* ============================================================
   05. Streak
   ============================================================ */
test('streak: casos base', () => {
  const { state, t1 } = tinyState();
  assert.equal(Logic.streak(state, TODAY), 0);
  Actions.logTime(state, t1.id, TODAY, 10);
  assert.equal(Logic.streak(state, TODAY), 1);
  Actions.logTime(state, t1.id, U.addDaysISO(TODAY, -1), 10);
  Actions.logTime(state, t1.id, U.addDaysISO(TODAY, -2), 10);
  assert.equal(Logic.streak(state, TODAY), 3);
});

test('streak: continua vivo se estudou ontem mas hoje ainda não', () => {
  const { state, t1 } = tinyState();
  Actions.logTime(state, t1.id, U.addDaysISO(TODAY, -1), 10);
  Actions.logTime(state, t1.id, U.addDaysISO(TODAY, -2), 10);
  assert.equal(Logic.streak(state, TODAY), 2);
});

test('streak: quebra com lacuna', () => {
  const { state, t1 } = tinyState();
  Actions.logTime(state, t1.id, U.addDaysISO(TODAY, -2), 10); // anteontem só
  assert.equal(Logic.streak(state, TODAY), 0);
  Actions.logTime(state, t1.id, TODAY, 10); // hoje, mas ontem vazio
  assert.equal(Logic.streak(state, TODAY), 1);
});

/* ============================================================
   06. Semana, períodos e meta
   ============================================================ */
test('weekRange e periodRange', () => {
  assert.deepEqual(Logic.weekRange(TODAY), { start: '2026-07-20', end: '2026-07-26' });
  assert.deepEqual(Logic.periodRange('today', TODAY), { start: TODAY, end: TODAY });
  assert.deepEqual(Logic.periodRange('month', TODAY), { start: '2026-07-01', end: '2026-07-31' });
  assert.equal(Logic.periodRange('all', TODAY), null);
});

test('weeklyGoal soma apenas a semana atual e limita pct a 100', () => {
  const { state, t1 } = tinyState();
  Actions.logTime(state, t1.id, '2026-07-20', 60);  // seg desta semana
  Actions.logTime(state, t1.id, TODAY, 30);          // sáb desta semana
  Actions.logTime(state, t1.id, '2026-07-19', 45);   // domingo anterior — fora
  const g = Logic.weeklyGoal(state, TODAY);
  assert.equal(g.minutes, 90);
  assert.equal(g.goalMin, 1200);
  assert.equal(g.pct, 8); // 90/1200 = 7.5% -> 8
  Actions.setWeeklyGoal(state, 1); // 60 min
  assert.equal(Logic.weeklyGoal(state, TODAY).pct, 100); // 90/60 clampado
});

test('setWeeklyGoal: clamp 1..168 e valores inválidos', () => {
  const { state } = tinyState();
  Actions.setWeeklyGoal(state, 500);
  assert.equal(state.settings.weeklyGoalHours, 168);
  Actions.setWeeklyGoal(state, 0);
  assert.equal(state.settings.weeklyGoalHours, 1);
  Actions.setWeeklyGoal(state, NaN);
  assert.equal(state.settings.weeklyGoalHours, 20); // default
});

test('distribution e topTheme', () => {
  const { state, t1, t2 } = tinyState();
  Actions.logTime(state, t1.id, TODAY, 30);
  Actions.logTime(state, t2.id, TODAY, 60);
  const dist = Logic.distribution(state, 'theme');
  assert.deepEqual(dist.map(d => d.label), ['Tema B', 'Tema A']);
  const byPhase = Logic.distribution(state, 'phase');
  assert.equal(byPhase.length, 1);
  assert.equal(byPhase[0].minutes, 90);
  assert.equal(Logic.topTheme(state, null).name, 'Tema B');
  // range que exclui tudo
  assert.equal(Logic.topTheme(state, { start: '2020-01-01', end: '2020-01-02' }), null);
});

/* ============================================================
   07. CRUD: fases, temas, tarefas, notas
   ============================================================ */
test('fases: criar, renomear, mover com limites, excluir', () => {
  const state = normalizeState({ phases: [] });
  const a = Actions.addPhase(state, '  A  ');
  const b = Actions.addPhase(state, 'B');
  assert.equal(a.name, 'A'); // trim
  assert.equal(Actions.movePhase(state, a.id, -1), false); // topo
  assert.equal(Actions.movePhase(state, a.id, 1), true);
  assert.deepEqual(state.phases.map(p => p.id), [b.id, a.id]);
  Actions.renamePhase(state, a.id, 'A2');
  assert.equal(Logic.findPhase(state, a.id).name, 'A2');
  Actions.renamePhase(state, a.id, '   '); // vazio ignorado
  assert.equal(Logic.findPhase(state, a.id).name, 'A2');
  Actions.deletePhase(state, b.id);
  assert.equal(state.phases.length, 1);
});

test('temas: mover dentro da fase e excluir limpa timer e lembretes', () => {
  const { state, phase, t1, t2 } = tinyState();
  assert.equal(Actions.moveTheme(state, t2.id, 1), false); // fundo
  assert.equal(Actions.moveTheme(state, t2.id, -1), true);
  assert.deepEqual(phase.themes.map(t => t.id), [t2.id, t1.id]);

  state.timer = { themeId: t1.id, startedAt: Date.now() };
  Actions.addReminder(state, { title: 'rev', date: TODAY, themeId: t1.id });
  Actions.deleteTheme(state, t1.id);
  assert.equal(state.timer, null);
  assert.equal(state.reminders[0].themeId, null);
  assert.equal(phase.themes.length, 1);
});

test('tarefas: ciclo de status todo->doing->done->todo', () => {
  const { state, t1 } = tinyState();
  const task = Actions.addTask(state, t1.id, 'estudar');
  assert.equal(task.status, 'todo');
  assert.equal(Actions.cycleTask(state, task.id), 'doing');
  assert.equal(Actions.cycleTask(state, task.id), 'done');
  assert.equal(Actions.cycleTask(state, task.id), 'todo');
});

test('tarefas: add trim/vazio, update inválido ignorado, delete', () => {
  const { state, t1 } = tinyState();
  assert.equal(Actions.addTask(state, t1.id, '   '), null);
  const task = Actions.addTask(state, t1.id, '  x  ');
  assert.equal(task.title, 'x');
  Actions.updateTask(state, task.id, { status: 'banana' });
  assert.equal(task.status, 'todo');
  Actions.updateTask(state, task.id, { title: 'y', status: 'done' });
  assert.equal(task.title, 'y');
  assert.equal(task.status, 'done');
  Actions.deleteTask(state, task.id);
  assert.equal(t1.tasks.length, 0);
});

test('tarefas: reordenação por passos e por índice (drag & drop)', () => {
  const { state, t1 } = tinyState();
  const ids = ['a', 'b', 'c', 'd'].map(x => Actions.addTask(state, t1.id, x).id);
  assert.equal(Actions.moveTask(state, ids[0], -1), false);
  assert.equal(Actions.moveTask(state, ids[3], 1), false);
  Actions.moveTask(state, ids[0], 1);
  assert.deepEqual(t1.tasks.map(t => t.title), ['b', 'a', 'c', 'd']);

  Actions.moveTaskTo(state, t1.id, ids[3], 0); // 'd' para o topo
  assert.deepEqual(t1.tasks.map(t => t.title), ['d', 'b', 'a', 'c']);
  Actions.moveTaskTo(state, t1.id, ids[3], 99); // clamp para o fim
  assert.deepEqual(t1.tasks.map(t => t.title), ['b', 'a', 'c', 'd']);
});

test('notas: criar (mais recente primeiro), editar, excluir', () => {
  const { state, t1 } = tinyState();
  Actions.addNote(state, t1.id, 'primeira');
  const n2 = Actions.addNote(state, t1.id, 'segunda');
  assert.deepEqual(t1.notes.map(n => n.text), ['segunda', 'primeira']);
  Actions.updateNote(state, n2.id, 'editada');
  assert.equal(t1.notes[0].text, 'editada');
  Actions.deleteNote(state, n2.id);
  assert.equal(t1.notes.length, 1);
  assert.equal(Actions.addNote(state, t1.id, '   '), null);
});

test('noteHTML: markdown-lite e proteção contra XSS', () => {
  const html = Logic.noteHTML('**forte** e *leve* com `SELECT 1`\n- item um\n- item dois\ntexto');
  assert.ok(html.includes('<strong>forte</strong>'));
  assert.ok(html.includes('<em>leve</em>'));
  assert.ok(html.includes('<code>SELECT 1</code>'));
  assert.ok(html.includes('<ul><li>item um</li><li>item dois</li></ul>'));
  assert.ok(html.includes('<p>texto</p>'));

  const evil = Logic.noteHTML('<script>window.x=1</script> **<img src=x onerror=alert(1)>**');
  assert.ok(!evil.includes('<script>'));
  assert.ok(!evil.includes('<img'));
  assert.ok(evil.includes('&lt;script&gt;'));
});

/* ============================================================
   08. Cronômetro
   ============================================================ */
test('cronômetro: sessão de 25 min é registrada no dia', () => {
  const { state, t1 } = tinyState();
  const t0 = 1_700_000_000_000;
  Actions.startTimer(state, t1.id, t0, TODAY);
  assert.equal(state.timer.themeId, t1.id);
  const res = Actions.stopTimer(state, t0 + 25 * 60000, TODAY);
  assert.deepEqual(res, { themeId: t1.id, minutes: 25, discarded: false });
  assert.equal(t1.time[TODAY], 25);
  assert.equal(state.timer, null);
});

test('cronômetro: sessão < 30s é descartada', () => {
  const { state, t1 } = tinyState();
  const t0 = 1_700_000_000_000;
  Actions.startTimer(state, t1.id, t0, TODAY);
  const res = Actions.stopTimer(state, t0 + 29000, TODAY);
  assert.equal(res.discarded, true);
  assert.equal(res.minutes, 0);
  assert.equal(t1.time[TODAY], undefined);
});

test('cronômetro: iniciar em outro tema registra a sessão anterior', () => {
  const { state, t1, t2 } = tinyState();
  const t0 = 1_700_000_000_000;
  Actions.startTimer(state, t1.id, t0, TODAY);
  const { previous } = Actions.startTimer(state, t2.id, t0 + 10 * 60000, TODAY);
  assert.equal(previous.minutes, 10);
  assert.equal(t1.time[TODAY], 10);
  assert.equal(state.timer.themeId, t2.id);
});

test('cronômetro: parar sem timer e iniciar em tema inexistente', () => {
  const { state } = tinyState();
  assert.equal(Actions.stopTimer(state, Date.now(), TODAY), null);
  Actions.startTimer(state, 'fantasma', Date.now(), TODAY);
  assert.equal(state.timer, null);
});

/* ============================================================
   09. Lembretes
   ============================================================ */
test('lembretes: criar valida título/data; tema fantasma vira null', () => {
  const { state, t1 } = tinyState();
  assert.equal(Actions.addReminder(state, { title: '', date: TODAY }), null);
  assert.equal(Actions.addReminder(state, { title: 'x', date: 'ruim' }), null);
  const r = Actions.addReminder(state, {
    title: 'Revisar SQL', date: '2026-08-01', time: '14:30', desc: 'caps 3', themeId: t1.id,
  });
  assert.equal(r.time, '14:30');
  assert.equal(r.themeId, t1.id);
  const r2 = Actions.addReminder(state, { title: 'y', date: TODAY, themeId: 'nope', time: 'zz' });
  assert.equal(r2.themeId, null);
  assert.equal(r2.time, '');
});

test('lembretes: ordenação no dia (sem horário vai para o fim) e próximos', () => {
  const { state } = tinyState();
  Actions.addReminder(state, { title: 'tarde', date: TODAY, time: '15:00' });
  Actions.addReminder(state, { title: 'sem-hora', date: TODAY });
  Actions.addReminder(state, { title: 'manhã', date: TODAY, time: '08:00' });
  Actions.addReminder(state, { title: 'ontem', date: U.addDaysISO(TODAY, -1) });
  Actions.addReminder(state, { title: 'amanhã', date: U.addDaysISO(TODAY, 1), time: '07:00' });

  assert.deepEqual(Logic.remindersOn(state, TODAY).map(r => r.title),
    ['manhã', 'tarde', 'sem-hora']);

  const up = Logic.upcomingReminders(state, TODAY, 10);
  assert.deepEqual(up.map(r => r.title), ['manhã', 'tarde', 'sem-hora', 'amanhã']);
  assert.equal(Logic.upcomingReminders(state, TODAY, 2).length, 2);
});

test('lembretes: editar e excluir', () => {
  const { state } = tinyState();
  const r = Actions.addReminder(state, { title: 'a', date: TODAY });
  Actions.updateReminder(state, r.id, { title: 'b', date: '2026-08-02', time: '10:00', desc: 'd' });
  assert.equal(r.title, 'b');
  assert.equal(r.date, '2026-08-02');
  Actions.deleteReminder(state, r.id);
  assert.equal(state.reminders.length, 0);
});

/* ============================================================
   10. Livros
   ============================================================ */
test('livros: cadastro com status define goalStart/finishedAt', () => {
  const { state } = tinyState();
  const quero = Actions.addBook(state, { title: 'A', totalPages: 100 }, TODAY);
  assert.equal(quero.status, 'quero');
  assert.equal(quero.goalStart, null);
  const lendo = Actions.addBook(state, { title: 'B', totalPages: 200, status: 'lendo', currentPage: 10, pagesPerDay: 5 }, TODAY);
  assert.deepEqual(lendo.goalStart, { date: TODAY, page: 10 });
  const lido = Actions.addBook(state, { title: 'C', totalPages: 50, status: 'lido' }, TODAY);
  assert.equal(lido.finishedAt, TODAY);
  assert.equal(Actions.addBook(state, { title: '  ' }, TODAY), null);
});

test('livros: bookStats — pct, restantes, previsão de término', () => {
  const book = {
    totalPages: 200, currentPage: 100, pagesPerDay: 10,
    status: 'lendo', goalStart: { date: TODAY, page: 100 }, log: {},
  };
  const s = Logic.bookStats(book, TODAY);
  assert.equal(s.pct, 50);
  assert.equal(s.remaining, 100);
  assert.equal(s.eta, '2026-08-04'); // hoje + ceil(100/10)
  assert.equal(s.delta, 0);          // meta começou hoje: em dia
});

test('livros: adiantado vs atrasado em relação à meta', () => {
  const mk = (cur) => ({
    totalPages: 200, currentPage: cur, pagesPerDay: 10,
    status: 'lendo', goalStart: { date: '2026-07-20', page: 0 }, log: {},
  });
  // 5 dias completos desde 20/07 => esperado 50 páginas
  assert.equal(Logic.bookStats(mk(40), TODAY).delta, -10); // atrasado
  assert.equal(Logic.bookStats(mk(60), TODAY).delta, 10);  // adiantado
  assert.equal(Logic.bookStats(mk(50), TODAY).delta, 0);   // em dia
  // sem meta => delta null
  const noGoal = { ...mk(40), pagesPerDay: 0, goalStart: null };
  assert.equal(Logic.bookStats(noGoal, TODAY).delta, null);
});

test('livros: setBookPage registra histórico e conclui automaticamente', () => {
  const { state } = tinyState();
  const b = Actions.addBook(state, { title: 'DDIA', totalPages: 200 }, TODAY);
  const r1 = Actions.setBookPage(state, b.id, 50, TODAY);
  assert.equal(r1.diff, 50);
  assert.equal(b.log[TODAY], 50);
  assert.equal(b.status, 'lendo'); // quero -> lendo automaticamente
  assert.ok(b.goalStart);

  // retroceder página não gera histórico negativo
  Actions.setBookPage(state, b.id, 40, TODAY);
  assert.equal(b.log[TODAY], 50);
  assert.equal(b.currentPage, 40);

  // terminar o livro
  const r3 = Actions.setBookPage(state, b.id, 200, TODAY);
  assert.equal(r3.finished, true);
  assert.equal(b.status, 'lido');
  assert.equal(b.finishedAt, TODAY);

  // clamp acima do total
  Actions.setBookPage(state, b.id, 999, TODAY);
  assert.equal(b.currentPage, 200);
});

test('livros: mudar meta reancora o ponto de partida; sair de "lido" limpa finishedAt', () => {
  const { state } = tinyState();
  const b = Actions.addBook(state, { title: 'X', totalPages: 100, status: 'lendo', pagesPerDay: 5 }, '2026-07-01');
  Actions.setBookPage(state, b.id, 30, '2026-07-10');
  Actions.updateBook(state, b.id, { pagesPerDay: 10 }, TODAY);
  assert.deepEqual(b.goalStart, { date: TODAY, page: 30 });
  Actions.updateBook(state, b.id, { status: 'lido' }, TODAY);
  assert.equal(b.finishedAt, TODAY);
  Actions.updateBook(state, b.id, { status: 'lendo' }, TODAY);
  assert.equal(b.finishedAt, null);
});

test('livros: booksOverview agrega o ano corrente', () => {
  const { state } = tinyState();
  const b1 = Actions.addBook(state, { title: 'este ano', totalPages: 10 }, TODAY);
  Actions.setBookPage(state, b1.id, 10, TODAY); // termina hoje
  const b2 = Actions.addBook(state, { title: 'ano passado', totalPages: 10, status: 'lido' }, TODAY);
  b2.finishedAt = '2025-03-01';
  b2.log = { '2025-02-01': 10 };
  const b3 = Actions.addBook(state, { title: 'lendo', totalPages: 300, status: 'lendo' }, TODAY);

  const ov = Logic.booksOverview(state, TODAY);
  assert.equal(ov.finishedThisYear, 1);
  assert.equal(ov.pagesThisYear, 10); // só o log de 2026
  assert.equal(ov.reading.id, b3.id);
});

/* ============================================================
   11. Estatísticas do card de compartilhamento
   ============================================================ */
test('shareStats: períodos, labels e frase estável', () => {
  const { state, t1, t2 } = tinyState();
  Actions.logTime(state, t1.id, TODAY, 60);                    // hoje
  Actions.logTime(state, t2.id, '2026-07-21', 90);             // semana
  Actions.logTime(state, t1.id, '2026-07-01', 120);            // mês
  Actions.logTime(state, t1.id, '2026-01-05', 45);             // só no geral

  const today = Logic.shareStats(state, 'today', TODAY);
  assert.equal(today.minutes, 60);
  assert.equal(today.periodLabel, 'HOJE');
  assert.equal(today.topTheme, 'Tema A');

  const week = Logic.shareStats(state, 'week', TODAY);
  assert.equal(week.minutes, 150);
  assert.equal(week.topTheme, 'Tema B'); // 90 > 60 na semana

  const month = Logic.shareStats(state, 'month', TODAY);
  assert.equal(month.minutes, 270);
  assert.equal(month.studyDays, 3);

  const all = Logic.shareStats(state, 'all', TODAY);
  assert.equal(all.minutes, 315);
  assert.equal(all.totalMinutes, 315);
  assert.ok(PHRASES.includes(all.phrase));
  assert.equal(all.phrase, Logic.shareStats(state, 'all', TODAY).phrase); // determinística
});

/* ============================================================
   12. Round-trip completo de backup (export -> import)
   ============================================================ */
test('backup: estado com dados de todas as áreas sobrevive a export/import', () => {
  const { state, t1 } = tinyState();
  Actions.addTask(state, t1.id, 'tarefa');
  Actions.cycleTask(state, t1.tasks[0].id);
  Actions.addNote(state, t1.id, '**nota**');
  Actions.logTime(state, t1.id, TODAY, 90);
  Actions.addReminder(state, { title: 'lembrete', date: '2026-08-10', time: '09:00', themeId: t1.id });
  const b = Actions.addBook(state, { title: 'Kimball', author: 'Ralph', totalPages: 400, status: 'lendo', pagesPerDay: 20 }, TODAY);
  Actions.setBookPage(state, b.id, 35, TODAY);
  Actions.setWeeklyGoal(state, 15);

  const exported = JSON.stringify(state, null, 2);
  const v = validateImport(JSON.parse(exported));
  assert.equal(v.ok, true);
  const imported = normalizeState(JSON.parse(exported));
  assert.deepEqual(imported, JSON.parse(JSON.stringify(state)));
});
