import type { Page } from '@playwright/test'
import { promises as fs } from 'fs'
import path from 'path'
import { logger } from '@utils/logger'
import { isProduction } from '@config/environments'
import { ScreenMapper } from '@tools/playwright/screenMapper'
import type { ScreenMap } from '@tools/playwright/screenMapper'
import { BddPlaywrightRunner, suiteToFeature } from './bdd'
import { evidencesDir, resolveCode } from '../knowledge/layout'
import type { BddStepResult } from './bdd'
import type { TestScenario, ScenarioSuite, ScenarioResult } from './types'

export interface RunReport {
  suiteId: string
  module: string
  startedAt: string
  finishedAt: string
  durationMs: number
  total: number
  passed: number
  failed: number
  skipped: number
  passRate: string
  featurePath?: string
  scenarios: TestScenario[]
}

// Indicadores de vazamento de erro de banco/stack — usados nas asserções de segurança
const LEAK_PATTERN = /sql syntax|syntax error|ora-\d|mysql|pg_|sqlstate|stack ?trace|unhandled exception/i

export class ScenarioRunner {
  private mapper: ScreenMapper
  private xssTriggered = false

  constructor(private page: Page) {
    this.mapper = new ScreenMapper(page)
  }

  async runSuite(suite: ScenarioSuite): Promise<RunReport> {
    const startedAt = new Date().toISOString()
    const start = Date.now()

    logger.info(`Iniciando suíte: ${suite.id} | ${suite.scenarios.length} cenário(s) | módulo: ${suite.module}`)

    // Qualquer dialog (alert/confirm) durante a suíte indica possível execução de XSS
    this.xssTriggered = false
    this.page.on('dialog', async dialog => {
      this.xssTriggered = true
      await dialog.dismiss().catch(() => {})
    })

    await this.page.goto(suite.url)
    await this.page.waitForLoadState('domcontentloaded')

    const screenMap = await this.mapper.map()
    const bddRunner = new BddPlaywrightRunner(this.page, screenMap)

    let passed = 0
    let failed = 0
    let skipped = 0

    const ordered = this.prioritizeScenarios(suite.scenarios)

    for (const scenario of ordered) {
      if (!scenario.automatable) {
        scenario.result = { passed: true, detail: 'Cenário manual — execução ignorada', duration: 0 }
        skipped++
        continue
      }

      if (isProduction && this.isDestructive(scenario)) {
        scenario.result = { passed: true, detail: 'Ignorado em produção (cenário destrutivo)', duration: 0 }
        skipped++
        continue
      }

      const t0 = Date.now()
      try {
        const result = await this.runScenario(scenario, bddRunner, screenMap)
        scenario.result = { ...result, duration: Date.now() - t0 }
        result.passed ? passed++ : failed++
      } catch (err) {
        scenario.result = { passed: false, detail: String(err), duration: Date.now() - t0, error: String(err) }
        failed++
      }

      logger.info(`[${scenario.result.passed ? 'OK' : 'FAIL'}] ${scenario.id} — ${scenario.title}`)
    }

    const durationMs = Date.now() - start
    const featurePath = await this.writeFeature(suite)

    const report: RunReport = {
      suiteId: suite.id,
      module: suite.module,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs,
      total: suite.scenarios.length,
      passed,
      failed,
      skipped,
      passRate: `${((passed / (passed + failed || 1)) * 100).toFixed(1)}%`,
      featurePath,
      scenarios: suite.scenarios,
    }

    this.logReport(report)
    return report
  }

  // Execução agora é dirigida pelos passos Dado/Quando/Então do cenário.
  // O `type` apenas enriquece a asserção final (ex: segurança verifica vazamento).
  private async runScenario(
    scenario: TestScenario,
    bddRunner: BddPlaywrightRunner,
    screenMap: ScreenMap
  ): Promise<ScenarioResult> {
    const stepResults = await bddRunner.runSteps(scenario)
    return this.assertScenario(scenario, stepResults, screenMap)
  }

  private async assertScenario(
    scenario: TestScenario,
    stepResults: BddStepResult[],
    _screenMap: ScreenMap
  ): Promise<ScenarioResult> {
    const failedSteps = stepResults.filter(s => !s.passed)
    let passed = failedSteps.length === 0
    let detail = passed
      ? `${stepResults.length} passo(s) BDD executado(s) — ${this.bddSummary(stepResults)}`
      : `Falha em: ${failedSteps.map(s => s.text).join(' | ')}`

    // Enriquecimento por tipo: segurança não pode vazar erro de banco nem executar script
    if (scenario.type === 'SEGURANCA') {
      const leak = await this.scanForLeak()
      if (leak) {
        passed = false
        detail = `VULNERABILIDADE: ${leak}`
      } else if (passed) {
        detail = `Nenhuma vulnerabilidade detectada — ${detail}`
      }
    }

    return { passed, detail }
  }

  private bddSummary(steps: BddStepResult[]): string {
    const count = (k: BddStepResult['keyword']) => steps.filter(s => s.keyword === k).length
    return `Dado:${count('DADO')} Quando:${count('QUANDO') + count('E')} Então:${count('ENTAO')}`
  }

  // Verifica execução de XSS (dialog) e vazamento de erros de banco no corpo da página
  private async scanForLeak(): Promise<string | null> {
    if (this.xssTriggered) return 'XSS executado (dialog disparado na página)'
    try {
      const body = (await this.page.locator('body').textContent()) ?? ''
      if (LEAK_PATTERN.test(body)) return 'erro de banco/stack trace exposto na resposta'
    } catch {
      // ignora erro transitório de leitura
    }
    return null
  }

  private async writeFeature(suite: ScenarioSuite): Promise<string | undefined> {
    try {
      const dir = evidencesDir(resolveCode(suite.url), 'features')
      await fs.mkdir(dir, { recursive: true })
      const safe = suite.module.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()
      const file = path.join(dir, `${safe || 'suite'}-${suite.id}.feature`)
      await fs.writeFile(file, suiteToFeature(suite), 'utf-8')
      logger.info(`Arquivo .feature (Gherkin) gerado: ${file}`)
      return file
    } catch (err) {
      logger.warn(`Não foi possível gravar o .feature: ${String(err)}`)
      return undefined
    }
  }

  // Cenários de segurança/destrutivos rodam por último; HIGH primeiro
  private prioritizeScenarios(scenarios: TestScenario[]): TestScenario[] {
    const order: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 }
    const typeOrder: Record<string, number> = {
      POSITIVO: 0, NEGATIVO: 1, BORDA: 2, REGRESSAO: 3,
      EXPLORATORIO: 4, USABILIDADE: 5, PERMISSAO: 6,
      API: 7, INTEGRACAO: 8, SEGURANCA: 9,
    }
    return [...scenarios].sort((a, b) => {
      const p = (order[a.priority] ?? 1) - (order[b.priority] ?? 1)
      if (p !== 0) return p
      return (typeOrder[a.type] ?? 5) - (typeOrder[b.type] ?? 5)
    })
  }

  private isDestructive(scenario: TestScenario): boolean {
    const destructiveTypes = ['NEGATIVO', 'SEGURANCA']
    const destructiveTags = ['delete', 'exclusao', 'destructive', 'write', 'create']
    return (
      destructiveTypes.includes(scenario.type) ||
      scenario.tags.some(t => destructiveTags.includes(t.toLowerCase()))
    )
  }

  private logReport(report: RunReport): void {
    logger.info('═══════════════════════════════════════')
    logger.info(` RELATÓRIO DE EXECUÇÃO — ${report.module}`)
    logger.info('═══════════════════════════════════════')
    logger.info(` Total    : ${report.total}`)
    logger.info(` Passou   : ${report.passed}`)
    logger.info(` Falhou   : ${report.failed}`)
    logger.info(` Ignorado : ${report.skipped}`)
    logger.info(` Taxa     : ${report.passRate}`)
    logger.info(` Duração  : ${(report.durationMs / 1000).toFixed(1)}s`)
    logger.info('═══════════════════════════════════════')
  }
}
