# QA-Orchestrator — Contexto para Claude Code

> **Regra de colaboração:** Antes de qualquer modificação considerada arriscada (mudança de arquitetura, nova dependência pesada, alteração de schema, mudança de modelo de IA, refactor amplo), Claude DEVE apresentar a proposta, questionar a solução e aguardar a palavra-passe **"Pode Seguir"** da Sheila antes de executar.

---

## Onde paramos (atualizar a cada sessão)

**Última sessão:** 2026-06-11

**Status:** Scaffold inicial criado e commitado (`07d6a20`). Projeto ainda não publicado no GitHub (falta `git remote add origin` + `git push`).

**O que foi feito:**
- Estrutura completa de pastas criada
- `package.json` com toda a stack definida
- `tsconfig.json`, `playwright.config.ts`, `docker-compose.yml`
- `prisma/schema.prisma` com modelos BugReport, KnowledgeEntry, TestRun
- `src/agents/orchestrator.ts` — motor principal (Claude)
- `src/config/constants.ts` — constantes, modelos, padrões LGPD
- `src/config/environments.ts` — validação de env vars com Zod
- `src/memory/knowledgeBase.ts` — memória evolutiva de bugs
- `src/reports/bugReport.ts` — geração de relatório com detecção de reincidência
- `src/tools/git/gitAnalyzer.ts` — análise de commits e PRs
- `src/tools/security/securityScanner.ts` — integração OWASP ZAP
- `src/utils/` — logger, mascaramento LGPD, dados fictícios pt_BR
- `.github/workflows/qa-pipeline.yml` — CI automático
- `.gitignore`, `.env.example`

**Próximos passos (ainda não feitos):**
1. Publicar no GitHub (`git remote add origin ...` + `git push`)
2. `npm install` e `npx playwright install`
3. Implementar `src/tools/playwright/` — mapeamento automático de telas
4. Implementar `src/scenarios/generator.ts` — geração de cenários por análise de UI
5. Implementar `src/tools/database/dbAnalyzer.ts` — inspeção de schema SQL
6. Implementar `src/agents/securityAgent.ts` — agente dedicado de segurança
7. Criar primeiros testes em `tests/functional/` e `tests/api/`
8. Configurar Qdrant para memória vetorial
9. Implementar relatório final consolidado

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
evidence/            # Screenshots, vídeos, logs (gitignored)
reports/             # Relatórios gerados (gitignored)
```

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
