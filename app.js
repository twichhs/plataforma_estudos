/* ============================================================================
   Trajeto — Plataforma de acompanhamento de estudos (Engenharia de Dados)
   100% vanilla JS. Sem dependências. Persistência em localStorage.

   Organização do arquivo:
     01. Utilitários (datas, formatação, ids)
     02. Constantes e dados iniciais (seed)
     03. Normalização e validação de dados (import/backup)
     04. Lógica pura — cálculos (progresso, streak, metas, livros, share)
     05. Ações — mutações de estado (CRUD de tudo, cronômetro)
     06. Camada de navegador: storage, estado global, estado de UI
     07. Helpers de render (escape, tooltip, toast, modal, heatmap)
     08. Render das abas (dashboard, roadmap, lembretes, livros, share)
     09. Card de compartilhamento (canvas nativo)
     10. Eventos (delegação) e boot
     11. Exports para testes (Node)
   ========================================================================== */
'use strict';

/* ============================================================================
   01. UTILITÁRIOS
   ========================================================================== */
const U = {
  /** id curto e único o suficiente para uso local */
  uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },

  pad(n) { return String(n).padStart(2, '0'); },

  /** Date -> 'YYYY-MM-DD' no fuso local */
  toISO(d) {
    return `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}-${U.pad(d.getDate())}`;
  },

  /** 'YYYY-MM-DD' -> Date ao meio-dia local (evita bugs de DST) */
  parseISO(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  },

  isISO(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); },

  /** 'HH:MM' válido (00:00–23:59) */
  isTime(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); },

  todayISO() { return U.toISO(new Date()); },

  addDaysISO(iso, n) {
    const d = U.parseISO(iso);
    d.setDate(d.getDate() + n);
    return U.toISO(d);
  },

  /** dias inteiros de a até b (b - a) */
  diffDays(aISO, bISO) {
    return Math.round((U.parseISO(bISO) - U.parseISO(aISO)) / 86400000);
  },

  /** segunda-feira da semana da data */
  startOfWeekISO(iso) {
    const d = U.parseISO(iso);
    const off = (d.getDay() + 6) % 7; // seg=0 ... dom=6
    d.setDate(d.getDate() - off);
    return U.toISO(d);
  },

  clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); },

  /** minutos -> '42m' | '3h' | '3h 05m' */
  fmtMin(min) {
    min = Math.max(0, Math.round(min || 0));
    const h = Math.floor(min / 60), m = min % 60;
    if (h <= 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${U.pad(m)}m`;
  },

  /** ms decorridos -> '02:35' | '1:02:35' (cronômetro) */
  fmtHMS(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return h > 0 ? `${h}:${U.pad(m)}:${U.pad(ss)}` : `${m}:${U.pad(ss)}`;
  },

  /** '2026-07-25' -> '25 jul' (ou '25 jul 2026') */
  fmtDateBR(iso, withYear) {
    if (!U.isISO(iso)) return '';
    const d = U.parseISO(iso);
    const s = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
    return withYear ? `${s} ${d.getFullYear()}` : s;
  },

  /** rótulo amigável: hoje / amanhã / 25 jul */
  fmtDateRel(iso, todayISO) {
    const diff = U.diffDays(todayISO, iso);
    if (diff === 0) return 'hoje';
    if (diff === 1) return 'amanhã';
    return U.fmtDateBR(iso);
  },

  weekdayName(iso) {
    return WEEKDAYS_LONG[U.parseISO(iso).getDay()];
  },

  /** hash simples e estável para strings */
  hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  },
};

const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const WEEKDAYS_LONG = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const WEEKDAYS_MIN = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']; // semana começa na segunda

/* ============================================================================
   02. CONSTANTES E SEED
   ========================================================================== */
const STORE_KEY = 'trajeto:v1';
const STATE_VERSION = 1;
const TASK_STATUS = ['todo', 'doing', 'done'];
const TASK_STATUS_LABEL = { todo: 'não iniciada', doing: 'em andamento', done: 'concluída' };
const BOOK_STATUS = ['quero', 'lendo', 'lido'];
const BOOK_STATUS_LABEL = { quero: 'quero ler', lendo: 'lendo', lido: 'lido' };
const MAX_DAY_MINUTES = 1440; // teto de minutos registráveis por tema/dia

const PHRASES = [
  'Consistência vence intensidade.',
  'Um dia de cada vez, uma query de cada vez.',
  'Quem estuda todo dia não compete — domina.',
  'Pequenos commits diários, grandes releases na vida.',
  'Disciplina é o melhor pipeline.',
  'Aprender é o único ETL que ninguém te tira.',
  'Hoje melhor que ontem, amanhã melhor que hoje.',
  'A curva de aprendizado dói, mas compila.',
  'Dados não mentem: você está evoluindo.',
  'O futuro pertence a quem estuda no presente.',
];

/** Cria um tema vazio */
function makeTheme(name, tasks = []) {
  return {
    id: U.uid(),
    name,
    tasks: tasks.map(t => ({ id: U.uid(), title: t, status: 'todo' })),
    notes: [],
    time: {}, // { 'YYYY-MM-DD': minutos }
  };
}

/** Estado inicial com o roadmap real do usuário */
function buildSeed() {
  const phase = (name, themes) => ({ id: U.uid(), name, themes });
  const state = {
    version: STATE_VERSION,
    createdAt: new Date().toISOString(),
    settings: { weeklyGoalHours: 20 },
    phases: [
      phase('Fase 0 — Fundamentos', [
        makeTheme('SQL avançado', [
          'Window functions (OVER, PARTITION BY, frames)',
          'CTEs e subqueries correlacionadas',
          'Índices e planos de execução (EXPLAIN)',
          'Resolver 20 desafios (StrataScratch/LeetCode)',
        ]),
        makeTheme('Modelagem de Dados (Kimball)', [
          'Ler cap. 1–3 do The DW Toolkit (Kimball)',
          'Star schema vs snowflake — modelar um exemplo',
          'Slowly Changing Dimensions (tipos 1, 2 e 3)',
          'Modelar um mini-DW de e-commerce',
        ]),
        makeTheme('Python de engenharia', [
          'Estruturas de dados e comprehensions',
          'Tipagem, dataclasses e pydantic',
          'Testes com pytest',
          'Ambientes e empacotamento (uv/poetry)',
        ]),
        makeTheme('Git/GitHub', [
          'Branching, merge e rebase',
          'Pull requests e code review',
          'Hooks e conventional commits',
        ]),
      ]),
      phase('Fase 1 — Engenharia de Dados Core', [
        makeTheme('Linux/Shell', [
          'Navegação, permissões e processos',
          'pipes, grep, awk e sed',
          'cron e systemd básico',
        ]),
        makeTheme('Data Warehousing', [
          'Arquiteturas: staging, core e data marts',
          'Particionamento e clustering',
          'Ler cap. 4–6 do The DW Toolkit',
        ]),
        makeTheme('Spark/PySpark', [
          'RDDs vs DataFrames e lazy evaluation',
          'Joins, particionamento e shuffle',
          'Otimização: broadcast, cache e AQE',
        ]),
        makeTheme('Airflow', [
          'DAGs, operators e sensors',
          'Scheduling, backfill e catchup',
          'Deploy local com Docker',
        ]),
        makeTheme('Cloud (AWS)', [
          'S3, IAM e boas práticas',
          'Glue e Athena',
          'Redshift básico',
          'Lambda para eventos',
        ]),
      ]),
      phase('Fase 2 — Modern Data Stack', [
        makeTheme('dbt', [
          'Models, sources e tests',
          'Jinja e macros',
          'Incremental models',
          'Documentação e lineage',
        ]),
        makeTheme('Snowflake/BigQuery', [
          'Arquitetura e modelo de billing',
          'Time travel e zero-copy clone',
          'Otimização de custo e consulta',
        ]),
        makeTheme('Kafka/Streaming', [
          'Tópicos, partições e consumer groups',
          'Semântica exactly-once',
          'Kafka Connect e CDC (Debezium)',
        ]),
        makeTheme('Data Quality', [
          'Great Expectations / Soda',
          'Contratos de dados',
          'Observabilidade e alertas',
        ]),
        makeTheme('Modelagem Avançada', [
          'Data Vault 2.0',
          'One Big Table vs dimensional',
          'Metrics layer',
        ]),
      ]),
      phase('Fase 3 — MLE Bridge', [
        makeTheme('Estatística intermediária', [
          'Distribuições e inferência',
          'Testes de hipótese e p-valor',
          'Regressão linear e logística',
        ]),
        makeTheme('ML Systems', [
          'Feature stores',
          'Treino vs serving skew',
          'Pipelines de ML com sklearn',
        ]),
        makeTheme('MLOps', [
          'MLflow tracking',
          'Versionamento de dados e modelos (DVC)',
          'Monitoramento de drift',
        ]),
        makeTheme('Aplicação a Fraude/Precificação', [
          'Estudo de caso: detecção de fraude',
          'Features de risco em tempo real',
          'Modelos de precificação dinâmica',
        ]),
      ]),
      phase('Fase 4 — Arquitetura & Liderança', [
        makeTheme('System Design', [
          'Ler DDIA (cap. 1–4)',
          'CAP, consistência e replicação',
          'Desenhar uma plataforma de dados end-to-end',
        ]),
        makeTheme('Escala/FinOps', [
          'Otimização de custos em cloud',
          'Autoscaling e spot instances',
          'Chargeback e tagging',
        ]),
        makeTheme('Liderança Técnica', [
          'RFCs e design docs',
          'Mentoria e code review eficaz',
          'Comunicação com stakeholders',
        ]),
      ]),
    ],
    reminders: [],
    books: [],
    timer: null, // { themeId, startedAt(ms) }
  };

  // Nota de exemplo para mostrar a formatação disponível
  const sql = state.phases[0].themes[0];
  sql.notes.push({
    id: U.uid(),
    text: '**Window functions** operam sobre uma janela de linhas sem colapsar o resultado.\n' +
      '- `ROW_NUMBER()` numera sem empates\n- `RANK()` pula posições em empates\n' +
      '- `LAG()/LEAD()` acessam linhas vizinhas\n\n*Dica:* `PARTITION BY` reinicia a janela por grupo.',
    updatedAt: new Date().toISOString(),
  });
  return state;
}

/* ============================================================================
   03. NORMALIZAÇÃO E VALIDAÇÃO (import / storage corrompido)
   ========================================================================== */

/** Checagem estrutural mínima de um backup antes de importar */
function validateImport(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'O arquivo não contém um objeto JSON válido.' };
  }
  if (!Array.isArray(raw.phases)) {
    return { ok: false, error: 'Backup inválido: campo "phases" ausente ou malformado.' };
  }
  for (const p of raw.phases) {
    if (!p || typeof p !== 'object' || typeof p.name !== 'string' || !Array.isArray(p.themes)) {
      return { ok: false, error: 'Backup inválido: uma das fases está malformada.' };
    }
  }
  return { ok: true };
}

const num = (v, def = 0) => (typeof v === 'number' && isFinite(v) ? v : def);
const str = (v, def = '') => (typeof v === 'string' ? v : def);

/** Mapa de tempo saneado: só datas válidas e minutos 1..1440 */
function cleanTimeMap(t) {
  const out = {};
  if (t && typeof t === 'object' && !Array.isArray(t)) {
    for (const [k, v] of Object.entries(t)) {
      const m = Math.round(num(v));
      if (U.isISO(k) && m > 0) out[k] = Math.min(m, MAX_DAY_MINUTES);
    }
  }
  return out;
}

/**
 * Constrói um estado 100% válido a partir de dados possivelmente parciais
 * ou sujos (backup antigo, edição manual do JSON, etc.). Nunca lança.
 */
function normalizeState(raw) {
  raw = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const state = {
    version: STATE_VERSION,
    createdAt: str(raw.createdAt, new Date().toISOString()),
    settings: {
      weeklyGoalHours: U.clamp(num(raw.settings && raw.settings.weeklyGoalHours, 20), 1, 168),
    },
    phases: [],
    reminders: [],
    books: [],
    timer: null,
  };

  for (const p of Array.isArray(raw.phases) ? raw.phases : []) {
    if (!p || typeof p !== 'object') continue;
    const phase = { id: str(p.id) || U.uid(), name: str(p.name, 'Fase sem nome'), themes: [] };
    for (const t of Array.isArray(p.themes) ? p.themes : []) {
      if (!t || typeof t !== 'object') continue;
      const theme = {
        id: str(t.id) || U.uid(),
        name: str(t.name, 'Tema sem nome'),
        tasks: [],
        notes: [],
        time: cleanTimeMap(t.time),
      };
      for (const task of Array.isArray(t.tasks) ? t.tasks : []) {
        if (!task || typeof task !== 'object' || !str(task.title).trim()) continue;
        theme.tasks.push({
          id: str(task.id) || U.uid(),
          title: str(task.title).trim(),
          status: TASK_STATUS.includes(task.status) ? task.status : 'todo',
        });
      }
      for (const note of Array.isArray(t.notes) ? t.notes : []) {
        if (!note || typeof note !== 'object' || !str(note.text).trim()) continue;
        theme.notes.push({
          id: str(note.id) || U.uid(),
          text: str(note.text),
          updatedAt: str(note.updatedAt, new Date().toISOString()),
        });
      }
      phase.themes.push(theme);
    }
    state.phases.push(phase);
  }

  const themeIds = new Set();
  for (const p of state.phases) for (const t of p.themes) themeIds.add(t.id);

  for (const r of Array.isArray(raw.reminders) ? raw.reminders : []) {
    if (!r || typeof r !== 'object') continue;
    const title = str(r.title).trim();
    if (!title || !U.isISO(r.date)) continue;
    state.reminders.push({
      id: str(r.id) || U.uid(),
      title,
      date: r.date,
      time: U.isTime(str(r.time)) ? r.time : '',
      desc: str(r.desc),
      themeId: themeIds.has(r.themeId) ? r.themeId : null,
    });
  }

  for (const b of Array.isArray(raw.books) ? raw.books : []) {
    if (!b || typeof b !== 'object') continue;
    const title = str(b.title).trim();
    if (!title) continue;
    const totalPages = Math.max(0, Math.round(num(b.totalPages)));
    const book = {
      id: str(b.id) || U.uid(),
      title,
      author: str(b.author).trim(),
      cover: str(b.cover),
      totalPages,
      currentPage: U.clamp(Math.round(num(b.currentPage)), 0, totalPages || 0),
      pagesPerDay: Math.max(0, Math.round(num(b.pagesPerDay))),
      status: BOOK_STATUS.includes(b.status) ? b.status : 'quero',
      notes: str(b.notes),
      log: cleanTimeMap(b.log), // mesmo formato: {data: páginas}
      goalStart: null,
      finishedAt: U.isISO(b.finishedAt) ? b.finishedAt : null,
    };
    if (b.goalStart && typeof b.goalStart === 'object' && U.isISO(b.goalStart.date)) {
      book.goalStart = {
        date: b.goalStart.date,
        page: U.clamp(Math.round(num(b.goalStart.page)), 0, totalPages || 0),
      };
    }
    state.books.push(book);
  }

  if (raw.timer && typeof raw.timer === 'object' &&
      themeIds.has(raw.timer.themeId) && num(raw.timer.startedAt) > 0) {
    // startedAt no futuro (relógio mudou) => reancora no presente
    state.timer = {
      themeId: raw.timer.themeId,
      startedAt: Math.min(num(raw.timer.startedAt), Date.now()),
    };
  }
  return state;
}

/* ============================================================================
   04. LÓGICA PURA — cálculos derivados do estado
   ========================================================================== */
const Logic = {
  /* ---------- localizar entidades ---------- */
  findPhase(state, id) { return state.phases.find(p => p.id === id) || null; },

  findTheme(state, id) {
    for (const phase of state.phases) {
      const theme = phase.themes.find(t => t.id === id);
      if (theme) return { phase, theme };
    }
    return null;
  },

  findTask(state, id) {
    for (const phase of state.phases) {
      for (const theme of phase.themes) {
        const task = theme.tasks.find(t => t.id === id);
        if (task) return { phase, theme, task };
      }
    }
    return null;
  },

  findNote(state, id) {
    for (const phase of state.phases) {
      for (const theme of phase.themes) {
        const note = theme.notes.find(n => n.id === id);
        if (note) return { theme, note };
      }
    }
    return null;
  },

  /* ---------- progresso ---------- */
  taskCount(tasks) {
    const total = tasks.length;
    const done = tasks.filter(t => t.status === 'done').length;
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
  },

  themeProgress(theme) { return Logic.taskCount(theme.tasks); },

  phaseProgress(phase) {
    return Logic.taskCount(phase.themes.flatMap(t => t.tasks));
  },

  overallProgress(state) {
    return Logic.taskCount(state.phases.flatMap(p => p.themes.flatMap(t => t.tasks)));
  },

  /* ---------- tempo ---------- */
  themeMinutes(theme) {
    return Object.values(theme.time).reduce((a, b) => a + b, 0);
  },

  totalMinutes(state) {
    return state.phases.reduce(
      (sum, p) => sum + p.themes.reduce((s, t) => s + Logic.themeMinutes(t), 0), 0);
  },

  /** Map 'YYYY-MM-DD' -> minutos somando todos os temas */
  minutesByDate(state) {
    const map = new Map();
    for (const p of state.phases) {
      for (const t of p.themes) {
        for (const [d, m] of Object.entries(t.time)) {
          map.set(d, (map.get(d) || 0) + m);
        }
      }
    }
    return map;
  },

  /** minutos no intervalo inclusivo; range null = tudo */
  rangeMinutes(state, range) {
    let sum = 0;
    for (const [d, m] of Logic.minutesByDate(state)) {
      if (!range || (d >= range.start && d <= range.end)) sum += m;
    }
    return sum;
  },

  /** dias distintos com estudo no intervalo */
  rangeStudyDays(state, range) {
    let n = 0;
    for (const [d, m] of Logic.minutesByDate(state)) {
      if (m > 0 && (!range || (d >= range.start && d <= range.end))) n++;
    }
    return n;
  },

  /** streak de dias consecutivos (conta a partir de hoje, ou de ontem se hoje ainda não estudou) */
  streak(state, todayISO) {
    const dates = new Set();
    for (const [d, m] of Logic.minutesByDate(state)) if (m > 0) dates.add(d);
    let cursor = dates.has(todayISO) ? todayISO : U.addDaysISO(todayISO, -1);
    let n = 0;
    while (dates.has(cursor)) { n++; cursor = U.addDaysISO(cursor, -1); }
    return n;
  },

  weekRange(todayISO) {
    const start = U.startOfWeekISO(todayISO);
    return { start, end: U.addDaysISO(start, 6) };
  },

  monthRange(todayISO) {
    const d = U.parseISO(todayISO);
    const start = `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}-01`;
    const end = U.toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));
    return { start, end };
  },

  /** período do card: 'today' | 'week' | 'month' | 'all' -> range | null */
  periodRange(period, todayISO) {
    if (period === 'today') return { start: todayISO, end: todayISO };
    if (period === 'week') return Logic.weekRange(todayISO);
    if (period === 'month') return Logic.monthRange(todayISO);
    return null;
  },

  weeklyGoal(state, todayISO) {
    const range = Logic.weekRange(todayISO);
    const minutes = Logic.rangeMinutes(state, range);
    const goalMin = Math.round(state.settings.weeklyGoalHours * 60);
    return {
      range, minutes, goalMin,
      pct: goalMin ? U.clamp(Math.round((minutes / goalMin) * 100), 0, 100) : 0,
    };
  },

  /** distribuição de tempo por tema ou fase, ordenada desc, só > 0 */
  distribution(state, by) {
    const rows = [];
    if (by === 'phase') {
      for (const p of state.phases) {
        const m = p.themes.reduce((s, t) => s + Logic.themeMinutes(t), 0);
        if (m > 0) rows.push({ label: p.name, minutes: m });
      }
    } else {
      for (const p of state.phases) {
        for (const t of p.themes) {
          const m = Logic.themeMinutes(t);
          if (m > 0) rows.push({ label: t.name, minutes: m });
        }
      }
    }
    return rows.sort((a, b) => b.minutes - a.minutes);
  },

  /** tema com mais minutos no intervalo */
  topTheme(state, range) {
    let best = null;
    for (const p of state.phases) {
      for (const t of p.themes) {
        let m = 0;
        for (const [d, v] of Object.entries(t.time)) {
          if (!range || (d >= range.start && d <= range.end)) m += v;
        }
        if (m > 0 && (!best || m > best.minutes)) best = { name: t.name, minutes: m };
      }
    }
    return best;
  },

  /** intensidade do heatmap: 0..4 */
  heatLevel(minutes) {
    if (!minutes || minutes <= 0) return 0;
    if (minutes < 30) return 1;
    if (minutes < 60) return 2;
    if (minutes < 120) return 3;
    return 4;
  },

  /* ---------- lembretes ---------- */
  remindersOn(state, dateISO) {
    return state.reminders
      .filter(r => r.date === dateISO)
      .sort((a, b) => (a.time || '99') < (b.time || '99') ? -1 : 1);
  },

  upcomingReminders(state, todayISO, limit = 8) {
    return state.reminders
      .filter(r => r.date >= todayISO)
      .sort((a, b) => (a.date + (a.time || '99')) < (b.date + (b.time || '99')) ? -1 : 1)
      .slice(0, limit);
  },

  /* ---------- livros ---------- */
  bookStats(book, todayISO) {
    const total = book.totalPages || 0;
    const cur = U.clamp(book.currentPage || 0, 0, total || Infinity);
    const remaining = Math.max(0, total - cur);
    const pct = total ? Math.round((cur / total) * 100) : 0;
    const ppd = book.pagesPerDay || 0;

    let eta = null;
    if (remaining > 0 && ppd > 0) {
      eta = U.addDaysISO(todayISO, Math.ceil(remaining / ppd));
    }

    // adiantado/atrasado: páginas devidas desde o início da meta (dias completos)
    let delta = null;
    if (book.goalStart && ppd > 0 && book.status === 'lendo') {
      const daysElapsed = Math.max(0, U.diffDays(book.goalStart.date, todayISO));
      const expected = Math.min(total, book.goalStart.page + ppd * daysElapsed);
      delta = cur - expected;
    }
    return { total, cur, remaining, pct, eta, delta };
  },

  booksOverview(state, todayISO) {
    const year = todayISO.slice(0, 4);
    let finishedThisYear = 0, pagesThisYear = 0;
    for (const b of state.books) {
      if (b.finishedAt && b.finishedAt.startsWith(year)) finishedThisYear++;
      for (const [d, pages] of Object.entries(b.log)) {
        if (d.startsWith(year)) pagesThisYear += pages;
      }
    }
    const reading = state.books.find(b => b.status === 'lendo') || null;
    return { finishedThisYear, pagesThisYear, reading };
  },

  /* ---------- notas: markdown-lite seguro ---------- */
  escapeHTML(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  /** **negrito**, *itálico*, `código` e listas com "- ". Sempre escapa HTML antes. */
  noteHTML(text) {
    const inline = (s) => s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    const lines = Logic.escapeHTML(text).split('\n');
    let html = '', list = false;
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith('- ')) {
        if (!list) { html += '<ul>'; list = true; }
        html += `<li>${inline(t.slice(2))}</li>`;
      } else {
        if (list) { html += '</ul>'; list = false; }
        if (t) html += `<p>${inline(t)}</p>`;
      }
    }
    if (list) html += '</ul>';
    return html || '<p></p>';
  },

  /* ---------- estatísticas do card de compartilhamento ---------- */
  shareStats(state, period, todayISO) {
    const range = Logic.periodRange(period, todayISO);
    const labels = { today: 'HOJE', week: 'ESTA SEMANA', month: 'ESTE MÊS', all: 'GERAL' };
    const top = Logic.topTheme(state, range);
    const overall = Logic.overallProgress(state);
    return {
      period,
      periodLabel: labels[period] || 'GERAL',
      minutes: Logic.rangeMinutes(state, range),
      totalMinutes: Logic.totalMinutes(state),
      studyDays: Logic.rangeStudyDays(state, range),
      streak: Logic.streak(state, todayISO),
      topTheme: top ? top.name : '—',
      overallPct: overall.pct,
      doneTasks: overall.done,
      totalTasks: overall.total,
      phrase: PHRASES[U.hash(todayISO + period) % PHRASES.length],
      dateLabel: U.fmtDateBR(todayISO, true),
      byDate: Logic.minutesByDate(state),
      today: todayISO,
    };
  },
};

/* ============================================================================
   05. AÇÕES — mutações de estado (recebem o estado; não tocam DOM/storage)
   ========================================================================== */
const Actions = {
  /* ---------- fases ---------- */
  addPhase(state, name) {
    const phase = { id: U.uid(), name: name.trim() || 'Nova fase', themes: [] };
    state.phases.push(phase);
    return phase;
  },

  renamePhase(state, id, name) {
    const p = Logic.findPhase(state, id);
    if (p && name.trim()) p.name = name.trim();
  },

  deletePhase(state, id) {
    const p = Logic.findPhase(state, id);
    if (!p) return;
    if (state.timer && p.themes.some(t => t.id === state.timer.themeId)) state.timer = null;
    state.phases = state.phases.filter(x => x.id !== id);
  },

  movePhase(state, id, dir) {
    const i = state.phases.findIndex(p => p.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= state.phases.length) return false;
    [state.phases[i], state.phases[j]] = [state.phases[j], state.phases[i]];
    return true;
  },

  /* ---------- temas ---------- */
  addTheme(state, phaseId, name) {
    const p = Logic.findPhase(state, phaseId);
    if (!p) return null;
    const theme = makeTheme(name.trim() || 'Novo tema');
    p.themes.push(theme);
    return theme;
  },

  renameTheme(state, id, name) {
    const f = Logic.findTheme(state, id);
    if (f && name.trim()) f.theme.name = name.trim();
  },

  deleteTheme(state, id) {
    const f = Logic.findTheme(state, id);
    if (!f) return;
    if (state.timer && state.timer.themeId === id) state.timer = null;
    f.phase.themes = f.phase.themes.filter(t => t.id !== id);
    for (const r of state.reminders) if (r.themeId === id) r.themeId = null;
  },

  moveTheme(state, id, dir) {
    const f = Logic.findTheme(state, id);
    if (!f) return false;
    const arr = f.phase.themes;
    const i = arr.findIndex(t => t.id === id);
    const j = i + dir;
    if (j < 0 || j >= arr.length) return false;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return true;
  },

  /* ---------- tarefas ---------- */
  addTask(state, themeId, title) {
    const f = Logic.findTheme(state, themeId);
    if (!f || !title.trim()) return null;
    const task = { id: U.uid(), title: title.trim(), status: 'todo' };
    f.theme.tasks.push(task);
    return task;
  },

  updateTask(state, taskId, patch) {
    const f = Logic.findTask(state, taskId);
    if (!f) return;
    if (patch.title !== undefined && patch.title.trim()) f.task.title = patch.title.trim();
    if (patch.status !== undefined && TASK_STATUS.includes(patch.status)) f.task.status = patch.status;
  },

  /** não iniciada -> em andamento -> concluída -> não iniciada */
  cycleTask(state, taskId) {
    const f = Logic.findTask(state, taskId);
    if (!f) return null;
    const next = TASK_STATUS[(TASK_STATUS.indexOf(f.task.status) + 1) % TASK_STATUS.length];
    f.task.status = next;
    return next;
  },

  deleteTask(state, taskId) {
    const f = Logic.findTask(state, taskId);
    if (f) f.theme.tasks = f.theme.tasks.filter(t => t.id !== taskId);
  },

  moveTask(state, taskId, dir) {
    const f = Logic.findTask(state, taskId);
    if (!f) return false;
    const arr = f.theme.tasks;
    const i = arr.findIndex(t => t.id === taskId);
    const j = i + dir;
    if (j < 0 || j >= arr.length) return false;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return true;
  },

  /** usado pelo drag & drop: move para um índice absoluto dentro do mesmo tema */
  moveTaskTo(state, themeId, taskId, index) {
    const f = Logic.findTheme(state, themeId);
    if (!f) return false;
    const arr = f.theme.tasks;
    const i = arr.findIndex(t => t.id === taskId);
    if (i < 0) return false;
    const [task] = arr.splice(i, 1);
    arr.splice(U.clamp(index, 0, arr.length), 0, task);
    return true;
  },

  /* ---------- notas ---------- */
  addNote(state, themeId, text) {
    const f = Logic.findTheme(state, themeId);
    if (!f || !text.trim()) return null;
    const note = { id: U.uid(), text: text.trim(), updatedAt: new Date().toISOString() };
    f.theme.notes.unshift(note);
    return note;
  },

  updateNote(state, noteId, text) {
    const f = Logic.findNote(state, noteId);
    if (f && text.trim()) {
      f.note.text = text.trim();
      f.note.updatedAt = new Date().toISOString();
    }
  },

  deleteNote(state, noteId) {
    const f = Logic.findNote(state, noteId);
    if (f) f.theme.notes = f.theme.notes.filter(n => n.id !== noteId);
  },

  /* ---------- tempo de estudo ---------- */
  logTime(state, themeId, dateISO, minutes) {
    const f = Logic.findTheme(state, themeId);
    minutes = Math.round(minutes);
    if (!f || !U.isISO(dateISO) || minutes <= 0) return 0;
    const cur = f.theme.time[dateISO] || 0;
    const add = Math.min(minutes, MAX_DAY_MINUTES - cur);
    if (add <= 0) return 0;
    f.theme.time[dateISO] = cur + add;
    return add;
  },

  /** inicia cronômetro; se havia outro rodando, registra a sessão anterior antes */
  startTimer(state, themeId, nowMs, todayISO) {
    let previous = null;
    if (state.timer) previous = Actions.stopTimer(state, nowMs, todayISO);
    if (!Logic.findTheme(state, themeId)) return { previous };
    state.timer = { themeId, startedAt: nowMs };
    return { previous };
  },

  /** para o cronômetro; sessões < 30s são descartadas */
  stopTimer(state, nowMs, todayISO) {
    if (!state.timer) return null;
    const { themeId, startedAt } = state.timer;
    state.timer = null;
    const elapsedMs = Math.max(0, nowMs - startedAt);
    if (elapsedMs < 30000) return { themeId, minutes: 0, discarded: true };
    const minutes = Math.max(1, Math.round(elapsedMs / 60000));
    const logged = Actions.logTime(state, themeId, todayISO, minutes);
    return { themeId, minutes: logged, discarded: false };
  },

  /* ---------- lembretes ---------- */
  addReminder(state, data) {
    if (!str(data.title).trim() || !U.isISO(data.date)) return null;
    const r = {
      id: U.uid(),
      title: data.title.trim(),
      date: data.date,
      time: U.isTime(str(data.time)) ? data.time : '',
      desc: str(data.desc).trim(),
      themeId: Logic.findTheme(state, data.themeId) ? data.themeId : null,
    };
    state.reminders.push(r);
    return r;
  },

  updateReminder(state, id, data) {
    const r = state.reminders.find(x => x.id === id);
    if (!r) return;
    if (str(data.title).trim()) r.title = data.title.trim();
    if (U.isISO(data.date)) r.date = data.date;
    r.time = U.isTime(str(data.time)) ? data.time : '';
    r.desc = str(data.desc).trim();
    r.themeId = Logic.findTheme(state, data.themeId) ? data.themeId : null;
  },

  deleteReminder(state, id) {
    state.reminders = state.reminders.filter(r => r.id !== id);
  },

  setWeeklyGoal(state, hours) {
    state.settings.weeklyGoalHours = U.clamp(num(hours, 20), 1, 168);
  },

  /* ---------- livros ---------- */
  addBook(state, data, todayISO) {
    const title = str(data.title).trim();
    if (!title) return null;
    const totalPages = Math.max(0, Math.round(num(data.totalPages)));
    const status = BOOK_STATUS.includes(data.status) ? data.status : 'quero';
    const currentPage = U.clamp(Math.round(num(data.currentPage)), 0, totalPages || 0);
    const book = {
      id: U.uid(),
      title,
      author: str(data.author).trim(),
      cover: str(data.cover),
      totalPages,
      currentPage,
      pagesPerDay: Math.max(0, Math.round(num(data.pagesPerDay))),
      status,
      notes: '',
      log: {},
      goalStart: status === 'lendo' ? { date: todayISO, page: currentPage } : null,
      finishedAt: status === 'lido' ? todayISO : null,
    };
    state.books.push(book);
    return book;
  },

  updateBook(state, id, data, todayISO) {
    const b = state.books.find(x => x.id === id);
    if (!b) return;
    if (data.title !== undefined && str(data.title).trim()) b.title = data.title.trim();
    if (data.author !== undefined) b.author = str(data.author).trim();
    if (data.cover !== undefined) b.cover = str(data.cover);
    if (data.notes !== undefined) b.notes = str(data.notes);
    if (data.totalPages !== undefined) {
      b.totalPages = Math.max(0, Math.round(num(data.totalPages)));
      b.currentPage = U.clamp(b.currentPage, 0, b.totalPages || 0);
    }
    if (data.pagesPerDay !== undefined) {
      const ppd = Math.max(0, Math.round(num(data.pagesPerDay)));
      // meta alterada => reancora o ponto de partida do ritmo
      if (ppd !== b.pagesPerDay) {
        b.pagesPerDay = ppd;
        b.goalStart = ppd > 0 ? { date: todayISO, page: b.currentPage } : null;
      }
    }
    if (data.status !== undefined && BOOK_STATUS.includes(data.status) && data.status !== b.status) {
      b.status = data.status;
      if (b.status === 'lendo' && !b.goalStart) b.goalStart = { date: todayISO, page: b.currentPage };
      if (b.status === 'lido' && !b.finishedAt) b.finishedAt = todayISO;
      if (b.status !== 'lido') b.finishedAt = null;
    }
  },

  deleteBook(state, id) {
    state.books = state.books.filter(b => b.id !== id);
  },

  /** atualiza página atual, registra páginas lidas no dia e trata conclusão */
  setBookPage(state, id, page, dateISO) {
    const b = state.books.find(x => x.id === id);
    if (!b) return null;
    const target = U.clamp(Math.round(num(page, b.currentPage)), 0, b.totalPages || 0);
    const diff = target - b.currentPage;
    b.currentPage = target;
    if (diff > 0 && U.isISO(dateISO)) {
      b.log[dateISO] = (b.log[dateISO] || 0) + diff;
    }
    if (b.status === 'quero' && target > 0) {
      b.status = 'lendo';
      if (!b.goalStart) b.goalStart = { date: dateISO, page: target };
    }
    let finished = false;
    if (b.totalPages > 0 && target >= b.totalPages && b.status !== 'lido') {
      b.status = 'lido';
      b.finishedAt = dateISO;
      finished = true;
    }
    return { diff, finished };
  },
};

/* ============================================================================
   11-pré. EXPORTS PARA TESTES (Node) — o restante do arquivo é só navegador
   ========================================================================== */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    U, Logic, Actions, buildSeed, normalizeState, validateImport,
    TASK_STATUS, BOOK_STATUS, MAX_DAY_MINUTES, PHRASES, STATE_VERSION,
  };
}

/* ============================================================================
   06. CAMADA DE NAVEGADOR — storage, estado global e estado de UI
   ========================================================================== */
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  (function browserApp() {

    const Store = {
      memory: null, // fallback se localStorage indisponível (modo privado etc.)
      warned: false,
      load() {
        try {
          const raw = window.localStorage.getItem(STORE_KEY);
          return raw ? JSON.parse(raw) : null;
        } catch (e) {
          return this.memory ? JSON.parse(this.memory) : null;
        }
      },
      save(state) {
        const json = JSON.stringify(state);
        try {
          window.localStorage.setItem(STORE_KEY, json);
        } catch (e) {
          this.memory = json;
          if (!this.warned) {
            this.warned = true;
            toast('Não foi possível salvar no navegador — exporte um backup!', 'warn');
          }
        }
      },
    };

    let state; // estado persistido
    const ui = { // estado efêmero de interface (não persistido)
      tab: 'dashboard',
      openThemes: new Set(),
      collapsedPhases: new Set(),
      cal: null,           // { y, m } cursor do calendário
      selDay: U.todayISO(),
      distBy: 'theme',
      share: { period: 'week', fmt: 'square', tpl: 'aurora' },
      drag: null,          // drag & drop de tarefas
    };

    const $ = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
    const esc = Logic.escapeHTML;

    function save() { Store.save(state); }
    function commit() { save(); render(); }

    /* ========================================================================
       07. HELPERS DE RENDER
       ===================================================================== */

    /* ---------- toast ---------- */
    function toast(msg, type = 'ok') {
      const root = $('#toast-root');
      if (!root) return;
      const el = document.createElement('div');
      el.className = `toast toast-${type}`;
      el.textContent = msg;
      root.appendChild(el);
      setTimeout(() => el.classList.add('is-out'), 2800);
      setTimeout(() => el.remove(), 3300);
    }

    /* ---------- tooltip global (elementos com data-tip) ---------- */
    const tooltip = { el: null };
    function showTip(target) {
      const tip = $('#tooltip');
      const text = target.getAttribute('data-tip');
      if (!tip || !text) return;
      tip.textContent = text;
      tip.hidden = false;
      const r = target.getBoundingClientRect();
      const tr = tip.getBoundingClientRect();
      let x = r.left + r.width / 2 - tr.width / 2;
      x = U.clamp(x, 8, window.innerWidth - tr.width - 8);
      let y = r.top - tr.height - 8;
      if (y < 8) y = r.bottom + 8;
      tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y + window.scrollY)}px)`;
      tooltip.el = target;
    }
    function hideTip() {
      const tip = $('#tooltip');
      if (tip) tip.hidden = true;
      tooltip.el = null;
    }

    /* ---------- modal genérico ---------- */
    const modal = { onSubmit: null };

    function openModal(title, bodyHTML, { submitLabel = 'Salvar', onSubmit = null, danger = false } = {}) {
      const root = $('#modal-root');
      $('#modal-title').textContent = title;
      const form = $('#modal-form');
      form.innerHTML = bodyHTML + `
        <div class="modal-actions">
          <button type="button" class="btn" data-act="modal-close">Cancelar</button>
          <button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(submitLabel)}</button>
        </div>`;
      modal.onSubmit = onSubmit;
      root.hidden = false;
      requestAnimationFrame(() => {
        root.classList.add('is-open');
        const first = form.querySelector('input:not([type=hidden]), textarea, select');
        if (first) first.focus();
      });
    }

    function closeModal() {
      const root = $('#modal-root');
      root.classList.remove('is-open');
      modal.onSubmit = null;
      setTimeout(() => { root.hidden = true; $('#modal-form').innerHTML = ''; }, 150);
    }

    /* campos de formulário reutilizáveis */
    const field = {
      text: (name, label, value = '', opts = {}) => `
        <label class="field"><span>${esc(label)}</span>
          <input type="${opts.type || 'text'}" name="${name}" value="${esc(value)}"
            ${opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : ''}
            ${opts.required ? 'required' : ''} ${opts.min !== undefined ? `min="${opts.min}"` : ''}
            ${opts.max !== undefined ? `max="${opts.max}"` : ''} ${opts.step ? `step="${opts.step}"` : ''}>
        </label>`,
      textarea: (name, label, value = '', opts = {}) => `
        <label class="field"><span>${esc(label)}</span>
          <textarea name="${name}" rows="${opts.rows || 5}"
            ${opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : ''}
            ${opts.required ? 'required' : ''}>${esc(value)}</textarea>
          ${opts.hint ? `<small class="field-hint">${opts.hint}</small>` : ''}
        </label>`,
      select: (name, label, options, value) => `
        <label class="field"><span>${esc(label)}</span>
          <select name="${name}">
            ${options.map(o => `<option value="${esc(o.value)}" ${o.value === value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
          </select>
        </label>`,
    };

    function themeOptions(selected) {
      const opts = [{ value: '', label: '— nenhum —' }];
      for (const p of state.phases) {
        for (const t of p.themes) opts.push({ value: t.id, label: t.name });
      }
      return field.select('themeId', 'Tema associado (opcional)', opts, selected || '');
    }

    /* ---------- heatmap (GitHub-style) ---------- */
    /**
     * byDate: Map data->minutos | objeto {data: minutos}
     * weeks:  quantas colunas (semanas)
     * small:  células menores (mini-heatmap por tema)
     */
    function heatmapHTML(byDate, weeks, todayISO, { small = false, labels = true } = {}) {
      const get = byDate instanceof Map ? (d) => byDate.get(d) : (d) => byDate[d];
      const startMonday = U.addDaysISO(U.startOfWeekISO(todayISO), -(weeks - 1) * 7);
      let monthLabels = '';
      let cells = '';
      let lastMonth = -1;
      for (let w = 0; w < weeks; w++) {
        const colStart = U.addDaysISO(startMonday, w * 7);
        const m = U.parseISO(colStart).getMonth();
        if (labels) {
          monthLabels += `<span>${(m !== lastMonth && U.parseISO(colStart).getDate() <= 14) ? MONTHS_SHORT[m] : ''}</span>`;
          lastMonth = m;
        }
        for (let d = 0; d < 7; d++) {
          const date = U.addDaysISO(colStart, d);
          if (date > todayISO) {
            cells += '<i class="hm-cell is-future"></i>';
          } else {
            const min = get(date) || 0;
            const lvl = Logic.heatLevel(min);
            const wd = WEEKDAYS_LONG[U.parseISO(date).getDay()];
            cells += `<i class="hm-cell l${lvl}" data-tip="${esc(`${wd}, ${U.fmtDateBR(date)} · ${min > 0 ? U.fmtMin(min) : 'sem estudo'}`)}"></i>`;
          }
        }
      }
      const wdCol = labels
        ? `<div class="hm-wd"><span></span><span>ter</span><span></span><span>qui</span><span></span><span>sáb</span><span></span></div>`
        : '';
      return `
        <div class="hm ${small ? 'hm-small' : ''}" style="--hm-weeks:${weeks}">
          ${labels ? `<div class="hm-months">${monthLabels}</div>` : ''}
          <div class="hm-body">${wdCol}<div class="hm-grid">${cells}</div></div>
        </div>`;
    }

    function heatLegendHTML() {
      return `<div class="hm-legend"><span>menos</span>
        <i class="hm-cell l0"></i><i class="hm-cell l1"></i><i class="hm-cell l2"></i>
        <i class="hm-cell l3"></i><i class="hm-cell l4"></i><span>mais</span></div>`;
    }

    function progressBarHTML(pct, cls = '') {
      return `<div class="progress ${cls}"><i style="width:${U.clamp(pct, 0, 100)}%"></i></div>`;
    }

    /* ========================================================================
       08. RENDER DAS ABAS
       ===================================================================== */

    function render() {
      renderTimerPill();
      const fn = {
        dashboard: renderDashboard,
        roadmap: renderRoadmap,
        reminders: renderReminders,
        books: renderBooks,
        share: renderShare,
      }[ui.tab];
      if (fn) fn();
    }

    function switchTab(tab) {
      ui.tab = tab;
      $$('.tab').forEach(b => {
        const on = b.dataset.tab === tab;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on);
      });
      $$('.tab-panel').forEach(p => { p.hidden = p.id !== `tab-${tab}`; });
      render();
    }

    /* ---------------------- DASHBOARD ---------------------- */
    function renderDashboard() {
      const today = U.todayISO();
      const total = Logic.totalMinutes(state);
      const overall = Logic.overallProgress(state);
      const streak = Logic.streak(state, today);
      const goal = Logic.weeklyGoal(state, today);
      const byDate = Logic.minutesByDate(state);
      const studiedToday = (byDate.get(today) || 0) > 0;
      const dist = Logic.distribution(state, ui.distBy);
      const maxDist = dist.length ? dist[0].minutes : 0;

      const streakSub = studiedToday
        ? 'estudou hoje ✓'
        : (streak > 0 ? 'estude hoje para manter' : 'comece hoje mesmo');

      $('#tab-dashboard').innerHTML = `
        <div class="stat-grid">
          <div class="stat-card stat-hero">
            <span class="stat-label">Total estudado</span>
            <span class="stat-value">${U.fmtMin(total)}</span>
            <span class="stat-sub">${U.fmtMin(goal.minutes)} esta semana</span>
          </div>
          <div class="stat-card">
            <span class="stat-label">Roadmap</span>
            <span class="stat-value">${overall.pct}%</span>
            ${progressBarHTML(overall.pct, 'progress-sm')}
            <span class="stat-sub">${overall.done} de ${overall.total} tarefas</span>
          </div>
          <div class="stat-card">
            <span class="stat-label">Streak</span>
            <span class="stat-value">${streak} ${streak === 1 ? 'dia' : 'dias'} <em class="flame ${streak > 0 ? 'is-on' : ''}">🔥</em></span>
            <span class="stat-sub">${streakSub}</span>
          </div>
          <div class="stat-card">
            <span class="stat-label">Meta semanal</span>
            <span class="stat-value">${goal.pct}%</span>
            ${progressBarHTML(goal.pct, 'progress-sm')}
            <span class="stat-sub">${U.fmtMin(goal.minutes)} de ${U.fmtMin(goal.goalMin)}</span>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <h3>Constância</h3>
            <span class="card-hint">últimas 20 semanas</span>
          </div>
          <div class="hm-scroll">${heatmapHTML(byDate, 20, today)}</div>
          ${heatLegendHTML()}
        </div>

        <div class="card">
          <div class="card-head">
            <h3>Distribuição de tempo</h3>
            <div class="segmented" role="group" aria-label="Agrupar por">
              <button class="${ui.distBy === 'theme' ? 'is-active' : ''}" data-act="dist-by" data-by="theme">Por tema</button>
              <button class="${ui.distBy === 'phase' ? 'is-active' : ''}" data-act="dist-by" data-by="phase">Por fase</button>
            </div>
          </div>
          ${dist.length === 0 ? `
            <div class="empty">
              <p>Nenhum tempo registrado ainda.</p>
              <p class="empty-sub">Use o cronômetro em um tema do Roadmap — as horas aparecem aqui.</p>
            </div>` : `
            <div class="bars">
              ${dist.slice(0, 12).map(row => `
                <div class="bar-row" data-tip="${esc(`${row.label} · ${U.fmtMin(row.minutes)}`)}">
                  <span class="bar-label">${esc(row.label)}</span>
                  <span class="bar-track"><i style="width:${Math.max(2, Math.round(row.minutes / maxDist * 100))}%"></i></span>
                  <span class="bar-value">${U.fmtMin(row.minutes)}</span>
                </div>`).join('')}
            </div>`}
        </div>`;
    }

    /* ---------------------- ROADMAP ---------------------- */
    function renderRoadmap() {
      const nThemes = state.phases.reduce((s, p) => s + p.themes.length, 0);
      const overall = Logic.overallProgress(state);
      $('#tab-roadmap').innerHTML = `
        <div class="page-head">
          <p class="lede">${state.phases.length} fases · ${nThemes} temas · ${overall.done}/${overall.total} tarefas concluídas</p>
          <button class="btn btn-primary" data-act="phase-add">+ Nova fase</button>
        </div>
        ${state.phases.length === 0 ? `
          <div class="empty card"><p>Nenhuma fase ainda.</p>
          <p class="empty-sub">Crie a primeira fase do seu roadmap.</p></div>` : ''}
        ${state.phases.map((phase, pi) => renderPhase(phase, pi)).join('')}`;
    }

    function renderPhase(phase, pi) {
      const prog = Logic.phaseProgress(phase);
      const minutes = phase.themes.reduce((s, t) => s + Logic.themeMinutes(t), 0);
      const collapsed = ui.collapsedPhases.has(phase.id);
      return `
      <section class="phase ${collapsed ? 'is-collapsed' : ''}" data-phase="${phase.id}">
        <header class="phase-head" data-act="phase-toggle" data-id="${phase.id}">
          <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m8.6 5.6 6.4 6.4-6.4 6.4L7.2 17l5-5-5-5 1.4-1.4Z"/></svg>
          <h2>${esc(phase.name)}</h2>
          <span class="phase-meta">${prog.done}/${prog.total} tarefas${minutes > 0 ? ` · ${U.fmtMin(minutes)}` : ''}</span>
          <div class="phase-bar">${progressBarHTML(prog.pct, 'progress-sm')}</div>
          <div class="row-actions">
            <button class="icon-btn sm" data-act="phase-up" data-id="${phase.id}" title="Mover para cima" ${pi === 0 ? 'disabled' : ''}>↑</button>
            <button class="icon-btn sm" data-act="phase-down" data-id="${phase.id}" title="Mover para baixo" ${pi === state.phases.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="icon-btn sm" data-act="phase-rename" data-id="${phase.id}" title="Renomear">✎</button>
            <button class="icon-btn sm danger" data-act="phase-del" data-id="${phase.id}" title="Excluir fase">✕</button>
          </div>
        </header>
        <div class="phase-body">
          <div class="themes-grid">
            ${phase.themes.map((t, ti) => renderThemeCard(t, ti, phase)).join('')}
            <button class="theme-ghost" data-act="theme-add" data-phase="${phase.id}">+ Tema</button>
          </div>
        </div>
      </section>`;
    }

    function renderThemeCard(theme, ti, phase) {
      const prog = Logic.themeProgress(theme);
      const minutes = Logic.themeMinutes(theme);
      const open = ui.openThemes.has(theme.id);
      const running = state.timer && state.timer.themeId === theme.id;
      const today = U.todayISO();

      return `
      <article class="theme ${open ? 'is-open' : ''} ${running ? 'is-running' : ''}" data-theme="${theme.id}">
        <header class="theme-head" data-act="theme-open" data-id="${theme.id}">
          <div class="theme-title">
            <h3>${esc(theme.name)}</h3>
            <div class="row-actions">
              <button class="icon-btn sm" data-act="theme-up" data-id="${theme.id}" title="Mover para cima" ${ti === 0 ? 'disabled' : ''}>↑</button>
              <button class="icon-btn sm" data-act="theme-down" data-id="${theme.id}" title="Mover para baixo" ${ti === phase.themes.length - 1 ? 'disabled' : ''}>↓</button>
              <button class="icon-btn sm" data-act="theme-rename" data-id="${theme.id}" title="Renomear">✎</button>
              <button class="icon-btn sm danger" data-act="theme-del" data-id="${theme.id}" title="Excluir tema">✕</button>
            </div>
          </div>
          <div class="theme-stats">
            <span class="theme-time" title="Tempo total estudado">${U.fmtMin(minutes)}</span>
            <span class="theme-count">${prog.done}/${prog.total}</span>
          </div>
          ${progressBarHTML(prog.pct)}
        </header>

        <div class="theme-body">
          <div class="theme-timebox">
            <button class="btn timer-btn ${running ? 'is-running' : ''}" data-act="timer-toggle" data-id="${theme.id}">
              ${running
                ? `<span class="rec-dot"></span> Parar · <span class="timer-live" data-live="${theme.id}">${U.fmtHMS(Date.now() - state.timer.startedAt)}</span>`
                : `▶ Estudar agora`}
            </button>
            <button class="btn btn-ghost" data-act="time-manual" data-id="${theme.id}">+ tempo manual</button>
          </div>

          <div class="theme-heatmap">
            ${heatmapHTML(theme.time, 12, today, { small: true, labels: false })}
          </div>

          <div class="tasks">
            <ul class="task-list" data-theme="${theme.id}">
              ${theme.tasks.map((task, i) => `
                <li class="task st-${task.status}" draggable="true" data-task="${task.id}">
                  <button class="task-status" data-act="task-cycle" data-id="${task.id}"
                    title="${TASK_STATUS_LABEL[task.status]} — clique para alternar" aria-label="Status: ${TASK_STATUS_LABEL[task.status]}">
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <circle cx="10" cy="10" r="8" class="ts-ring"/>
                      ${task.status === 'doing' ? '<path class="ts-half" d="M10 2a8 8 0 0 1 0 16Z"/>' : ''}
                      ${task.status === 'done' ? '<circle cx="10" cy="10" r="8" class="ts-fill"/><path class="ts-check" d="m6 10.2 2.6 2.6L14 7.4"/>' : ''}
                    </svg>
                  </button>
                  <span class="task-title" data-act="task-edit" data-id="${task.id}" title="Editar tarefa">${esc(task.title)}</span>
                  <span class="row-actions">
                    <button class="icon-btn sm" data-act="task-up" data-id="${task.id}" ${i === 0 ? 'disabled' : ''} title="Subir">↑</button>
                    <button class="icon-btn sm" data-act="task-down" data-id="${task.id}" ${i === theme.tasks.length - 1 ? 'disabled' : ''} title="Descer">↓</button>
                    <button class="icon-btn sm danger" data-act="task-del" data-id="${task.id}" title="Remover">✕</button>
                  </span>
                </li>`).join('')}
            </ul>
            <form class="task-add" data-form="task-add" data-theme="${theme.id}">
              <input type="text" name="title" placeholder="+ nova tarefa ou material" autocomplete="off" required>
            </form>
          </div>

          <div class="notes">
            <div class="notes-head">
              <h4>Notas <span class="count">${theme.notes.length}</span></h4>
              <button class="btn btn-ghost sm" data-act="note-add" data-theme="${theme.id}">+ nota</button>
            </div>
            ${theme.notes.map(note => `
              <div class="note">
                <div class="note-body">${Logic.noteHTML(note.text)}</div>
                <div class="row-actions">
                  <button class="icon-btn sm" data-act="note-edit" data-id="${note.id}" title="Editar">✎</button>
                  <button class="icon-btn sm danger" data-act="note-del" data-id="${note.id}" title="Remover">✕</button>
                </div>
              </div>`).join('')}
          </div>
        </div>
      </article>`;
    }

    /* ---------------------- LEMBRETES ---------------------- */
    function renderReminders() {
      const today = U.todayISO();
      if (!ui.cal) {
        const d = U.parseISO(today);
        ui.cal = { y: d.getFullYear(), m: d.getMonth() };
      }
      const { y, m } = ui.cal;
      const byDate = Logic.minutesByDate(state);
      const goal = Logic.weeklyGoal(state, today);
      const upcoming = Logic.upcomingReminders(state, today, 8);
      const remDates = new Set(state.reminders.map(r => r.date));

      // grade 6x7 começando na segunda
      const first = new Date(y, m, 1, 12);
      const offset = (first.getDay() + 6) % 7;
      const gridStart = new Date(y, m, 1 - offset, 12);
      let cells = '';
      for (let i = 0; i < 42; i++) {
        const d = new Date(gridStart); d.setDate(gridStart.getDate() + i);
        const iso = U.toISO(d);
        const out = d.getMonth() !== m;
        const nRem = remDates.has(iso) ? Logic.remindersOn(state, iso).length : 0;
        const studied = (byDate.get(iso) || 0) > 0;
        cells += `
          <button class="cal-day ${out ? 'is-out' : ''} ${iso === today ? 'is-today' : ''}
            ${iso === ui.selDay ? 'is-sel' : ''} ${studied ? 'has-study' : ''}"
            data-act="cal-day" data-date="${iso}" aria-label="${U.fmtDateBR(iso, true)}">
            <span>${d.getDate()}</span>
            ${nRem > 0 ? `<i class="cal-dots">${'•'.repeat(Math.min(nRem, 3))}</i>` : ''}
          </button>`;
      }

      const selRems = Logic.remindersOn(state, ui.selDay);
      const themeName = (id) => {
        const f = id && Logic.findTheme(state, id);
        return f ? f.theme.name : null;
      };

      $('#tab-reminders').innerHTML = `
        <div class="rem-layout">
          <div class="card cal-card">
            <div class="cal-head">
              <button class="icon-btn" data-act="cal-prev" aria-label="Mês anterior">‹</button>
              <h3>${MONTHS_LONG[m]} ${y}</h3>
              <button class="icon-btn" data-act="cal-next" aria-label="Próximo mês">›</button>
              <button class="btn btn-ghost sm" data-act="cal-today">hoje</button>
            </div>
            <div class="cal-grid">
              ${WEEKDAYS_MIN.map(w => `<span class="cal-wd">${w}</span>`).join('')}
              ${cells}
            </div>
            <div class="cal-legend">
              <span><i class="dot-rem"></i> lembrete</span>
              <span><i class="dot-study"></i> dia estudado</span>
            </div>

            <div class="cal-daypanel">
              <div class="cal-daypanel-head">
                <h4>${U.weekdayName(ui.selDay)}, ${U.fmtDateBR(ui.selDay, true)}</h4>
                <button class="btn btn-primary sm" data-act="rem-add" data-date="${ui.selDay}">+ lembrete</button>
              </div>
              ${selRems.length === 0
                ? `<p class="empty-sub">Sem lembretes neste dia.</p>`
                : selRems.map(r => `
                  <div class="rem-item">
                    <span class="rem-time">${r.time || '—'}</span>
                    <div class="rem-info">
                      <strong>${esc(r.title)}</strong>
                      ${r.desc ? `<p>${esc(r.desc)}</p>` : ''}
                      ${themeName(r.themeId) ? `<span class="chip">${esc(themeName(r.themeId))}</span>` : ''}
                    </div>
                    <span class="row-actions">
                      <button class="icon-btn sm" data-act="rem-edit" data-id="${r.id}" title="Editar">✎</button>
                      <button class="icon-btn sm danger" data-act="rem-del" data-id="${r.id}" title="Remover">✕</button>
                    </span>
                  </div>`).join('')}
            </div>
          </div>

          <div class="rem-side">
            <div class="card goal-card">
              <div class="card-head"><h3>Meta semanal</h3></div>
              <label class="goal-input">
                <input type="number" id="goal-hours" min="1" max="168" step="0.5"
                  value="${state.settings.weeklyGoalHours}"> <span>horas/semana</span>
              </label>
              <div class="goal-big">${U.fmtMin(goal.minutes)} <span>de ${U.fmtMin(goal.goalMin)}</span></div>
              ${progressBarHTML(goal.pct)}
              <p class="stat-sub">${goal.minutes >= goal.goalMin
                ? 'meta cumprida — continue assim! 🎉'
                : `faltam ${U.fmtMin(goal.goalMin - goal.minutes)} · semana de ${U.fmtDateBR(goal.range.start)} a ${U.fmtDateBR(goal.range.end)}`}</p>
            </div>

            <div class="card">
              <div class="card-head"><h3>Próximos lembretes</h3></div>
              ${upcoming.length === 0
                ? `<p class="empty-sub">Nada agendado. Crie um lembrete no calendário.</p>`
                : upcoming.map(r => `
                  <div class="rem-item compact" data-act="rem-goto" data-date="${r.date}">
                    <span class="rem-when">${U.fmtDateRel(r.date, today)}${r.time ? ` · ${r.time}` : ''}</span>
                    <div class="rem-info"><strong>${esc(r.title)}</strong>
                    ${themeName(r.themeId) ? `<span class="chip">${esc(themeName(r.themeId))}</span>` : ''}</div>
                  </div>`).join('')}
            </div>
          </div>
        </div>`;
    }

    /* ---------------------- LIVROS ---------------------- */
    function coverHTML(book) {
      if (book.cover) {
        return `<img src="${esc(book.cover)}" alt="Capa de ${esc(book.title)}" loading="lazy"
          onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'cover-ph',textContent:${JSON.stringify(book.title.slice(0, 2).toUpperCase())}}))">`;
      }
      const hue = U.hash(book.title) % 360;
      return `<div class="cover-ph" style="--ph:${hue}">${esc(book.title.slice(0, 2).toUpperCase())}</div>`;
    }

    function renderBooks() {
      const today = U.todayISO();
      const ov = Logic.booksOverview(state, today);
      const readingStats = ov.reading ? Logic.bookStats(ov.reading, today) : null;

      $('#tab-books').innerHTML = `
        <div class="stat-grid stat-grid-3">
          <div class="stat-card">
            <span class="stat-label">Lidos no ano</span>
            <span class="stat-value">${ov.finishedThisYear}</span>
            <span class="stat-sub">${U.parseISO(today).getFullYear()}</span>
          </div>
          <div class="stat-card">
            <span class="stat-label">Páginas no ano</span>
            <span class="stat-value">${ov.pagesThisYear}</span>
            <span class="stat-sub">registradas no histórico</span>
          </div>
          <div class="stat-card ${ov.reading ? 'stat-hero' : ''}">
            <span class="stat-label">Lendo agora</span>
            ${ov.reading
              ? `<span class="stat-value sm-text">${esc(ov.reading.title)}</span>
                 ${progressBarHTML(readingStats.pct, 'progress-sm')}
                 <span class="stat-sub">${readingStats.pct}% · página ${readingStats.cur} de ${readingStats.total}</span>`
              : `<span class="stat-value sm-text">—</span><span class="stat-sub">nenhum livro em andamento</span>`}
          </div>
        </div>

        <div class="page-head">
          <p class="lede">${state.books.length} ${state.books.length === 1 ? 'livro' : 'livros'} na estante</p>
          <button class="btn btn-primary" data-act="book-add">+ Novo livro</button>
        </div>

        ${state.books.length === 0 ? `
          <div class="empty card">
            <p>Estante vazia.</p>
            <p class="empty-sub">Cadastre um livro com meta de páginas/dia e acompanhe o ritmo de leitura.</p>
          </div>` : `
          <div class="books-grid">${state.books.map(b => renderBookCard(b, today)).join('')}</div>`}`;
    }

    function renderBookCard(book, today) {
      const s = Logic.bookStats(book, today);
      // mini-gráfico: páginas lidas nos últimos 14 dias
      const days = [];
      let maxPages = 0;
      for (let i = 13; i >= 0; i--) {
        const d = U.addDaysISO(today, -i);
        const pages = book.log[d] || 0;
        maxPages = Math.max(maxPages, pages);
        days.push({ d, pages });
      }
      const paceChip = (s.delta === null || book.status !== 'lendo') ? '' :
        s.delta > 0 ? `<span class="chip chip-good">▲ ${s.delta} pág. adiantado</span>` :
        s.delta < 0 ? `<span class="chip chip-warn">▼ ${-s.delta} pág. atrasado</span>` :
        `<span class="chip chip-good">✓ em dia</span>`;

      return `
      <article class="book st-${book.status}" data-book="${book.id}">
        <div class="book-cover">${coverHTML(book)}</div>
        <div class="book-info">
          <div class="book-top">
            <h3>${esc(book.title)}</h3>
            <span class="chip st-chip">${BOOK_STATUS_LABEL[book.status]}</span>
            <span class="row-actions">
              <button class="icon-btn sm" data-act="book-edit" data-id="${book.id}" title="Editar">✎</button>
              <button class="icon-btn sm danger" data-act="book-del" data-id="${book.id}" title="Remover">✕</button>
            </span>
          </div>
          ${book.author ? `<p class="book-author">${esc(book.author)}</p>` : ''}

          ${book.totalPages > 0 ? `
            ${progressBarHTML(s.pct)}
            <div class="book-meta">
              <span>${s.cur}/${s.total} pág. · <strong>${s.pct}%</strong></span>
              ${s.remaining > 0 ? `<span>faltam ${s.remaining}</span>` : `<span class="chip chip-good">concluído 🎉</span>`}
            </div>
            <div class="book-chips">
              ${book.pagesPerDay > 0 && s.remaining > 0 ? `<span class="chip">${book.pagesPerDay} pág/dia</span>` : ''}
              ${s.eta ? `<span class="chip" data-tip="ritmo de ${book.pagesPerDay} pág/dia">termina ~ ${U.fmtDateBR(s.eta)}</span>` : ''}
              ${paceChip}
            </div>
            ${book.status !== 'lido' ? `
              <form class="book-update" data-form="book-page" data-book="${book.id}">
                <label>página atual
                  <input type="number" name="page" min="0" max="${book.totalPages}" value="${s.cur}" required>
                </label>
                <button class="btn sm btn-primary" type="submit">registrar</button>
              </form>` : ''}` : ''}

          ${maxPages > 0 ? `
            <div class="book-chart" aria-label="Páginas lidas nos últimos 14 dias">
              ${days.map(x => `<i style="--h:${x.pages ? Math.max(12, Math.round(x.pages / maxPages * 100)) : 0}%"
                data-tip="${esc(`${U.fmtDateBR(x.d)} · ${x.pages} pág.`)}" class="${x.pages ? '' : 'is-zero'}"></i>`).join('')}
            </div>` : ''}

          <details class="book-notes" ${book.notes ? 'open' : ''}>
            <summary>Anotações & citações</summary>
            <textarea data-book-notes="${book.id}" rows="3"
              placeholder="Frases, ideias, citações…">${esc(book.notes)}</textarea>
          </details>
        </div>
      </article>`;
    }

    /* ---------------------- COMPARTILHAR ---------------------- */
    function renderShare() {
      const seg = (opts, cur, act) => opts.map(o =>
        `<button class="${o.v === cur ? 'is-active' : ''}" data-act="${act}" data-v="${o.v}">${o.l}</button>`).join('');

      $('#tab-share').innerHTML = `
        <div class="share-layout">
          <div class="card share-controls">
            <div class="card-head"><h3>Card de progresso</h3></div>
            <p class="empty-sub">Gere um card bonito do seu progresso para postar — estilo resumo de treino.</p>
            <div class="field-row">
              <span class="field-label">Período</span>
              <div class="segmented">${seg([
                { v: 'today', l: 'Hoje' }, { v: 'week', l: 'Semana' },
                { v: 'month', l: 'Mês' }, { v: 'all', l: 'Geral' }], ui.share.period, 'share-period')}</div>
            </div>
            <div class="field-row">
              <span class="field-label">Formato</span>
              <div class="segmented">${seg([
                { v: 'square', l: 'Quadrado 1:1' }, { v: 'story', l: 'Stories 9:16' }], ui.share.fmt, 'share-fmt')}</div>
            </div>
            <div class="field-row">
              <span class="field-label">Template</span>
              <div class="segmented">${seg([
                { v: 'aurora', l: 'Aurora' }, { v: 'grade', l: 'Grade' },
                { v: 'impacto', l: 'Impacto' }], ui.share.tpl, 'share-tpl')}</div>
            </div>
            <div class="share-actions">
              <button class="btn btn-primary" data-act="share-download">⬇ Baixar PNG</button>
              <button class="btn" data-act="share-copy">⧉ Copiar imagem</button>
            </div>
            <p class="field-hint">Gerado 100% no navegador com canvas nativo — sem dependências.</p>
          </div>
          <div class="share-preview ${ui.share.fmt === 'story' ? 'is-story' : ''}">
            <canvas id="share-canvas"></canvas>
          </div>
        </div>`;
      drawShareCard();
    }

    /* ========================================================================
       09. CARD DE COMPARTILHAMENTO — desenho em canvas nativo
       ===================================================================== */
    const CARD = {
      bg: '#0b0d10', card: '#14171c', line: '#262c35',
      text: '#eef1f4', text2: '#9aa3b0', muted: '#6b7482',
      accent: '#b8f13c', accentInk: '#0b0d10', violet: '#8b7cf0',
      heat: ['#1b1f26', '#42591f', '#61812a', '#8db433', '#b8f13c'],
    };

    function rr(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    const FONT = (w, px) => `${w} ${px}px 'Inter','Segoe UI',system-ui,-apple-system,sans-serif`;

    /** heatmap em canvas: últimas N semanas terminando hoje */
    function drawHeatStrip(ctx, stats, x, y, weeks, cell, gap) {
      const startMonday = U.addDaysISO(U.startOfWeekISO(stats.today), -(weeks - 1) * 7);
      for (let w = 0; w < weeks; w++) {
        for (let d = 0; d < 7; d++) {
          const date = U.addDaysISO(startMonday, w * 7 + d);
          if (date > stats.today) continue;
          const lvl = Logic.heatLevel(stats.byDate.get(date) || 0);
          ctx.fillStyle = CARD.heat[lvl];
          rr(ctx, x + w * (cell + gap), y + d * (cell + gap), cell, cell, cell * 0.28);
          ctx.fill();
        }
      }
      return { w: weeks * (cell + gap) - gap, h: 7 * (cell + gap) - gap };
    }

    function drawStatBlock(ctx, x, y, label, value, k, valueColor) {
      ctx.textAlign = 'left';
      ctx.fillStyle = CARD.muted;
      ctx.font = FONT(600, 26 * k);
      ctx.fillText(label.toUpperCase(), x, y);
      ctx.fillStyle = valueColor || CARD.text;
      ctx.font = FONT(800, 52 * k);
      ctx.fillText(value, x, y + 62 * k);
    }

    function drawShareCard() {
      const canvas = $('#share-canvas');
      if (!canvas) return;
      const story = ui.share.fmt === 'story';
      const W = 1080, H = story ? 1920 : 1080;
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      const stats = Logic.shareStats(state, ui.share.period, U.todayISO());
      const tpl = ui.share.tpl;
      if (tpl === 'grade') drawTplGrade(ctx, W, H, stats);
      else if (tpl === 'impacto') drawTplImpacto(ctx, W, H, stats);
      else drawTplAurora(ctx, W, H, stats);
    }

    /* wrap simples para a frase motivacional */
    function wrapText(ctx, text, x, y, maxW, lineH, align = 'left') {
      ctx.textAlign = align;
      const words = text.split(' ');
      let line = '', yy = y;
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxW && line) {
          ctx.fillText(line, x, yy);
          line = word; yy += lineH;
        } else line = test;
      }
      if (line) ctx.fillText(line, x, yy);
      return yy;
    }

    /* ----- template 1: Aurora (blobs de luz + número gigante) ----- */
    function drawTplAurora(ctx, W, H, s) {
      const k = W / 1080;
      const story = H > W;
      ctx.fillStyle = CARD.bg;
      ctx.fillRect(0, 0, W, H);

      // blobs de luz
      const blob = (x, y, r, color, a) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, color + Math.round(a * 255).toString(16).padStart(2, '0'));
        g.addColorStop(1, color + '00');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      };
      blob(W * 0.85, H * 0.12, 620 * k, CARD.accent, 0.16);
      blob(W * 0.1, H * 0.9, 700 * k, CARD.violet, 0.14);
      blob(W * 0.15, H * 0.15, 400 * k, CARD.accent, 0.05);

      const pad = 96 * k;

      // marca + período
      const brandY = (story ? 200 : 150) * k;
      ctx.textAlign = 'left';
      ctx.fillStyle = CARD.accent;
      ctx.font = FONT(800, 40 * k);
      ctx.fillText('● TRAJETO', pad, brandY);
      ctx.fillStyle = CARD.text2;
      ctx.font = FONT(600, 34 * k);
      ctx.textAlign = 'right';
      ctx.fillText(s.periodLabel, W - pad, brandY);

      // número gigante
      const numY = (story ? 560 : 400) * k;
      const h = Math.floor(s.minutes / 60), m = s.minutes % 60;
      ctx.textAlign = 'left';
      ctx.fillStyle = CARD.text;
      ctx.font = FONT(800, (story ? 230 : 200) * k);
      const hoursTxt = `${h}h`;
      ctx.fillText(hoursTxt, pad, numY);
      const hw = ctx.measureText(hoursTxt).width;
      ctx.fillStyle = CARD.accent;
      ctx.font = FONT(800, (story ? 120 : 105) * k);
      ctx.fillText(`${U.pad(m)}m`, pad + hw + 18 * k, numY);
      ctx.fillStyle = CARD.muted;
      ctx.font = FONT(600, 34 * k);
      ctx.fillText('TEMPO DE ESTUDO', pad, numY + 58 * k);

      // grid de stats 2x2
      const colW = (W - pad * 2) / 2;
      const r1 = (story ? 800 : 560) * k;
      const r2 = (story ? 950 : 700) * k;
      drawStatBlock(ctx, pad, r1, 'streak', `${s.streak} ${s.streak === 1 ? 'dia' : 'dias'} 🔥`, k);
      drawStatBlock(ctx, pad + colW, r1, 'roadmap', `${s.overallPct}%`, k, CARD.accent);
      drawStatBlock(ctx, pad, r2, 'tema top', s.topTheme.length > 22 ? s.topTheme.slice(0, 21) + '…' : s.topTheme, k);
      drawStatBlock(ctx, pad + colW, r2, 'dias ativos', String(s.studyDays), k);

      // heatmap + frase
      if (story) {
        drawHeatStrip(ctx, s, pad, 1120 * k, 16, 30 * k, 8 * k);
        ctx.fillStyle = CARD.text2;
        ctx.font = FONT(600, 40 * k);
        wrapText(ctx, `“${s.phrase}”`, pad, 1560 * k, W - pad * 2, 54 * k);
      } else {
        const hm = drawHeatStrip(ctx, s, pad, 810 * k, 16, 18 * k, 5 * k);
        const px = pad + hm.w + 50 * k;
        ctx.fillStyle = CARD.text2;
        ctx.font = FONT(600, 34 * k);
        wrapText(ctx, `“${s.phrase}”`, px, 850 * k, W - pad - px, 46 * k);
      }

      // rodapé
      const footY = H - (story ? 90 : 60) * k;
      ctx.fillStyle = CARD.muted;
      ctx.font = FONT(500, 30 * k);
      ctx.textAlign = 'left';
      ctx.fillText(s.dateLabel, pad, footY);
      ctx.textAlign = 'right';
      ctx.fillText('feito com Trajeto', W - pad, footY);
    }

    /* ----- template 2: Grade (caixas com contorno) ----- */
    function drawTplGrade(ctx, W, H, s) {
      const k = W / 1080;
      const story = H > W;
      ctx.fillStyle = CARD.bg;
      ctx.fillRect(0, 0, W, H);
      const pad = (story ? 72 : 64) * k;

      // moldura
      ctx.strokeStyle = CARD.line;
      ctx.lineWidth = 2 * k;
      rr(ctx, pad, pad, W - pad * 2, H - pad * 2, 32 * k);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = CARD.accent;
      ctx.font = FONT(800, 38 * k);
      ctx.fillText('T R A J E T O', W / 2, (story ? 182 : 150) * k);
      ctx.fillStyle = CARD.muted;
      ctx.font = FONT(600, 28 * k);
      ctx.fillText(`RESUMO · ${s.periodLabel} · ${s.dateLabel.toUpperCase()}`, W / 2, (story ? 236 : 200) * k);

      // caixa principal com horas
      const bx = pad + 36 * k;
      const bw = W - (pad + 36 * k) * 2;
      const by = (story ? 356 : 240) * k;
      const bh = (story ? 360 : 250) * k;
      ctx.fillStyle = CARD.card;
      rr(ctx, bx, by, bw, bh, 24 * k);
      ctx.fill();
      const h = Math.floor(s.minutes / 60), m = s.minutes % 60;
      ctx.fillStyle = CARD.accent;
      ctx.font = FONT(800, (story ? 150 : 128) * k);
      ctx.fillText(`${h}h ${U.pad(m)}m`, W / 2, by + bh / 2 + 18 * k);
      ctx.fillStyle = CARD.muted;
      ctx.font = FONT(600, 26 * k);
      ctx.fillText('TEMPO DE ESTUDO', W / 2, by + bh / 2 + (story ? 80 : 72) * k);

      // 4 caixas menores (2x2)
      const gap = (story ? 30 : 24) * k;
      const cw = (bw - gap) / 2;
      const ch = (story ? 240 : 150) * k;
      const box = (bx2, by2, label, value, color) => {
        ctx.fillStyle = CARD.card;
        rr(ctx, bx2, by2, cw, ch, 24 * k);
        ctx.fill();
        ctx.fillStyle = color || CARD.text;
        ctx.font = FONT(800, (story ? 62 : 54) * k);
        ctx.fillText(value, bx2 + cw / 2, by2 + ch / 2 + (story ? 8 : 6) * k);
        ctx.fillStyle = CARD.muted;
        ctx.font = FONT(600, 24 * k);
        ctx.fillText(label.toUpperCase(), bx2 + cw / 2, by2 + ch / 2 + (story ? 62 : 52) * k);
      };
      const row1 = by + bh + gap;
      const row2 = row1 + ch + gap;
      box(bx, row1, 'streak', `${s.streak}🔥`);
      box(bx + cw + gap, row1, 'roadmap', `${s.overallPct}%`, CARD.accent);
      box(bx, row2, 'dias ativos', String(s.studyDays));
      box(bx + cw + gap, row2, 'tarefas', `${s.doneTasks}/${s.totalTasks}`);

      // tema top + frase
      const topY = row2 + ch + (story ? 90 : 56) * k;
      ctx.fillStyle = CARD.text;
      ctx.font = FONT(700, (story ? 40 : 34) * k);
      const top = s.topTheme.length > 26 ? s.topTheme.slice(0, 25) + '…' : s.topTheme;
      ctx.fillText(`tema mais estudado: ${top}`, W / 2, topY);
      ctx.fillStyle = CARD.text2;
      ctx.font = FONT(600, (story ? 34 : 30) * k);
      wrapText(ctx, `“${s.phrase}”`, W / 2, topY + (story ? 70 : 50) * k, W - pad * 4, (story ? 46 : 42) * k, 'center');
    }

    /* ----- template 3: Impacto (bloco accent gigante) ----- */
    function drawTplImpacto(ctx, W, H, s) {
      const k = W / 1080;
      const story = H > W;
      ctx.fillStyle = CARD.bg;
      ctx.fillRect(0, 0, W, H);
      const pad = 90 * k;

      // topo
      ctx.textAlign = 'left';
      ctx.fillStyle = CARD.text;
      ctx.font = FONT(800, 44 * k);
      ctx.fillText('TRAJETO //', pad, pad + 40 * k);
      ctx.textAlign = 'right';
      ctx.fillStyle = CARD.muted;
      ctx.font = FONT(700, 34 * k);
      ctx.fillText(s.periodLabel, W - pad, pad + 40 * k);

      // bloco accent com as horas
      const by = pad + (story ? 160 : 110) * k;
      const bh = story ? 560 * k : 360 * k;
      ctx.fillStyle = CARD.accent;
      rr(ctx, pad, by, W - pad * 2, bh, 40 * k);
      ctx.fill();
      const h = Math.floor(s.minutes / 60), m = s.minutes % 60;
      ctx.fillStyle = CARD.accentInk;
      ctx.textAlign = 'left';
      ctx.font = FONT(800, story ? 230 * k : 190 * k);
      ctx.fillText(`${h}h${U.pad(m)}`, pad + 50 * k, by + bh / 2 + (story ? 60 : 50) * k);
      ctx.font = FONT(700, 36 * k);
      ctx.fillText('TEMPO DE ESTUDO', pad + 50 * k, by + bh - 60 * k);
      ctx.font = FONT(800, 40 * k);
      ctx.textAlign = 'right';
      ctx.fillText(`${s.streak}🔥`, W - pad - 50 * k, by + 80 * k);

      // stats em linha
      const colW = (W - pad * 2) / 2;
      const r1 = by + bh + (story ? 140 : 100) * k;
      drawStatBlock(ctx, pad, r1, 'roadmap', `${s.overallPct}%`, k, CARD.accent);
      drawStatBlock(ctx, pad + colW, r1, 'dias ativos', String(s.studyDays), k);
      const r2 = r1 + 150 * k;
      const top = s.topTheme.length > 24 ? s.topTheme.slice(0, 23) + '…' : s.topTheme;
      drawStatBlock(ctx, pad, r2, 'tema top', top, k);

      // heatmap + frase
      if (story) {
        drawHeatStrip(ctx, s, pad, r2 + 200 * k, 16, 38 * k, 10 * k);
        ctx.fillStyle = CARD.text2;
        ctx.font = FONT(600, 36 * k);
        wrapText(ctx, `“${s.phrase}”`, pad, H - 200 * k, W - pad * 2, 48 * k);
      } else {
        const hm = drawHeatStrip(ctx, s, pad, r2 + 92 * k, 16, 14 * k, 4 * k);
        const px = pad + hm.w + 44 * k;
        ctx.fillStyle = CARD.text2;
        ctx.font = FONT(600, 32 * k);
        wrapText(ctx, `“${s.phrase}”`, px, r2 + 130 * k, W - pad - px, 44 * k);
      }
      ctx.fillStyle = CARD.muted;
      ctx.font = FONT(500, 28 * k);
      ctx.textAlign = 'right';
      ctx.fillText(`${s.dateLabel} · feito com Trajeto`, W - pad, H - (story ? 70 : 46) * k);
    }

    function downloadCard() {
      const canvas = $('#share-canvas');
      if (!canvas) return;
      canvas.toBlob((blob) => {
        if (!blob) { toast('Falha ao gerar a imagem', 'warn'); return; }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `trajeto-${ui.share.period}-${U.todayISO()}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast('Imagem baixada ✓');
      }, 'image/png');
    }

    async function copyCard() {
      const canvas = $('#share-canvas');
      if (!canvas) return;
      try {
        const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast('Imagem copiada ✓');
      } catch (e) {
        toast('Copiar não suportado aqui — use "Baixar PNG"', 'warn');
      }
    }

    /* ========================================================================
       10. FORMULÁRIOS/MODAIS ESPECÍFICOS + EVENTOS
       ===================================================================== */

    /* ---------- export / import ---------- */
    function exportJSON() {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `trajeto-backup-${U.todayISO()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('Backup exportado ✓');
    }

    function importJSON(text) {
      let parsed;
      try { parsed = JSON.parse(text); }
      catch (e) { return { ok: false, error: 'Arquivo não é um JSON válido.' }; }
      const v = validateImport(parsed);
      if (!v.ok) return v;
      state = normalizeState(parsed);
      ui.openThemes.clear();
      commit();
      return { ok: true };
    }

    /* ---------- modais de cada entidade ---------- */
    function modalPhaseAdd() {
      openModal('Nova fase', field.text('name', 'Nome da fase', '', { required: true, placeholder: 'Ex.: Fase 5 — Especialização' }), {
        submitLabel: 'Criar',
        onSubmit: (fd) => { Actions.addPhase(state, fd.get('name')); commit(); toast('Fase criada ✓'); },
      });
    }

    function modalPhaseRename(id) {
      const p = Logic.findPhase(state, id);
      if (!p) return;
      openModal('Renomear fase', field.text('name', 'Nome', p.name, { required: true }), {
        onSubmit: (fd) => { Actions.renamePhase(state, id, fd.get('name')); commit(); },
      });
    }

    function modalThemeAdd(phaseId) {
      openModal('Novo tema', field.text('name', 'Nome do tema', '', { required: true, placeholder: 'Ex.: Terraform' }), {
        submitLabel: 'Criar',
        onSubmit: (fd) => {
          const t = Actions.addTheme(state, phaseId, fd.get('name'));
          if (t) ui.openThemes.add(t.id);
          commit(); toast('Tema criado ✓');
        },
      });
    }

    function modalThemeRename(id) {
      const f = Logic.findTheme(state, id);
      if (!f) return;
      openModal('Renomear tema', field.text('name', 'Nome', f.theme.name, { required: true }), {
        onSubmit: (fd) => { Actions.renameTheme(state, id, fd.get('name')); commit(); },
      });
    }

    function modalTaskEdit(taskId) {
      const f = Logic.findTask(state, taskId);
      if (!f) return;
      openModal('Editar tarefa',
        field.text('title', 'Descrição', f.task.title, { required: true }) +
        field.select('status', 'Status', TASK_STATUS.map(s => ({ value: s, label: TASK_STATUS_LABEL[s] })), f.task.status), {
        onSubmit: (fd) => {
          Actions.updateTask(state, taskId, { title: fd.get('title'), status: fd.get('status') });
          commit();
        },
      });
    }

    function modalNote(themeId, noteId) {
      const existing = noteId ? Logic.findNote(state, noteId) : null;
      openModal(existing ? 'Editar nota' : 'Nova nota',
        field.textarea('text', 'Conteúdo', existing ? existing.note.text : '', {
          rows: 8, required: true,
          placeholder: 'Conceitos, fórmulas, termos…',
          hint: '<b>**negrito**</b> · <i>*itálico*</i> · <code>`código`</code> · linhas com "- " viram lista',
        }), {
        onSubmit: (fd) => {
          if (existing) Actions.updateNote(state, noteId, fd.get('text'));
          else Actions.addNote(state, themeId, fd.get('text'));
          commit(); toast('Nota salva ✓');
        },
      });
    }

    function modalManualTime(themeId) {
      const f = Logic.findTheme(state, themeId);
      if (!f) return;
      const today = U.todayISO();
      openModal(`Registrar tempo — ${f.theme.name}`,
        field.text('minutes', 'Minutos estudados', '30', { type: 'number', required: true, min: 1, max: MAX_DAY_MINUTES }) +
        field.text('date', 'Data', today, { type: 'date', required: true, max: today }), {
        submitLabel: 'Registrar',
        onSubmit: (fd) => {
          const added = Actions.logTime(state, themeId, fd.get('date'), Number(fd.get('minutes')));
          commit();
          toast(added > 0 ? `+${U.fmtMin(added)} em ${f.theme.name} ✓` : 'Nada registrado (limite diário atingido)', added > 0 ? 'ok' : 'warn');
        },
      });
    }

    function modalReminder(dateISO, remId) {
      const existing = remId ? state.reminders.find(r => r.id === remId) : null;
      const r = existing || { title: '', date: dateISO || U.todayISO(), time: '', desc: '', themeId: '' };
      openModal(existing ? 'Editar lembrete' : 'Novo lembrete',
        field.text('title', 'Título', r.title, { required: true, placeholder: 'Ex.: Revisar window functions' }) +
        `<div class="field-2col">
          ${field.text('date', 'Data', r.date, { type: 'date', required: true })}
          ${field.text('time', 'Horário (opcional)', r.time, { type: 'time' })}
        </div>` +
        field.textarea('desc', 'Descrição (opcional)', r.desc, { rows: 3 }) +
        themeOptions(r.themeId), {
        submitLabel: existing ? 'Salvar' : 'Criar',
        onSubmit: (fd) => {
          const data = {
            title: fd.get('title'), date: fd.get('date'), time: fd.get('time'),
            desc: fd.get('desc'), themeId: fd.get('themeId'),
          };
          if (existing) Actions.updateReminder(state, remId, data);
          else Actions.addReminder(state, data);
          ui.selDay = data.date;
          const d = U.parseISO(data.date);
          ui.cal = { y: d.getFullYear(), m: d.getMonth() };
          commit(); toast('Lembrete salvo ✓');
        },
      });
    }

    /** lê capa enviada como arquivo, reduzindo para caber no localStorage */
    function readCoverFile(file) {
      return new Promise((resolve) => {
        if (!file || !file.type.startsWith('image/')) { resolve(''); return; }
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          const maxW = 400;
          const scale = Math.min(1, maxW / img.width);
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          resolve(c.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(''); };
        img.src = url;
      });
    }

    function modalBook(bookId) {
      const b = bookId ? state.books.find(x => x.id === bookId) : null;
      openModal(b ? 'Editar livro' : 'Novo livro',
        field.text('title', 'Título', b ? b.title : '', { required: true }) +
        field.text('author', 'Autor(a)', b ? b.author : '') +
        `<div class="field-2col">
          ${field.text('totalPages', 'Total de páginas', b ? b.totalPages || '' : '', { type: 'number', min: 0 })}
          ${field.text('pagesPerDay', 'Meta (pág/dia)', b ? b.pagesPerDay || '' : '', { type: 'number', min: 0 })}
        </div>` +
        `<div class="field-2col">
          ${field.select('status', 'Status', BOOK_STATUS.map(s => ({ value: s, label: BOOK_STATUS_LABEL[s] })), b ? b.status : 'quero')}
          ${field.text('currentPage', 'Página atual', b ? b.currentPage : 0, { type: 'number', min: 0 })}
        </div>` +
        field.text('cover', 'Capa — URL (opcional)', b ? (b.cover.startsWith('data:') ? '' : b.cover) : '', { placeholder: 'https://…' }) +
        `<label class="field"><span>Capa — upload (opcional)</span>
          <input type="file" name="coverFile" accept="image/*"></label>`, {
        submitLabel: b ? 'Salvar' : 'Cadastrar',
        onSubmit: async (fd) => {
          let cover = String(fd.get('cover') || '').trim();
          const file = fd.get('coverFile');
          if (file && file.size > 0) {
            const dataUrl = await readCoverFile(file);
            if (dataUrl) cover = dataUrl;
          } else if (!cover && b && b.cover.startsWith('data:')) {
            cover = b.cover; // mantém upload anterior
          }
          const data = {
            title: fd.get('title'), author: fd.get('author'), cover,
            totalPages: Number(fd.get('totalPages')) || 0,
            pagesPerDay: Number(fd.get('pagesPerDay')) || 0,
            status: fd.get('status'),
            currentPage: Number(fd.get('currentPage')) || 0,
          };
          const today = U.todayISO();
          if (b) {
            Actions.updateBook(state, bookId, data, today);
            if (data.currentPage !== b.currentPage) Actions.setBookPage(state, bookId, data.currentPage, today);
          } else {
            Actions.addBook(state, data, today);
          }
          commit(); toast('Livro salvo ✓');
        },
      });
    }

    /* ---------- cronômetro ---------- */
    function toggleTimer(themeId) {
      const now = Date.now(), today = U.todayISO();
      if (state.timer && state.timer.themeId === themeId) {
        const res = Actions.stopTimer(state, now, today);
        commit();
        if (res && res.discarded) toast('Sessão muito curta (<30s) — descartada', 'warn');
        else if (res) toast(`Sessão registrada: ${U.fmtMin(res.minutes)} ✓`);
      } else {
        const { previous } = Actions.startTimer(state, themeId, now, today);
        commit();
        if (previous && !previous.discarded) toast(`Sessão anterior registrada: ${U.fmtMin(previous.minutes)}`);
      }
    }

    function renderTimerPill() {
      const pill = $('#timer-pill');
      if (!pill) return;
      if (state.timer) {
        const f = Logic.findTheme(state, state.timer.themeId);
        $('#timer-pill-label').textContent = f ? f.theme.name : '';
        $('#timer-pill-time').textContent = U.fmtHMS(Date.now() - state.timer.startedAt);
        pill.hidden = false;
      } else {
        pill.hidden = true;
      }
    }

    function tickTimer() {
      if (!state.timer) return;
      const elapsed = U.fmtHMS(Date.now() - state.timer.startedAt);
      const pillTime = $('#timer-pill-time');
      if (pillTime) pillTime.textContent = elapsed;
      $$(`.timer-live`).forEach(el => { el.textContent = elapsed; });
    }

    /* ---------- confirmação ---------- */
    function confirmDel(msg) { return window.confirm(msg); }

    /* ---------- despachante central de cliques ---------- */
    const clickActions = {
      'tab': (el) => switchTab(el.dataset.tab),
      'go-dashboard': () => switchTab('dashboard'),
      'export': exportJSON,
      'import': () => $('#import-file').click(),
      'modal-close': closeModal,
      'timer-pill': () => {
        if (!state.timer) return;
        switchTab('roadmap');
        const f = Logic.findTheme(state, state.timer.themeId);
        if (f) {
          ui.collapsedPhases.delete(f.phase.id);
          ui.openThemes.add(f.theme.id);
          render();
          const el = $(`[data-theme="${f.theme.id}"]`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      },

      /* dashboard */
      'dist-by': (el) => { ui.distBy = el.dataset.by; render(); },

      /* fases */
      'phase-add': modalPhaseAdd,
      'phase-toggle': (el) => {
        const id = el.dataset.id;
        if (ui.collapsedPhases.has(id)) ui.collapsedPhases.delete(id);
        else ui.collapsedPhases.add(id);
        render();
      },
      'phase-rename': (el) => modalPhaseRename(el.dataset.id),
      'phase-up': (el) => { if (Actions.movePhase(state, el.dataset.id, -1)) commit(); },
      'phase-down': (el) => { if (Actions.movePhase(state, el.dataset.id, 1)) commit(); },
      'phase-del': (el) => {
        const p = Logic.findPhase(state, el.dataset.id);
        if (p && confirmDel(`Excluir a fase "${p.name}" e todos os seus temas?`)) {
          Actions.deletePhase(state, el.dataset.id); commit(); toast('Fase excluída');
        }
      },

      /* temas */
      'theme-add': (el) => modalThemeAdd(el.dataset.phase),
      'theme-open': (el) => {
        const id = el.dataset.id;
        if (ui.openThemes.has(id)) ui.openThemes.delete(id);
        else ui.openThemes.add(id);
        render();
      },
      'theme-rename': (el) => modalThemeRename(el.dataset.id),
      'theme-up': (el) => { if (Actions.moveTheme(state, el.dataset.id, -1)) commit(); },
      'theme-down': (el) => { if (Actions.moveTheme(state, el.dataset.id, 1)) commit(); },
      'theme-del': (el) => {
        const f = Logic.findTheme(state, el.dataset.id);
        if (f && confirmDel(`Excluir o tema "${f.theme.name}" com tarefas, notas e tempo registrado?`)) {
          Actions.deleteTheme(state, el.dataset.id); commit(); toast('Tema excluído');
        }
      },

      /* tarefas */
      'task-cycle': (el) => {
        const next = Actions.cycleTask(state, el.dataset.id);
        save();
        if (next === 'done') {
          // micro-feedback de conclusão antes do re-render
          const li = el.closest('.task');
          if (li) li.classList.add('just-done');
          setTimeout(render, 350);
        } else {
          render();
        }
      },
      'task-edit': (el) => modalTaskEdit(el.dataset.id),
      'task-up': (el) => { if (Actions.moveTask(state, el.dataset.id, -1)) commit(); },
      'task-down': (el) => { if (Actions.moveTask(state, el.dataset.id, 1)) commit(); },
      'task-del': (el) => {
        const f = Logic.findTask(state, el.dataset.id);
        if (f && confirmDel(`Remover a tarefa "${f.task.title}"?`)) {
          Actions.deleteTask(state, el.dataset.id); commit();
        }
      },

      /* notas */
      'note-add': (el) => modalNote(el.dataset.theme, null),
      'note-edit': (el) => {
        const f = Logic.findNote(state, el.dataset.id);
        if (f) modalNote(f.theme.id, el.dataset.id);
      },
      'note-del': (el) => {
        if (confirmDel('Remover esta nota?')) { Actions.deleteNote(state, el.dataset.id); commit(); }
      },

      /* tempo */
      'timer-toggle': (el) => toggleTimer(el.dataset.id),
      'time-manual': (el) => modalManualTime(el.dataset.id),

      /* calendário / lembretes */
      'cal-prev': () => { ui.cal.m--; if (ui.cal.m < 0) { ui.cal.m = 11; ui.cal.y--; } render(); },
      'cal-next': () => { ui.cal.m++; if (ui.cal.m > 11) { ui.cal.m = 0; ui.cal.y++; } render(); },
      'cal-today': () => {
        const d = U.parseISO(U.todayISO());
        ui.cal = { y: d.getFullYear(), m: d.getMonth() };
        ui.selDay = U.todayISO();
        render();
      },
      'cal-day': (el) => { ui.selDay = el.dataset.date; render(); },
      'rem-add': (el) => modalReminder(el.dataset.date, null),
      'rem-edit': (el) => modalReminder(null, el.dataset.id),
      'rem-del': (el) => {
        if (confirmDel('Remover este lembrete?')) { Actions.deleteReminder(state, el.dataset.id); commit(); }
      },
      'rem-goto': (el) => {
        ui.selDay = el.dataset.date;
        const d = U.parseISO(el.dataset.date);
        ui.cal = { y: d.getFullYear(), m: d.getMonth() };
        render();
      },

      /* livros */
      'book-add': () => modalBook(null),
      'book-edit': (el) => modalBook(el.dataset.id),
      'book-del': (el) => {
        const b = state.books.find(x => x.id === el.dataset.id);
        if (b && confirmDel(`Remover o livro "${b.title}"?`)) {
          Actions.deleteBook(state, el.dataset.id); commit();
        }
      },

      /* share */
      'share-period': (el) => { ui.share.period = el.dataset.v; render(); },
      'share-fmt': (el) => { ui.share.fmt = el.dataset.v; render(); },
      'share-tpl': (el) => { ui.share.tpl = el.dataset.v; render(); },
      'share-download': downloadCard,
      'share-copy': copyCard,
    };

    function onClick(e) {
      const el = e.target.closest('[data-act]');
      if (!el || el.disabled) return;
      const fn = clickActions[el.dataset.act];
      if (fn) { e.preventDefault(); fn(el); }
    }

    /* ---------- submits ---------- */
    function onSubmit(e) {
      const form = e.target;

      if (form.id === 'modal-form') {
        e.preventDefault();
        if (!modal.onSubmit) { closeModal(); return; }
        const result = modal.onSubmit(new FormData(form));
        if (result && typeof result.then === 'function') result.then(closeModal);
        else closeModal();
        return;
      }

      if (form.dataset.form === 'task-add') {
        e.preventDefault();
        const input = form.querySelector('input[name=title]');
        const themeId = form.dataset.theme;
        if (input.value.trim()) {
          Actions.addTask(state, themeId, input.value);
          save(); render();
          // devolve o foco ao campo do mesmo tema após o re-render
          const again = $(`.task-add[data-theme="${themeId}"] input`);
          if (again) again.focus();
        }
        return;
      }

      if (form.dataset.form === 'book-page') {
        e.preventDefault();
        const page = Number(form.querySelector('input[name=page]').value);
        const res = Actions.setBookPage(state, form.dataset.book, page, U.todayISO());
        commit();
        if (res && res.finished) toast('Livro concluído! 🎉');
        else if (res && res.diff > 0) toast(`+${res.diff} páginas registradas ✓`);
        else toast('Página atualizada');
      }
    }

    /* ---------- changes (inputs sem form) ---------- */
    function onChange(e) {
      const t = e.target;

      if (t.id === 'import-file') {
        const file = t.files && t.files[0];
        t.value = '';
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          if (!confirmDel('Importar backup? Os dados atuais serão substituídos.')) return;
          const res = importJSON(String(reader.result));
          toast(res.ok ? 'Backup importado ✓' : res.error, res.ok ? 'ok' : 'warn');
        };
        reader.readAsText(file);
        return;
      }

      if (t.id === 'goal-hours') {
        Actions.setWeeklyGoal(state, Number(t.value));
        save(); render();
        return;
      }

      if (t.dataset.bookNotes) {
        Actions.updateBook(state, t.dataset.bookNotes, { notes: t.value }, U.todayISO());
        save(); // sem re-render para não perder o foco/scroll
      }
    }

    /* ---------- drag & drop de tarefas ---------- */
    function onDragStart(e) {
      const li = e.target.closest('.task');
      if (!li) return;
      ui.drag = { taskId: li.dataset.task, themeId: li.closest('.task-list').dataset.theme };
      li.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', li.dataset.task);
    }
    function onDragOver(e) {
      if (!ui.drag) return;
      const li = e.target.closest('.task');
      if (!li || li.closest('.task-list').dataset.theme !== ui.drag.themeId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = li.getBoundingClientRect();
      const below = e.clientY > rect.top + rect.height / 2;
      li.classList.toggle('drop-below', below);
      li.classList.toggle('drop-above', !below);
    }
    function onDragLeave(e) {
      const li = e.target.closest('.task');
      if (li) li.classList.remove('drop-above', 'drop-below');
    }
    function onDrop(e) {
      if (!ui.drag) return;
      const li = e.target.closest('.task');
      if (!li || li.closest('.task-list').dataset.theme !== ui.drag.themeId) return;
      e.preventDefault();
      const list = li.closest('.task-list');
      const items = Array.from(list.querySelectorAll('.task'));
      const rect = li.getBoundingClientRect();
      const below = e.clientY > rect.top + rect.height / 2;
      let index = items.indexOf(li) + (below ? 1 : 0);
      const fromIndex = items.findIndex(x => x.dataset.task === ui.drag.taskId);
      if (fromIndex < index) index--; // compensa a remoção do item de origem
      Actions.moveTaskTo(state, ui.drag.themeId, ui.drag.taskId, index);
      ui.drag = null;
      commit();
    }
    function onDragEnd() {
      ui.drag = null;
      $$('.task').forEach(li => li.classList.remove('is-dragging', 'drop-above', 'drop-below'));
    }

    /* ---------- boot ---------- */
    function boot() {
      const saved = Store.load();
      state = saved ? normalizeState(saved) : buildSeed();
      save();

      document.addEventListener('click', onClick);
      document.addEventListener('submit', onSubmit);
      document.addEventListener('change', onChange);
      document.addEventListener('dragstart', onDragStart);
      document.addEventListener('dragover', onDragOver);
      document.addEventListener('dragleave', onDragLeave);
      document.addEventListener('drop', onDrop);
      document.addEventListener('dragend', onDragEnd);
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !$('#modal-root').hidden) closeModal();
      });
      // tooltip global
      document.addEventListener('mouseover', (e) => {
        const t = e.target.closest('[data-tip]');
        if (t) showTip(t);
      });
      document.addEventListener('mouseout', (e) => {
        if (tooltip.el && !e.relatedTarget?.closest?.('[data-tip]')) hideTip();
      });
      document.addEventListener('scroll', hideTip, true);

      setInterval(tickTimer, 1000);
      switchTab('dashboard');
    }

    /* hooks para testes E2E e depuração */
    window.App = {
      get state() { return state; },
      set state(s) { state = normalizeState(s); },
      U, Logic, Actions, ui,
      save, render, switchTab, importJSON,
      serialize: () => JSON.stringify(state),
      buildSeed, normalizeState, validateImport,
      drawShareCard,
      resetForTests() { state = buildSeed(); save(); render(); },
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  })();
}
