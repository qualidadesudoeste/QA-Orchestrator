/**
 * screenKnowledge — memória de TELA, em arquivo (sem banco).
 *
 * É o primeiro tijolo da "conexão" prevista na visão: hoje cada ferramenta Maker
 * (register/crud/validate/tabs/oráculo) grava seu próprio artefato isolado e
 * nenhuma LÊ o que a outra aprendeu. Esta fachada dá a elas um lugar único, por
 * tela, para:
 *   - read-before: consultar o que já se sabe (abas, campos, obrigatórios,
 *     problemas conhecidos, histórico de resultados) ANTES de agir;
 *   - write-after: registrar o que aprendeu DEPOIS de agir.
 *
 * Determinístico, sem IA. File-backed e CONFIDENCIAL (vive em
 * systems/<CODE>/screens/<tela>/knowledge.json, que é gitignored junto com o
 * resto do conhecimento de cliente). Quando o Postgres/Qdrant da `KnowledgeBase`
 * subir, este arquivo é a fonte para espelhar — não se reinventa, conecta-se.
 */

import fs from 'fs'
import path from 'path'
import { screenDir, slug } from '../knowledge/layout'

/** Uma observação pontual de uma ferramenta sobre a tela (histórico capado). */
export interface ScreenObservation {
  at: string // ISO
  tool: string // 'register' | 'crud' | 'validate' | 'tabs' | 'oracle' | ...
  ok: boolean
  summary: string
}

export interface ScreenField {
  label: string
  type: string
  name: string
}

export interface ScreenTab {
  name: string
  hasGrid: boolean
  fieldCount: number
}

/** O que o agente sabe acumuladamente sobre UMA tela. */
export interface ScreenKnowledge {
  code: string
  screen: string
  slug: string
  url?: string
  firstSeen: string
  lastSeen: string
  /** Estrutura aprendida (abas/campos) — vinda do tabExplorer/register. */
  tabs?: ScreenTab[]
  formFields?: ScreenField[]
  /** Campos provados obrigatórios pelos testes negativos (validationTests). */
  mandatoryFields?: string[]
  /** Sinais recorrentes (ex.: ruído de console de infra, modal de duplicidade). */
  knownIssues: string[]
  observations: ScreenObservation[]
  stats: {
    registers: number
    successes: number
    lastVerifiedInGrid: number
  }
}

const MAX_OBSERVATIONS = 50

function file(code: string, screen: string): string {
  return path.join(screenDir(code, screen), 'knowledge.json')
}

/** read-before: o que já se sabe sobre a tela (ou null se é a 1ª vez). */
export function loadScreen(code: string, screen: string): ScreenKnowledge | null {
  const f = file(code, screen)
  if (!fs.existsSync(f)) return null
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8')) as ScreenKnowledge
  } catch {
    return null
  }
}

/** Linha curta e humana do que já se sabe — pra logar no read-before. */
export function summarize(k: ScreenKnowledge | null): string {
  if (!k) return '(primeira visita — sem conhecimento prévio)'
  const parts: string[] = []
  if (k.tabs?.length) parts.push(`${k.tabs.length} aba(s)`)
  if (k.formFields?.length) parts.push(`${k.formFields.length} campo(s) de form`)
  if (k.mandatoryFields?.length) parts.push(`obrigatório(s): ${k.mandatoryFields.join(', ')}`)
  if (k.stats.registers) parts.push(`${k.stats.successes}/${k.stats.registers} inclusão(ões) OK`)
  if (k.knownIssues.length) parts.push(`${k.knownIssues.length} sinal(is) conhecido(s)`)
  return parts.length ? parts.join(' · ') : '(conhecido, sem detalhes estruturais)'
}

/** Campos que uma ferramenta pode oferecer pra mesclar (write-after). */
export interface ScreenPatch {
  url?: string
  tabs?: ScreenTab[]
  formFields?: ScreenField[]
  mandatoryFields?: string[]
  knownIssues?: string[]
  /** incrementos de estatística desta execução */
  register?: { success: boolean; verifiedInGrid: number }
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr.filter(Boolean)))
}

/**
 * write-after: mescla o que a ferramenta aprendeu e registra a observação.
 * Best-effort por natureza — nunca deve derrubar o fluxo de quem chama.
 */
export function record(
  code: string,
  screen: string,
  obs: ScreenObservation,
  patch: ScreenPatch = {}
): ScreenKnowledge {
  const now = new Date().toISOString()
  const prev = loadScreen(code, screen)
  const k: ScreenKnowledge = prev ?? {
    code,
    screen,
    slug: slug(screen),
    firstSeen: now,
    lastSeen: now,
    knownIssues: [],
    observations: [],
    stats: { registers: 0, successes: 0, lastVerifiedInGrid: 0 },
  }

  k.lastSeen = now
  if (patch.url) k.url = patch.url
  if (patch.tabs?.length) k.tabs = patch.tabs
  if (patch.formFields?.length) k.formFields = patch.formFields
  if (patch.mandatoryFields?.length) {
    k.mandatoryFields = uniq([...(k.mandatoryFields ?? []), ...patch.mandatoryFields])
  }
  if (patch.knownIssues?.length) {
    k.knownIssues = uniq([...k.knownIssues, ...patch.knownIssues])
  }
  if (patch.register) {
    k.stats.registers += 1
    if (patch.register.success) k.stats.successes += 1
    k.stats.lastVerifiedInGrid = patch.register.verifiedInGrid
  }

  k.observations.push(obs)
  if (k.observations.length > MAX_OBSERVATIONS) {
    k.observations = k.observations.slice(-MAX_OBSERVATIONS)
  }

  try {
    fs.writeFileSync(file(code, screen), JSON.stringify(k, null, 2), 'utf8')
  } catch {
    /* persistência é best-effort — não derruba o chamador */
  }
  return k
}
