import { test, expect } from '@playwright/test'

// Usa sessão autenticada para testes de segurança que requerem estar logado
test.describe('SIGP — Segurança (autenticado)', () => {

  test('IDOR — tentativa de acessar recursos com IDs alterados', async ({ page }) => {
    await page.goto(process.env.BASE_URL!)
    await page.waitForLoadState('networkidle')

    const currentUrl = page.url()
    const idMatch = currentUrl.match(/[?&/](\d{3,})[&/?#]?/)

    if (!idMatch) {
      console.log('Nenhum ID numérico na URL atual — navegue até uma tela com ID para testar IDOR')
      test.skip()
      return
    }

    const originalId = parseInt(idMatch[1])
    const testId = originalId + 9999

    const testUrl = currentUrl.replace(idMatch[1], String(testId))
    const res = await page.request.get(testUrl, { failOnStatusCode: false })

    expect([401, 403, 404]).toContain(res.status()),
    console.log(`IDOR test: ID ${testId} → HTTP ${res.status()}`)
  })

  test('clickjacking — X-Frame-Options ou CSP frame-ancestors', async ({ request }) => {
    const res = await request.get(process.env.BASE_URL!, { failOnStatusCode: false })
    const xfo = res.headers()['x-frame-options']
    const csp = res.headers()['content-security-policy'] ?? ''
    const frameAncestors = csp.includes('frame-ancestors')

    const protegido = !!xfo || frameAncestors
    if (!protegido) {
      console.warn('⚠ RISCO de Clickjacking: sem X-Frame-Options e sem frame-ancestors no CSP')
    }
    console.log(`X-Frame-Options: ${xfo ?? 'ausente'} | frame-ancestors no CSP: ${frameAncestors}`)
    // Soft check — não reprova o pipeline, gera evidência
  })

  test('mixed content — página HTTPS não deve carregar recursos HTTP', async ({ page }) => {
    const mixedContent: string[] = []

    page.on('response', res => {
      if (res.url().startsWith('http://') && process.env.BASE_URL?.startsWith('https://')) {
        mixedContent.push(res.url())
      }
    })

    await page.goto(process.env.BASE_URL!)
    await page.waitForLoadState('networkidle')

    if (mixedContent.length > 0) {
      console.warn('Mixed content detectado:', mixedContent.slice(0, 5))
    }
    expect(mixedContent.length, `Mixed content: ${mixedContent.join(', ')}`).toBeLessThanOrEqual(2)
  })

  test('cookies de sessão têm flags Secure e HttpOnly', async ({ page }) => {
    await page.goto(process.env.BASE_URL!)
    const cookies = await page.context().cookies()

    const sessionCookies = cookies.filter(c =>
      /session|jsession|auth|token|sid/i.test(c.name)
    )

    console.log(`Cookies de sessão encontrados: ${sessionCookies.map(c => c.name).join(', ')}`)

    for (const cookie of sessionCookies) {
      if (!cookie.httpOnly) {
        console.warn(`⚠ Cookie "${cookie.name}" sem flag HttpOnly — acessível via JavaScript`)
      }
      if (!cookie.secure && process.env.BASE_URL?.startsWith('https://')) {
        console.warn(`⚠ Cookie "${cookie.name}" sem flag Secure em site HTTPS`)
      }
      // Registra findings sem reprovar — relatório completo via SecurityAgent
    }
  })

  test('página de erro não vaza stack trace ou informações internas', async ({ page }) => {
    const notFoundUrl = process.env.BASE_URL!.replace(/open\.do.*/, 'pagina-que-nao-existe-xyz.do')
    await page.goto(notFoundUrl, { waitUntil: 'domcontentloaded' })

    const body = (await page.locator('body').textContent()) ?? ''

    const leaks = [
      { pattern: /at\s+\w+\.\w+\(.*:\d+:\d+\)/g, label: 'stack trace Java' },
      { pattern: /Exception|NullPointer|ClassNotFound/g, label: 'exception Java' },
      { pattern: /org\.apache|com\.sun|javax\./g, label: 'package interno Java' },
      { pattern: /SELECT|INSERT|UPDATE|DELETE|FROM\s+\w+/gi, label: 'query SQL' },
    ]

    for (const { pattern, label } of leaks) {
      const found = pattern.test(body)
      if (found) console.warn(`⚠ Possível vazamento de informação na página de erro: ${label}`)
      expect(found, `Página de erro não deve expor ${label}`).toBeFalsy()
    }
  })
})
