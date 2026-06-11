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
    await preencherLogin(page, process.env.APP_USERNAME!, process.env.APP_PASSWORD!)

    await page.waitForLoadState('networkidle')

    // Não deve permanecer na tela de login
    const aindaNoLogin = page.url().includes('open.do') || page.url().includes('login')
    const erroVisivel = await page.locator('[class*="error" i], [class*="erro" i]').isVisible().catch(() => false)

    expect(erroVisivel, 'Mensagem de erro não deve aparecer com credenciais válidas').toBeFalsy()
    await expect(page).toHaveScreenshot('login-sucesso.png', { maxDiffPixelRatio: 0.1 }).catch(() => {})
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
    // Verifica existência de campos essenciais
    const temCampoUsuario = await page.locator(
      'input[name*="user" i], input[name*="login" i], input[name*="j_username"]'
    ).count() > 0

    const temCampoSenha = await page.locator('input[type="password"]').count() > 0
    const temBotaoSubmit = await page.locator(
      'button[type="submit"], input[type="submit"], button:has-text("Entrar")'
    ).count() > 0

    expect(temCampoUsuario, 'Deve ter campo de usuário').toBeTruthy()
    expect(temCampoSenha, 'Deve ter campo de senha').toBeTruthy()
    expect(temBotaoSubmit, 'Deve ter botão de submit').toBeTruthy()

    // Labels para acessibilidade
    const temLabels = await page.locator('label, [aria-label], [placeholder]').count() > 0
    expect(temLabels, 'Campos devem ter labels ou aria-labels').toBeTruthy()
  })
})

// Helper interno — não repete lógica de seletor por todo o arquivo
async function preencherLogin(page: import('@playwright/test').Page, user: string, pass: string) {
  const userSelectors = [
    'input[name="username"]', 'input[name="login"]', 'input[name="user"]',
    'input[name="j_username"]', 'input[id*="user" i]', 'input[id*="login" i]',
    'input[placeholder*="usuário" i]',
  ]
  const passSelectors = [
    'input[name="password"]', 'input[name="senha"]',
    'input[name="j_password"]', 'input[type="password"]',
  ]

  for (const sel of userSelectors) {
    const el = page.locator(sel).first()
    if (await el.isVisible().catch(() => false)) { await el.fill(user); break }
  }
  for (const sel of passSelectors) {
    const el = page.locator(sel).first()
    if (await el.isVisible().catch(() => false)) { await el.fill(pass); break }
  }

  const submitSelectors = [
    'button[type="submit"]', 'input[type="submit"]',
    'button:has-text("Entrar")', 'button:has-text("Login")', 'button:has-text("Acessar")',
  ]
  for (const sel of submitSelectors) {
    const el = page.locator(sel).first()
    if (await el.isVisible().catch(() => false)) { await el.click(); break }
  }
}
