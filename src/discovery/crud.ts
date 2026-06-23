/**
 * crud — Read / Update / Delete autônomos (o Create fica em register.ts).
 *
 * SEGURANÇA: editar e excluir só agem em linhas da grade que contêm o TOKEN do
 * agente (registros que ele mesmo criou). Nunca toca em dados reais.
 *
 * Uso:
 *   ts-node src/discovery/crud.ts <op> <url> "<Tela>" [--headed] [--token "texto"]
 *     op = search | edit | delete | full
 *   - search: abre a tela, busca o token na Localizar e conta os resultados
 *   - edit:   acha a linha do token, abre, altera e salva
 *   - delete: acha a linha do token, exclui e confirma a baixa
 *   - full:   cria um registro único e roda read→update→delete nele (ciclo CRUD)
 */

import 'dotenv/config'
import { chromium } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { profileStore } from './systemProfile'
import { resolveCode, executionDir, screenshotsDir } from '../knowledge/layout'
import {
  selectorsFromProfile, loginToSystem, openScreen, pickFormFrame, fillForm,
  clickSave, detectSuccess, searchInGrid, countRowsWithToken, clickRowAction, confirmDialog,
  clickInclude, ensureOnGrid, ensureLoggedIn, reopenAndCount,
} from './makerSession'
import { attachConsoleCapture } from '../tools/playwright/capture'
import type { ConsoleCapture } from '../tools/playwright/capture'

type Op = 'search' | 'edit' | 'delete' | 'full'

export interface CrudResult {
  op: Op
  loggedIn: boolean
  opened: boolean
  matched: number
  acted: boolean
  confirmed: boolean
  token: string
  evidence: string[]
}

export async function runCrud(
  op: Op,
  url: string,
  screenName: string,
  opts: { headed?: boolean; token?: string; all?: boolean } = {}
): Promise<CrudResult> {
  const code = resolveCode(url)
  const shotDir = screenshotsDir(code, screenName)
  const profile = profileStore.loadByUrl(url)
  const sel = selectorsFromProfile(profile)
  const token = opts.token || 'QA Teste'
  const evidence: string[] = []

  const shot = async (name: string, page: Page) => {
    const p = path.join(shotDir, name)
    await page.screenshot({ path: p, fullPage: true }).catch(() => {})
    evidence.push(p)
  }

  let browser: Browser | null = null
  let consoleCap: ConsoleCapture | null = null
  try {
    browser = await chromium.launch({ headless: !opts.headed, slowMo: opts.headed ? 400 : 0 })
    const page = await (await browser.newContext({ locale: 'pt-BR' })).newPage()
    consoleCap = attachConsoleCapture(page) // passivo: coleta erros JS como evidência

    console.log(`\n[crud:${op}] Logando em ${url} ...`)
    const loggedIn = await loginToSystem(page, url, sel)
    console.log(`      ${loggedIn ? '✓ logado' : '✗ login não confirmado'}`)
    if (!loggedIn) { await shot('crud-falha-login.png', page); return res(false, false, 0, false, false) }
    await page.waitForTimeout(5000)

    console.log(`[crud:${op}] Abrindo a tela "${screenName}" (cai na Localizar) ...`)
    const opened = await openScreen(page, screenName)
    await page.waitForTimeout(3000)

    // Filtra a grade pelo token (quando há busca) para isolar registros do agente.
    const searched = await searchInGrid(page, token)
    if (searched) { console.log(`      ✓ busca por "${token}" aplicada`); await page.waitForTimeout(1500) }
    const matched = await countRowsWithToken(page, token)
    console.log(`      ${matched} linha(s) com o token "${token}"`)
    await shot(`crud-${op}-lista.png`, page)

    if (op === 'search') {
      learn(code, op, screenName, { token, matched, acted: searched, confirmed: matched > 0, evidence })
      return res(true, opened, matched, searched, matched > 0)
    }

    if (matched === 0) {
      console.log(`      ⚠️ nenhum registro do agente para ${op}. (Crie um com register antes, ou use --token.)`)
      return res(true, opened, 0, false, false)
    }

    if (op === 'edit') {
      console.log(`[crud:edit] Abrindo a 1ª linha do token para editar ...`)
      const acted = await clickRowAction(page, token, 'edit')
      console.log(`      ${acted ? '✓ formulário de edição aberto' : '✗ não achei o botão de editar na linha'}`)
      if (!acted) { await shot('crud-edit-sem-botao.png', page); return res(true, opened, matched, false, false) }
      await page.waitForTimeout(2500)
      const editedToken = `${token} EDITADO ${Date.now() % 100000}`
      const frame = await pickFormFrame(page)
      const filled = await fillForm(frame, editedToken)
      console.log(`      ✓ ${filled} campo(s) alterado(s) para "${editedToken}"`)
      await shot('crud-edit-preenchido.png', page)
      await clickSave(page)
      await page.waitForTimeout(3500)
      const confirmed = await detectSuccess(page, editedToken)
      console.log(`      ${confirmed ? '✓ edição salva' : '⚠️ não confirmei a edição'}`)
      await shot('crud-edit-apos.png', page)
      learn(code, op, screenName, { token: editedToken, matched, acted: true, confirmed, evidence })
      if (opts.headed) await page.waitForTimeout(6000)
      return res(true, opened, matched, true, confirmed)
    }

    // delete — uma linha por vez; com --all, repete até zerar o token na sessão.
    const maxRounds = opts.all ? 30 : 1
    let deleted = 0
    let lastConfirmed = false
    for (let round = 0; round < maxRounds; round++) {
      const before = await countRowsWithToken(page, token)
      if (before === 0) break
      console.log(`[crud:delete] Excluindo linha do token (${deleted + 1}) ...`)
      const acted = await clickRowAction(page, token, 'delete')
      if (!acted) { console.log('      ✗ não achei o botão de excluir na linha'); await shot('crud-delete-sem-botao.png', page); break }
      await page.waitForTimeout(1200)
      const ok = await confirmDialog(page)
      console.log(`      ${ok ? '✓ confirmação do diálogo' : '(sem diálogo de confirmação)'}`)
      await page.waitForTimeout(2800)
      await searchInGrid(page, token).catch(() => false)
      await page.waitForTimeout(1200)
      const after = await countRowsWithToken(page, token)
      lastConfirmed = after < before
      if (lastConfirmed) deleted++
      console.log(`      ${lastConfirmed ? `✓ exclusão confirmada (${before}→${after})` : `⚠️ contagem não caiu (${before}→${after})`}`)
      if (!lastConfirmed) break
    }
    await shot('crud-delete-apos.png', page)
    const confirmed = deleted > 0
    console.log(`      total excluído nesta sessão: ${deleted}`)
    learn(code, op, screenName, { token, matched, acted: deleted > 0, confirmed, evidence })
    if (opts.headed) await page.waitForTimeout(6000)
    return res(true, opened, matched, deleted > 0, confirmed)
  } finally {
    // Salva erros de console/JS coletados (best-effort; não derruba o teste).
    try {
      const errs = consoleCap?.errors() ?? []
      if (errs.length) {
        const p = path.join(shotDir, `crud-${op}-console-erros.json`)
        fs.writeFileSync(p, JSON.stringify(errs, null, 2), 'utf-8')
        evidence.push(p)
        console.log(`      ⚠️ ${errs.length} erro(s) de console/JS — salvo em ${path.basename(p)}`)
      }
      consoleCap?.detach()
    } catch { /* evidência é best-effort */ }
    await browser?.close().catch(() => {})
  }

  function res(loggedIn: boolean, opened: boolean, matched: number, acted: boolean, confirmed: boolean): CrudResult {
    return { op, loggedIn, opened, matched, acted, confirmed, token, evidence }
  }
}

function learn(
  code: string, op: Op, screenName: string,
  data: { token: string; matched: number; acted: boolean; confirmed: boolean; evidence: string[] }
): void {
  const dir = executionDir(code)
  const log = [
    `# CRUD ${op.toUpperCase()} — ${screenName}`, '',
    `- Data: ${new Date().toISOString()}`,
    `- Operação: ${op}`,
    `- Token: ${data.token}`,
    `- Linhas casadas: ${data.matched}`,
    `- Ação executada: ${data.acted ? 'sim' : 'não'}`,
    `- Confirmado: ${data.confirmed ? 'SIM' : 'não'}`,
    '', '## Evidências', ...data.evidence.map(e => `- ${path.basename(e)}`), '',
  ].join('\n')
  fs.writeFileSync(path.join(dir, `crud-${op}-${screenName.replace(/\s+/g, '_')}.md`), log, 'utf-8')
}

/**
 * Ciclo CRUD completo num ÚNICO registro rastreável, em SESSÃO ÚNICA:
 * abre 1 browser, loga 1 vez e roda Create→Read→Update→Delete na MESMA página.
 * Entre as fases, `ensureLoggedIn` só reloga se a sessão tiver caído (não fica
 * relogando à toa — essencial p/ sistemas lentos e telas complexas).
 */
export async function runFull(url: string, screenName: string, opts: { headed?: boolean }): Promise<void> {
  const code = resolveCode(url)
  const shotDir = screenshotsDir(code, screenName)
  const profile = profileStore.loadByUrl(url)
  const sel = selectorsFromProfile(profile)
  const token = `QA CRUD ${Date.now()}`
  const evidence: string[] = []
  const shot = async (name: string, page: Page) => {
    const p = path.join(shotDir, name)
    await page.screenshot({ path: p, fullPage: true }).catch(() => {})
    evidence.push(p)
  }

  let browser: Browser | null = null
  let consoleCap: ConsoleCapture | null = null
  let cOk = false, rFound = 0, uOk = false, dOk = false
  console.log(`\n========== CRUD COMPLETO (SESSÃO ÚNICA) em "${screenName}" — token: ${token} ==========`)
  try {
    browser = await chromium.launch({ headless: !opts.headed, slowMo: opts.headed ? 400 : 0 })
    const page = await (await browser.newContext({ locale: 'pt-BR' })).newPage()
    consoleCap = attachConsoleCapture(page)

    console.log('\n[login] Logando (uma única vez) ...')
    if (!(await loginToSystem(page, url, sel))) { console.log('  ✗ login não confirmado'); return }
    console.log('  ✓ logado')
    await page.waitForTimeout(4000)

    // ── C: CREATE ─────────────────────────────────────────────────────────
    console.log('\n--- C: CREATE ---')
    await ensureLoggedIn(page, url, sel)
    await openScreen(page, screenName); await page.waitForTimeout(2500)
    const formOpened = await clickInclude(page); await page.waitForTimeout(2000)
    if (formOpened) {
      const cFrame = await pickFormFrame(page)
      const filled = await fillForm(cFrame, token)
      console.log(`  ✓ ${filled} campo(s) preenchido(s)`)
      await clickSave(page); await page.waitForTimeout(3000)
      const sig = await detectSuccess(page, token)
      const inGrid = await reopenAndCount(page, screenName, token)
      cOk = sig || inGrid > 0
      console.log(`  Create: ${cOk ? 'OK' : 'revisar'} (sinal:${sig ? 'sim' : 'não'} | grade:${inGrid})`)
    } else {
      console.log('  ✗ não achei o botão de incluir')
    }
    await shot('full-create.png', page)

    // ── R: READ ───────────────────────────────────────────────────────────
    console.log('\n--- R: READ ---')
    await ensureLoggedIn(page, url, sel)
    await ensureOnGrid(page)
    await searchInGrid(page, token); await page.waitForTimeout(1200)
    rFound = await countRowsWithToken(page, token)
    console.log(`  Read: ${rFound} linha(s) com o token`)
    await shot('full-read.png', page)

    // ── U: UPDATE (edita o PRÓPRIO registro) ──────────────────────────────
    console.log('\n--- U: UPDATE ---')
    await ensureLoggedIn(page, url, sel)
    await ensureOnGrid(page)
    await searchInGrid(page, token); await page.waitForTimeout(1000)
    let editedToken = token
    if (await clickRowAction(page, token, 'edit')) {
      await page.waitForTimeout(2500)
      editedToken = `${token} EDITADO`
      const uFrame = await pickFormFrame(page)
      const ed = await fillForm(uFrame, editedToken)
      await clickSave(page); await page.waitForTimeout(3000)
      const sig = await detectSuccess(page, editedToken)
      const g = await reopenAndCount(page, screenName, editedToken)
      uOk = sig || g > 0
      console.log(`  Update: ${uOk ? 'OK' : 'revisar'} (${ed} campo(s) → "${editedToken}" | grade:${g})`)
    } else {
      console.log('  ⚠️ não achei o ícone de editar na linha (revisar clickRowAction)')
    }
    await shot('full-update.png', page)

    // ── D: DELETE (exclui o PRÓPRIO registro) ─────────────────────────────
    console.log('\n--- D: DELETE ---')
    await ensureLoggedIn(page, url, sel)
    await ensureOnGrid(page)
    const delToken = uOk ? editedToken : token
    await searchInGrid(page, delToken); await page.waitForTimeout(1000)
    const before = await countRowsWithToken(page, delToken)
    if (before > 0 && await clickRowAction(page, delToken, 'delete')) {
      await page.waitForTimeout(1200)
      await confirmDialog(page); await page.waitForTimeout(2800)
      await ensureOnGrid(page)
      await searchInGrid(page, delToken); await page.waitForTimeout(1200)
      const after = await countRowsWithToken(page, delToken)
      dOk = after < before
      console.log(`  Delete: ${dOk ? `OK (${before}→${after})` : `revisar (${before}→${after})`}`)
    } else {
      console.log('  ⚠️ nada para excluir ou não achei o ícone de excluir na linha')
    }
    await shot('full-delete.png', page)

    console.log(`\n========== RESUMO CRUD (sessão única, 1 login) ==========`)
    console.log(`Create: ${cOk ? 'OK' : 'revisar'} | Read: ${rFound} | Update: ${uOk ? 'OK' : 'revisar'} | Delete: ${dOk ? 'OK' : 'revisar'}`)
    learn(code, 'full', screenName, { token, matched: rFound, acted: uOk || dOk, confirmed: cOk && dOk, evidence })
    if (opts.headed) await page.waitForTimeout(6000)
  } finally {
    try {
      const errs = consoleCap?.errors() ?? []
      if (errs.length) {
        const p = path.join(shotDir, 'full-console-erros.json')
        fs.writeFileSync(p, JSON.stringify(errs, null, 2), 'utf-8')
        console.log(`      ⚠️ ${errs.length} erro(s) de console/JS — salvo em ${path.basename(p)}`)
      }
      consoleCap?.detach()
    } catch { /* evidência é best-effort */ }
    await browser?.close().catch(() => {})
  }
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const headed = args.includes('--headed')
  const all = args.includes('--all')
  const tIdx = args.indexOf('--token')
  const tokenArg = tIdx >= 0 ? args[tIdx + 1] : undefined
  const pos = args.filter((a, i) => !a.startsWith('--') && !(tIdx >= 0 && i === tIdx + 1))
  const op = pos[0] as Op
  const url = pos[1]
  const screenName = pos.slice(2).join(' ')
  if (!['search', 'edit', 'delete', 'full'].includes(op) || !url || !screenName) {
    console.error('Uso: ts-node src/discovery/crud.ts <search|edit|delete|full> <url> "<Tela>" [--headed] [--token "texto"]')
    process.exit(1)
  }
  const run = op === 'full'
    ? runFull(url, screenName, { headed })
    : runCrud(op, url, screenName, { headed, token: tokenArg, all }).then(r => {
        console.log(`\n=== Resultado crud:${r.op} ===`)
        console.log(`Login: ${r.loggedIn ? 'OK' : 'FALHOU'} | Tela: ${r.opened ? 'aberta' : 'não'} | Casados: ${r.matched} | Ação: ${r.acted ? 'sim' : 'não'} | Confirmado: ${r.confirmed ? 'SIM' : 'não'}`)
      })
  run.catch(err => { console.error('Falha:', err.message); process.exit(1) })
}
