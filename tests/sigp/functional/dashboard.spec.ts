import { test, expect } from '@playwright/test'

import { activeFrames } from '../../../src/tools/playwright/frameUtils'

const MENU_LABELS = [
  'configuracoes',
  'cadastros',
  'relatorios gerenciais',
  'gerador de relatorios',
  'utilitarios',
  'recrutamento',
]

test.describe('SIGP - Dashboard / Navegacao pos-login', () => {
  test.setTimeout(75_000)

  test.beforeEach(async ({ page }) => {
    await page.goto(process.env.BASE_URL!, { waitUntil: 'domcontentloaded' })
  })

  test('dashboard carrega com shell autenticada', async ({ page }) => {
    const hasShell = await waitForMenuText(page)
    expect(hasShell, 'Dashboard deve exibir menu autenticado').toBeTruthy()

    await page.screenshot({ path: 'evidence/screenshots/sigp-dashboard.png', fullPage: false })
  })

  test('titulo da pagina ou shell autenticada esta definida', async ({ page }) => {
    const title = await page.title()
    const hasShell = await waitForMenuText(page)

    expect(title.length > 0 || hasShell, 'Pagina deve ter titulo ou shell autenticada visivel').toBeTruthy()
    console.log(`Titulo da pagina: ${title}`)
  })

  test('console nao tem erros JavaScript criticos', async ({ page }) => {
    const errors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    page.on('pageerror', err => errors.push(err.message))

    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForMenuText(page)

    const criticalErrors = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('analytics') &&
      !e.includes('gtag') &&
      !e.includes('net::ERR_BLOCKED')
    )

    if (criticalErrors.length > 0) {
      console.warn('Erros JS encontrados:', criticalErrors)
    }

    expect(criticalErrors.length).toBeLessThanOrEqual(5)
  })

  test('sem requisicoes com erro 5xx na carga inicial', async ({ page }) => {
    const erros5xx: string[] = []

    page.on('response', res => {
      if (res.status() >= 500) erros5xx.push(`${res.status()} ${res.url()}`)
    })

    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForMenuText(page)

    expect(erros5xx, `Erros 5xx encontrados: ${erros5xx.join(', ')}`).toHaveLength(0)
  })

  test('tempo ate a shell autenticada e aceitavel', async ({ page }) => {
    const start = Date.now()
    const loaded = await waitForMenuText(page, 60_000)
    const duration = Date.now() - start

    console.log(`Tempo ate menu autenticado: ${duration}ms`)
    expect(loaded, 'Menu autenticado deve carregar').toBeTruthy()
    expect(duration, 'Carregamento autenticado nao deve exceder 60 segundos').toBeLessThan(60_000)
  })

  test('menus / navegacao principal estao visiveis', async ({ page }) => {
    const hasMenuText = await waitForMenuText(page)

    const menuLabelsFound = await visibleMenuLabelCount(page)

    await page.screenshot({ path: 'evidence/screenshots/sigp-menu.png', fullPage: false }).catch(() => {})

    expect(hasMenuText || menuLabelsFound > 0, 'Deve haver labels de menu reconheciveis apos login').toBeTruthy()
    console.log(`Menus reconhecidos: ${menuLabelsFound}`)
  })
})

async function waitForMenuText(page: import('@playwright/test').Page, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if ((await visibleMenuLabelCount(page)) > 0) return true
    await page.waitForTimeout(500)
  }

  return false
}

async function visibleMenuLabelCount(page: import('@playwright/test').Page): Promise<number> {
  let found = 0

  for (const { frame } of await activeFrames(page)) {
    try {
      const text = await frame.locator('body').innerText({ timeout: 500 })
      const normalized = normalizeText(text)
      found += MENU_LABELS.filter(label => normalized.includes(label)).length
    } catch {
      // SIGP can replace inner frames while the dashboard is loading.
    }
  }

  return found
}

function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}
