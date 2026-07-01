/**
 * tabExplorer — o agente APRENDE uma tela Maker abrindo ABA POR ABA.
 *
 * Telas Maker são organizadas em abas (Cadastro, Localizar, e outras). Este
 * módulo abre a tela, percorre cada aba, estuda o conteúdo (campos, botões,
 * se tem grade) e grava o conhecimento em disco — sem IA, determinístico.
 *
 * Conhecimento salvo (confidencial, local):
 *   systems/<CODE>/screens/<tela>/tabs.json        (mapa estruturado das abas)
 *   systems/<CODE>/screens/<tela>/screenshots/aba-<n>-<nome>.png
 *
 * Uso: ts-node src/discovery/tabExplorer.ts <url> "<Tela>" [--headed]
 */

import 'dotenv/config'
import { chromium } from '@playwright/test'
import type { Browser, Frame, Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { profileStore } from './systemProfile'
import { resolveCode, screenDir, screenshotsDir } from '../knowledge/layout'
import { selectorsFromProfile, loginToSystem, openScreen, findTabs, goToTab, norm } from './makerSession'
import { record as recordScreen } from '../memory/screenKnowledge'

interface TabStudy {
  index: number
  name: string
  fields: { tag: string; type: string; label: string; name: string }[]
  buttons: string[]
  hasGrid: boolean
  gridRows: number
  screenshot: string
}

/** Acha o frame que de fato tem conteúdo (mais inputs; senão, mais linhas). */
function pickContentFrame(page: Page): Frame {
  let best: { frame: Frame; score: number } | null = null
  for (const frame of page.frames()) {
    if (!frame.url() || frame.url() === 'about:blank') continue
    // contagem síncrona não dá; usamos heurística por url depois. Aqui só coleta.
    best = best ?? { frame, score: 0 }
  }
  return best?.frame ?? page.mainFrame()
}

/** Estuda a aba ATUAL: campos visíveis, botões e se tem grade. */
async function studyCurrentTab(page: Page): Promise<Omit<TabStudy, 'index' | 'name' | 'screenshot'>> {
  // escolhe o frame com mais inputs OU mais linhas de tabela
  let chosen: Frame | null = null
  let bestScore = -1
  for (const frame of page.frames()) {
    if (!frame.url() || frame.url() === 'about:blank') continue
    const inputs = await frame.locator('input, select, textarea').count().catch(() => 0)
    const rows = await frame.locator('table tr, [role="row"]').count().catch(() => 0)
    const score = inputs * 2 + rows
    if (score > bestScore) { bestScore = score; chosen = frame }
  }
  const frame = chosen ?? pickContentFrame(page)

  const fields: TabStudy['fields'] = []
  const inputs = await frame.locator('input, select, textarea').all().catch(() => [])
  for (const h of inputs) {
    if (!(await h.isVisible().catch(() => false))) continue
    const type = ((await h.getAttribute('type').catch(() => '')) ?? '').toLowerCase()
    if (type === 'hidden') continue
    fields.push({
      tag: (await h.evaluate(el => el.tagName.toLowerCase()).catch(() => 'input')) ?? 'input',
      type: type || 'text',
      label: ((await h.getAttribute('title').catch(() => '')) || (await h.getAttribute('placeholder').catch(() => '')) || (await h.getAttribute('aria-label').catch(() => '')) || '').trim(),
      name: (await h.getAttribute('name').catch(() => '')) ?? '',
    })
  }

  const buttons: string[] = []
  const btns = await frame.locator('button, input[type="submit"], input[type="button"], [role="button"], a[onclick], a[href="#!"]').all().catch(() => [])
  for (const b of btns) {
    if (!(await b.isVisible().catch(() => false))) continue
    const t = ((await b.innerText().catch(() => '')) || (await b.getAttribute('title').catch(() => '')) || (await b.getAttribute('value').catch(() => '')) || '').trim().replace(/\s+/g, ' ')
    if (t && t.length < 40 && !buttons.includes(t)) buttons.push(t)
  }

  const gridRows = await frame.locator('table tbody tr, [role="row"]').count().catch(() => 0)
  const hasGrid = gridRows > 0

  return { fields, buttons, hasGrid, gridRows }
}

export async function exploreTabs(
  url: string,
  screenName: string,
  opts: { headed?: boolean } = {}
): Promise<TabStudy[]> {
  const code = resolveCode(url)
  const profile = profileStore.loadByUrl(url)
  const sel = selectorsFromProfile(profile)
  const shotDir = screenshotsDir(code, screenName)

  let browser: Browser | null = null
  const studies: TabStudy[] = []
  try {
    browser = await chromium.launch({ headless: !opts.headed })
    const page = await browser.newPage()

    console.log(`[1/4] Logando ...`)
    const logged = await loginToSystem(page, url, sel)
    console.log(logged ? '      ✓ logado' : '      ⚠️ login não confirmado (segue mesmo assim)')

    console.log(`[2/4] Abrindo a tela "${screenName}" ...`)
    await openScreen(page, screenName).catch(() => false)
    await page.waitForTimeout(2500)

    console.log(`[3/4] Descobrindo as abas ...`)
    const tabs = await findTabs(page)
    console.log(`      ${tabs.length} aba(s): ${tabs.map(t => t.name).join(' | ') || '(nenhuma)'}`)

    // Se não achou abas, estuda a tela como uma "aba única".
    const toVisit = tabs.length ? tabs.map(t => t.name) : ['(tela)']

    console.log(`[4/4] Estudando aba por aba ...`)
    let idx = 0
    for (const name of toVisit) {
      idx++
      if (tabs.length) {
        const clicked = await goToTab(page, name).catch(() => false)
        await page.waitForTimeout(1200)
        if (!clicked) console.log(`      • "${name}": não consegui clicar (pulada)`)
      }
      const study = await studyCurrentTab(page)
      const shotName = `aba-${idx}-${norm(name).replace(/[^a-z0-9]+/g, '-').slice(0, 24) || 'tela'}.png`
      const shotPath = path.join(shotDir, shotName)
      await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {})
      const full: TabStudy = { index: idx, name, ...study, screenshot: shotPath }
      studies.push(full)
      console.log(`      • "${name}": ${study.fields.length} campo(s), ${study.buttons.length} botão(ões), grade=${study.hasGrid ? `sim(${study.gridRows} linhas)` : 'não'}`)
    }

    // grava o conhecimento (artefato detalhado da ferramenta)
    const outFile = path.join(screenDir(code, screenName), 'tabs.json')
    fs.writeFileSync(outFile, JSON.stringify({
      code, screen: screenName, url, learnedAt: new Date().toISOString(), tabs: studies,
    }, null, 2), 'utf8')
    console.log(`\n✓ Conhecimento salvo em ${outFile}`)

    // write-after: alimenta a memória de tela COMPARTILHADA, pra que outras
    // ferramentas (register/crud/validate) reusem as abas e campos sem me consultar.
    const richest = studies.reduce<TabStudy | null>(
      (best, t) => (!best || t.fields.length > best.fields.length ? t : best), null)
    recordScreen(
      code, screenName,
      {
        at: new Date().toISOString(), tool: 'tabs', ok: studies.length > 0,
        summary: `aprendeu ${studies.length} aba(s): ${studies.map(t => t.name).join(' | ')}`,
      },
      {
        url,
        tabs: studies.map(t => ({ name: t.name, hasGrid: t.hasGrid, fieldCount: t.fields.length })),
        formFields: (richest?.fields ?? []).map(f => ({ label: f.label, type: f.type, name: f.name })),
      }
    )
  } finally {
    await browser?.close().catch(() => {})
  }
  return studies
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const headed = args.includes('--headed')
  const pos = args.filter(a => !a.startsWith('--'))
  const url = pos[0]
  const screenName = pos.slice(1).join(' ')
  if (!url || !screenName) {
    console.error('Uso: ts-node src/discovery/tabExplorer.ts <url> "<Tela>" [--headed]')
    process.exit(1)
  }
  exploreTabs(url, screenName, { headed })
    .then(s => {
      console.log(`\n=== Resumo ===`)
      console.log(`${s.length} aba(s) estudada(s).`)
      for (const t of s) console.log(`  [${t.index}] ${t.name} — ${t.fields.length} campos, grade=${t.hasGrid ? 'sim' : 'não'}`)
    })
    .catch(err => { console.error('Falha:', err.message); process.exit(1) })
}
