# QA-Orchestrator — Contexto para Claude Code

> **Regra de colaboração:** Antes de qualquer modificação considerada arriscada (mudança de arquitetura, nova dependência pesada, alteração de schema, mudança de modelo de IA, refactor amplo), Claude DEVE apresentar a proposta, questionar a solução e aguardar a palavra-passe **"Pode Seguir"** da Sheila antes de executar.

---

## ⚠️ Confidencialidade — onde mora o quê

Este `CLAUDE.md` é **versionado (Git)** e contém só o que é **genérico do agente**.
**Nunca** colocar aqui detalhe específico de cliente (URLs de homologação, usuários,
nomes de tabela, SQL, regras de negócio extraídas, "onde paramos" detalhado).

Tudo isso é **confidencial e fica apenas local** (gitignored):
- **`CLAUDE.local.md`** — o "onde paramos" detalhado + histórico de sessões + alvos. (Carregado automaticamente pelo Claude Code; **não** vai pro Git.)
- **`systems/<CODE>/`** — `system_info/`, `knowledge/`, `learned_patterns/` e exports `*.xml` do cliente. (No `.gitignore`; só a estrutura `.gitkeep` de `evidences/reports/screens` é versionada.)

> Ao atualizar o estado da sessão, escreva o **detalhe** no `CLAUDE.local.md` e deixe aqui só um resumo genérico.

---

## Onde paramos (resumo genérico — detalhe em `CLAUDE.local.md`)

**Capacidades do agente já construídas (genéricas):**
- **Descoberta autônoma de login** (`explorer` sem IA + `discoveryAgent` com IA, provedores plugáveis `anthropic|openai|gemini`) → `SystemProfile` aprendido em disco (`data/profiles/*.json`).
- **Senha pelo chat do agente** (`src/utils/prompt.ts`): `askSecret` (eco mascarado, leitura raw char-a-char) + `resolvePassword` (cache em memória, pergunta 1×/processo; **nunca** grava em disco/log). Os 4 logins pegam o usuário do `.env` mas **perguntam a senha em runtime**. Sem TTY → erro claro (não trava). `APP_PASSWORD` aposentado.
- **CRUD autônomo** dirigido por perfil (`makerSession.ts` + `register`/`crud`), sem IA nas decisões mecânicas. Segurança: edit/delete só agem em linhas com o **token do agente**. O **`crud full` roda em SESSÃO ÚNICA** (1 login; `ensureLoggedIn` só reloga se a sessão cair — essencial p/ sistemas lentos). `clickRowAction` robusto: match por dica + **fallback posicional** (convenção Maker: 1º ícone=editar, último=excluir) p/ grades com ícones sem rótulo.
- **Telas em abas** (`findTabs`/`goToTab`/`TAB_SELECTORS` + `tabExplorer.ts`, `npm run tabs`): o agente abre **aba por aba** e estuda cada uma (campos/botões/grade), gravando `systems/<CODE>/screens/<tela>/tabs.json`. Telas Maker têm abas (ex.: Cadastro/Localizar).
- **Reverificação na grade** pós-ação (`reopenAndCount`), **tab-aware**: garante a aba "Localizar" (via `ensureOnGrid`/`closeEditForm` — a aba só renderiza fora do modo edição) e `searchInGrid` ignora a barra "Buscar no menu". A grade é a fonte da verdade. `dismissModal` fecha modais de aviso (OK/Fechar).
- **Testes negativos de validação** (`validationTests.ts`, `npm run validate`): **obrigatoriedade** (salvar com obrigatório vazio deve barrar) e **duplicidade** (criar idêntico deve barrar — checa pela contagem na grade). Sessão única; só age no token do agente; a duplicidade limpa o que cria.
- **Oráculo de regra de negócio** (`makerRules.ts`, `npm run rules`): parseia export Maker → `business_rules.json` (oráculo de máquina) + cenários derivados, determinístico (sem IA).
- **Verificador de oráculo → execução** (`oracleVerifier.ts`, `npm run verify-rule`): transforma o oráculo num plano de verificação. Confere o efeito de duas formas: **banco** (`--live`, só leitura) **ou UI/grade** (`uiOracleCheck.ts`, o caminho quando não há acesso a banco).
- **Playwright MCP** (`.mcp.json`) para o Claude dirigir telas ao vivo nas sessões (exige reabrir o Claude Code; alvos podem exigir VPN).
- **Helpers de captura/clique** (`src/tools/playwright/capture.ts`): `attachConsoleCapture` (coleta passiva de erros JS → evidência, já plugado em `register`/`crud`), `captureFullScreen` (screenshot da tela inteira do Windows via PowerShell+.NET, pega o que está fora do browser) e `clickAtCoordinates`/`clickByBoundingBox` (clique por coordenada, fallback p/ iframe que não expõe o elemento — ex.: SIGP/Maker).
- **Navegação robusta** (`gotoSmart` em `src/tools/playwright/frameUtils.ts`): normaliza URL sem protocolo p/ `https://`, loga o erro real do `goto` e avisa quando a página fica em `about:blank` (em vez de falhar em silêncio). Usado por todos os fluxos que abrem um alvo (`register`/`crud`/`screen`/`navigate`/`explore`/`maker`/`runner`/`orchestrator`).

**Estado de código:** `tsc --noEmit` limpo. Deps instaladas (`npm install`); restam 8 vulnerabilidades transitivas da stack LangChain (só somem com upgrade major → "Pode Seguir").

### 🎯 Visão de produto (norteia tudo daqui pra frente)
- **Este repo é o BACK-END** (o motor). **Outra pessoa vai montar o FRONTEND** que vai consumi-lo. ⇒ cada capacidade deve ser **dirigível por código/API** (entrada/saída estruturada, **credencial injetável** via `setPassword`/`setPasswordProvider` em `prompt.ts`), nunca presa só à CLI.
- **Pensar no agente como um AGENTE DE IA PRÓPRIO** em 3 camadas: **ferramentas** (blocos determinísticos = mãos) → **cérebro** (IA/Claude planeja e decide, `agents/orchestrator.ts` + LangGraph) → **API** (o frontend conversa).
- **O agente APRENDE, não só testa:** loop **percebe → aprende → guarda → consulta o que já sabe → age melhor → aprende com o resultado**. Memória evolutiva (`memory/knowledgeBase.ts` + Prisma + Qdrant) **já é o princípio fundador** — o `orchestrator` já realimenta bugs reincidentes na geração de cenários.
- **⚠️ GAP atual / próximo passo:** as ferramentas robustas de Maker (`register`/`crud`/`validate`/`tabs`/oráculo) **gravam só em arquivo e NÃO consultam/alimentam a `KnowledgeBase`**; o `orchestrator` ainda usa o `ScreenMapper` genérico (tropeça no login/iframes/abas Maker). **Próximo passo = CONECTAR (não reinventar):** ferramentas lêem-antes/escrevem-depois na `KnowledgeBase`, e o `orchestrator` passa a usar os blocos robustos do `makerSession`.

👉 **Para o "onde paramos" detalhado, o objetivo da próxima sessão e os alvos, leia `CLAUDE.local.md`.**

**Pendências de governança recorrentes:**
- **Rotacionar as 3 chaves de API** (`.env` em texto puro).
- **Higiene de histórico (Nível 2):** conhecimento de cliente já foi commitado em sessões anteriores e segue no histórico do GitHub — purgar exige reescrever histórico (`git filter-repo`/BFG) + force-push → **só com "Pode Seguir"**.

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
systems/<CODE>/      # Base de conhecimento POR SISTEMA — CONFIDENCIAL (local)
├── system_info/  knowledge/  learned_patterns/   # gitignored (conteúdo de cliente)
├── screens/<tela>/  reports/                      # estrutura versionada (.gitkeep)
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

> **Regra de confidencialidade:** conhecimento de cliente (`system_info/`, `knowledge/`,
> `learned_patterns/`, exports `*.xml`) é **gitignored** — só local. Nunca commitar.

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
- **Conhecimento de cliente**: nunca versionar (URLs, usuários, tabelas, SQL, regras) — só local

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
| Jessica | Colaboradora / QA |

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
