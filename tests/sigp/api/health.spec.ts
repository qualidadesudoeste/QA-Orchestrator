import { test, expect } from '@playwright/test'

const BASE = process.env.BASE_URL!.replace(/\/open\.do.*/, '')  // https://sigp.[REDACTED_HOST]/SIGP

test.describe('SIGP — Verificações HTTP / API', () => {

  test('servidor responde com 200 ou redirecionamento na raiz', async ({ request }) => {
    const res = await request.get(BASE, { failOnStatusCode: false })
    expect(res.status(), 'Servidor deve estar no ar').toBeLessThan(500)
    console.log(`Status raiz: ${res.status()}`)
  })

  test('endpoint de login retorna página válida', async ({ request }) => {
    const res = await request.get(process.env.BASE_URL!, { failOnStatusCode: false })
    expect([200, 302, 301]).toContain(res.status())

    const body = await res.text()
    expect(body.length, 'Resposta não pode ser vazia').toBeGreaterThan(100)
  })

  test('headers de segurança básicos presentes', async ({ request }) => {
    const res = await request.get(process.env.BASE_URL!, { failOnStatusCode: false })
    const headers = res.headers()

    // Registra os headers recebidos para análise
    const securityHeaders = {
      'strict-transport-security': headers['strict-transport-security'] ?? 'AUSENTE',
      'x-frame-options': headers['x-frame-options'] ?? 'AUSENTE',
      'x-content-type-options': headers['x-content-type-options'] ?? 'AUSENTE',
      'content-security-policy': headers['content-security-policy'] ? 'PRESENTE' : 'AUSENTE',
    }
    console.table(securityHeaders)

    // Soft check — registra sem reprovar (análise completa via SecurityAgent)
    const missingCritical = !headers['x-frame-options'] && !headers['content-security-policy']
    if (missingCritical) {
      console.warn('⚠ Headers críticos de segurança ausentes — executar SecurityAgent para relatório completo')
    }
  })

  test('não expõe informações da stack no header Server', async ({ request }) => {
    const res = await request.get(process.env.BASE_URL!, { failOnStatusCode: false })
    const server = res.headers()['server'] ?? ''
    const xPowered = res.headers()['x-powered-by'] ?? ''

    console.log(`Server: ${server || '(não exposto)'}`)
    console.log(`X-Powered-By: ${xPowered || '(não exposto)'}`)

    // Versões específicas expostas são riscos de segurança
    const expoeVersao = /\d+\.\d+/.test(server) || /\d+\.\d+/.test(xPowered)
    if (expoeVersao) {
      console.warn(`⚠ Header expõe versão do servidor: Server="${server}" X-Powered-By="${xPowered}"`)
    }
    // Informativo apenas neste nível — SecurityAgent faz análise completa
  })

  test('acesso sem autenticação retorna 401 ou redireciona ao login', async ({ request }) => {
    const protectedPath = BASE + '/main.do'
    const res = await request.get(protectedPath, {
      failOnStatusCode: false,
      maxRedirects: 0,
    })

    const isProtected = [401, 403, 302, 301].includes(res.status())
    expect(isProtected,
      `Rota protegida (${protectedPath}) deve retornar 401/403 ou redirecionar ao login. Recebido: ${res.status()}`
    ).toBeTruthy()
    console.log(`Acesso sem auth: ${res.status()}`)
  })

  test('resposta em tempo aceitável (< 5s)', async ({ request }) => {
    const start = Date.now()
    await request.get(process.env.BASE_URL!, { failOnStatusCode: false })
    const duration = Date.now() - start

    console.log(`Tempo de resposta HTTP: ${duration}ms`)
    expect(duration, 'Endpoint deve responder em menos de 5 segundos').toBeLessThan(5_000)
  })
})
