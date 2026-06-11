import Anthropic from '@anthropic-ai/sdk'
import { env, isProduction } from '@config/environments'
import { CLAUDE_MODELS, PRODUCTION_RESTRICTIONS, RISK_LEVELS } from '@config/constants'
import { logger } from '@utils/logger'
import { maskObject } from '@utils/dataMasking'

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

  constructor() {
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
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
      model: CLAUDE_MODELS.POWERFUL,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
    return JSON.parse(text) as ImpactAnalysis
  }

  private async generateAndExecuteScenarios(
    input: OrchestratorInput,
    impact: ImpactAnalysis
  ): Promise<void> {
    const prompt = `
Você é um QA Sênior especialista. Com base na análise de impacto abaixo, gere cenários de teste.

Análise: ${JSON.stringify(maskObject(impact))}
Ambiente: ${env.APP_ENV}
${isProduction ? 'ATENÇÃO: Ambiente de produção — apenas testes passivos' : ''}

Gere cenários para:
- Testes Positivos
- Testes Negativos
- Testes de Borda
- Testes de Segurança (SQL Injection, XSS, CSRF, IDOR)
- Testes de Regressão
- Testes de API (status, contrato, autenticação)

Formato: JSON com array de cenários contendo { tipo, descricao, passos, criterioAceite }
`

    const response = await this.client.messages.create({
      model: CLAUDE_MODELS.FAST,
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : '[]'
    logger.info(`Cenários gerados com sucesso para ${input.target}`)
    logger.debug(`Cenários: ${text}`)
  }
}
