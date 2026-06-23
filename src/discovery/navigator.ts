/**
 * Navigator — Fase C: login real + navegação pelos menus.
 *
 * Usa o SystemProfile aprendido (seletores de login descobertos pela IA) para
 * ENTRAR de verdade no sistema e então mapear os módulos navegáveis do
 * dashboard. Opcionalmente entra em módulos específicos pedidos por nome
 * (ex.: "grimório", "fichas"), captura o que há em cada um e salva no perfil.
 *
 * Usuário vem do .env (APP_USERNAME); a senha é perguntada ao usuário no chat
 * em tempo de execução (resolvePassword) — nunca hardcoded nem em arquivo.
 *
 * Uso:
 *   ts-node src/discovery/navigator.ts <url> [alvo1] [alvo2] ... [--headed]
 *   ex.: ts-node src/discovery/navigator.ts https://rpgbuilder.vercel.app/login grimorio fichas
 */

import 'dotenv/config'
import { chromium } from '@playwright/test'
import type { Browser, Frame, Page } from '@playwright/test'
import path from 'path'
import { profileStore, idFromUrl, type ModuleProfile } from './systemProfile'
import { gotoSmart } from '../tools/playwright/frameUtils'
import { resolvePassword } from '../utils/prompt'
import { evidencesDir, resolveCode } from '../knowledge/layout'

export interface NavItem {
  text: string
  href: string
  tag: string
}

export interface VisitedModule {
  requested: string
  matchedText: string
  url: string
  screenshotPath: string
  itemsOnPage: NavItem[]
  found: boolean
}

export interface NavigationResult {
  loggedIn: boolean
  dashboardUrl: string
  dashboardScreenshot: string
  menu: NavItem[]
  visited: VisitedModule[]
}

/** Pasta de screenshots SEMPRE por sistema: systems/<CODE>/evidences/navigation/ */
const shotDirFor = (url: string) => evidencesDir(resolveCode(url), 'navigation')

export async function loginAndNavigate(
  url: string,
  targets: string[] = [],
  opts: { headed?: boolean } = {}
): Promise<NavigationResult> {
  const shotDir = shotDirFor(url)
  const id = idFromUrl(url)
  const profile = profileStore.loadByUrl(url)
  const username = requiredEnv('APP_USERNAME')
  const password = await resolvePassword(username)

  // Seletores: do perfil aprendido, com fallback genérico.
  const userSel = profile?.login?.usernameSelectors?.length
    ? profile.login.usernameSelectors
    : ['input[type="email"]', 'input[name="email"]', 'input[name="username"]', '#email', '#username']
  const passSel = profile?.login?.passwordSelectors?.length
    ? profile.login.passwordSelectors
    : ['input[type="password"]', '#password']
  const submitSel = profile?.login?.submitSelectors?.length
    ? profile.login.submitSelectors
    : ['button[type="submit"]', 'button:has-text("Entrar")', 'button:has-text("Login")']

  let browser: Browser | null = null
  try {
    browser = await chromium.launch({ headless: !opts.headed })
    const context = await browser.newContext({ locale: 'pt-BR' })
    const page = await context.newPage()

    console.log(`\n[1/4] Abrindo ${url} e logando como ${username} ...`)
    await gotoSmart(page, url, { timeout: 45_000 })
    await page.waitForTimeout(2500)

    await fillFirst(page, userSel, username)
    await fillFirst(page, passSel, password)
    const clicked = await clickFirst(page, submitSel)
    if (!clicked) {
      // Sistemas Maker frequentemente não têm <button>: o submit é imagem/link.
      // Enter no campo de senha dispara o form de forma genérica.
      console.log('      (sem botão de submit clicável — enviando com Enter)')
      await pressEnter(page, passSel)
    }

    // Espera sair da tela de login (SPA muda a rota sem reload).
    const loggedIn = await waitLoggedIn(page, url)
    console.log(`      ${loggedIn ? '✓ login OK' : '✗ ainda na tela de login'} — URL: ${page.url()}`)

    const dashboardScreenshot = path.join(shotDir, `${id}-dashboard.png`)
    await page.screenshot({ path: dashboardScreenshot, fullPage: true }).catch(() => {})

    console.log('[2/4] Mapeando o menu/dashboard ...')
    await page.waitForTimeout(4000) // deixa o menu renderizar após o login
    await expandMenus(page)
    const menu = await collectNav(page)
    console.log(`      ${menu.length} itens navegáveis encontrados`)
    for (const m of menu.slice(0, 30)) console.log(`        • ${m.text}${m.href ? `  → ${m.href}` : ''}`)

    const visited: VisitedModule[] = []
    if (targets.length) {
      console.log(`[3/4] Entrando nos módulos pedidos: ${targets.join(', ')} ...`)
      for (const target of targets) {
        visited.push(await enterModule(page, url, id, target))
      }
    } else {
      console.log('[3/4] Nenhum módulo específico pedido — só o mapa do dashboard.')
    }

    console.log('[4/4] Salvando módulos no perfil aprendido ...')
    saveModules(url, menu, visited)

    return {
      loggedIn,
      dashboardUrl: page.url(),
      dashboardScreenshot,
      menu,
      visited,
    }
  } finally {
    await browser?.close().catch(() => {})
  }
}

async function fillFirst(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const frame of page.frames()) {
    for (const sel of selectors) {
      const loc = frame.locator(sel).first()
      if (await loc.isVisible({ timeout: 500 }).catch(() => false)) {
        await loc.fill(value).catch(() => {})
        return true
      }
    }
  }
  return false
}

async function clickFirst(page: Page, selectors: string[]): Promise<boolean> {
  for (const frame of page.frames()) {
    for (const sel of selectors) {
      const loc = frame.locator(sel).first()
      if (await loc.isVisible({ timeout: 500 }).catch(() => false)) {
        await loc.click().catch(() => {})
        return true
      }
    }
  }
  return false
}

async function pressEnter(page: Page, selectors: string[]): Promise<boolean> {
  for (const frame of page.frames()) {
    for (const sel of selectors) {
      const loc = frame.locator(sel).first()
      if (await loc.isVisible({ timeout: 500 }).catch(() => false)) {
        await loc.press('Enter').catch(() => {})
        return true
      }
    }
  }
  return false
}

async function waitLoggedIn(page: Page, loginUrl: string, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    // Sinal genérico e confiável (SPA e Maker): o campo de senha sumiu de
    // TODOS os frames => o form de login deu lugar à aplicação. Não dependemos
    // de mudança de URL, que não acontece em apps Maker (a URL fica igual).
    let passwordVisible = false
    for (const frame of page.frames()) {
      const seen = await frame
        .locator('input[type="password"]')
        .first()
        .isVisible({ timeout: 200 })
        .catch(() => false)
      if (seen) {
        passwordVisible = true
        break
      }
    }
    if (!passwordVisible) return true
    await page.waitForTimeout(500)
  }
  return false
}

/**
 * Expande grupos colapsados do menu (padrão comum: grupos que abrem ao clicar).
 * Genérico: tenta os toggles típicos do Maker e também cabeçalhos de grupo.
 */
async function expandMenus(page: Page): Promise<void> {
  const toggleSel =
    'a[href^="#Menu-submenu"], [onclick*="submenu" i], [aria-expanded="false"], ' +
    '[class*="has-submenu" i], [class*="menu-group" i] > a, [class*="dropdown-toggle" i]'
  for (const frame of page.frames()) {
    const toggles = await frame.locator(toggleSel).all().catch(() => [])
    for (const t of toggles) {
      if (await t.isVisible().catch(() => false)) {
        await t.click().catch(() => {})
        await page.waitForTimeout(150)
      }
    }
  }
  await page.waitForTimeout(800)
}

/** Coleta itens navegáveis visíveis (links, botões, itens de menu) em todos os frames. */
async function collectNav(page: Page): Promise<NavItem[]> {
  const items: NavItem[] = []
  const seen = new Set<string>()

  // Inclui padrões de menu do Maker (li/[role=menuitem]/.menu-item), não só a/button.
  const selector =
    'a:visible, button:visible, [role="menuitem"]:visible, [role="link"]:visible, ' +
    '[role="treeitem"]:visible, li[class*="menu"]:visible, [class*="menu-item"]:visible'

  for (const frame of page.frames()) {
    const handles = await frame.locator(selector).all().catch(() => [])
    for (const h of handles) {
      const text = ((await h.innerText().catch(() => '')) || '').trim().replace(/\s+/g, ' ')
      if (!text || text.length > 40) continue
      const href = (await h.getAttribute('href').catch(() => '')) ?? ''
      const tag = (await h.evaluate(el => el.tagName.toLowerCase()).catch(() => '')) ?? ''
      const key = `${text}|${href}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push({ text, href, tag })
    }
  }
  return items
}

/** Tenta entrar num módulo pelo nome (texto), captura a tela resultante. */
async function enterModule(page: Page, baseUrl: string, id: string, target: string): Promise<VisitedModule> {
  const want = norm(target)
  const shot = path.join(shotDirFor(baseUrl), `${id}-${slug(target)}.png`)

  const candidates = await page.locator('a:visible, button:visible, [role="menuitem"]:visible').all().catch(() => [])
  for (const c of candidates) {
    const text = ((await c.innerText().catch(() => '')) || '').trim()
    if (!text) continue
    const n = norm(text)
    if (n === want || n.includes(want) || want.includes(n)) {
      await c.click().catch(() => {})
      await page.waitForLoadState('domcontentloaded').catch(() => {})
      await page.waitForTimeout(2000)
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {})
      const itemsOnPage = await collectNav(page)
      console.log(`        ✓ "${target}" → "${text}" | URL: ${page.url()} | ${itemsOnPage.length} itens na tela`)
      return { requested: target, matchedText: text, url: page.url(), screenshotPath: shot, itemsOnPage, found: true }
    }
  }

  console.log(`        ✗ "${target}" não encontrado no menu atual`)
  return { requested: target, matchedText: '', url: page.url(), screenshotPath: '', itemsOnPage: [], found: false }
}

function saveModules(url: string, menu: NavItem[], visited: VisitedModule[]): void {
  const profile = profileStore.loadOrCreate(url)
  const now = new Date().toISOString()

  const byName = new Map<string, ModuleProfile>()
  for (const m of profile.modules) byName.set(norm(m.name), m)

  // Itens do menu viram módulos conhecidos.
  for (const item of menu) {
    if (!item.text) continue
    const key = norm(item.text)
    if (!byName.has(key)) {
      byName.set(key, {
        name: item.text,
        url: item.href || undefined,
        navSelectors: item.href ? [`a[href="${item.href}"]`] : [`text=${item.text}`],
        discoveredAt: now,
      })
    }
  }

  // Módulos visitados ganham a URL real.
  for (const v of visited) {
    if (!v.found) continue
    byName.set(norm(v.matchedText), {
      name: v.matchedText,
      url: v.url,
      navSelectors: [`text=${v.matchedText}`],
      discoveredAt: now,
    })
  }

  profile.modules = [...byName.values()]
  profile.learnedRuns += 1
  profileStore.save(profile)
  console.log(`      ✓ ${profile.modules.length} módulo(s) salvos no perfil ${profile.id}`)
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}
function slug(s: string): string {
  return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
function requiredEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`)
  return v
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const headed = args.includes('--headed')
  const positional = args.filter(a => a !== '--headed')
  const url = positional[0]
  const targets = positional.slice(1)
  if (!url) {
    console.error('Uso: ts-node src/discovery/navigator.ts <url> [alvo1 alvo2 ...] [--headed]')
    process.exit(1)
  }
  loginAndNavigate(url, targets, { headed })
    .then(r => {
      console.log(`\n=== Resumo ===`)
      console.log(`Login: ${r.loggedIn ? 'OK' : 'FALHOU'} | Dashboard: ${r.dashboardUrl}`)
      console.log(`Menu: ${r.menu.length} itens | Módulos visitados: ${r.visited.filter(v => v.found).length}/${r.visited.length}`)
      console.log(`Screenshot do dashboard: ${r.dashboardScreenshot}`)
    })
    .catch(err => {
      console.error('Falha na navegação:', err.message)
      process.exit(1)
    })
}
