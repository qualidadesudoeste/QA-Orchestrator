import Anthropic from '@anthropic-ai/sdk'
import type { Page, APIRequestContext } from '@playwright/test'
import { env, isProduction } from '@config/environments'
import { CLAUDE_MODELS, RISK_LEVELS } from '@config/constants'
import { logger } from '@utils/logger'
import { maskObject } from '@utils/dataMasking'
import { SecurityScanner, type SecurityFinding } from '@tools/security/securityScanner'
import { HeaderAnalyzer, type HeaderFinding } from '@tools/security/headerAnalyzer'
import { AuthTester, type AuthFinding } from '@tools/security/authTester'
import { FormTester } from '@tools/playwright/formTester'
import { ScreenMapper } from '@tools/playwright/screenMapper'
import fs from 'fs'
import path from 'path'

export interface SecurityReportSummary {
  critical: number
  high: number
  medium: number
  low: number
  info: number
}

export interface SecurityReport {
  id: string
  target: string
  environment: string
  scanDate: string
  overallRisk: keyof typeof RISK_LEVELS
  score: number            // 0-100 (higher = more secure)
  summary: SecurityReportSummary
  zapFindings: SecurityFinding[]
  headerFindings: HeaderFinding[]
  authFindings: AuthFinding[]
  formSecurityIssues: { field: string; scenario: string; detail: string }[]
  aiAnalysis: string
  recommendations: string[]
  reportPath: string
}

export class SecurityAgent {
  private client: Anthropic
  private scanner: SecurityScanner
  private headerAnalyzer: HeaderAnalyzer

  constructor() {
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
    this.scanner = new SecurityScanner()
    this.headerAnalyzer = new HeaderAnalyzer()
  }

  async run(page: Page, request: APIRequestContext, endpoints: string[] = []): Promise<SecurityReport> {
    const target = page.url()
    logger.info(`SecurityAgent iniciado — alvo: ${target} | ambiente: ${env.APP_ENV}`)

    if (isProduction) {
      logger.warn('Produção — ZAP active scan ignorado. Apenas análise passiva de headers e UI.')
    }

    // 1. OWASP ZAP active scan (skip in production)
    const zapFindings = isProduction ? [] : await this.scanner.activeScan(target)

    // 2. Security headers
    const headerReport = await this.headerAnalyzer.analyze(target)

    // 3. Auth / authorization tests
    const authTester = new AuthTester(page, request)
    const authFindings = await authTester.runAll(target, endpoints)

    // 4. Form-level security (SQL Injection, XSS via FormTester)
    const mapper = new ScreenMapper(page)
    const screenMap = await mapper.map()
    const formTester = new FormTester(page)
    const formResults = await formTester.testAll(screenMap)
    const formSecurityIssues = formResults
      .filter(r => !r.passed && (r.scenario.includes('SQL') || r.scenario.includes('XSS')))
      .map(r => ({ field: r.field, scenario: r.scenario, detail: r.detail }))

    // 5. Consolidate and score
    const allFindings = [
      ...zapFindings,
      ...headerReport.findings.filter(f => f.status !== 'PRESENT'),
      ...authFindings.filter(f => !f.passed),
    ]

    const summary = this.buildSummary(zapFindings, headerReport.findings, authFindings, formSecurityIssues)
    const overallRisk = this.calcRisk(summary)
    const score = this.calcScore(summary, headerReport.score)

    // 6. AI analysis using Claude Sonnet
    const aiAnalysis = await this.generateAiAnalysis(target, summary, zapFindings, authFindings, formSecurityIssues)
    const recommendations = await this.generateRecommendations(summary, zapFindings, headerReport.findings, authFindings)

    const report: SecurityReport = {
      id: `SEC-${Date.now()}`,
      target,
      environment: env.APP_ENV,
      scanDate: new Date().toISOString(),
      overallRisk,
      score,
      summary,
      zapFindings,
      headerFindings: headerReport.findings,
      authFindings,
      formSecurityIssues,
      aiAnalysis,
      recommendations,
      reportPath: '',
    }

    report.reportPath = this.saveReport(report)
    this.logFinalSummary(report)

    return report
  }

  private async generateAiAnalysis(
    target: string,
    summary: SecurityReportSummary,
    zap: SecurityFinding[],
    auth: AuthFinding[],
    form: { field: string; scenario: string; detail: string }[]
  ): Promise<string> {
    const prompt = `Você é um analista de segurança sênior. Analise os resultados abaixo e escreva um parecer técnico conciso (máximo 300 palavras) sobre o nível de segurança da aplicação.

Alvo: ${target}
Resumo: ${JSON.stringify(maskObject(summary))}
ZAP (${zap.length} findings): ${JSON.stringify(maskObject(zap.slice(0, 5)))}
Auth (${auth.filter(a => !a.passed).length} falhas): ${JSON.stringify(maskObject(auth.filter(a => !a.passed).slice(0, 5)))}
Formulários (${form.length} vulnerabilidades): ${JSON.stringify(maskObject(form.slice(0, 5)))}

Inclua: avaliação geral, principais riscos identificados, áreas críticas a corrigir imediatamente.
NÃO inclua dados sensíveis. Seja direto e técnico.`

    const response = await this.client.messages.create({
      model: CLAUDE_MODELS.DEFAULT,
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    })

    return response.content[0].type === 'text' ? response.content[0].text : ''
  }

  private async generateRecommendations(
    summary: SecurityReportSummary,
    zap: SecurityFinding[],
    headers: HeaderFinding[],
    auth: AuthFinding[]
  ): Promise<string[]> {
    const prompt = `Com base nestes resultados de segurança, gere uma lista de no máximo 10 recomendações de correção, ordenadas por prioridade (crítica primeiro).

Findings ZAP: ${zap.map(f => f.type).join(', ')}
Headers com problema: ${headers.filter(h => h.status !== 'PRESENT').map(h => h.header).join(', ')}
Falhas de auth: ${auth.filter(a => !a.passed).map(a => a.test).join(', ')}

Retorne APENAS um array JSON de strings. Ex: ["Corrigir XSS no campo X", "Adicionar HSTS"]`

    const response = await this.client.messages.create({
      model: CLAUDE_MODELS.LIGHT, // Haiku é suficiente para gerar lista de texto
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    })

    try {
      const text = response.content[0].type === 'text' ? response.content[0].text : '[]'
      const match = text.match(/\[[\s\S]*\]/)
      return match ? JSON.parse(match[0]) : []
    } catch {
      return []
    }
  }

  private buildSummary(
    zap: SecurityFinding[],
    headers: HeaderFinding[],
    auth: AuthFinding[],
    form: { field: string }[]
  ): SecurityReportSummary {
    const count = (sev: string) =>
      zap.filter(f => f.severity === sev).length +
      headers.filter(h => h.status !== 'PRESENT' && h.severity === sev).length +
      auth.filter(a => !a.passed && a.severity === sev).length

    return {
      critical: count('CRÍTICA') + form.length,
      high: count('ALTA'),
      medium: count('MÉDIA'),
      low: count('BAIXA'),
      info: headers.filter(h => h.status === 'PRESENT').length,
    }
  }

  private calcRisk(s: SecurityReportSummary): keyof typeof RISK_LEVELS {
    if (s.critical > 0) return 'CRITICAL'
    if (s.high > 2) return 'HIGH'
    if (s.high > 0 || s.medium > 3) return 'MEDIUM'
    return 'LOW'
  }

  private calcScore(s: SecurityReportSummary, headerScore: number): number {
    const deductions = s.critical * 20 + s.high * 10 + s.medium * 5 + s.low * 2
    return Math.max(0, Math.round((headerScore + Math.max(0, 100 - deductions)) / 2))
  }

  private saveReport(report: SecurityReport): string {
    const safe = maskObject(report) as Record<string, unknown>
    const filename = `security-${report.id}.json`
    const filepath = path.join(env.REPORTS_DIR, filename)
    fs.mkdirSync(env.REPORTS_DIR, { recursive: true })
    fs.writeFileSync(filepath, JSON.stringify(safe, null, 2), 'utf-8')
    logger.info(`Relatório de segurança salvo: ${filepath}`)
    return filepath
  }

  private logFinalSummary(r: SecurityReport): void {
    logger.info('═══════════════════════════════════════')
    logger.info(' RELATÓRIO DE SEGURANÇA')
    logger.info('═══════════════════════════════════════')
    logger.info(` Alvo       : ${r.target}`)
    logger.info(` Risco      : ${RISK_LEVELS[r.overallRisk]}`)
    logger.info(` Score      : ${r.score}/100`)
    logger.info(` Crítico    : ${r.summary.critical}`)
    logger.info(` Alto       : ${r.summary.high}`)
    logger.info(` Médio      : ${r.summary.medium}`)
    logger.info(` Baixo      : ${r.summary.low}`)
    logger.info(` Relatório  : ${r.reportPath}`)
    logger.info('═══════════════════════════════════════')
    if (r.summary.critical > 0) {
      logger.error(`⚠ ${r.summary.critical} vulnerabilidade(s) CRÍTICA(s) — corrigir antes de qualquer deploy!`)
    }
  }
}
