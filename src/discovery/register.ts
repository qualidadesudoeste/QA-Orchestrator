/**
 * register — Create do CRUD: o agente INCLUI um registro sozinho.
 *
 * Genérico e SEM IA externa nas decisões. Reusa os blocos de makerSession.
 * Fluxo: login → abre tela (cai na Localizar) → Incluir → preenche → Salva →
 * confirma (várias formas) → grava evidência e aprende.
 *
 * Uso: ts-node src/discovery/register.ts <url> "<Tela>" [--headed] [--value "texto"]
 */

import 'dotenv/config'
import { chromium } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { profileStore } from './systemProfile'
import { resolveCode, executionDir, learnedPatternsDir, screenshotsDir } from '../knowledge/layout'
import {
  selectorsFromProfile, loginToSystem, openScreen, clickInclude,
  pickFormFrame, fillForm, clickSave, detectSuccess, reopenAndCount,
} from './makerSession'
import { attachConsoleCapture } from '../tools/playwright/capture'
import type { ConsoleCapture } from '../tools/playwright/capture'

export interface RegisterResult {
  loggedIn: boolean
  opened: boolean
  formOpened: boolean
  saved: boolean
  success: boolean
  /** Reverificação definitiva: nº de linhas com o token ao reabrir a Localizar. */
  verifiedInGrid: number
  token: string
  filledFields: number
  evidence: string[]
  notes: string[]
}

export async function registerRecord(
  url: string,
  screenName: string,
  opts: { headed?: boolean; value?: string } = {}
): Promise<RegisterResult> {
  const code = resolveCode(url)
  const shotDir = screenshotsDir(code, screenName)
  const profile = profileStore.loadByUrl(url)
  const token = opts.value || `QA Teste ${Date.now()}`
  const notes: string[] = []
  const evidence: string[] = []
  const sel = selectorsFromProfile(profile)

  const shot = async (name: string) => {
    const p = path.join(shotDir, name)
    await page.screenshot({ path: p, fullPage: true }).catch(() => {})
    evidence.push(p)
  }

  let browser: Browser | null = null
  let page!: Page
  let consoleCap: ConsoleCapture | null = null
  try {
    browser = await chromium.launch({ headless: !opts.headed, slowMo: opts.headed ? 400 : 0 })
    page = await (await browser.newContext({ locale: 'pt-BR' })).newPage()
    consoleCap = attachConsoleCapture(page) // passivo: coleta erros JS como evidência

    console.log(`\n[1/6] Logando em ${url} ...`)
    const loggedIn = await loginToSystem(page, url, sel)
    console.log(`      ${loggedIn ? '✓ logado' : '✗ login não confirmado'}`)
    if (!loggedIn) { await shot('falha-login.png'); return result(false, false, false, false) }
    await page.waitForTimeout(5000)

    console.log(`[2/6] Abrindo a tela "${screenName}" ...`)
    const opened = await openScreen(page, screenName)
    console.log(`      ${opened ? '✓ tela aberta' : '✗ não abriu pelo menu'}`)
    await page.waitForTimeout(3000)
    await shot('lista.png')

    console.log(`[3/6] Acionando "Incluir/Novo" ...`)
    const formOpened = await clickInclude(page)
    console.log(`      ${formOpened ? '✓ formulário de inclusão aberto' : '✗ não achei o botão de incluir'}`)
    if (!formOpened) {
      notes.push('Botão de inclusão não encontrado — tela pode não permitir cadastro ou usa outro rótulo.')
      await shot('sem-incluir.png')
      return result(true, opened, false, false)
    }
    await page.waitForTimeout(2500)

    console.log(`[4/6] Preenchendo os campos com "${token}" ...`)
    const formFrame = await pickFormFrame(page)
    const filledFields = await fillForm(formFrame, token)
    console.log(`      ✓ ${filledFields} campo(s) preenchido(s)`)
    await shot('preenchido.png')

    console.log(`[5/6] Salvando ...`)
    const saved = await clickSave(page)
    console.log(`      ${saved ? '✓ salvar acionado' : '✗ botão salvar não encontrado'}`)
    await page.waitForTimeout(3500)
    await shot('apos-salvar.png')

    console.log(`[6/6] Confirmando o resultado ...`)
    const success = await detectSuccess(page, token)
    console.log(`      ${success ? '✓ inclusão confirmada (sinal imediato)' : '⚠️ sinal imediato não veio (ver evidências)'}`)

    console.log(`[7/7] Reverificação definitiva — reabrindo a Localizar e buscando "${token}" ...`)
    const verifiedInGrid = await reopenAndCount(page, screenName, token)
    console.log(`      ${verifiedInGrid > 0 ? `✓ PROVADO na grade: ${verifiedInGrid} linha(s)` : '⚠️ token não apareceu na grade ao reabrir'}`)
    await shot('reverificacao-grade.png')
    if (verifiedInGrid > 0 && !success) notes.push('Sinal imediato fraco, mas o registro foi PROVADO na grade ao reabrir a Localizar.')

    // Sucesso final = sinal imediato OU prova na grade (a grade é a fonte da verdade).
    const confirmed = success || verifiedInGrid > 0
    learn(code, screenName, { token, saved, success: confirmed, verifiedInGrid, filledFields, notes, evidence })
    if (opts.headed) await page.waitForTimeout(8000)
    return result(true, opened, true, saved, confirmed, filledFields, verifiedInGrid)
  } finally {
    // Salva erros de console/JS coletados (não derruba o teste se falhar).
    try {
      const errs = consoleCap?.errors() ?? []
      if (errs.length) {
        const p = path.join(shotDir, 'console-erros.json')
        fs.writeFileSync(p, JSON.stringify(errs, null, 2), 'utf-8')
        evidence.push(p)
        notes.push(`${errs.length} erro(s) de console/JS capturado(s) durante o fluxo (ver console-erros.json).`)
        console.log(`      ⚠️ ${errs.length} erro(s) de console/JS — salvo em console-erros.json`)
      }
      consoleCap?.detach()
    } catch { /* evidência é best-effort */ }
    await browser?.close().catch(() => {})
  }

  function result(loggedIn: boolean, opened: boolean, formOpened: boolean, saved: boolean, success = false, filledFields = 0, verifiedInGrid = 0): RegisterResult {
    return { loggedIn, opened, formOpened, saved, success, verifiedInGrid, token, filledFields, evidence, notes }
  }
}

function learn(
  code: string,
  screenName: string,
  data: { token: string; saved: boolean; success: boolean; verifiedInGrid: number; filledFields: number; notes: string[]; evidence: string[] }
): void {
  const dir = executionDir(code)
  const log = [
    `# Inclusão de registro — ${screenName}`, '',
    `- Data: ${new Date().toISOString()}`,
    `- Tela: ${screenName}`,
    `- Token de teste: ${data.token}`,
    `- Campos preenchidos: ${data.filledFields}`,
    `- Salvar acionado: ${data.saved ? 'sim' : 'não'}`,
    `- Reverificação na grade: ${data.verifiedInGrid} linha(s)`,
    `- Sucesso confirmado: ${data.success ? 'SIM' : 'não'}`,
    ...(data.notes.length ? ['', '## Observações', ...data.notes.map(n => `- ${n}`)] : []),
    '', '## Evidências', ...data.evidence.map(e => `- ${path.basename(e)}`), '',
  ].join('\n')
  fs.writeFileSync(path.join(dir, `inclusao-${screenName.replace(/\s+/g, '_')}.md`), log, 'utf-8')

  const patFile = path.join(learnedPatternsDir(code), 'fluxos_cadastro.md')
  const line = `- ${new Date().toISOString().slice(0, 10)} | ${screenName}: incluir→preencher(${data.filledFields})→salvar→reverificar(grade:${data.verifiedInGrid}) ⇒ ${data.success ? 'OK' : 'revisar'}\n`
  fs.appendFileSync(patFile, fs.existsSync(patFile) ? line : `# Fluxos de Cadastro Aprendidos\n\n${line}`)
  console.log(`      ✓ aprendizado salvo em ${path.relative(process.cwd(), dir)}`)
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const headed = args.includes('--headed')
  const vIdx = args.indexOf('--value')
  const value = vIdx >= 0 ? args[vIdx + 1] : undefined
  const pos = args.filter((a, i) => !a.startsWith('--') && !(vIdx >= 0 && i === vIdx + 1))
  const url = pos[0]
  const screenName = pos.slice(1).join(' ')
  if (!url || !screenName) {
    console.error('Uso: ts-node src/discovery/register.ts <url> "<Tela>" [--headed] [--value "texto"]')
    process.exit(1)
  }
  registerRecord(url, screenName, { headed, value })
    .then(r => {
      console.log(`\n=== Resultado ===`)
      console.log(`Login: ${r.loggedIn ? 'OK' : 'FALHOU'} | Tela: ${r.opened ? 'aberta' : 'não'} | Form: ${r.formOpened ? 'aberto' : 'não'}`)
      console.log(`Salvar: ${r.saved ? 'sim' : 'não'} | Grade: ${r.verifiedInGrid} linha(s) | Sucesso: ${r.success ? 'CONFIRMADO' : 'não confirmado'} | Token: ${r.token}`)
    })
    .catch(err => { console.error('Falha:', err.message); process.exit(1) })
}
