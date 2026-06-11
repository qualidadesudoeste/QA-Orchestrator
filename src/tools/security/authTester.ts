import type { Page, APIRequestContext } from '@playwright/test'
import { logger } from '@utils/logger'
import { maskObject } from '@utils/dataMasking'

export interface AuthFinding {
  test: string
  severity: 'CRÍTICA' | 'ALTA' | 'MÉDIA' | 'BAIXA'
  passed: boolean   // true = seguro, false = vulnerável
  detail: string
  endpoint?: string
}

export class AuthTester {
  constructor(private page: Page, private request: APIRequestContext) {}

  async runAll(baseUrl: string, endpoints: string[] = []): Promise<AuthFinding[]> {
    logger.info('Iniciando testes de autenticação e autorização')
    const findings: AuthFinding[] = []

    findings.push(...await this.testUnauthenticatedAccess(baseUrl, endpoints))
    findings.push(...await this.testExpiredToken(baseUrl, endpoints))
    findings.push(...await this.testIDOR(baseUrl))
    findings.push(...await this.testJWTWeaknesses(baseUrl, endpoints))
    findings.push(...await this.testCSRF(baseUrl))
    findings.push(...await this.testPrivilegeEscalation(baseUrl, endpoints))

    const vulns = findings.filter(f => !f.passed)
    logger.info(`Auth — ${findings.length} teste(s) | ${vulns.length} vulnerabilidade(s) encontrada(s)`)

    return findings
  }

  // Test 1 — Endpoints must return 401/403 without auth
  private async testUnauthenticatedAccess(baseUrl: string, endpoints: string[]): Promise<AuthFinding[]> {
    const findings: AuthFinding[] = []
    const targets = endpoints.length > 0 ? endpoints : [baseUrl]

    for (const endpoint of targets.slice(0, 5)) {
      try {
        const res = await this.request.get(endpoint, {
          headers: { Authorization: '' },
          failOnStatusCode: false,
        })
        const protected_ = [401, 403].includes(res.status())
        findings.push({
          test: 'Acesso sem autenticação',
          severity: 'CRÍTICA',
          passed: protected_,
          detail: protected_
            ? `Endpoint protegido (HTTP ${res.status()})`
            : `VULNERABILIDADE: endpoint acessível sem auth (HTTP ${res.status()})`,
          endpoint,
        })
      } catch (err) {
        findings.push({ test: 'Acesso sem autenticação', severity: 'CRÍTICA', passed: false, detail: String(err), endpoint })
      }
    }
    return findings
  }

  // Test 2 — Expired/malformed tokens must be rejected
  private async testExpiredToken(baseUrl: string, endpoints: string[]): Promise<AuthFinding[]> {
    const fakeTokens = [
      'Bearer eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxMjM0NTY3ODkwIn0.',  // alg: none
      'Bearer invalid.token.here',
      'Bearer ' + 'A'.repeat(256),
    ]

    const findings: AuthFinding[] = []
    const target = endpoints[0] ?? baseUrl

    for (const token of fakeTokens) {
      try {
        const res = await this.request.get(target, {
          headers: { Authorization: token },
          failOnStatusCode: false,
        })
        const rejected = [401, 403].includes(res.status())
        findings.push({
          test: `Token inválido rejeitado: ${token.slice(7, 30)}...`,
          severity: 'CRÍTICA',
          passed: rejected,
          detail: rejected
            ? `Token inválido rejeitado (HTTP ${res.status()})`
            : `VULNERABILIDADE: token inválido aceito (HTTP ${res.status()}) — possível alg:none ou validação ausente`,
          endpoint: target,
        })
      } catch (err) {
        findings.push({ test: 'Token inválido', severity: 'CRÍTICA', passed: false, detail: String(err), endpoint: target })
      }
    }
    return findings
  }

  // Test 3 — IDOR: incrementing numeric IDs in URL
  private async testIDOR(baseUrl: string): Promise<AuthFinding[]> {
    const findings: AuthFinding[] = []

    // Look for numeric IDs in current page URL
    const currentUrl = this.page.url()
    const idMatch = currentUrl.match(/\/(\d+)(\/|$|\?)/)
    if (!idMatch) {
      findings.push({
        test: 'IDOR — ID numérico na URL',
        severity: 'ALTA',
        passed: true,
        detail: 'Nenhum ID numérico encontrado na URL atual para testar IDOR',
      })
      return findings
    }

    const originalId = parseInt(idMatch[1])
    const testIds = [originalId - 1, originalId + 1, 0, 99999]

    for (const testId of testIds) {
      const testUrl = currentUrl.replace(`/${originalId}`, `/${testId}`)
      try {
        const res = await this.request.get(testUrl, { failOnStatusCode: false })
        const isProtected = [401, 403, 404].includes(res.status())

        if (res.status() === 200 && testId !== originalId) {
          findings.push({
            test: `IDOR — ID ${testId}`,
            severity: 'CRÍTICA',
            passed: false,
            detail: `VULNERABILIDADE IDOR: acesso ao recurso ID=${testId} retornou 200 sem autorização`,
            endpoint: testUrl,
          })
        } else {
          findings.push({
            test: `IDOR — ID ${testId}`,
            severity: 'ALTA',
            passed: true,
            detail: `ID ${testId} retornou HTTP ${res.status()} (esperado 403/404)`,
            endpoint: testUrl,
          })
        }
      } catch (err) {
        findings.push({ test: `IDOR ID ${testId}`, severity: 'ALTA', passed: false, detail: String(err), endpoint: testUrl })
      }
    }
    return findings
  }

  // Test 4 — JWT specific: alg:none, weak secrets signals
  private async testJWTWeaknesses(baseUrl: string, endpoints: string[]): Promise<AuthFinding[]> {
    const findings: AuthFinding[] = []
    const target = endpoints[0] ?? baseUrl

    // alg:none payload: {"sub":"admin","role":"admin"}
    const noneAlgToken = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiJ9.'

    try {
      const res = await this.request.get(target, {
        headers: { Authorization: `Bearer ${noneAlgToken}` },
        failOnStatusCode: false,
      })
      const rejected = [401, 403].includes(res.status())
      findings.push({
        test: 'JWT alg:none',
        severity: 'CRÍTICA',
        passed: rejected,
        detail: rejected
          ? 'JWT alg:none rejeitado corretamente'
          : 'VULNERABILIDADE CRÍTICA: JWT com alg:none aceito — autenticação bypassável',
        endpoint: target,
      })
    } catch (err) {
      findings.push({ test: 'JWT alg:none', severity: 'CRÍTICA', passed: false, detail: String(err), endpoint: target })
    }

    return findings
  }

  // Test 5 — CSRF: check for CSRF token in forms and SameSite cookie attribute
  private async testCSRF(baseUrl: string): Promise<AuthFinding[]> {
    const findings: AuthFinding[] = []

    // Check SameSite cookie attribute
    const cookies = await this.page.context().cookies()
    const sessionCookies = cookies.filter(c =>
      /session|auth|token|sid|jwt/i.test(c.name)
    )

    for (const cookie of sessionCookies) {
      const sameSiteOk = cookie.sameSite === 'Strict' || cookie.sameSite === 'Lax'
      findings.push({
        test: `CSRF — Cookie SameSite: ${cookie.name}`,
        severity: 'ALTA',
        passed: sameSiteOk,
        detail: sameSiteOk
          ? `Cookie ${cookie.name} tem SameSite=${cookie.sameSite}`
          : `RISCO CSRF: cookie ${cookie.name} sem atributo SameSite adequado (atual: ${cookie.sameSite ?? 'none'})`,
      })

      const secureOk = cookie.secure === true
      findings.push({
        test: `CSRF/Secure — Cookie Secure: ${cookie.name}`,
        severity: 'MÉDIA',
        passed: secureOk,
        detail: secureOk
          ? `Cookie ${cookie.name} tem flag Secure`
          : `Cookie ${cookie.name} sem flag Secure — transmitido em HTTP`,
      })
    }

    // Check for CSRF token in forms
    const forms = await this.page.locator('form').count()
    if (forms > 0) {
      const hasCsrfField = await this.page.locator(
        'input[name*="csrf"], input[name*="token"], input[name*="_token"], meta[name="csrf-token"]'
      ).count() > 0

      findings.push({
        test: 'CSRF — Token em formulários',
        severity: 'ALTA',
        passed: hasCsrfField,
        detail: hasCsrfField
          ? 'Campo CSRF token encontrado nos formulários'
          : 'ATENÇÃO: formulários sem campo CSRF token visível — verificar proteção no backend',
      })
    }

    return findings
  }

  // Test 6 — Privilege escalation: try accessing admin paths as regular user
  private async testPrivilegeEscalation(baseUrl: string, endpoints: string[]): Promise<AuthFinding[]> {
    const findings: AuthFinding[] = []
    const adminPaths = ['/admin', '/api/admin', '/manager', '/superuser', '/backoffice', '/dashboard/admin']

    for (const path of adminPaths) {
      const url = baseUrl.replace(/\/$/, '') + path
      try {
        const res = await this.request.get(url, { failOnStatusCode: false })
        const blocked = [401, 403, 404].includes(res.status())
        findings.push({
          test: `Escalonamento de privilégio: ${path}`,
          severity: 'CRÍTICA',
          passed: blocked,
          detail: blocked
            ? `Rota admin bloqueada (HTTP ${res.status()})`
            : `RISCO: rota ${path} retornou HTTP ${res.status()} — verificar controle de acesso`,
          endpoint: url,
        })
      } catch {
        // network error = path doesn't exist, which is fine
        findings.push({
          test: `Escalonamento: ${path}`,
          severity: 'CRÍTICA',
          passed: true,
          detail: 'Rota não acessível (erro de rede)',
          endpoint: url,
        })
      }
    }
    return findings
  }
}
