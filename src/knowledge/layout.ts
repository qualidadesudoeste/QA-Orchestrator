/**
 * layout — a estrutura ORGANIZADA da base de conhecimento do agente QA.
 *
 * Raiz do repositório:
 *   systems/<CODE>/
 *     system_info/   urls.md, credentials.md (placeholder), architecture.md
 *     knowledge/     business_rules.md, requirements.md, known_bugs.md
 *     screens/<tela>/  context.md, test_scenarios.md, screenshots/, bugs/
 *     executions/<data>/  execution_log.md, findings.md, screenshots/
 *     reports/
 *     learned_patterns/  validacoes_frequentes.md, problemas_recorrentes.md, ...
 *   evidences/{critical,major,minor,visual}/
 *   metrics/{bug_history,executions,coverage}.csv
 *   prompts/  templates/  README.md
 *
 * <CODE> = código curto do sistema (SIGP, CLE, SGOS...). A memória legível
 * (markdown) vive aqui; a memória de máquina continua em data/profiles/*.json.
 */

import fs from 'fs'
import path from 'path'
import { profileStore } from '../discovery/systemProfile'

export const ROOT = process.env.QA_BASE || process.cwd()

export function slug(s: string): string {
  return (
    (s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'sem_nome'
  )
}

function ens(dir: string): string {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Resolve o código curto do sistema a partir da URL (perfil > derivado). */
export function resolveCode(url: string): string {
  const p = profileStore.loadByUrl(url)
  if (p?.code) return p.code
  // Deriva um código curto do host (ex.: [REDACTED_HOST]... -> CLE-HOMO...): pega o 1º rótulo.
  try {
    const host = new URL(url).host
    return host.split('.')[0].toUpperCase()
  } catch {
    return slug(url).toUpperCase()
  }
}

// ── Raiz ──────────────────────────────────────────────────────────────────
export const promptsDir = () => ens(path.join(ROOT, 'prompts'))
export const templatesDir = () => ens(path.join(ROOT, 'templates'))
export const metricsDir = () => ens(path.join(ROOT, 'metrics'))
export const evidencesDir = (sev: 'critical' | 'major' | 'minor' | 'visual') =>
  ens(path.join(ROOT, 'evidences', sev))

// ── Por sistema ───────────────────────────────────────────────────────────
export const systemRoot = (code: string) => ens(path.join(ROOT, 'systems', code))
export const systemInfoDir = (code: string) => ens(path.join(systemRoot(code), 'system_info'))
export const knowledgeDir = (code: string) => ens(path.join(systemRoot(code), 'knowledge'))
export const learnedPatternsDir = (code: string) => ens(path.join(systemRoot(code), 'learned_patterns'))
export const reportsDir = (code: string) => ens(path.join(systemRoot(code), 'reports'))

// ── Por tela ──────────────────────────────────────────────────────────────
export const screenDir = (code: string, tela: string) =>
  ens(path.join(systemRoot(code), 'screens', slug(tela)))
export const screenshotsDir = (code: string, tela: string) =>
  ens(path.join(screenDir(code, tela), 'screenshots'))
export const screenBugsDir = (code: string, tela: string) =>
  ens(path.join(screenDir(code, tela), 'bugs'))

// ── Por execução ──────────────────────────────────────────────────────────
export const executionDir = (code: string, date = today()) =>
  ens(path.join(systemRoot(code), 'executions', date))
