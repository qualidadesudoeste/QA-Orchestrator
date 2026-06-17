/**
 * inspect — o agente AUDITA as próprias pastas locais (base de conhecimento).
 *
 * Varre `systems/<CODE>/...`, diz o que está preenchido vs. vazio (placeholder),
 * conta telas/execuções/relatórios e cruza com os perfis aprendidos em
 * `data/profiles/*.json`. É só LEITURA — não cria nem altera nada.
 *
 * Uso:
 *   ts-node src/knowledge/inspect.ts            → audita tudo
 *   ts-node src/knowledge/inspect.ts <CODE>     → audita só um sistema
 *   ts-node src/knowledge/inspect.ts --json     → saída em JSON (para o agente)
 */

import fs from 'fs'
import path from 'path'
import { ROOT } from './layout'

interface FileStatus {
  file: string
  exists: boolean
  /** Tem conteúdo de verdade além do(s) cabeçalho(s)/placeholder? */
  filled: boolean
  lines: number
}

interface SystemAudit {
  code: string
  hasProfile: boolean
  systemInfo: FileStatus[]
  knowledge: FileStatus[]
  learnedPatterns: { total: number; filled: number }
  screens: string[]
  executions: string[]
  reports: number
}

/** Considera "vazio" um .md que só tem cabeçalhos/placeholders e nenhuma linha de conteúdo. */
function fileStatus(abs: string, rel: string): FileStatus {
  if (!fs.existsSync(abs)) return { file: rel, exists: false, filled: false, lines: 0 }
  const raw = fs.readFileSync(abs, 'utf-8')
  const content = raw
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .filter(l => !l.startsWith('#')) // ignora títulos markdown
    .filter(l => !/^>\s*⚠️/.test(l)) // ignora aviso de senha
    .filter(l => !/^-\s*(Homologação|Produção|Plataforma|Padrão|Observações|Usuário de teste|Severidade|Tela|Passos|Esperado|Obtido|Evidência|Cenário|Pré-condições|Dados|Resultado):/i.test(l))
  return { file: rel, exists: true, filled: content.length > 0, lines: content.length }
}

function listDir(abs: string): string[] {
  if (!fs.existsSync(abs)) return []
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== '.gitkeep')
    .map(d => d.name)
}

function countFiles(abs: string): number {
  if (!fs.existsSync(abs)) return 0
  return fs.readdirSync(abs).filter(f => f !== '.gitkeep').length
}

function profileCodes(): Set<string> {
  const dir = path.join(ROOT, 'data', 'profiles')
  const codes = new Set<string>()
  if (!fs.existsSync(dir)) return codes
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    try {
      const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))
      if (p.code) codes.add(String(p.code).toUpperCase())
      if (p.id) codes.add(String(p.id).toUpperCase())
    } catch {
      // perfil ilegível — ignora
    }
  }
  return codes
}

export function auditSystem(code: string, profiles: Set<string>): SystemAudit {
  const base = path.join(ROOT, 'systems', code)
  const info = (f: string) => fileStatus(path.join(base, 'system_info', f), `system_info/${f}`)
  const know = (f: string) => fileStatus(path.join(base, 'knowledge', f), `knowledge/${f}`)

  const lpDir = path.join(base, 'learned_patterns')
  const lpFiles = fs.existsSync(lpDir) ? fs.readdirSync(lpDir).filter(f => f.endsWith('.md')) : []
  const lpFilled = lpFiles.filter(f => fileStatus(path.join(lpDir, f), f).filled).length

  return {
    code,
    hasProfile: profiles.has(code.toUpperCase()),
    systemInfo: [info('urls.md'), info('credentials.md'), info('architecture.md')],
    knowledge: [know('business_rules.md'), know('requirements.md'), know('known_bugs.md')],
    learnedPatterns: { total: lpFiles.length, filled: lpFilled },
    screens: listDir(path.join(base, 'screens')),
    executions: listDir(path.join(base, 'executions')),
    reports: countFiles(path.join(base, 'reports')),
  }
}

export function auditAll(onlyCode?: string): SystemAudit[] {
  const systemsDir = path.join(ROOT, 'systems')
  if (!fs.existsSync(systemsDir)) return []
  const profiles = profileCodes()
  const codes = listDir(systemsDir)
    .filter(c => !onlyCode || c.toUpperCase() === onlyCode.toUpperCase())
    .sort()
  return codes.map(c => auditSystem(c, profiles))
}

function tick(b: boolean): string {
  return b ? '✓' : '·'
}

function printReport(audits: SystemAudit[]): void {
  // Estrutura raiz
  const rootDirs = ['prompts', 'templates', 'metrics', 'evidences', 'data/profiles']
  console.log('\n=== Auditoria das pastas locais (base de conhecimento) ===')
  console.log(`Raiz: ${ROOT}\n`)
  console.log('Estrutura raiz:')
  for (const d of rootDirs) {
    const abs = path.join(ROOT, d)
    console.log(`  ${tick(fs.existsSync(abs))} ${d}`)
  }

  if (!audits.length) {
    console.log('\n(nenhum sistema em systems/)')
    return
  }

  for (const a of audits) {
    const infoFilled = a.systemInfo.filter(f => f.filled).length
    const knowFilled = a.knowledge.filter(f => f.filled).length
    console.log(`\n── ${a.code}  ${a.hasProfile ? '[perfil aprendido ✓]' : '[sem perfil]'}`)
    console.log(`   system_info:     ${infoFilled}/${a.systemInfo.length} preenchidos`)
    for (const f of a.systemInfo) console.log(`       ${tick(f.filled)} ${f.file}${f.exists ? '' : ' (ausente)'}`)
    console.log(`   knowledge:       ${knowFilled}/${a.knowledge.length} preenchidos`)
    for (const f of a.knowledge) console.log(`       ${tick(f.filled)} ${f.file}${f.exists ? '' : ' (ausente)'}`)
    console.log(`   learned_patterns: ${a.learnedPatterns.filled}/${a.learnedPatterns.total} com conteúdo`)
    console.log(`   screens mapeadas: ${a.screens.length}${a.screens.length ? ' → ' + a.screens.slice(0, 8).join(', ') : ''}`)
    console.log(`   execuções:        ${a.executions.length}`)
    console.log(`   relatórios:       ${a.reports}`)
  }

  // Resumo
  const totScreens = audits.reduce((s, a) => s + a.screens.length, 0)
  const withProfile = audits.filter(a => a.hasProfile).length
  console.log(`\nResumo: ${audits.length} sistema(s), ${withProfile} com perfil aprendido, ${totScreens} tela(s) mapeada(s) no total.\n`)
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const asJson = args.includes('--json')
  const code = args.find(a => !a.startsWith('--'))
  const audits = auditAll(code)
  if (asJson) {
    console.log(JSON.stringify(audits, null, 2))
  } else {
    printReport(audits)
  }
}
