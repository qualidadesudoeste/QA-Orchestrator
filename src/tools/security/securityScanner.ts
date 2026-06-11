import { logger } from '@utils/logger'
import { env } from '@config/environments'

export interface SecurityFinding {
  type: 'SQL_INJECTION' | 'XSS' | 'CSRF' | 'SSRF' | 'IDOR' | 'PATH_TRAVERSAL' | 'BROKEN_ACCESS' | 'SECRET_EXPOSED'
  severity: 'CRÍTICA' | 'ALTA' | 'MÉDIA' | 'BAIXA'
  url?: string
  parameter?: string
  description: string
  recommendation: string
}

export class SecurityScanner {
  private zapBaseUrl: string
  private zapApiKey: string

  constructor() {
    this.zapBaseUrl = env.ZAP_API_URL
    this.zapApiKey = env.ZAP_API_KEY ?? 'changeme'
  }

  async activeScan(targetUrl: string): Promise<SecurityFinding[]> {
    logger.info(`Iniciando scan de segurança (OWASP ZAP) em: ${targetUrl}`)

    try {
      // Spider the target
      await fetch(`${this.zapBaseUrl}/JSON/spider/action/scan/?apikey=${this.zapApiKey}&url=${encodeURIComponent(targetUrl)}`)

      // Start active scan
      const scanRes = await fetch(
        `${this.zapBaseUrl}/JSON/ascan/action/scan/?apikey=${this.zapApiKey}&url=${encodeURIComponent(targetUrl)}&recurse=true`
      )
      const { scan: scanId } = (await scanRes.json()) as { scan: string }

      await this.waitForScan(scanId)

      return this.parseAlerts(targetUrl)
    } catch (err) {
      logger.error('Erro ao executar scan ZAP', err)
      return []
    }
  }

  private async waitForScan(scanId: string): Promise<void> {
    let progress = 0
    while (progress < 100) {
      await new Promise(r => setTimeout(r, 5000))
      const res = await fetch(
        `${this.zapBaseUrl}/JSON/ascan/view/status/?apikey=${this.zapApiKey}&scanId=${scanId}`
      )
      const data = (await res.json()) as { status: string }
      progress = parseInt(data.status, 10)
      logger.info(`ZAP scan progress: ${progress}%`)
    }
  }

  private async parseAlerts(targetUrl: string): Promise<SecurityFinding[]> {
    const res = await fetch(
      `${this.zapBaseUrl}/JSON/alert/view/alerts/?apikey=${this.zapApiKey}&baseurl=${encodeURIComponent(targetUrl)}`
    )
    const data = (await res.json()) as { alerts: any[] }

    return data.alerts.map(alert => ({
      type: this.mapRiskToType(alert.name),
      severity: this.mapRiskLevel(alert.risk),
      url: alert.url,
      parameter: alert.param,
      description: alert.description,
      recommendation: alert.solution,
    }))
  }

  private mapRiskToType(name: string): SecurityFinding['type'] {
    const n = name.toLowerCase()
    if (n.includes('sql')) return 'SQL_INJECTION'
    if (n.includes('xss') || n.includes('cross-site scripting')) return 'XSS'
    if (n.includes('csrf')) return 'CSRF'
    if (n.includes('ssrf')) return 'SSRF'
    if (n.includes('path traversal')) return 'PATH_TRAVERSAL'
    if (n.includes('access control')) return 'BROKEN_ACCESS'
    return 'BROKEN_ACCESS'
  }

  private mapRiskLevel(risk: string): SecurityFinding['severity'] {
    const map: Record<string, SecurityFinding['severity']> = {
      High: 'ALTA',
      Medium: 'MÉDIA',
      Low: 'BAIXA',
      Informational: 'BAIXA',
    }
    return map[risk] ?? 'MÉDIA'
  }
}
