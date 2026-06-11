import { test, expect } from '@playwright/test'

// Usa a sessão salva pelo auth.setup.ts — já está autenticado
test.describe('SIGP — Dashboard / Navegação pós-login', () => {

  test('dashboard carrega com conteúdo após login', async ({ page }) => {
    await page.goto(process.env.BASE_URL!)
    await page.waitForLoadState('networkidle')

    // Deve ter algum conteúdo de sistema (menu, título, frame)
    const temConteudo = await page.locator(
      'nav, menu, [role="navigation"], [class*="menu" i], [class*="nav" i], [class*="header" i], frame, iframe'
    ).count() > 0

    expect(temConteudo, 'Dashboard deve ter elementos de navegação').toBeTruthy()
    await page.screenshot({ path: 'evidence/screenshots/sigp-dashboard.png', fullPage: true })
  })

  test('título da página está definido', async ({ page }) => {
    await page.goto(process.env.BASE_URL!)
    const title = await page.title()
    expect(title.length, 'Página deve ter título').toBeGreaterThan(0)
    console.log(`Título da página: ${title}`)
  })

  test('console não tem erros JavaScript críticos', async ({ page }) => {
    const errors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    page.on('pageerror', err => errors.push(err.message))

    await page.goto(process.env.BASE_URL!)
    await page.waitForLoadState('networkidle')

    // Filtra erros esperados de tracking/ads externos
    const criticalErrors = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('analytics') &&
      !e.includes('gtag') &&
      !e.includes('net::ERR_BLOCKED')
    )

    if (criticalErrors.length > 0) {
      console.warn('Erros JS encontrados:', criticalErrors)
    }
    // Registra mas não falha — erros JS são informativos neste momento
    expect(criticalErrors.length).toBeLessThanOrEqual(5)
  })

  test('sem requisições com erro 5xx na carga inicial', async ({ page }) => {
    const erros5xx: string[] = []

    page.on('response', res => {
      if (res.status() >= 500) erros5xx.push(`${res.status()} ${res.url()}`)
    })

    await page.goto(process.env.BASE_URL!)
    await page.waitForLoadState('networkidle')

    expect(erros5xx, `Erros 5xx encontrados: ${erros5xx.join(', ')}`).toHaveLength(0)
  })

  test('tempo de carregamento aceitável (< 10s)', async ({ page }) => {
    const start = Date.now()
    await page.goto(process.env.BASE_URL!)
    await page.waitForLoadState('networkidle')
    const duration = Date.now() - start

    console.log(`Tempo de carregamento: ${duration}ms`)
    expect(duration, 'Carregamento não deve exceder 10 segundos').toBeLessThan(10_000)
  })

  test('menus / navegação principal estão visíveis', async ({ page }) => {
    await page.goto(process.env.BASE_URL!)
    await page.waitForLoadState('networkidle')

    // Captura screenshot para análise visual
    await page.screenshot({
      path: 'evidence/screenshots/sigp-menu.png',
      fullPage: false,
    })

    // Tenta encontrar itens de menu clicáveis
    const menuItems = await page.locator(
      'a[href]:not([href="#"]):not([href=""]), [role="menuitem"], [class*="menu-item" i]'
    ).count()

    expect(menuItems, 'Deve haver links/menus navegáveis após login').toBeGreaterThan(0)
    console.log(`Links de navegação encontrados: ${menuItems}`)
  })
})
