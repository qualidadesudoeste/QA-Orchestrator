import { test as setup, expect } from '@playwright/test'
import path from 'path'

const AUTH_FILE = path.join('playwright', '.auth', 'sigp.json')

// Executa uma vez antes de todos os testes do SIGP.
// Faz login e salva a sessão — os outros testes reutilizam sem precisar logar de novo.
setup('autenticar no SIGP', async ({ page }) => {
  const url = process.env.BASE_URL!
  const username = process.env.APP_USERNAME!
  const password = process.env.APP_PASSWORD!

  await page.goto(url)
  await page.waitForLoadState('domcontentloaded')

  // Estratégia flexível: tenta os seletores mais comuns de sistemas Java/ERP
  const userSelectors = [
    'input[name="username"]',
    'input[name="login"]',
    'input[name="user"]',
    'input[name="j_username"]',
    'input[id*="user" i]',
    'input[id*="login" i]',
    'input[placeholder*="usuário" i]',
    'input[placeholder*="login" i]',
  ]

  const passSelectors = [
    'input[name="password"]',
    'input[name="senha"]',
    'input[name="j_password"]',
    'input[type="password"]',
  ]

  // Preenche usuário
  let filled = false
  for (const sel of userSelectors) {
    const el = page.locator(sel).first()
    if (await el.isVisible().catch(() => false)) {
      await el.fill(username)
      filled = true
      break
    }
  }
  if (!filled) throw new Error('Campo de usuário não encontrado na tela de login do SIGP')

  // Preenche senha
  for (const sel of passSelectors) {
    const el = page.locator(sel).first()
    if (await el.isVisible().catch(() => false)) {
      await el.fill(password)
      break
    }
  }

  // Submete
  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Entrar")',
    'button:has-text("Login")',
    'button:has-text("Acessar")',
    'a:has-text("Entrar")',
  ]

  for (const sel of submitSelectors) {
    const el = page.locator(sel).first()
    if (await el.isVisible().catch(() => false)) {
      await el.click()
      break
    }
  }

  // Aguarda navegação pós-login
  await page.waitForLoadState('networkidle')

  // Verifica se login funcionou (URL mudou ou elemento de menu apareceu)
  const loginFailed = await page.locator(
    '[class*="error"], [class*="erro"], [id*="error"], [id*="erro"]'
  ).isVisible().catch(() => false)

  if (loginFailed) {
    const errText = await page.locator('[class*="error"], [class*="erro"]').first().textContent().catch(() => '')
    throw new Error(`Login falhou: ${errText}`)
  }

  await expect(page).not.toHaveURL(/login|open\.do/)

  // Salva sessão para reuso
  await page.context().storageState({ path: AUTH_FILE })
  console.log(`✓ Sessão SIGP salva em: ${AUTH_FILE}`)
})
