/**
 * Maker Inspector — Parte 1: descoberta de menus e submenus em sistemas Maker.
 *
 * Sistemas Softwell Maker / Webrun (open.do?sys=XXX — SIGP, CLE, etc.) montam
 * tudo em IFRAMES ANINHADOS: menu num frame, form em outro, abas em outro.
 * Um navegador comum só lê a página de cima — por isso "não enxerga" o menu.
 *
 * Esta camada:
 *   1. Loga de forma frame-aware (o login do Maker vive num iframe openform.do)
 *   2. Varre TODOS os frames (page.frames() já traz os aninhados, em qualquer nível)
 *   3. Caça itens de menu pelo padrão Maker: onclick/href com openForm/formID
 *   4. Extrai o formID de cada tela (identificador único do form no Maker)
 *
 * Saída: árvore de frames + lista de menus/submenus com seus formIDs, salva em
 * evidence/maker/<id>-menu.json, mais screenshot.
 *
 * Uso: ts-node src/discovery/maker/makerInspector.ts <url> [--headed]
 */

import 'dotenv/config'
import { chromium } from '@playwright/test'
import type { Browser, Frame, Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { findInFrames, waitForAnyFrameSelector } from '../../tools/playwright/frameUtils'
import { profileStore, idFromUrl } from '../systemProfile'

const OUT_DIR = path.join('evidence', 'maker')

/** Padrões de "abrir formulário" típicos do Maker/Webrun. */
const MENU_SELECTORS = [
  '[onclick*="openForm" i]',
  '[onclick*="openform" i]',
  '[onclick*="formID" i]',
  '[onclick*="abrirForm" i]',
  '[onclick*="carregaForm" i]',
  '[onclick*="loadForm" i]',
  'a[href*="openform.do" i]',
  'a[href*="formID" i]',
  // árvore/menu genérico como rede de segurança
  '[class*="menu" i] a',
  '[class*="tree" i] a',
  '[id*="menu" i] a',
]

export interface MakerMenuItem {
  label: string
  formId: string | null
  trigger: string // onclick ou href que abre a tela
  frameUrl: string
  depth: number // profundidade do frame (0 = topo)
}

export interface FrameNode {
  index: number
  depth: number
  url: string
  inputs: number
  menuCandidates: number
}

export interface MakerInspection {
  url: string
  loggedIn: boolean
  frameTree: FrameNode[]
  menus: MakerMenuItem[]
  screenshotPath: string
}

export async function inspectMaker(url: string, opts: { headed?: boolean } = {}): Promise<MakerInspection> {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const id = idFromUrl(url)
  const profile = profileStore.loadByUrl(url)

  const userSel = profile?.login?.usernameSelectors ?? [
    'input[name*="WFRInput" i]', 'input[type="text"]', 'input[name*="user" i]', 'input[name*="login" i]',
  ]
  const passSel = profile?.login?.passwordSelectors ?? ['input[type="password"]']
  const submitSel = profile?.login?.submitSelectors ?? [
    'button:has-text("Entrar")', 'input[type="submit"]', 'button[type="submit"]', 'a:has-text("Entrar")',
  ]

  let browser: Browser | null = null
  try {
    browser = await chromium.launch({ headless: !opts.headed })
    const page = await (await browser.newContext({ locale: 'pt-BR' })).newPage()

    console.log(`\n[1/4] Abrindo ${url} ...`)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => null)
    await waitForAnyFrameSelector(page, [...userSel, ...passSel], 45_000)

    console.log('[2/4] Logando (frame-aware) ...')
    const loggedIn = await loginFrameAware(page, url, userSel, passSel, submitSel)
    console.log(`      ${loggedIn ? '✓ logado' : '✗ login não confirmado'} — URL: ${page.url()}`)

    // Maker carrega os frames de menu/conteúdo após o login — dá um tempo.
    await page.waitForTimeout(6000)

    const screenshotPath = path.join(OUT_DIR, `${id}-app.png`)
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {})

    console.log('[3/4] Varrendo TODOS os frames aninhados ...')
    const frameTree = await mapFrameTree(page)
    console.log(`      ${frameTree.length} frame(s) no total:`)
    for (const f of frameTree) {
      console.log(`        ${'  '.repeat(f.depth)}[${f.index}] d${f.depth} inputs:${f.inputs} menus:${f.menuCandidates} — ${shortUrl(f.url)}`)
    }

    console.log('[4/4] Extraindo menus/submenus (padrão Maker) ...')
    const menus = await collectMakerMenus(page)
    console.log(`      ${menus.length} item(ns) de menu encontrados`)
    for (const m of menus.slice(0, 40)) {
      console.log(`        • ${m.label}${m.formId ? `  [formID=${m.formId}]` : ''}`)
    }

    const report: MakerInspection = { url, loggedIn, frameTree, menus, screenshotPath }
    const reportPath = path.join(OUT_DIR, `${id}-menu.json`)
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8')
    console.log(`\n✓ Relatório salvo: ${reportPath}`)
    console.log(`✓ Screenshot: ${screenshotPath}`)

    return report
  } finally {
    await browser?.close().catch(() => {})
  }
}

async function loginFrameAware(
  page: Page,
  url: string,
  userSel: string[],
  passSel: string[],
  submitSel: string[]
): Promise<boolean> {
  const user = process.env.APP_USERNAME
  const pass = process.env.APP_PASSWORD
  if (!user || !pass) throw new Error('APP_USERNAME / APP_PASSWORD ausentes no .env')

  const userCtx = await findInFrames(page, userSel)
  if (!userCtx) return false
  await userCtx.locator.fill(user)

  const passCtx = await findInFrames(page, passSel, userCtx.frame)
  if (passCtx) await passCtx.locator.fill(pass)

  const submitCtx = await findInFrames(page, submitSel, userCtx.frame)
  if (submitCtx) await submitCtx.locator.click().catch(() => {})
  else if (passCtx) await passCtx.locator.press('Enter').catch(() => {})

  // Maker: sucesso = sai do form de login / aparece menu. Heurística simples por tempo + ausência de senha.
  await page.waitForTimeout(4000)
  const stillLogin = await findInFrames(page, passSel, undefined, 400)
  return !stillLogin
}

/** Mapeia a árvore de frames (todos os níveis), com contagens úteis. */
async function mapFrameTree(page: Page): Promise<FrameNode[]> {
  const frames = page.frames()
  const nodes: FrameNode[] = []

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    const furl = frame.url()
    if (!furl || furl === 'about:blank') continue

    const inputs = await frame.locator('input').count().catch(() => 0)
    let menuCandidates = 0
    for (const sel of MENU_SELECTORS) {
      menuCandidates += await frame.locator(sel).count().catch(() => 0)
    }
    nodes.push({ index: i, depth: frameDepth(frame), url: furl, inputs, menuCandidates })
  }
  return nodes
}

/** Coleta itens de menu/submenu em todos os frames, pelo padrão Maker. */
async function collectMakerMenus(page: Page): Promise<MakerMenuItem[]> {
  const items: MakerMenuItem[] = []
  const seen = new Set<string>()

  for (const frame of page.frames()) {
    const furl = frame.url()
    if (!furl || furl === 'about:blank') continue
    const depth = frameDepth(frame)

    for (const sel of MENU_SELECTORS) {
      const handles = await frame.locator(sel).all().catch(() => [])
      for (const h of handles) {
        const visible = await h.isVisible().catch(() => false)
        if (!visible) continue
        const label = ((await h.innerText().catch(() => '')) || '').trim().replace(/\s+/g, ' ')
        if (!label || label.length > 60) continue
        const onclick = (await h.getAttribute('onclick').catch(() => '')) ?? ''
        const href = (await h.getAttribute('href').catch(() => '')) ?? ''
        const trigger = onclick || href
        const formId = extractFormId(trigger)
        const key = `${label}|${formId ?? trigger}`
        if (seen.has(key)) continue
        seen.add(key)
        items.push({ label, formId, trigger: trigger.slice(0, 120), frameUrl: furl, depth })
      }
    }
  }
  return items
}

function extractFormId(s: string): string | null {
  const m = s.match(/formID['"=:\s]*?(\d{3,})/i)
  return m ? m[1] : null
}

function frameDepth(frame: Frame): number {
  let d = 0
  let f: Frame | null = frame.parentFrame()
  while (f) {
    d++
    f = f.parentFrame()
  }
  return d
}

function shortUrl(u: string): string {
  return u.length > 80 ? u.slice(0, 77) + '...' : u
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const headed = args.includes('--headed')
  const url = args.filter(a => a !== '--headed')[0]
  if (!url) {
    console.error('Uso: ts-node src/discovery/maker/makerInspector.ts <url> [--headed]')
    process.exit(1)
  }
  inspectMaker(url, { headed }).catch(err => {
    console.error('Falha na inspeção Maker:', err.message)
    process.exit(1)
  })
}
