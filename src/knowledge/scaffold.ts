/**
 * scaffold — cria a estrutura organizada da base de conhecimento.
 *
 *   ts-node src/knowledge/scaffold.ts            → cria raiz (prompts/templates/...)
 *   ts-node src/knowledge/scaffold.ts <CODE> [Nome do sistema]  → + esqueleto do sistema
 *
 * Só cria o que NÃO existe (nunca sobrescreve conhecimento já preenchido).
 */

import fs from 'fs'
import path from 'path'
import {
  ROOT, promptsDir, templatesDir, metricsDir, evidencesDir,
  systemInfoDir, knowledgeDir, learnedPatternsDir, reportsDir, systemRoot,
} from './layout'

const SEVERITIES = ['critical', 'major', 'minor', 'visual'] as const

function writeIfAbsent(file: string, content: string): void {
  if (fs.existsSync(file)) return
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, 'utf-8')
  console.log(`  + ${path.relative(ROOT, file)}`)
}
function gitkeep(dir: string): void {
  writeIfAbsent(path.join(dir, '.gitkeep'), '')
}

export function scaffoldRoot(): void {
  console.log('Estrutura raiz:')
  // prompts
  writeIfAbsent(path.join(promptsDir(), 'master_prompt.md'), '# Master Prompt\n\nVocê é um agente de QA autônomo. Aprenda o sistema, gere e execute testes, registre bugs e evolua os learned_patterns a cada execução.\n')
  writeIfAbsent(path.join(promptsDir(), 'exploratory_testing.md'), '# Teste Exploratório\n\nNavegue livremente, registre comportamentos inesperados e hipóteses de bug.\n')
  writeIfAbsent(path.join(promptsDir(), 'regression_testing.md'), '# Teste de Regressão\n\nReexecute os cenários conhecidos e compare com os resultados anteriores.\n')
  writeIfAbsent(path.join(promptsDir(), 'bug_hunting.md'), '# Caça a Bugs\n\nFoque em bordas, validações, segurança (SQLi/XSS) e fluxos de exceção.\n')
  // templates
  writeIfAbsent(path.join(templatesDir(), 'bug_template.md'), '# Bug: <título>\n\n- **Severidade:** crítico | maior | menor | visual\n- **Tela:** \n- **Passos:** \n- **Esperado:** \n- **Obtido:** \n- **Evidência:** \n')
  writeIfAbsent(path.join(templatesDir(), 'test_case_template.md'), '# Caso de Teste\n\n- **Cenário:** \n- **Pré-condições:** \n- **Passos (BDD):** Dado / Quando / Então\n- **Dados:** \n- **Resultado esperado:** \n')
  writeIfAbsent(path.join(templatesDir(), 'report_template.md'), '# Relatório\n\n- **Sistema:** \n- **Período:** \n- **Cenários executados:** \n- **Bugs encontrados:** \n- **Cobertura:** \n')
  // metrics (com cabeçalho CSV)
  writeIfAbsent(path.join(metricsDir(), 'bug_history.csv'), 'data,sistema,tela,severidade,titulo,status\n')
  writeIfAbsent(path.join(metricsDir(), 'executions.csv'), 'data,sistema,tela,cenarios,passou,falhou\n')
  writeIfAbsent(path.join(metricsDir(), 'coverage.csv'), 'sistema,telas_mapeadas,telas_testadas,percentual\n')
  // README
  writeIfAbsent(path.join(ROOT, 'README.md'), '# QA-Orchestrator — Base de Conhecimento\n\nEstrutura: `systems/<CODE>/` (system_info, knowledge, screens, executions, reports, learned_patterns, **evidences**), e `data/` (exclusivo do projeto: profiles, prompts, templates, metrics).\n')
}

const LEARNED = [
  ['validacoes_frequentes.md', '# Validações Frequentes\n\nValidações que aparecem repetidamente nas telas deste sistema.\n'],
  ['problemas_recorrentes.md', '# Problemas Recorrentes\n\nBugs/comportamentos que se repetem entre telas.\n'],
  ['telas_instaveis.md', '# Telas Instáveis\n\nTelas que falham/intermitem com frequência.\n'],
  ['componentes_reutilizados.md', '# Componentes Reutilizados\n\nGrids, abas, máscaras e widgets comuns do sistema.\n'],
  ['regras_descobertas.md', '# Regras Descobertas\n\nRegras de negócio inferidas durante os testes.\n'],
]

export function scaffoldSystem(code: string, name = code): void {
  console.log(`\nSistema ${code}:`)
  // system_info
  writeIfAbsent(path.join(systemInfoDir(code), 'urls.md'), `# URLs — ${name}\n\n- Homologação: \n- Produção: \n`)
  writeIfAbsent(path.join(systemInfoDir(code), 'credentials.md'), `# Credenciais — ${name}\n\n> ⚠️ NÃO colocar senhas aqui. As credenciais reais ficam no .env (gitignored).\n\n- Usuário de teste: (ver .env: APP_USERNAME)\n`)
  writeIfAbsent(path.join(systemInfoDir(code), 'architecture.md'), `# Arquitetura — ${name}\n\n- Plataforma: \n- Padrão de telas/menus: \n- Observações Maker (iframes, formID): \n`)
  // knowledge
  writeIfAbsent(path.join(knowledgeDir(code), 'business_rules.md'), `# Regras de Negócio — ${name}\n`)
  writeIfAbsent(path.join(knowledgeDir(code), 'requirements.md'), `# Requisitos — ${name}\n`)
  writeIfAbsent(path.join(knowledgeDir(code), 'known_bugs.md'), `# Bugs Conhecidos — ${name}\n`)
  // learned_patterns
  for (const [file, content] of LEARNED) writeIfAbsent(path.join(learnedPatternsDir(code), file), content)
  // evidências por severidade — SEMPRE dentro do próprio sistema
  for (const sev of SEVERITIES) gitkeep(evidencesDir(code, sev))
  // pastas vazias
  gitkeep(reportsDir(code))
  gitkeep(path.join(systemRoot(code), 'screens'))
  gitkeep(path.join(systemRoot(code), 'executions'))
}

if (require.main === module) {
  scaffoldRoot()
  const code = process.argv[2]
  if (code) scaffoldSystem(code.toUpperCase(), process.argv.slice(3).join(' ') || code.toUpperCase())
  console.log('\n✓ Estrutura pronta.')
}
