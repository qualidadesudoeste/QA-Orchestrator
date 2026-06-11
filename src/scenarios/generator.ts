import Anthropic from '@anthropic-ai/sdk'
import { env, isProduction } from '@config/environments'
import { CLAUDE_MODELS, SCENARIO_TYPES } from '@config/constants'
import { logger } from '@utils/logger'
import { maskObject } from '@utils/dataMasking'
import type { ScreenMap } from '@tools/playwright/screenMapper'
import type { TestScenario, ScenarioSuite, TestStep } from './types'

interface GeneratorInput {
  screenMap: ScreenMap
  module: string
  commitHash?: string
  prNumber?: string
  knownBugs?: string[]
  businessContext?: string
}

// Claude response schema for scenarios
interface ClaudeScenario {
  type: string
  title: string
  description: string
  priority: 'HIGH' | 'MEDIUM' | 'LOW'
  risk: string
  automatable: boolean
  tags: string[]
  steps: { order: number; action: string; target?: string; value?: string; expectedOutcome?: string }[]
  expectedResult: string
  testData?: Record<string, unknown>
}

export class ScenarioGenerator {
  private client: Anthropic
  private idCounter = 0

  constructor() {
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  }

  async generate(input: GeneratorInput): Promise<ScenarioSuite> {
    logger.info(`Gerando cenários para módulo: ${input.module} | Tela: ${input.screenMap.title}`)

    const safeMap = maskObject(input.screenMap) as ScreenMap
    const scenarios = await this.callClaude(input, safeMap)
    const suite = this.buildSuite(input, scenarios)

    logger.info(`${suite.stats.total} cenário(s) gerado(s) para ${input.module}`)
    this.logBreakdown(suite)

    return suite
  }

  private async callClaude(input: GeneratorInput, safeMap: ScreenMap): Promise<TestScenario[]> {
    const prompt = this.buildPrompt(input, safeMap)

    const response = await this.client.messages.create({
      model: CLAUDE_MODELS.DEFAULT, // Sonnet — sufficient for scenario generation
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = response.content[0].type === 'text' ? response.content[0].text : '[]'
    return this.parseAndValidate(raw, input.module)
  }

  private buildPrompt(input: GeneratorInput, map: ScreenMap): string {
    const productionNote = isProduction
      ? '\n⚠️ AMBIENTE DE PRODUÇÃO: gere apenas cenários passivos (leitura, validação visual). Nenhum cenário de escrita, exclusão ou envio de dados reais.'
      : ''

    const screenSummary = {
      title: map.title,
      url: map.url,
      fields: map.fields.map(f => ({ label: f.label, type: f.type, required: f.required, maxLength: f.maxLength })),
      buttons: map.buttons.map(b => ({ text: b.text, action: b.action })),
      grids: map.grids.map(g => ({ columns: g.columns.map(c => c.header), rowCount: g.rowCount, hasPagination: g.hasPagination })),
      tabs: map.tabs.map(t => t.label),
      filters: map.filters.map(f => f.label),
      hasExport: map.hasExport,
      hasImport: map.hasImport,
    }

    return `Você é um QA Sênior gerando cenários de teste automatizados.
${productionNote}

TELA ANALISADA:
${JSON.stringify(screenSummary, null, 2)}

MÓDULO: ${input.module}
COMMIT: ${input.commitHash ?? 'N/A'}
PR: ${input.prNumber ?? 'N/A'}
${input.businessContext ? `CONTEXTO DE NEGÓCIO: ${input.businessContext}` : ''}
${input.knownBugs?.length ? `BUGS CONHECIDOS (priorizar cobertura):\n${input.knownBugs.join('\n')}` : ''}

TIPOS DE CENÁRIO DISPONÍVEIS: ${SCENARIO_TYPES.join(', ')}

INSTRUÇÕES:
1. Gere cenários reais e executáveis baseados nos elementos encontrados na tela.
2. Para cada campo de formulário, gere ao menos: positivo, negativo, borda.
3. Para grids: teste de listagem, busca, ordenação, paginação (se houver).
4. Inclua testes de segurança (SQL Injection, XSS) em campos de entrada.
5. Se houver exportação, gere cenário para ela.
6. Priorize HIGH para fluxos críticos de negócio e segurança.
7. Marque automatable: false apenas para cenários que requerem julgamento humano.
8. Os passos (steps) devem ser concretos e referir os elementos da tela pelo label/texto.

RETORNE APENAS um array JSON válido com o seguinte formato por item:
{
  "type": "POSITIVO",
  "title": "Título conciso",
  "description": "Descrição detalhada",
  "priority": "HIGH",
  "risk": "ALTO",
  "automatable": true,
  "tags": ["formulario", "cadastro"],
  "steps": [
    { "order": 1, "action": "navegar", "target": "URL da tela", "expectedOutcome": "Tela carregada" },
    { "order": 2, "action": "preencher", "target": "Nome do campo", "value": "valor_teste" },
    { "order": 3, "action": "clicar", "target": "Texto do botão", "expectedOutcome": "Resultado esperado" }
  ],
  "expectedResult": "Descrição do resultado esperado ao final",
  "testData": { "campo": "valor" }
}

Gere entre 15 e 25 cenários, cobrindo todos os tipos relevantes para esta tela.`
  }

  private parseAndValidate(raw: string, module: string): TestScenario[] {
    try {
      // Extract JSON array even if wrapped in markdown code block
      const jsonMatch = raw.match(/\[[\s\S]*\]/)
      if (!jsonMatch) throw new Error('Nenhum array JSON encontrado na resposta')

      const parsed: ClaudeScenario[] = JSON.parse(jsonMatch[0])

      return parsed
        .filter(s => s.type && s.title && s.steps?.length)
        .map(s => this.mapToScenario(s, module))
    } catch (err) {
      logger.error('Erro ao parsear cenários do Claude', err)
      return []
    }
  }

  private mapToScenario(s: ClaudeScenario, module: string): TestScenario {
    const type = SCENARIO_TYPES.includes(s.type as any)
      ? (s.type as TestScenario['type'])
      : 'EXPLORATORIO'

    const risk = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(s.risk)
      ? (s.risk as TestScenario['risk'])
      : 'MEDIUM'

    return {
      id: `SCN-${String(++this.idCounter).padStart(4, '0')}`,
      type,
      title: s.title,
      description: s.description,
      module,
      steps: s.steps as TestStep[],
      expectedResult: s.expectedResult,
      testData: s.testData,
      priority: s.priority ?? 'MEDIUM',
      risk,
      automatable: s.automatable ?? true,
      tags: s.tags ?? [],
    }
  }

  private buildSuite(input: GeneratorInput, scenarios: TestScenario[]): ScenarioSuite {
    const byType = Object.fromEntries(SCENARIO_TYPES.map(t => [t, 0])) as Record<string, number>
    const byPriority: Record<string, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 }

    for (const s of scenarios) {
      byType[s.type] = (byType[s.type] ?? 0) + 1
      byPriority[s.priority] = (byPriority[s.priority] ?? 0) + 1
    }

    return {
      id: `SUITE-${Date.now()}`,
      module: input.module,
      url: input.screenMap.url,
      generatedAt: new Date().toISOString(),
      commitHash: input.commitHash,
      prNumber: input.prNumber,
      scenarios,
      stats: {
        total: scenarios.length,
        byType: byType as any,
        byPriority,
      },
    }
  }

  private logBreakdown(suite: ScenarioSuite): void {
    const { byType, byPriority } = suite.stats
    const typeSummary = Object.entries(byType)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k}:${v}`)
      .join(' | ')

    logger.info(`Tipos — ${typeSummary}`)
    logger.info(`Prioridade — HIGH:${byPriority.HIGH} MEDIUM:${byPriority.MEDIUM} LOW:${byPriority.LOW}`)
  }
}
