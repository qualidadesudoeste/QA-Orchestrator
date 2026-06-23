/**
 * validationTests — testes NEGATIVOS de validação de formulário (sem IA).
 *
 * Passa quando o sistema BLOQUEIA corretamente a ação inválida:
 *   • obrigatoriedade: salvar com campo(s) obrigatório(s) vazio(s) deve ser barrado.
 *   • duplicidade:     criar um registro idêntico a outro já existente deve ser barrado.
 *
 * Sessão única (1 login). Reusa os blocos robustos do makerSession. Segurança:
 * só age em registros com o TOKEN do agente; o teste de duplicidade limpa o que cria.
 *
 * Uso: ts-node src/discovery/validationTests.ts <url> "<Tela>" [--headed] [--only required|duplicate]
 */

import 'dotenv/config'
import { chromium } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { profileStore } from './systemProfile'
import { resolveCode, screenshotsDir, executionDir } from '../knowledge/layout'
import {
  selectorsFromProfile, loginToSystem, ensureLoggedIn, openScreen, ensureOnGrid,
  clickInclude, pickFormFrame, fillForm, clickSave, detectSuccess, closeEditForm,
  reopenAndCount, searchInGrid, countRowsWithToken, clickRowAction, confirmDialog,
} from './makerSession'

interface CheckResult { name: string; passed: boolean; detail: string }

/** Procura indício de erro/validação na tela (texto ou marcador estrutural). */
async function detectValidationError(page: Page): Promise<string | null> {
  const RE = /obrigat[óo]ri|required|preench|informe|campo.*(vazio|obrigat)|n[ãa]o pode|inv[áa]lid|j[áa] existe|duplicad|existe um registro/i
  for (const frame of page.frames()) {
    const inval = await frame.locator('[aria-invalid="true"], [class*="is-invalid" i], [class*="invalid" i], [class*="error" i], [class*="erro" i]')
      .first().isVisible().catch(() => false)
    if (inval) {
      // tenta capturar o texto perto do marcador; se não, reporta o marcador
      const txts = await frame.locator('[class*="toast" i],[class*="alert" i],[class*="message" i],[class*="mensagem" i],[role="alert"],[class*="error" i],[class*="erro" i],[class*="invalid" i]')
        .allInnerTexts().catch(() => [] as string[])
      const hit = txts.find(t => RE.test(t))
      return hit ? hit.trim().replace(/\s+/g, ' ').slice(0, 140) : 'marcador visual de campo inválido/erro'
    }
    const alerts = await frame.locator('[class*="toast" i],[class*="alert" i],[class*="message" i],[class*="mensagem" i],[role="alert"]')
      .allInnerTexts().catch(() => [] as string[])
    const hit = alerts.find(t => RE.test(t))
    if (hit) return hit.trim().replace(/\s+/g, ' ').slice(0, 140)
  }
  return null
}

/** OBRIGATORIEDADE: salvar com tudo vazio deve ser BARRADO (não pode salvar). */
async function testRequired(page: Page, url: string, sel: any, screenName: string, shot: (n: string) => Promise<void>): Promise<CheckResult> {
  console.log('\n[obrigatoriedade] abrindo inclusão e salvando com campos VAZIOS ...')
  await ensureLoggedIn(page, url, sel)
  await openScreen(page, screenName); await page.waitForTimeout(2000)
  await ensureOnGrid(page)
  if (!(await clickInclude(page))) return { name: 'Obrigatoriedade', passed: false, detail: 'não abriu o formulário de inclusão' }
  await page.waitForTimeout(1800)
  await clickSave(page) // NÃO preenche nada de propósito
  await page.waitForTimeout(2500)
  const success = await detectSuccess(page, '')
  const err = await detectValidationError(page)
  await shot('valida-obrigatoriedade.png')
  // PASS = não salvou (bloqueado). Mensagem de validação é evidência extra.
  const passed = !success
  const detail = success
    ? 'FALHOU: o sistema SALVOU com campo obrigatório vazio (sem bloqueio)'
    : (err ? `OK: bloqueou — "${err}"` : 'OK: não salvou (sem toast de sucesso); sem mensagem de validação explícita na tela')
  await closeEditForm(page).catch(() => {})
  return { name: 'Obrigatoriedade', passed, detail }
}

/** DUPLICIDADE: criar um 2º registro idêntico deve ser BARRADO (grade não vai a 2). */
async function testDuplicate(page: Page, url: string, sel: any, screenName: string, shot: (n: string) => Promise<void>): Promise<CheckResult> {
  const token = `QA DUP ${Date.now()}`
  console.log(`\n[duplicidade] token base: "${token}"`)
  try {
    // 1ª criação — deve funcionar
    await ensureLoggedIn(page, url, sel)
    await openScreen(page, screenName); await page.waitForTimeout(2000)
    await ensureOnGrid(page)
    if (!(await clickInclude(page))) return { name: 'Duplicidade', passed: false, detail: 'não abriu o formulário de inclusão' }
    await page.waitForTimeout(1500)
    await fillForm(await pickFormFrame(page), token)
    await clickSave(page); await page.waitForTimeout(3000)
    const base = await reopenAndCount(page, screenName, token)
    console.log(`      registro base na grade: ${base}`)
    if (base < 1) return { name: 'Duplicidade', passed: false, detail: `não consegui criar o registro base (grade:${base}) — teste inconclusivo` }

    // 2ª criação IDÊNTICA — deve ser barrada
    console.log('      tentando criar a DUPLICATA (mesmo valor) ...')
    await ensureOnGrid(page)
    if (!(await clickInclude(page))) return { name: 'Duplicidade', passed: false, detail: 'não reabriu inclusão para a duplicata' }
    await page.waitForTimeout(1500)
    await fillForm(await pickFormFrame(page), token)
    await clickSave(page); await page.waitForTimeout(3000)
    const err = await detectValidationError(page)
    await shot('valida-duplicidade.png')
    const after = await reopenAndCount(page, screenName, token)
    const passed = after <= 1
    const detail = passed
      ? `OK: bloqueou a duplicata (grade continua ${after})${err ? ` — "${err}"` : ''}`
      : `FALHOU: permitiu duplicar (grade foi para ${after})`
    return { name: 'Duplicidade', passed, detail }
  } finally {
    // limpeza: apaga TODOS os registros do token criados pelo teste
    try {
      await ensureOnGrid(page)
      await searchInGrid(page, token).catch(() => false)
      for (let i = 0; i < 6; i++) {
        const before = await countRowsWithToken(page, token)
        if (before === 0) break
        if (!(await clickRowAction(page, token, 'delete'))) break
        await page.waitForTimeout(1000)
        await confirmDialog(page).catch(() => false)
        await page.waitForTimeout(2200)
        await ensureOnGrid(page)
        await searchInGrid(page, token).catch(() => false)
      }
      console.log('      ✓ limpeza do token concluída')
    } catch { /* limpeza é best-effort */ }
  }
}

export async function runValidations(
  url: string,
  screenName: string,
  opts: { headed?: boolean; only?: 'required' | 'duplicate' } = {}
): Promise<CheckResult[]> {
  const code = resolveCode(url)
  const shotDir = screenshotsDir(code, screenName)
  const profile = profileStore.loadByUrl(url)
  const sel = selectorsFromProfile(profile)
  let pageRef: Page | null = null
  const shot = async (name: string) => {
    await pageRef?.screenshot({ path: path.join(shotDir, name), fullPage: true }).catch(() => {})
  }
  const results: CheckResult[] = []

  let browser: Browser | null = null
  console.log(`\n===== TESTES DE VALIDAÇÃO (sessão única) em "${screenName}" =====`)
  try {
    browser = await chromium.launch({ headless: !opts.headed, slowMo: opts.headed ? 350 : 0 })
    const page = await (await browser.newContext({ locale: 'pt-BR' })).newPage()
    pageRef = page

    console.log('\n[login] ...')
    if (!(await loginToSystem(page, url, sel))) { console.log('  ✗ login não confirmado'); return results }
    console.log('  ✓ logado')
    await page.waitForTimeout(4000)

    if (opts.only !== 'duplicate') results.push(await testRequired(page, url, sel, screenName, shot))
    if (opts.only !== 'required') results.push(await testDuplicate(page, url, sel, screenName, shot))

    console.log('\n===== RESUMO =====')
    for (const r of results) console.log(`  ${r.passed ? '✓ PASSOU' : '✗ FALHOU'} | ${r.name}: ${r.detail}`)

    // relatório
    const dir = executionDir(code)
    const md = [
      `# Testes de validação — ${screenName}`, '',
      `- Data: ${new Date().toISOString()}`, '',
      ...results.map(r => `- **${r.name}**: ${r.passed ? 'PASSOU' : 'FALHOU'} — ${r.detail}`), '',
    ].join('\n')
    fs.writeFileSync(path.join(dir, `validacao-${screenName.replace(/\s+/g, '_')}.md`), md, 'utf-8')
    if (opts.headed) await page.waitForTimeout(5000)
  } finally {
    await browser?.close().catch(() => {})
  }
  return results
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const headed = args.includes('--headed')
  const oIdx = args.indexOf('--only')
  const only = oIdx >= 0 ? (args[oIdx + 1] as 'required' | 'duplicate') : undefined
  const pos = args.filter((a, i) => !a.startsWith('--') && !(oIdx >= 0 && i === oIdx + 1))
  const url = pos[0]
  const screenName = pos.slice(1).join(' ')
  if (!url || !screenName) {
    console.error('Uso: ts-node src/discovery/validationTests.ts <url> "<Tela>" [--headed] [--only required|duplicate]')
    process.exit(1)
  }
  runValidations(url, screenName, { headed, only })
    .then(rs => {
      const allPass = rs.length > 0 && rs.every(r => r.passed)
      console.log(`\n=== ${allPass ? 'TODOS PASSARAM' : 'REVISAR'} (${rs.filter(r => r.passed).length}/${rs.length}) ===`)
      process.exit(allPass ? 0 : 1)
    })
    .catch(err => { console.error('Falha:', err.message); process.exit(1) })
}
