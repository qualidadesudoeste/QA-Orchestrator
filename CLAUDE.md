# QA-Orchestrator — Contexto para Claude Code

> **Regra de colaboração:** Antes de qualquer modificação considerada arriscada (mudança de arquitetura, nova dependência pesada, alteração de schema, mudança de modelo de IA, refactor amplo), Claude DEVE apresentar a proposta, questionar a solução e aguardar a palavra-passe **"Pode Seguir"** da Sheila antes de executar.

---

## Onde paramos (atualizar a cada sessão)

**Última sessão:** 2026-06-18

**Status:** 🧹 **Raiz enxugada + evidência agora é SEMPRE por sistema.** Reorganização de pastas: o que é "do projeto/agente em si" foi para `data/`; toda evidência deixou de ser um depósito global e passou a viver dentro de `systems/<CODE>/evidences/`.

**Feito nesta sessão (2026-06-18):**
- **Decluttering da raiz (−5 pastas):** `prompts/`, `templates/`, `metrics/` → movidos para `data/{prompts,templates,metrics}` (junto de `data/profiles`, já existente). `data/` é a pasta **exclusiva do projeto/agente**.
- **Fim do depósito global de evidência:** as antigas `evidence/` (runtime) e `evidences/{critical,major,minor,visual}/` (raiz) foram **removidas**. Evidência agora é **sempre por sistema**: `systems/<CODE>/evidences/<sub>/`, onde `<sub>` = severidade (`critical|major|minor|visual`) **ou** tipo de runtime (`discovery|navigation|scenarios|features`). Acabou a mistura entre sistemas.
- **Código alinhado:** novo helper `evidencesDir(code, sub)` e `dataDir()` em `layout.ts`; `scaffold.ts` cria evidências dentro do sistema; `inspect.ts` audita `data/*` e evidências por sistema; refs hardcoded de `'evidence'` em `explorer.ts`, `navigator.ts`, `testGen.ts` e `runner.ts` agora resolvem o `<CODE>` via `resolveCode(url)`. `.gitignore` atualizado (ignora binários em `systems/**/evidences/**`, versiona a estrutura `.gitkeep`). `tsc --noEmit` limpo.
- **Higiene de branch:** os 3 commits do motor de descoberta/Maker continuavam só em `feat/maker-discovery-engine` (a `main` estava atrás) — esta sessão consolida e dá push.

**Histórico — Sessão 2026-06-17:**

**Status (2026-06-17):** 🎯 **Destravado o teste de REGRA DE NEGÓCIO** — o agente agora extrai o *oráculo* (o "deveria ser") direto do export do Maker, de forma determinística e sem IA. Provado nas 2 regras do `sgos_rules.xml`.

**Feito na sessão 2026-06-17:**
- **Reverificação definitiva na grade** (item #1 pendente): `register.ts` ganhou o passo `[7/7]` — depois de salvar, **reabre a Localizar, busca o token e conta as linhas**. Sucesso final = sinal imediato **OU** prova na grade (a grade é a fonte da verdade). Novo helper `reopenAndCount()` em `makerSession.ts`; novo campo `verifiedInGrid` na evidência/aprendizado. O `crud full` herda isso no Create.
- **Parser de regras do Maker → oráculo** (`src/knowledge/makerRules.ts`, comando `npm run rules -- <arquivo.xml> [--code SGOS]`): decodifica o `REG_INTERFACE` (base64 → DFM Delphi), reconstrói as `FUNCTION/SQL` embutidas e produz **3 saídas**: `business_rules.md` (oráculo humano), `business_rules.json` (oráculo de máquina — **contrato p/ integrar com outros projetos**) e `cenarios_regras.md` (cenários positivo/negativos derivados, sem IA). Trata as 2 formas do Maker: `<SQL TYPE>` (DML estruturado) e `<PSQL><COMMAND>` (SQL cru de consulta/permissão).
- **Provado no SGOS** (`sgos_rules.xml`): regra **[136] Cancelar OS** → extraiu as DUAS atualizações em cascata (`[REDACTED_TABLE].[REDACTED_COL]=6, [REDACTED_COL]=:pMotivo` **e** `[REDACTED_TABLE].[REDACTED_COL]='N'`, ambas `WHERE OS_COD=:pOS_COD`); regra **[398] Verificar Permissão** → extraiu o SELECT que define a permissão (`[REDACTED_TABLE]` ligando `[REDACTED_COL]=:USUARIO` ao contrato da OS). 6 cenários derivados (2 positivos / 4 negativos).

**Decisão estratégica desta sessão (alinhada com a Sheila):** testar regra de negócio = comparar o comportamento contra um **oráculo**; sem oráculo, o agente só faz fumaça + validação de campo. O Maker é a mina de ouro: a regra vem exportável em XML. **NÃO precisamos do FRZ do sistema inteiro** — trabalhar **tela a tela / regra a regra** é o caminho certo (granularidade de teste + export viável). Para sistemas não-Maker, a fonte vira um `business_rules.md` estruturado (alimentado pela Sheila/time). "Pode Seguir" dado para construir o parser.

**Próximos passos sugeridos:**
1. **Ligar oráculo → execução:** usar o `business_rules.json` para o runner validar de verdade (executar o cenário na UI e conferir o efeito; idealmente checar a tabela via os adaptadores em `src/tools/database/`).
2. Conseguir o export Maker de **mais telas** do SGOS (e do CLE/SIGP) e rodar `rules` em cada — a cobertura cresce por tela.
3. Melhorar o parser para `INSERT` com colunas/valores e funções aninhadas (hoje SQL cru de consulta já sai; refinar quando aparecer caso novo).
4. **Rotacionar as 3 chaves de API** (continuam em texto puro no `.env`).

---

### Sessão 2026-06-16 (continuação) (histórico)

**Última sessão:** 2026-06-16 (continuação)

**Status:** 🎉 **CRUD completo autônomo funcionando no SGOS** — o agente loga, navega, e faz Create/Read/Update/Delete sozinho, só com os comandos dele e SEM IA externa nas decisões mecânicas. Provado ponta-a-ponta na tela Natureza: `Create OK | Read 1 | Update OK | Delete OK (1→0)`.

**CRUD (fase nova, 2026-06-16):**
- **`makerSession.ts`** — blocos compartilhados (login c/ Enter, abrir tela, achar form, salvar, confirmar sucesso por 4 vias, buscar na grade, achar linha por token, editar/excluir por linha, confirmar diálogo). `register` e `crud` reusam (sem duplicar).
- **`crud.ts`** — `search | edit | delete | full`. **Segurança:** edit/delete só agem em linhas que contêm o **token do agente** (nunca dados reais). `--all` exclui todos do token na mesma sessão. `full` roda o ciclo CRUD inteiro num token único e se auto-limpa.
- **Conhecimento Maker gravado:** Excluir = lixeira → **modal "Confirma a exclusão?" (Ok/Cancelar)**; Editar = lápis → mesmo form preenchido. Login pode demorar a confirmar (janela aumentada p/ 25s). Tudo em `systems/SGOS/system_info/architecture.md`.
- **Comando novo:** `npm run crud -- <op> <url> "<Tela>" [--headed] [--token "x"] [--all]`.

**Feito nesta sessão (continuação 2026-06-16):**
- **Fallback heurístico de login (sem IA)** em `discoveryAgent.ts` (`heuristicLogin`): se há 1 senha + 1 usuário claro, monta o `LoginProfile` sozinho (imune a outage de IA, custo zero). Resolveu o SGOS sozinho (`#username`/`#password`, confiança 0.95). IA só para telas ambíguas.
- **Login Maker sem botão:** `navigator`/`register` enviam com **Enter** quando não há `<button>` de submit.
- **Detecção de login genérica:** "o campo de senha sumiu" (não depende de mudança de URL — Maker mantém a URL).
- **Mapa de menu:** `navigator` agora dá settle + expande grupos + varre frames → **28 módulos do SGOS** salvos no perfil.
- **Comando novo `register`** (`src/discovery/register.ts`): abre tela → "Incluir Registro" → preenche → **Salva** (acha o ícone de disquete por title/classe) → confirma sucesso por **4 métodos independentes** (toast por classe, varredura de texto visível p/ o aviso mínimo no canto, token na grade, form limpou) → grava evidência + aprende em `executions/` e `learned_patterns/fluxos_cadastro.md`.
- **Comandos de auto-conhecimento:** `inspect` (audita as pastas locais: o que está preenchido/vazio por sistema) e `context` (monta um briefing do sistema lendo knowledge+learned_patterns+perfil — deixa o agente "mais inteligente sobre o sistema em si").
- **Conhecimento do SGOS gravado** em `systems/SGOS/system_info/architecture.md`: é **Maker IA**; telas abrem na **aba Localizar** (a grade); cadastro = Localizar→Incluir→preencher→Salvar(disquete); **retorno de salvamento do Maker é fraco/inconsistente** → sempre confirmar de mais de uma forma. Perfil alinhado para `code=SGOS`.

**Provado ao vivo:** inclusão de **Natureza** no SGOS (`[REDACTED_HOST].../os/open.do?sys=WKR`, usuário `qualidade`) — toast "Os dados foram salvos com sucesso" + form limpo. Sem VPN.

**Próximos passos sugeridos:**
1. Confirmação definitiva reabrindo a Localizar e buscando o token (já há sinal de form-limpo; falta o loop de reverificação na grade).
2. Repetir `register` em outras telas (Empresas, Grupos de Serviço) e cadastros compostos (abas).
3. Generalizar os padrões Maker IA num conhecimento cross-sistema (vale p/ CLE, SGOS, SIGP).
4. **Rotacionar as 3 chaves de API** (continuam em texto puro no `.env`).

---

### Histórico — Fases A–D (2026-06-16)

**Status:** Fases A–D funcionando + camada Maker + estrutura de conhecimento organizada.

**Feito em 2026-06-16:**
- **3 provedores de IA plugáveis** (`anthropic | openai | gemini` via `AI_PROVIDER`). Gemini free tier é o que roda (Anthropic e OpenAI com chaves válidas mas **sem saldo**). Gemini: safety liberado + retry 429/503/RECITATION + temperatura.
- **Fase C** (navigator): login real + navegação de menus — rpgbuilder e CLE.
- **Fase D** (screenTest): abre uma tela, lê campos/abas no iframe Maker, **preenche dados** (`--fill`), gera BDD; `--headed` abre Chrome visível. Provado no CLE "Tipo de Evento" (5 campos, 3 abas) e saucedemo (10 cenários).
- **Camada Maker** (makerInspector): lê iframes aninhados; mapeou **57 menus/submenus do CLE** (`systems/CLE/system_info/menu.json`). Arquitetura Maker aprendida pelo FRZ/jar do SGOS: fluxos = fluxograma de funções/SQL; telas por `CodigoForm`; campos `WFRInput` via `dictionary.xml`.
- **Estrutura de conhecimento** (`knowledge/layout.ts` + `scaffold.ts`): `systems/<CODE>/{system_info,knowledge,screens/<tela>,executions,reports,learned_patterns}`, `evidences/`, `metrics/`, `prompts/`, `templates/`. Limpeza geral da raiz (removido evidence/ antigo, artifacts/, paths.ts órfão).

**Comandos novos:** `explore`, `discover`, `navigate`, `maker:inspect`, `screen`, `testgen`, `scaffold`, `profile:*`.

**Bloqueador conhecido:** CLE exige **VPN ligada e estável** (caiu no meio de uma rodada). Quando estável: `npm run screen -- "https://[REDACTED_HOST]/eventos/open.do?sys=CLE" "Tipo de Evento" --headed --fill`.

**Próxima sessão (amanhã):**
1. Rodar `screen` completo no CLE com VPN estável (login→tela→preenche→abas→BDD)
2. **EXECUTAR** os cenários BDD (`BddPlaywrightRunner` já existe) e reportar passou/falhou
3. Loop sobre as 57 telas do CLE usando o `menu.json`
4. Ingerir o FRZ/`dictionary.xml` do SGOS para enriquecer `knowledge/business_rules`
5. **Rotacionar as 3 chaves de API** (Anthropic, OpenAI, Gemini — foram coladas em texto puro)

---

### Sessão 2026-06-15 (histórico)

**Status:** virada de arquitetura aprovada ("Pode Seguir") — agente genérico que aprende qualquer sistema. **Fase A concluída.**

**Decisão desta sessão:** o conhecimento específico do sistema sai do código e vira **SystemProfile** (memória aprendida em disco). Plano em fases A→E. Sheila escolheu "tornar genérico".

**Diagnóstico importante:** o login SIGP estava falhando porque **o servidor caiu (Cloudflare 522 — Host: Error)**, não por bug. Os seletores `[REDACTED_SEL]/535` estão confirmados e o login funcionou às 09:11 de 2026-06-15 (sessão salva em `playwright/.auth/sigp.json`).

**Fase A — feita (2026-06-15):**
- `src/discovery/systemProfile.ts` — modelo SystemProfile + store JSON em disco (100% offline, sem env/DB/API key)
- `src/discovery/seedSigp.ts` — migra o hardcode do SIGP para um perfil aprendido (confiança 1)
- `src/discovery/profileCli.ts` — CLI: `list | show <id> | seed-sigp`
- Scripts npm: `profile:list`, `profile:show`, `profile:seed-sigp`
- Perfil salvo em `data/profiles/sigp-[REDACTED_HOST]-com-br.json`
- `tsc --noEmit` limpo

**Fase B — feita (2026-06-15):**
- `src/discovery/explorer.ts` (B1, SEM IA) — abre qualquer URL, varre frames, coleta inputs/botões, detecta bloqueio Cloudflare/erro. **Testado ao vivo:** practicetestautomation ✓, the-internet ✓, SIGP → detectou "522 Connection timed out" ✓
- `src/discovery/discoveryAgent.ts` (B2, COM IA) — manda os candidatos ao Claude (Sonnet) e recebe LoginProfile estruturado; tem `dryRun` (custo zero) e trata erro de crédito
- `src/discovery/discover.ts` — orquestra explorar→entender→salvar perfil; CLI `discover <url> [--dry] [--vision] [--headed]`
- Scripts npm: `explore`, `discover`
- `tsc` limpo; dry-run validado de ponta a ponta

**Camada de provedor de IA plugável — feita (2026-06-16):**
- `src/discovery/aiProvider.ts` — interface comum + seleção por `AI_PROVIDER`
- `src/discovery/providers/anthropicProvider.ts` (Claude, padrão) | `openaiProvider.ts` (GPT) | `geminiProvider.ts` (Google, free tier)
- `AI_PROVIDER=anthropic | openai | gemini` no `.env` — troca de cérebro sem mexer no código
- Anthropic e OpenAI: chaves válidas mas **contas sem saldo** (400 / 429). Gemini free tier **rodou de verdade**.

**🎉 MARCO (2026-06-16): descoberta autônoma ponta-a-ponta funcionando.**
`discover https://rpgbuilder.vercel.app/login --vision` (provedor gemini) explorou, o Gemini identificou o login sozinho (confiança 1: `#email`, `#password`, `button[type=submit]`) e salvou o perfil `rpgbuilder-vercel-app` na memória. Custo: grátis (718/97 tokens). 2 sistemas na memória: SIGP (manual) + rpgbuilder (descoberto por IA).

**Chaves no `.env` (todas a rotacionar — foram coladas em texto puro):** Anthropic, OpenAI, Gemini.

**Próximas fases (aprovadas, ainda não feitas):**
- **Fase C** — login genérico dirigido pelo perfil (aposenta seletores fixos do `auth.setup.ts`)
- **Fase D** — mapeamento de módulos pós-login + cenários por módulo
- **Fase E** — re-detecção de mudança de tela (reaprende sozinho; base `loginFingerprint` já existe)

**Pendências de higiene:** working tree tem mudanças não commitadas; `AGENTS.md` e este "Onde paramos" estavam desatualizados; pasta `reports/`→`reporting/` renomeada.

---

### Histórico anterior (2026-06-11)

**O que foi feito:**
- Estrutura completa de pastas criada e publicada no GitHub
- `package.json` com toda a stack definida
- `tsconfig.json`, `playwright.config.ts`, `docker-compose.yml`
- `prisma/schema.prisma` com modelos BugReport, KnowledgeEntry, TestRun
- `src/agents/orchestrator.ts` — motor principal (Claude Sonnet)
- `src/config/constants.ts` — Opus desabilitado, Sonnet padrão, Haiku para tarefas leves
- `src/config/environments.ts` — validação de env vars com Zod
- `src/memory/knowledgeBase.ts` — memória evolutiva de bugs com detecção de reincidência
- `src/reports/bugReport.ts` — geração de relatório estruturado
- `src/tools/git/gitAnalyzer.ts` — análise de commits e PRs via GitHub API
- `src/tools/security/securityScanner.ts` — integração OWASP ZAP
- `src/utils/` — logger, mascaramento LGPD, dados fictícios pt_BR
- `.github/workflows/qa-pipeline.yml` — CI automático em todo PR
- **`src/tools/playwright/screenMapper.ts`** ✓
- **`src/tools/playwright/formTester.ts`** ✓
- **`src/tools/playwright/gridHandler.ts`** ✓
- **`src/tools/playwright/pageActions.ts`** ✓
- **`src/scenarios/types.ts`** ✓
- **`src/scenarios/generator.ts`** ✓
- **`src/scenarios/runner.ts`** ✓
- **`src/tools/database/`** ✓ — multi-banco: PostgreSQL, MySQL, Oracle, MongoDB
- **`frontend/`** ✓ — pasta reservada (só .gitkeep)
- **`src/tools/security/headerAnalyzer.ts`** ✓
- **`src/tools/security/authTester.ts`** ✓
- **`src/agents/securityAgent.ts`** ✓
- **`tests/sigp/`** ✓ — login.spec, dashboard.spec, api/health.spec, security.spec
- **`tests/sigp/setup/auth.setup.ts`** ✓ — **ATUALIZADO (2x nesta sessão):**
  - Usa `page.frames()` para varrer todos os iframes
  - `printFrameTree()` lista TODOS os inputs (nome, tipo, id, visible) de cada frame
  - Seletores ampliados com variações SIGP (nm_login, ds_login, cd_usuario, etc.)
  - Screenshots automáticos: `sigp-login-before.png`, `sigp-login-after.png`

**O que descobrimos sobre o SIGP:**
- Frame de login: `openform.do?sys=ARH&action=openform&[REDACTED]&firstLoad=true`
- Frame `[1]` tem **14 inputs** e **4 botões**
- Campos detectados pelo setup (usando seletor genérico de fallback):
  - Usuário: `input[type="text"]` — **ainda não confirmamos o `name` exato**
  - Senha: `input[type="password"]` ✓
  - Botão: `button:has-text("Entrar")` ✓
- **Pendência:** rodar setup de novo e colar o log dos 14 inputs para fixar o seletor correto do campo usuário

**Sistema alvo atual:** SIGP — `https://sigp.[REDACTED_HOST]/SIGP/open.do?sys=ARH`
Credenciais em `.env` local (gitignored).

**Próximos passos (ainda não feitos):**
1. Rodar: `npx playwright test --project=sigp-setup`
2. Colar no chat o bloco `input[0..13]` do log — Claude adiciona o seletor exato do campo usuário
3. Confirmar que o setup salva `playwright/.auth/sigp.json` com sucesso
4. Rodar: `npx playwright test --project=sigp-functional`
5. Configurar Qdrant para memória vetorial
6. Implementar relatório final consolidado
7. Mapear módulos do SIGP após login funcional (cadastros, lançamentos, relatórios)

**Nota multi-banco:**
- `DB_TYPE` no `.env` escolhe o adaptador: `postgres | mysql | oracle | mongodb`
- Oracle está em `optionalDependencies` — se não tiver Instant Client instalado, avisa e não quebra o projeto
- Frontend é responsabilidade de outro colaborador — não alterar a pasta `frontend/`

**Pendência de infraestrutura:**
- Renomear pasta `Agente de IA` → `QA-Orchestrator` (fazer fora do Claude Code):
  ```powershell
  Rename-Item -Path "C:\GitHub\Agente de IA" -NewName "QA-Orchestrator"
  ```

---

## O que é este projeto

Agente QA autônomo enterprise que combina **Claude AI + Playwright MCP** para executar ciclos completos de qualidade de software sem intervenção manual. O agente analisa mudanças de código, gera cenários de teste, executa automações no browser, verifica APIs, analisa segurança e gera relatórios completos com rastreabilidade.

---

## Estratégia de modelos — economia de créditos

| Modelo | Uso |
|---|---|
| `claude-haiku-4-5-20251001` | Tarefas simples: formatação, geração de dados, validações básicas |
| `claude-sonnet-4-6` | Padrão para tudo: análise de impacto, geração de cenários, análise de código |
| `claude-opus-4-8` | **DESABILITADO por padrão** — usar somente se Sheila autorizar explicitamente para análise de segurança crítica |

**Regra:** Claude deve sempre questionar se a tarefa realmente precisa de um modelo mais poderoso antes de sugerir troca. Sonnet é suficiente para 95% dos casos deste projeto.

---

## Palavra-passe para modificações arriscadas

Para qualquer uma das ações abaixo, Claude apresenta a proposta, aguarda e só executa após receber **"Pode Seguir"**:

- Troca de modelo de IA (ex: ativar Opus)
- Adição de nova dependência pesada
- Alteração de schema do banco (prisma/schema.prisma)
- Mudança de arquitetura de agentes
- Refactor amplo que afete múltiplos arquivos
- Qualquer ação que afete CI/CD ou infraestrutura

---

## Stack tecnológico

| Camada | Tecnologia |
|---|---|
| AI Engine | Claude API (Sonnet padrão, Haiku para tarefas leves) |
| Orquestração | LangGraph.js + Anthropic SDK |
| Browser Automation | Playwright + Playwright MCP |
| Memória Evolutiva | PostgreSQL (bugs/runs) + Qdrant (vector search) |
| Cache de Estado | Redis |
| Git Integration | Octokit (GitHub API) + simple-git |
| Segurança | OWASP ZAP (headless) + Semgrep |
| Relatórios | Allure Report + HTML customizado |
| Dados de Teste | Faker.js (locale pt_BR) — LGPD compliant |
| Segredos | HashiCorp Vault / AWS Secrets Manager / Azure Key Vault |
| ORM | Prisma + PostgreSQL |

---

## Estrutura do projeto

```
src/
├── agents/          # Orquestradores e agentes IA (Claude)
├── tools/
│   ├── playwright/  # Automação browser (Playwright MCP) ← A IMPLEMENTAR
│   ├── git/         # Análise de commits e PRs ✓
│   ├── database/    # Inspeção de schema SQL ← A IMPLEMENTAR
│   └── security/    # OWASP ZAP, Semgrep ✓
├── memory/          # Base de conhecimento evolutiva (bugs, fluxos) ✓
├── scenarios/       # Geração automática de cenários ← A IMPLEMENTAR
├── reports/         # Bug reports e relatório final ✓
├── config/          # Ambientes, constantes, secrets ✓
└── utils/           # Logger, mascaramento LGPD, dados de teste ✓
tests/
├── functional/      # Testes funcionais Playwright ← A IMPLEMENTAR
├── api/             # Testes de API ← A IMPLEMENTAR
├── security/        # Testes de segurança ← A IMPLEMENTAR
├── regression/      # Suíte de regressão acumulativa ← A IMPLEMENTAR
└── integration/     # Testes de integração ← A IMPLEMENTAR
prisma/
└── schema.prisma    # Modelos: BugReport, KnowledgeEntry, TestRun ✓
data/                # EXCLUSIVO do projeto/agente
├── profiles/        # Memória de máquina: perfis aprendidos (*.json) ✓
├── prompts/         # Prompts do agente (master, exploratório, regressão...) ✓
├── templates/       # Templates de bug / caso de teste / relatório ✓
└── metrics/         # CSVs agregados (bug_history, executions, coverage) ✓
systems/<CODE>/      # Base de conhecimento POR SISTEMA
├── system_info/  knowledge/  screens/<tela>/  learned_patterns/  reports/
├── executions/<data>/   # logs + screenshots de cada execução (gitignored)
└── evidences/<sub>/     # evidência SEMPRE por sistema (nunca depósito global)
                         #   <sub> = critical|major|minor|visual (severidade)
                         #          ou discovery|navigation|scenarios|features (runtime)
reports/             # Relatórios gerados (gitignored)
artifacts/           # Saídas de runtime/Allure (gitignored)
```

> **Regra de evidência:** nunca criar um depósito global de evidência na raiz. Toda
> screenshot/vídeo/feature gerado vai para `systems/<CODE>/evidences/<sub>/`, com o
> `<CODE>` resolvido por `resolveCode(url)` (em `src/knowledge/layout.ts`).

---

## Setup inicial

```bash
# 1. Copiar variáveis de ambiente
cp .env.example .env
# Preencher ANTHROPIC_API_KEY, BASE_URL, DATABASE_URL etc.

# 2. Subir infraestrutura
docker-compose up -d

# 3. Instalar dependências
npm install

# 4. Instalar browsers do Playwright
npx playwright install --with-deps

# 5. Rodar migrations
npx prisma migrate dev

# 6. Iniciar o agente
npm run dev
```

## Variáveis de ambiente obrigatórias

| Variável | Descrição |
|---|---|
| `ANTHROPIC_API_KEY` | Chave da API Anthropic (console.anthropic.com) |
| `BASE_URL` | URL da aplicação a testar |
| `DATABASE_URL` | PostgreSQL connection string |
| `APP_ENV` | `development` / `homologacao` / `production` |
| `GITHUB_TOKEN` | Token GitHub (escopo: repo, pull_requests) |
| `GITHUB_OWNER` | Org/usuário do repositório alvo |
| `GITHUB_REPO` | Nome do repositório alvo |

---

## Regras de governança (NUNCA violar)

- **Produção**: apenas leitura passiva — zero escrita, zero exclusão, zero massa de teste
- **Segredos**: nunca em código, logs, relatórios ou banco de dados — somente via Vault/AWS/Azure
- **Dados pessoais**: mascaramento automático antes de qualquer armazenamento (LGPD)
- **Código-fonte**: o agente analisa, nunca altera — toda mudança exige aprovação humana
- **Pull Requests**: o agente pode gerar PR para revisão, nunca aprovar

---

## Classificação de bugs

| Código | Descrição |
|---|---|
| `BUG_FUNCIONAL` | Comportamento incorreto de funcionalidade |
| `BUG_VISUAL` | Problema de interface/layout |
| `BUG_API` | Falha em endpoint (status, contrato, auth) |
| `BUG_DADOS` | Inconsistência ou corrupção de dados |
| `BUG_SEGURANCA` | Vulnerabilidade (SQLi, XSS, CSRF, IDOR...) |
| `BUG_PERFORMANCE` | Tempo de resposta / degradação |
| `BUG_USABILIDADE` | Problema de UX/acessibilidade |
| `BUG_INTEGRACAO` | Falha entre sistemas integrados |

---

## Níveis de risco

`BAIXO` → `MÉDIO` → `ALTO` → `CRÍTICO`

---

## CI/CD

Pipeline `.github/workflows/qa-pipeline.yml` executa em todo PR e push para `main`:
1. Sobe PostgreSQL + Redis via services
2. Roda migrations Prisma
3. Executa suíte funcional + API
4. Sobe evidências como artifact (30 dias)
5. Publica Allure Report no GitHub Pages

---

## Comandos úteis

```bash
npm run test                    # Todos os testes
npm run test:functional         # Apenas funcionais
npm run test:api                # Apenas APIs
npm run test:security           # Apenas segurança
npm run test:regression         # Regressão acumulativa
npm run report                  # Gerar e abrir Allure Report
npm run db:studio               # Abrir Prisma Studio (visualizar KB)
npx playwright show-report      # Ver último relatório HTML
```

---

## Colaboradores

| Nome | Papel |
|---|---|
| Sheila Silva | Criadora / QA Lead |
| (a definir) | Colaborador |

Para adicionar um colaborador: abrir PR atualizando esta tabela.

---

## Convenções de commit

```
feat: nova funcionalidade no agente
fix: correção de comportamento
test: novo cenário ou suíte
chore: config, deps, infra
docs: apenas documentação
```
