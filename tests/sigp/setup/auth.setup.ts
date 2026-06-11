import { test as setup } from '@playwright/test'
import type { Frame, Locator, Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const AUTH_FILE = path.join('playwright', '.auth', 'sigp.json')

// Garante que a pasta existe
fs.mkdirSync(path.join('playwright', '.auth'), { recursive: true })
fs.mkdirSync(path.join('evidence', 'screenshots'), { recursive: true })

const USER_SELECTORS = [
  'input[name="username"]',
  'input[name="login"]',
  'input[name="user"]',
  'input[name="j_username"]',
  'input[name="strUsuario"]',
  'input[name="nm_usuario"]',
  'input[name="Usuario"]',
  'input[id*="user" i]',
  'input[id*="login" i]',
  'input[id*="usuario" i]',
  'input[type="text"]:not([style*="display:none"]):not([style*="display: none"])',
]

const PASS_SELECTORS = [
  'input[type="password"]',
  'input[name="password"]',
  'input[name="senha"]',
  'input[name="j_password"]',
  'input[name="strSenha"]',
  'input[name="Senha"]',
]

const SUBMIT_SELECTORS = [
  'input[type="submit"]',
  'button[type="submit"]',
  'button:has-text("Entrar")',
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

setup('autenticar no SIGP', async ({ page }) => {
  const url = process.env.BASE_URL!
  const username = process.env.APP_USERNAME!
  const password = process.env.APP_PASSWORD!

  console.log(`\nNavegando para: ${url}`)
  await page.goto(url)
  await page.waitForLoadState('networkidle')

  // Aguarda iframes carregarem (sistemas no-code costumam ter carregamento assíncrono)
  await page.waitForTimeout(2000)

  // Screenshot e diagnóstico antes de qualquer ação
  await page.screenshot({ path: 'evidence/screenshots/sigp-login-before.png', fullPage: true })
  await printFrameTree(page)

  // Busca campo de usuário em todos os frames
  const userCtx = await findInAllFrames(page, USER_SELECTORS)

  if (!userCtx) {
    await page.screenshot({ path: 'evidence/screenshots/sigp-login-not-found.png', fullPage: true })
    throw new Error(
      'Campo de usuário não encontrado em nenhum frame.\n' +
      'Verifique: evidence/screenshots/sigp-login-before.png\n' +
      'Frames inspecionados foram logados acima.'
    )
  }

  console.log(`✓ Campo usuário: frame="${userCtx.frameUrl}" selector="${userCtx.selector}"`)
  await userCtx.locator.fill(username)

  // Busca senha — prefere o mesmo frame do usuário
  const passCtx = await findInAllFrames(page, PASS_SELECTORS, userCtx.frame)
  if (passCtx) {
    console.log(`✓ Campo senha: selector="${passCtx.selector}"`)
    await passCtx.locator.fill(password)
  } else {
    console.warn('⚠ Campo de senha não encontrado — tentando submeter mesmo assim')
  }

  // Busca botão de submit — prefere o mesmo frame
  const submitCtx = await findInAllFrames(page, SUBMIT_SELECTORS, userCtx.frame)
  if (submitCtx) {
    console.log(`✓ Botão submit: selector="${submitCtx.selector}"`)
    await submitCtx.locator.click()
  } else {
    console.log('Botão não encontrado — pressionando Enter no campo usuário')
    await userCtx.locator.press('Enter')
  }

  // Aguarda resposta do servidor
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)

  await page.screenshot({ path: 'evidence/screenshots/sigp-login-after.png', fullPage: true })

  // Verifica se houve mensagem de erro de login em qualquer frame
  const errorCtx = await findInAllFrames(page, [
    '[class*="error" i]',
    '[class*="erro" i]',
    '[id*="msgErro" i]',
    '[id*="error" i]',
    '[role="alert"]',
    '.alert-danger',
  ])

  if (errorCtx) {
    const txt = (await errorCtx.locator.textContent().catch(() => '')).trim()
    if (txt) throw new Error(`Login falhou — mensagem do sistema: "${txt}"`)
  }

  // Salva estado da sessão (cookies + localStorage)
  await page.context().storageState({ path: AUTH_FILE })
  console.log(`\n✓ Sessão SIGP salva em: ${AUTH_FILE}`)
  console.log('  Execute agora: npx playwright test --project=sigp-functional')
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface FrameMatch {
  locator: Locator
  frame: Frame
  frameUrl: string
  selector: string
}

async function findInAllFrames(
  page: Page,
  selectors: string[],
  preferredFrame?: Frame
): Promise<FrameMatch | null> {
  const allFrames = page.frames()

  // Ordena: frame preferido primeiro, depois os demais
  const ordered = preferredFrame
    ? [preferredFrame, ...allFrames.filter(f => f !== preferredFrame)]
    : allFrames

  for (const frame of ordered) {
    const frameUrl = frame.url()
    if (!frameUrl || frameUrl === 'about:blank') continue

    for (const sel of selectors) {
      try {
        const locator = frame.locator(sel).first()
        const visible = await locator.isVisible({ timeout: 800 }).catch(() => false)
        if (visible) {
          return { locator, frame, frameUrl, selector: sel }
        }
      } catch {
        // Frame pode ter sido destruído ou não está acessível — ignora
      }
    }
  }

  return null
}

async function printFrameTree(page: Page): Promise<void> {
  const frames = page.frames()
  console.log(`\n=== ${frames.length} frame(s) carregado(s) ===`)
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    try {
      const inputCount = await frame.locator('input').count()
      const btnCount = await frame.locator('button, input[type="submit"], input[type="button"]').count()
      console.log(`  [${i}] ${frame.url()}`)
      console.log(`       inputs: ${inputCount} | buttons: ${btnCount}`)

      // Lista os inputs visíveis para debug
      if (inputCount > 0 && inputCount <= 10) {
        const inputs = frame.locator('input')
        for (let j = 0; j < inputCount; j++) {
          const el = inputs.nth(j)
          const name = await el.getAttribute('name').catch(() => '')
          const type = await el.getAttribute('type').catch(() => '')
          const id = await el.getAttribute('id').catch(() => '')
          console.log(`         input[${j}]: name="${name}" type="${type}" id="${id}"`)
        }
      }
    } catch {
      console.log(`  [${i}] ${frame.url()} (não acessível)`)
    }
  }
  console.log('==========================================\n')
}
