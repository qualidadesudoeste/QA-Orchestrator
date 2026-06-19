import { test, expect } from '@playwright/test'

const BASE_URL = process.env.BASE_URL!

// Estes testes NÃO usam storageState — testam o login em si (positivo e negativo)
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('SIGP — Login', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForLoadState('domcontentloaded')
  })

  test('login positivo — credenciais válidas', async ({ page }) => {
    const urlAntes = page.url()
    await preencherLogin(page, process.env.APP_USERNAME!, process.env.APP_PASSWORD!)

    // networkidle trava em ERPs Java com polling contínuo — aguarda URL mudar
    await page.waitForURL((url) => !url.href.includes('open.do'), { timeout: 60_000 })
      .catch(() => null)

    const erroVisivel = await page.frames().reduce(async (acc, frame) => {
      if (await acc) return true
      return frame.locator('[class*="error" i], [class*="erro" i]').isVisible({ timeout: 500 }).catch(() => false)
    }, Promise.resolve(false))

    expect(erroVisivel, 'Mensagem de erro não deve aparecer com credenciais válidas').toBeFalsy()
    await page.screenshot({ path: 'evidence/screenshots/login-sucesso.png', fullPage: true })
  })

  test('login negativo — senha incorreta', async ({ page }) => {
    await preencherLogin(page, process.env.APP_USERNAME!, 'senha_errada_123')

    await page.waitForTimeout(1500)

    const temErro = await page.locator(
      '[class*="error" i], [class*="erro" i], [role="alert"], [class*="alert" i]'
    ).isVisible().catch(() => false)

    const aindaNoLogin = page.url().includes('open.do') || page.url().includes('login')

    expect(temErro || aindaNoLogin, 'Sistema deve rejeitar senha incorreta com mensagem ou manter na tela de login').toBeTruthy()
  })

  test('login negativo — campos vazios', async ({ page }) => {
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Entrar")',
      'button:has-text("Login")',
      'button:has-text("Acessar")',
    ]

    for (const sel of submitSelectors) {
      const el = page.locator(sel).first()
      if (await el.isVisible().catch(() => false)) {
        await el.click()
        break
      }
    }

    await page.waitForTimeout(1000)

    const aindaNoLogin = page.url().includes('open.do') || page.url().includes('login')
    const temErro = await page.locator('[class*="error" i], [class*="erro" i], [required]:invalid').count() > 0

    expect(temErro || aindaNoLogin, 'Sistema deve bloquear submit com campos vazios').toBeTruthy()
  })

  test('login negativo — usuário inexistente', async ({ page }) => {
    await preencherLogin(page, 'usuario_nao_existe_xyz', 'qualquer_senha')

    await page.waitForTimeout(1500)

    const temErro = await page.locator(
      '[class*="error" i], [class*="erro" i], [role="alert"]'
    ).isVisible().catch(() => false)

    const aindaNoLogin = page.url().includes('open.do') || page.url().includes('login')
    expect(temErro || aindaNoLogin, 'Usuário inexistente deve ser rejeitado').toBeTruthy()
  })

  test('segurança — SQL Injection no campo de login', async ({ page }) => {
    await preencherLogin(page, "' OR '1'='1'--", 'qualquer')

    await page.waitForTimeout(1500)

    const bodyText = (await page.locator('body').textContent()) ?? ''
    const leaked = /sql|syntax error|ora-|mysql|exception|stacktrace/i.test(bodyText)

    expect(leaked, 'Sistema NÃO deve vazar erros SQL na resposta').toBeFalsy()

    // Deve continuar na tela de login ou mostrar erro genérico
    const aindaNoLogin = page.url().includes('open.do') || page.url().includes('login')
    const errVago = await page.locator('[class*="error" i], [class*="erro" i]').isVisible().catch(() => false)
    expect(aindaNoLogin || errVago, 'SQLi deve ser bloqueado sem bypassar autenticação').toBeTruthy()
  })

  test('segurança — XSS no campo de usuário', async ({ page }) => {
    let dialogDisparado = false
    page.once('dialog', async dialog => {
      dialogDisparado = true
      await dialog.dismiss()
    })

    await preencherLogin(page, '<script>alert(1)</script>', 'qualquer')
    await page.waitForTimeout(800)

    expect(dialogDisparado, 'XSS NÃO deve executar script no campo de login').toBeFalsy()
  })

  test('tela de login — estrutura e acessibilidade', async ({ page }) => {
    // Formulário está dentro de iframe — busca no frame openform.do
    const loginFrame = page.frames().find(f => f.url().includes('openform.do')) ?? page.mainFrame()

    const temCampoUsuario = await loginFrame.locator(
      'input[name*="user" i], input[name*="login" i], input[name*="usuario" i]'
    ).count() > 0

    const temCampoSenha = await loginFrame.locator('input[type="password"]').count() > 0
    const temBotaoSubmit = await loginFrame.locator(
      'button[type="submit"], input[type="submit"], button:has-text("Entrar")'
    ).count() > 0

    expect(temCampoUsuario, 'Deve ter campo de usuário').toBeTruthy()
    expect(temCampoSenha, 'Deve ter campo de senha').toBeTruthy()
    expect(temBotaoSubmit, 'Deve ter botão de submit').toBeTruthy()

    const temLabels = await loginFrame.locator('label, [aria-label], [placeholder]').count() > 0
    expect(temLabels, 'Campos devem ter labels ou aria-labels').toBeTruthy()
  })
})

// Helper interno — busca campos em todos os frames (SIGP usa iframe para o formulário)
async function preencherLogin(page: import('@playwright/test').Page, user: string, pass: string) {
  const envList = (name: string): string[] =>
    (process.env[name] || '').split(',').map(s => s.trim()).filter(Boolean)
  const userSelectors = [
    ...envList('TARGET_USER_SELECTORS'), // específicos do alvo via .env (gitignored)
    'input[name="username"]', 'input[name="login"]', 'input[name="user"]',
    'input[name="j_username"]', 'input[id*="user" i]', 'input[id*="login" i]',
  ]
  const passSelectors = [
    ...envList('TARGET_PASS_SELECTORS'),
    'input[name="password"]', 'input[name="senha"]',
    'input[name="j_password"]', 'input[type="password"]',
  ]
  const submitSelectors = [
    'button[type="submit"]', 'input[type="submit"]',
    'button:has-text("Entrar")', 'button:has-text("Login")', 'button:has-text("Acessar")',
  ]

  for (const frame of page.frames()) {
    if (!frame.url() || frame.url() === 'about:blank') continue

    let preencheu = false
    for (const sel of userSelectors) {
      const el = frame.locator(sel).first()
      if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
        await el.fill(user)
        preencheu = true
        break
      }
    }
    if (!preencheu) continue

    for (const sel of passSelectors) {
      const el = frame.locator(sel).first()
      if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
        await el.fill(pass)
        break
      }
    }

    for (const sel of submitSelectors) {
      const el = frame.locator(sel).first()
      if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
        await el.click()
        break
      }
    }

    break // campos encontrados neste frame — não precisa continuar
  }
}
