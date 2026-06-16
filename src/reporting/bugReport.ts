import { BUG_CATEGORIES, RISK_LEVELS, SEVERITY } from '@config/constants'
import { maskObject } from '@utils/dataMasking'
import { knowledgeBase, type BugRecord } from '@memory/knowledgeBase'
import { logger } from '@utils/logger'
import fs from 'fs'
import path from 'path'
import { env } from '@config/environments'

export async function generateBugReport(bug: BugRecord): Promise<string> {
  const id = await knowledgeBase.saveBug(bug)
  const recurring = await knowledgeBase.findRecurringBugs(bug.module)
  const isRecurrence = recurring.some(r => r.title === bug.title)

  const report = {
    id,
    titulo: bug.title,
    categoria: BUG_CATEGORIES[bug.category],
    modulo: bug.module,
    caminho: bug.path,
    descricao: bug.description,
    resultadoAtual: bug.actualResult,
    resultadoEsperado: bug.expectedResult,
    passosParaReproduzir: bug.steps,
    severidade: SEVERITY[bug.severity],
    prioridade: bug.priority,
    risco: RISK_LEVELS[bug.risk],
    evidencias: bug.evidencePaths,
    possivelCausa: bug.possibleCause,
    reincidencia: isRecurrence,
    commit: bug.commitHash,
    pr: bug.prNumber,
    versao: bug.version,
    timestamp: new Date().toISOString(),
  }

  const safeReport = maskObject(report) as Record<string, unknown>
  const filename = `bug-${id}-${Date.now()}.json`
  const filepath = path.join(env.REPORTS_DIR, filename)

  fs.writeFileSync(filepath, JSON.stringify(safeReport, null, 2), 'utf-8')
  logger.info(`Bug report gerado: ${filepath}`)

  if (isRecurrence) {
    logger.warn(`REINCIDÊNCIA DETECTADA: ${bug.title} — módulo ${bug.module}`)
  }

  return filepath
}
