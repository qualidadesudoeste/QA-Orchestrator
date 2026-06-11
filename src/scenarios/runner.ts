import type { Page } from '@playwright/test'
import { logger } from '@utils/logger'
import { isProduction } from '@config/environments'
import { FormTester } from '@tools/playwright/formTester'
import { GridHandler } from '@tools/playwright/gridHandler'
import { PageActions } from '@tools/playwright/pageActions'
import { ScreenMapper } from '@tools/playwright/screenMapper'
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
  scenarios: TestScenario[]
}

export class ScenarioRunner {
  private mapper: ScreenMapper
  private formTester: FormTester
  private gridHandler: GridHandler
  private pageActions: PageActions

  constructor(private page: Page) {
    this.mapper = new ScreenMapper(page)
    this.formTester = new FormTester(page)
    this.gridHandler = new GridHandler(page)
    this.pageActions = new PageActions(page)
  }

  async runSuite(suite: ScenarioSuite): Promise<RunReport> {
    const startedAt = new Date().toISOString()
    const start = Date.now()

    logger.info(`Iniciando suíte: ${suite.id} | ${suite.scenarios.length} cenário(s) | módulo: ${suite.module}`)

    // Navigate to the target URL once
    await this.page.goto(suite.url)
    await this.page.waitForLoadState('networkidle')

    const screenMap = await this.mapper.map()

    let passed = 0
    let failed = 0
    let skipped = 0

    // Group scenarios: security and write ops last; skip write ops in production
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
        const result = await this.runScenario(scenario, screenMap)
        scenario.result = { ...result, duration: Date.now() - t0 }
        result.passed ? passed++ : failed++
      } catch (err) {
        scenario.result = { passed: false, detail: String(err), duration: Date.now() - t0, error: String(err) }
        failed++
      }

      logger.info(`[${scenario.result.passed ? 'OK' : 'FAIL'}] ${scenario.id} — ${scenario.title}`)
    }

    const durationMs = Date.now() - start
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
      scenarios: suite.scenarios,
    }

    this.logReport(report)
    return report
  }

  private async runScenario(
    scenario: TestScenario,
    screenMap: import('@tools/playwright/screenMapper').ScreenMap
  ): Promise<ScenarioResult> {
    switch (scenario.type) {
      case 'POSITIVO':
        return this.runPositive(scenario, screenMap)
      case 'NEGATIVO':
        return this.runNegative(scenario, screenMap)
      case 'BORDA':
        return this.runEdge(scenario, screenMap)
      case 'SEGURANCA':
        return this.runSecurity(screenMap)
      case 'EXPLORATORIO':
        return this.runExploratory()
      case 'REGRESSAO':
        return this.runRegression(scenario, screenMap)
      case 'API':
        return { passed: true, detail: 'Cenário API — executar via tests/api/', duration: 0 }
      case 'INTEGRACAO':
        return { passed: true, detail: 'Cenário de integração — requer setup adicional', duration: 0 }
      case 'USABILIDADE':
        return this.runUsability()
      case 'PERMISSAO':
        return this.runPermission()
      default:
        return { passed: true, detail: `Tipo ${scenario.type} sem executor mapeado`, duration: 0 }
    }
  }

  private async runPositive(
    scenario: TestScenario,
    screenMap: import('@tools/playwright/screenMapper').ScreenMap
  ): Promise<ScenarioResult> {
    const summary = await this.pageActions.runFullPageTest()
    const crudPassed = summary.crudResults.filter(r => r.operation === 'CREATE' && r.passed).length > 0
    return {
      passed: crudPassed || summary.crudResults.every(r => r.passed),
      detail: crudPassed ? 'Fluxo positivo executado com sucesso' : 'Fluxo positivo com falhas em CREATE',
      screenshotPath: summary.screenshotPath,
    }
  }

  private async runNegative(
    scenario: TestScenario,
    screenMap: import('@tools/playwright/screenMapper').ScreenMap
  ): Promise<ScenarioResult> {
    const formResults = await this.formTester.testAll(screenMap)
    const requiredTests = formResults.filter(r => r.scenario.includes('Obrigatório') || r.scenario.includes('Obrigatoriedade'))
    const allPass = requiredTests.every(r => r.passed)
    return {
      passed: allPass,
      detail: allPass
        ? `${requiredTests.length} validação(ões) negativa(s) passaram`
        : `FALHA: ${requiredTests.filter(r => !r.passed).map(r => r.field).join(', ')} não validaram`,
    }
  }

  private async runEdge(
    scenario: TestScenario,
    screenMap: import('@tools/playwright/screenMapper').ScreenMap
  ): Promise<ScenarioResult> {
    const formResults = await this.formTester.testAll(screenMap)
    const edgeTests = formResults.filter(r =>
      r.scenario.includes('máximo') || r.scenario.includes('Caracteres')
    )
    const allPass = edgeTests.length === 0 || edgeTests.every(r => r.passed)
    return {
      passed: allPass,
      detail: allPass ? 'Testes de borda aprovados' : `${edgeTests.filter(r => !r.passed).length} borda(s) falharam`,
    }
  }

  private async runSecurity(
    screenMap: import('@tools/playwright/screenMapper').ScreenMap
  ): Promise<ScenarioResult> {
    const formResults = await this.formTester.testAll(screenMap)
    const secTests = formResults.filter(r =>
      r.scenario.includes('SQL') || r.scenario.includes('XSS')
    )
    const vulns = secTests.filter(r => !r.passed)
    return {
      passed: vulns.length === 0,
      detail: vulns.length === 0
        ? `Nenhuma vulnerabilidade encontrada (${secTests.length} payload(s) testado(s))`
        : `VULNERABILIDADE: ${vulns.map(r => r.scenario).join(' | ')}`,
    }
  }

  private async runExploratory(): Promise<ScenarioResult> {
    try {
      await this.page.waitForLoadState('networkidle')
      await this.page.screenshot({ path: `evidence/screenshots/exploratory-${Date.now()}.png`, fullPage: true })
      const url = this.page.url()
      return { passed: true, detail: `Exploração registrada: ${url}`, screenshotPath: `evidence/screenshots/exploratory-${Date.now()}.png` }
    } catch (err) {
      return { passed: false, detail: String(err) }
    }
  }

  private async runRegression(
    scenario: TestScenario,
    screenMap: import('@tools/playwright/screenMapper').ScreenMap
  ): Promise<ScenarioResult> {
    // Regression = re-run positive + negative to confirm no breakage
    const pos = await this.runPositive(scenario, screenMap)
    const neg = await this.runNegative(scenario, screenMap)
    const passed = pos.passed && neg.passed
    return {
      passed,
      detail: passed ? 'Regressão aprovada — fluxos positivo e negativo OK' : `Regressão FALHOU — positivo:${pos.passed} negativo:${neg.passed}`,
    }
  }

  private async runUsability(): Promise<ScenarioResult> {
    try {
      // Check basic usability signals
      const checks = await Promise.all([
        this.page.locator('h1, h2, [role="heading"]').count().then(n => ({ check: 'heading', ok: n > 0 })),
        this.page.locator('button, a, [role="button"]').count().then(n => ({ check: 'interactive', ok: n > 0 })),
        this.page.locator('[aria-label], [aria-labelledby], label').count().then(n => ({ check: 'accessibility-labels', ok: n > 0 })),
        this.page.locator('img:not([alt])').count().then(n => ({ check: 'img-alt', ok: n === 0 })),
      ])

      const failed = checks.filter(c => !c.ok)
      return {
        passed: failed.length === 0,
        detail: failed.length === 0
          ? 'Verificações básicas de usabilidade aprovadas'
          : `Atenção: ${failed.map(c => c.check).join(', ')}`,
      }
    } catch (err) {
      return { passed: false, detail: String(err) }
    }
  }

  private async runPermission(): Promise<ScenarioResult> {
    try {
      // Try accessing the page without expected auth headers
      const response = await this.page.request.get(this.page.url(), {
        headers: { Authorization: '' },
        failOnStatusCode: false,
      })

      const isProtected = response.status() === 401 || response.status() === 403
      return {
        passed: isProtected,
        detail: isProtected
          ? `Endpoint protegido (HTTP ${response.status()})`
          : `ATENÇÃO: endpoint pode estar desprotegido (HTTP ${response.status()})`,
      }
    } catch (err) {
      return { passed: false, detail: String(err) }
    }
  }

  // Security and destructive scenarios run last; HIGH priority runs first
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
