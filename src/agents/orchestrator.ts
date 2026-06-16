import Anthropic from '@anthropic-ai/sdk'
import { chromium } from '@playwright/test'
import type { Browser, BrowserContext } from '@playwright/test'
import { existsSync } from 'fs'
import path from 'path'
import { env, isProduction } from '@config/environments'
import { CLAUDE_MODELS, PRODUCTION_RESTRICTIONS, RISK_LEVELS } from '@config/constants'
import { logger } from '@utils/logger'
import { ScreenMapper } from '@tools/playwright/screenMapper'
import { ScenarioGenerator, ScenarioRunner } from '@scenarios/index'
import { knowledgeBase } from '@memory/knowledgeBase'

export interface OrchestratorInput {
  target: string
  commitHash?: string
  prNumber?: string
  scope?: 'full' | 'regression' | 'smoke' | 'security'
}

export interface ImpactAnalysis {
  riskLevel: keyof typeof RISK_LEVELS
  affectedModules: string[]
  affectedApis: string[]
  affectedDb: boolean
  affectedIntegrations: string[]
  recommendation: string
}

export class QAOrchestrator {
  private client: Anthropic
  private generator: ScenarioGenerator

  constructor() {
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
    this.generator = new ScenarioGenerator()
  }

  async run(input: OrchestratorInput): Promise<void> {
    logger.info(`QA Orchestrator iniciado — Alvo: ${input.target} | Ambiente: ${env.APP_ENV}`)

    if (isProduction) {
      logger.warn('AMBIENTE DE PRODUÇÃO — Modo somente leitura ativado')
      logger.warn(PRODUCTION_RESTRICTIONS.join(' | '))
    }

    const impact = await this.analyzeImpact(input)
    logger.info(`Análise de impacto: ${impact.riskLevel} — Módulos: ${impact.affectedModules.join(', ')}`)

    await this.generateAndExecuteScenarios(input, impact)
  }

  private async analyzeImpact(input: OrchestratorInput): Promise<ImpactAnalysis> {
    const prompt = `
Você é um QA Sênior analisando o impacto de uma mudança.
Alvo: ${input.target}
Commit: ${input.commitHash ?? 'N/A'}
PR: ${input.prNumber ?? 'N/A'}
Ambiente: ${env.APP_ENV}

Analise e retorne um JSON com:
- riskLevel: BAIXO | MÉDIO | ALTO | CRÍTICO
- affectedModules: string[]
- affectedApis: string[]
- affectedDb: boolean
- affectedIntegrations: string[]
- recommendation: string

Responda APENAS com o JSON.
`

    const response = await this.client.messages.create({
      model: CLAUDE_MODELS.DEFAULT,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
    const json = text.match(/\{[\s\S]*\}/)?.[0] ?? '{}'
    return JSON.parse(json) as ImpactAnalysis
  }

  // Pipeline real: abre a tela → mapeia → gera cenários BDD (realimentados pela KB) → executa por passos
  private async generateAndExecuteScenarios(
    input: OrchestratorInput,
    impact: ImpactAnalysis
  ): Promise<void> {
    const module = impact.affectedModules[0] ?? 'aplicacao'

    let browser: Browser | undefined
    let context: BrowserContext | undefined
    try {
      browser = await chromium.launch()
      context = await browser.newContext(this.contextOptions())
      const page = await context.newPage()

      logger.info(`Abrindo alvo para mapeamento: ${input.target}`)
      await page.goto(input.target)
      await page.waitForLoadState('domcontentloaded')

      const screenMap = await new ScreenMapper(page).map()

      // Loop de aprendizado: prioriza cobertura dos bugs que já reincidiram neste módulo
      const knownBugs = await this.recurringBugTitles(module)
      if (knownBugs.length) {
        logger.info(`KB — ${knownBugs.length} bug(s) reincidente(s) alimentando a geração de cenários`)
      }

      const suite = await this.generator.generate({
        screenMap,
        module,
        commitHash: input.commitHash,
        prNumber: input.prNumber,
        knownBugs,
        businessContext: impact.recommendation,
      })

      const report = await new ScenarioRunner(page).runSuite(suite)
      logger.info(
        `Execução concluída — ${report.passed}/${report.total} passou(aram) | taxa ${report.passRate}` +
          (report.featurePath ? ` | feature: ${report.featurePath}` : '')
      )
    } catch (err) {
      logger.error('Falha no pipeline de geração/execução de cenários', err)
      throw err
    } finally {
      await context?.close().catch(() => {})
      await browser?.close().catch(() => {})
    }
  }

  // Reaproveita uma sessão autenticada se houver storageState salvo (ex: SIGP)
  private contextOptions() {
    const candidate =
      process.env.STORAGE_STATE ?? path.resolve('playwright', '.auth', 'sigp.json')
    if (existsSync(candidate)) {
      logger.info(`Reutilizando sessão autenticada: ${candidate}`)
      return { storageState: candidate }
    }
    return {}
  }

  private async recurringBugTitles(module: string): Promise<string[]> {
    try {
      const bugs = await knowledgeBase.findRecurringBugs(module)
      return bugs.map(b => `${b.title} (${b.category})`)
    } catch (err) {
      logger.warn(`KB indisponível — seguindo sem histórico de bugs (${String(err)})`)
      return []
    }
  }
}
