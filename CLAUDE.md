# QA-Orchestrator — Contexto para Claude Code

## O que é este projeto

Agente QA autônomo enterprise que combina **Claude AI + Playwright MCP** para executar ciclos completos de qualidade de software sem intervenção manual. O agente analisa mudanças de código, gera cenários de teste, executa automações no browser, verifica APIs, analisa segurança e gera relatórios completos com rastreabilidade.

## Stack tecnológico

| Camada | Tecnologia |
|---|---|
| AI Engine | Claude API (`claude-opus-4-8` para análise, `claude-sonnet-4-6` para execução) |
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

## Estrutura do projeto

```
src/
├── agents/          # Orquestradores e agentes IA (Claude)
├── tools/
│   ├── playwright/  # Automação browser (Playwright MCP)
│   ├── git/         # Análise de commits e PRs
│   ├── database/    # Inspeção de schema SQL
│   └── security/    # OWASP ZAP, Semgrep
├── memory/          # Base de conhecimento evolutiva (bugs, fluxos)
├── scenarios/       # Geração automática de cenários de teste
├── reports/         # Bug reports e relatório final
├── config/          # Ambientes, constantes, secrets
└── utils/           # Logger, mascaramento de dados (LGPD), dados de teste
tests/
├── functional/      # Testes funcionais Playwright
├── api/             # Testes de API (contratos, status, auth)
├── security/        # Testes de segurança automatizados
├── regression/      # Suíte de regressão acumulativa
└── integration/     # Testes de integração entre módulos
prisma/
└── schema.prisma    # Modelos: BugReport, KnowledgeEntry, TestRun
evidence/            # Screenshots, vídeos, logs (gitignored)
reports/             # Relatórios gerados (gitignored)
```

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

## Regras de governança (NUNCA violar)

- **Produção**: apenas leitura passiva — zero escrita, zero exclusão, zero massa de teste
- **Segredos**: nunca em código, logs, relatórios ou banco de dados — somente via Vault/AWS/Azure
- **Dados pessoais**: mascaramento automático antes de qualquer armazenamento (LGPD)
- **Código-fonte**: o agente analisa, nunca altera — toda mudança exige aprovação humana
- **Pull Requests**: o agente pode gerar PR para revisão, nunca aprovar

## Modelos Claude a usar

```typescript
// Análise complexa, impacto, segurança
model: 'claude-opus-4-8'

// Execução de cenários, geração de scripts
model: 'claude-sonnet-4-6'
```

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

## Níveis de risco

`BAIXO` → `MÉDIO` → `ALTO` → `CRÍTICO`

Calculado com base em: arquivos alterados, impacto em banco, impacto em APIs, impacto em segurança.

## CI/CD

O pipeline `.github/workflows/qa-pipeline.yml` executa automaticamente em todo PR e push para `main`:
1. Sobe PostgreSQL + Redis via services
2. Roda migrations Prisma
3. Executa suíte funcional + API
4. Sobe evidências como artifact (30 dias)
5. Publica Allure Report no GitHub Pages

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

## Colaboradores

| Nome | Papel |
|---|---|
| Sheila Silva | Criadora / QA Lead |

Para adicionar um colaborador: abrir PR atualizando esta tabela.

## Convenções de commit

```
feat: nova funcionalidade no agente
fix: correção de comportamento
test: novo cenário ou suíte
chore: config, deps, infra
docs: apenas documentação
```
