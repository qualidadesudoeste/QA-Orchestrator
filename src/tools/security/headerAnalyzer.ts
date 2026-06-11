import { logger } from '@utils/logger'

export interface HeaderFinding {
  header: string
  status: 'PRESENT' | 'MISSING' | 'WEAK' | 'INSECURE'
  severity: 'CRÍTICA' | 'ALTA' | 'MÉDIA' | 'BAIXA' | 'INFO'
  currentValue?: string
  recommendation: string
}

export interface HeaderReport {
  url: string
  score: number          // 0-100
  findings: HeaderFinding[]
  exposedTech: string[]  // server, x-powered-by revealing stack
}

const REQUIRED_HEADERS: Array<{
  name: string
  severity: HeaderFinding['severity']
  validate: (value: string | null) => { ok: boolean; issue?: string }
  recommendation: string
}> = [
  {
    name: 'strict-transport-security',
    severity: 'ALTA',
    validate: v => {
      if (!v) return { ok: false }
      const maxAge = parseInt(v.match(/max-age=(\d+)/)?.[1] ?? '0')
      if (maxAge < 31536000) return { ok: false, issue: `max-age insuficiente (${maxAge}s, mínimo: 31536000)` }
      return { ok: true }
    },
    recommendation: 'Adicionar: Strict-Transport-Security: max-age=31536000; includeSubDomains; preload',
  },
  {
    name: 'content-security-policy',
    severity: 'ALTA',
    validate: v => {
      if (!v) return { ok: false }
      if (v.includes("'unsafe-inline'") || v.includes("'unsafe-eval'"))
        return { ok: false, issue: "Contém 'unsafe-inline' ou 'unsafe-eval'" }
      return { ok: true }
    },
    recommendation: "Definir CSP restritiva. Remover 'unsafe-inline' e 'unsafe-eval'",
  },
  {
    name: 'x-frame-options',
    severity: 'MÉDIA',
    validate: v => {
      if (!v) return { ok: false }
      if (!['DENY', 'SAMEORIGIN'].includes(v.toUpperCase()))
        return { ok: false, issue: `Valor inválido: ${v}` }
      return { ok: true }
    },
    recommendation: 'Adicionar: X-Frame-Options: DENY ou SAMEORIGIN',
  },
  {
    name: 'x-content-type-options',
    severity: 'MÉDIA',
    validate: v => ({ ok: v?.toLowerCase() === 'nosniff', issue: v ? `Valor: ${v}` : undefined }),
    recommendation: 'Adicionar: X-Content-Type-Options: nosniff',
  },
  {
    name: 'referrer-policy',
    severity: 'BAIXA',
    validate: v => {
      const safe = ['no-referrer', 'strict-origin', 'strict-origin-when-cross-origin', 'no-referrer-when-downgrade']
      return { ok: !!v && safe.some(s => v.toLowerCase().includes(s)) }
    },
    recommendation: 'Adicionar: Referrer-Policy: strict-origin-when-cross-origin',
  },
  {
    name: 'permissions-policy',
    severity: 'BAIXA',
    validate: v => ({ ok: !!v }),
    recommendation: 'Adicionar: Permissions-Policy: camera=(), microphone=(), geolocation=()',
  },
]

const TECH_REVEAL_HEADERS = ['server', 'x-powered-by', 'x-aspnet-version', 'x-aspnetmvc-version', 'x-generator']

export class HeaderAnalyzer {
  async analyze(url: string): Promise<HeaderReport> {
    logger.info(`Analisando headers de segurança: ${url}`)

    let headers: Record<string, string> = {}
    try {
      const res = await fetch(url, { method: 'GET', redirect: 'follow' })
      res.headers.forEach((value, key) => { headers[key.toLowerCase()] = value })
    } catch (err) {
      logger.error(`Erro ao buscar headers de ${url}`, err)
      return { url, score: 0, findings: [], exposedTech: [] }
    }

    const findings: HeaderFinding[] = []
    let deductions = 0

    for (const rule of REQUIRED_HEADERS) {
      const value = headers[rule.name] ?? null
      const { ok, issue } = rule.validate(value)

      if (!ok) {
        const status: HeaderFinding['status'] = !value ? 'MISSING' : 'WEAK'
        findings.push({
          header: rule.name,
          status,
          severity: rule.severity,
          currentValue: value ?? undefined,
          recommendation: issue ? `${rule.recommendation} (${issue})` : rule.recommendation,
        })
        const pts = { CRÍTICA: 25, ALTA: 20, MÉDIA: 10, BAIXA: 5, INFO: 0 }
        deductions += pts[rule.severity] ?? 0
      } else {
        findings.push({
          header: rule.name,
          status: 'PRESENT',
          severity: 'INFO',
          currentValue: value ?? undefined,
          recommendation: 'OK',
        })
      }
    }

    // Check for tech-revealing headers
    const exposedTech: string[] = []
    for (const h of TECH_REVEAL_HEADERS) {
      if (headers[h]) {
        exposedTech.push(`${h}: ${headers[h]}`)
        findings.push({
          header: h,
          status: 'INSECURE',
          severity: 'BAIXA',
          currentValue: headers[h],
          recommendation: `Remover header ${h} — expõe informações da stack tecnológica`,
        })
        deductions += 5
      }
    }

    const score = Math.max(0, 100 - deductions)
    logger.info(`Headers — score: ${score}/100 | ${findings.filter(f => f.status !== 'PRESENT').length} problema(s)`)

    return { url, score, findings, exposedTech }
  }
}
