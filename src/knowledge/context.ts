/**
 * context — o agente APRENDE sobre um sistema lendo a própria base local.
 *
 * Junta tudo que já se sabe de um sistema (system_info, knowledge,
 * learned_patterns e o perfil aprendido em data/profiles) num único briefing
 * em markdown. Esse texto é o que torna o agente "mais inteligente sobre o
 * sistema em si": pode ser injetado nos prompts de geração/execução de testes
 * para ele já chegar sabendo regras de negócio, bugs conhecidos e padrões.
 *
 * Uso:
 *   ts-node src/knowledge/context.ts <CODE>            → imprime o briefing
 *   ts-node src/knowledge/context.ts <CODE> --save     → grava em systems/<CODE>/system_info/brief.md
 */

import fs from 'fs'
import path from 'path'
import { ROOT } from './layout'
import { profileStore } from '../discovery/systemProfile'

/** Lê um .md e devolve o conteúdo "útil" (sem o título e sem placeholders vazios). */
function readSection(abs: string): string {
  if (!fs.existsSync(abs)) return ''
  const lines = fs.readFileSync(abs, 'utf-8').split(/\r?\n/)
  const body = lines
    .filter(l => l.trim().length > 0)
    .filter(l => !/^#\s/.test(l)) // tira o H1
    .filter(l => !/^>\s*⚠️/.test(l)) // tira aviso de senha
  // Remove placeholders "- Campo: " sem valor.
  const useful = body.filter(l => !/^-\s*[^:]+:\s*$/.test(l.trim()))
  return useful.join('\n').trim()
}

function appendIf(out: string[], title: string, content: string): void {
  if (content) {
    out.push(`## ${title}`)
    out.push(content)
    out.push('')
  }
}

export function buildSystemBrief(code: string): string {
  const base = path.join(ROOT, 'systems', code)
  if (!fs.existsSync(base)) return `(sistema ${code} não existe em systems/)`

  const out: string[] = [`# Briefing do sistema ${code}`, '']

  // Perfil aprendido (login, módulos) — memória de máquina.
  const profile = profileStore.list().find(p => (p.code || p.id).toUpperCase().includes(code.toUpperCase()))
  if (profile) {
    const lines: string[] = []
    if (profile.login) {
      lines.push(`- Login aprendido (confiança ${profile.login.confidence}, fonte ${profile.login.source}):`)
      lines.push(`  - usuário: ${profile.login.usernameSelectors.join(', ') || '?'}`)
      lines.push(`  - senha:   ${profile.login.passwordSelectors.join(', ') || '?'}`)
      lines.push(`  - submit:  ${profile.login.submitSelectors.join(', ') || '(Enter)'}`)
    }
    if (profile.modules?.length) {
      lines.push(`- Módulos conhecidos (${profile.modules.length}): ${profile.modules.map(m => m.name).slice(0, 20).join(', ')}`)
    }
    appendIf(out, 'Perfil aprendido', lines.join('\n'))
  }

  // system_info
  appendIf(out, 'Arquitetura', readSection(path.join(base, 'system_info', 'architecture.md')))
  appendIf(out, 'URLs', readSection(path.join(base, 'system_info', 'urls.md')))

  // knowledge
  appendIf(out, 'Regras de negócio', readSection(path.join(base, 'knowledge', 'business_rules.md')))
  appendIf(out, 'Requisitos', readSection(path.join(base, 'knowledge', 'requirements.md')))
  appendIf(out, 'Bugs conhecidos', readSection(path.join(base, 'knowledge', 'known_bugs.md')))

  // learned_patterns (todos)
  const lpDir = path.join(base, 'learned_patterns')
  if (fs.existsSync(lpDir)) {
    for (const f of fs.readdirSync(lpDir).filter(f => f.endsWith('.md'))) {
      appendIf(out, `Padrão: ${f.replace('.md', '').replace(/_/g, ' ')}`, readSection(path.join(lpDir, f)))
    }
  }

  const brief = out.join('\n').trim()
  const hasContent = brief.split('\n').length > 2
  return hasContent ? brief : `# Briefing do sistema ${code}\n\n(sem conhecimento registrado ainda — rode discover/navigate/screen para o agente aprender)`
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const code = args.find(a => !a.startsWith('--'))
  if (!code) {
    console.error('Uso: ts-node src/knowledge/context.ts <CODE> [--save]')
    process.exit(1)
  }
  const brief = buildSystemBrief(code.toUpperCase())
  if (args.includes('--save')) {
    const dest = path.join(ROOT, 'systems', code.toUpperCase(), 'system_info', 'brief.md')
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, brief + '\n', 'utf-8')
    console.log(`✓ Briefing salvo em ${path.relative(ROOT, dest)}`)
  } else {
    console.log('\n' + brief + '\n')
  }
}
