# Trajeto — Plataforma de Estudos (Engenharia de Dados)

Aplicação web completa de acompanhamento de estudos, estilo Notion + Trello:
roadmap em três níveis (Fases → Temas → Tarefas), cronômetro de estudo,
heatmap de constância, lembretes com calendário, tracking de livros e geração
de cards de progresso para redes sociais.

**100% HTML + CSS + JavaScript vanilla.** Sem frameworks, sem build, sem
dependências. Basta abrir o `index.html` no navegador.

## Como usar

```
abra index.html no navegador (duplo clique ou arraste para a janela)
```

Os dados são salvos automaticamente no `localStorage` a cada alteração e
persistem entre sessões. Use os botões no canto superior direito para
**exportar** um backup `.json` e **importar** de volta quando quiser.

## Abas

| Aba | O que faz |
|---|---|
| **Dashboard** | total de horas, % do roadmap, streak, meta semanal, heatmap de constância (20 semanas) e distribuição de tempo por tema/fase |
| **Roadmap** | CRUD e reordenação de fases, temas e tarefas (setas + drag & drop); status não iniciada / em andamento / concluída; cronômetro start/stop e registro manual de minutos; mini-heatmap e notas com formatação (`**negrito**`, `*itálico*`, `` `código` ``, listas com `- `) por tema |
| **Lembretes** | calendário mensal navegável com lembretes (título, descrição, horário, tema), dias estudados destacados, próximos lembretes e meta semanal de horas com barra de progresso |
| **Livros** | cadastro com capa (URL ou upload), meta de páginas/dia, previsão de término, adiantado/atrasado, histórico de leitura (14 dias), anotações e visão geral do ano |
| **Compartilhar** | card de progresso estilo Strava em canvas nativo — 3 templates × 2 formatos (1:1 e stories 9:16), período configurável, download PNG e copiar imagem |

Detalhes de comportamento:

- O cronômetro sobrevive a recarregamentos de página (o início da sessão fica
  no estado persistido) e aparece como pílula no topo em qualquer aba.
- Sessões de cronômetro com menos de 30s são descartadas.
- Streak conta dias consecutivos com estudo; estudar ontem mantém o streak
  vivo até o fim de hoje.
- A semana da meta começa na segunda-feira.

## Estrutura

```
index.html    esqueleto e navegação
styles.css    design system dark (tokens, componentes, responsivo)
app.js        lógica pura + ações de estado + renderização + canvas
tests/        suíte de QA (não é necessária para usar o app)
```

## QA

A aplicação em si não tem dependências; a suíte de testes usa Node 18+ e o
Chrome instalado na máquina (via `puppeteer-core`, dependência só de teste).

```bash
cd tests
npm install        # instala puppeteer-core (uma vez)
npm test           # 45 testes unitários + 21 testes E2E
npm run test:unit  # só a lógica pura (rápido, sem navegador)
npm run test:e2e   # fluxos reais no Chrome headless + screenshots
```

Cobertura: CRUD dos três níveis, reordenação, cronômetro (inclusive descarte
de sessão curta e troca de tema com timer ativo), streak e limiares do
heatmap, meta semanal, round-trip de backup, sanitização de imports sujos,
XSS em tarefas e notas, calendário, ritmo de leitura/previsão de término,
canvas dos 6 cards, persistência após reload, layout mobile e ausência de
erros de console. Os screenshots gerados ficam em `tests/screenshots/`.
