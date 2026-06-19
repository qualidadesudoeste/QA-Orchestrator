import { test as setup, expect } from '@playwright/test'
import type { Frame, Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'

import { findInFrames, hasLoginFields, waitForAnyFrameSelector } from '../../../src/tools/playwright/frameUtils'

const AUTH_FILE = path.join('playwright', '.auth', 'sigp.json')

fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true })
fs.mkdirSync(path.join('evidence', 'screenshots'), { recursive: true })

// Seletores específicos do sistema-alvo NÃO ficam fixos no código (confidencial):
// vêm de variáveis de ambiente (CSV) — ex.: TARGET_USER_SELECTORS no .env (gitignored).
const envList = (name: string): string[] =>
  (process.env[name] || '').split(',').map(s => s.trim()).filter(Boolean)

const USER_SELECTORS = [
  ...envList('TARGET_USER_SELECTORS'),
  'input[name="username"]',
  'input[name="login"]',
  'input[name="user"]',
  'input[name="j_username"]',
  'input[name="strUsuario"]',
  'input[name="nm_usuario"]',
  'input[name="Usuario"]',
  'input[name="nm_login"]',
  'input[name="ds_login"]',
  'input[name="cd_usuario"]',
  'input[name="nr_cpf"]',
  'input[id*="user" i]',
  'input[id*="login" i]',
  'input[id*="usuario" i]',
  'input[id*="usu" i]',
  'input[name*="user" i]',
  'input[name*="login" i]',
  'input[name*="usuario" i]',
  'input[type="text"]:not([style*="display:none"]):not([style*="display: none"])',
]

const PASS_SELECTORS = [
  ...envList('TARGET_PASS_SELECTORS'),
  'input[type="password"]',
  'input[name="password"]',
  'input[name="senha"]',
  'input[name="j_password"]',
  'input[name="strSenha"]',
  'input[name="Senha"]',
]

const SUBMIT_SELECTORS = [
  'button:has-text("Entrar")',
  'input[type="submit"]',
  'button[type="submit"]',
  'button:has-text("Login")',
  'button:has-text("Acessar")',
  'button:has-text("OK")',
  'input[type="button"]',
  'a:has-text("Entrar")',
  'a:has-text("Login")',
  '[onclick*="login" i]',
  '[onclick*="entrar" i]',
  '[onclick*="logar" i]',
]

const AUTHENTICATED_SELECTORS = [
  'text=Configurações',
  'text=Cadastros',
  'text=Relatórios Gerenciais',
  'text=Gerador de Relatórios',
  'text=Utilitários',
  'text=Recrutamento',
  '[class*="menu" i]',
  '[class*="sidebar" i]',
  '[role="navigation"]',
  'nav',
]

const ERROR_SELECTORS = [
  '[class*="error" i]',
  '[class*="erro" i]',
  '[id*="msgErro" i]',
  '[id*="error" i]',
  '[role="alert"]',
  '.alert-danger',
  'text=senha inválida',
  'text=usuário inválido',
  'text=login inválido',
]

setup('autenticar no SIGP', async ({ page }) => {
  setup.setTimeout(300_000)

  const url = requiredEnv('BASE_URL')
  const username = requiredEnv('APP_USERNAME')
  const password = requiredEnv('APP_PASSWORD')

  console.log(`\nNavegando para: ${url}`)
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await waitForAnyFrameSelector(page, USER_SELECTORS, 45_000)
  await printFrameTree(page)

  await page.screenshot({ path: 'evidence/screenshots/sigp-login-before.png', fullPage: true })

  const userCtx = await findInFrames(page, USER_SELECTORS)
  if (!userCtx) {
    throw new Error('Campo de usuario nao encontrado em nenhum frame. Verifique evidence/screenshots/sigp-login-before.png')
  }

  console.log(`Campo usuario: frame="${userCtx.frameUrl}" selector="${userCtx.selector}"`)
  await userCtx.locator.fill(username)

  const passCtx = await findInFrames(page, PASS_SELECTORS, userCtx.frame)
  if (!passCtx) {
    throw new Error(`Campo de senha nao encontrado no fluxo de login. Frame do usuario: ${userCtx.frameUrl}`)
  }

  console.log(`Campo senha: selector="${passCtx.selector}"`)
  await passCtx.locator.fill(password)

  const submitCtx = await findInFrames(page, SUBMIT_SELECTORS, userCtx.frame)
  console.log(`URL antes do submit: ${page.url()}`)

  if (submitCtx) {
    console.log(`Botao submit: selector="${submitCtx.selector}"`)
    await submitCtx.locator.click()
  } else {
    console.log('Botao nao encontrado; pressionando Enter no campo de senha')
    await passCtx.locator.press('Enter')
  }

  const dashboard = await waitForAuthenticatedShell(page)
  expect(dashboard, 'Login deve exibir menu/dashboard autenticado').toBeTruthy()

  const cookies = await page.context().cookies([url])
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ cookies, origins: [] }, null, 2))
  console.log(`\nSessao SIGP salva em: ${AUTH_FILE}`)

  await page.screenshot({ path: 'evidence/screenshots/sigp-login-after.png', fullPage: false }).catch(() => {})
})

async function waitForAuthenticatedShell(page: Page): Promise<boolean> {
  const startedAt = Date.now()
  const timeoutMs = 90_000

  while (Date.now() - startedAt < timeoutMs) {
    const menu = await findInFrames(page, AUTHENTICATED_SELECTORS, undefined, 300)
    const textMenu = await hasAuthenticatedText(page)
    const stillLogin = await hasLoginFields(page)
    if (menu && !stillLogin) {
      console.log(`Dashboard detectado: frame="${menu.frameUrl}" selector="${menu.selector}"`)
      return true
    }
    if (textMenu && !stillLogin) {
      console.log('Dashboard detectado por texto visivel normalizado')
      return true
    }
    await page.waitForTimeout(500)
  }

  console.log(`URL apos login: ${page.url()}`)
  return false
}

async function hasAuthenticatedText(page: Page): Promise<boolean> {
  const expected = [
    'configuracoes',
    'cadastros',
    'relatorios gerenciais',
    'gerador de relatorios',
    'utilitarios',
    'recrutamento',
  ]

  for (const frame of page.frames()) {
    try {
      const text = await frame.locator('body').innerText({ timeout: 300 })
      const normalized = normalizeText(text)
      if (expected.some(item => normalized.includes(item))) return true
    } catch {
      // Ignore frames that are being replaced while SIGP loads.
    }
  }

  return false
}

function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

async function printFrameTree(page: Page): Promise<void> {
  const frames = page.frames()
  console.log(`\n=== ${frames.length} frame(s) carregado(s) ===`)

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    try {
      const inputCount = await frame.locator('input').count()
      const buttonCount = await frame.locator('button, input[type="submit"], input[type="button"]').count()

      console.log(`  [${i}] ${frame.url()}`)
      console.log(`       inputs: ${inputCount} | buttons: ${buttonCount}`)

      for (let j = 0; j < inputCount; j++) {
        const input = frame.locator('input').nth(j)
        const name = await input.getAttribute('name').catch(() => '')
        const type = await input.getAttribute('type').catch(() => '')
        const id = await input.getAttribute('id').catch(() => '')
        const visible = await input.isVisible().catch(() => false)
        console.log(`         input[${j}]: name="${name}" type="${type}" id="${id}" visible=${visible}`)
      }
    } catch {
      console.log(`  [${i}] ${frame.url()} (nao acessivel)`)
    }
  }

  console.log('==========================================\n')
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`)
  return value
}
