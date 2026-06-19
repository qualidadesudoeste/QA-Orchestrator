/**
 * screenTest — Fase D (passos 1+2): abrir UMA tela, ler campos/abas e gerar testes.
 *
 * Fluxo:
 *   1. Loga (frame-aware, usando o perfil aprendido)
 *   2. Abre a tela pedida pelo nome do menu (expande grupos + clica na folha)
 *   3. Mapeia, DENTRO dos iframes Maker, os campos, botões e abas da tela
 *   4. Gera cenários BDD (provedor de IA configurado) com dados
 *   5. Salva tudo organizado em evidence/<sistema>/<tela>/
 *
 * Uso: ts-node src/discovery/screenTest.ts <url> "<Nome da Tela>" [--headed]
 */

import 'dotenv/config'
import { chromium } from '@playwright/test'
import type { Browser, Frame, Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { findInFrames, waitForAnyFrameSelector, gotoSmart } from '../tools/playwright/frameUtils'
import { profileStore } from './systemProfile'
import { getProvider } from './aiProvider'
import { screenDir, screenshotsDir, resolveCode } from '../knowledge/layout'

interface FieldInfo { tag: string; type: string; name: string; id: string; label: string }
interface TabInfo { text: string }

const TAB_SELECTORS = [
  '[role="tab"]',
  '[class*="aba" i]',
  '[class*="tab" i]:not([class*="table" i])',
  'a[onclick*="aba" i]',
  'a[onclick*="tab" i]',
  'li[onclick*="tab" i]',
]

export async function testScreen(url: string, screenName: string, opts: { headed?: boolean; fill?: boolean } = {}) {
  const code = resolveCode(url)
  const outDir = screenDir(code, screenName)
  const shotDir = screenshotsDir(code, screenName)
  const profile = profileStore.loadByUrl(url)

  const userSel = profile?.login?.usernameSelectors ?? ['input[name*="WFRInput" i]', 'input[type="text"]', 'input[type="email"]']
  const passSel = profile?.login?.passwordSelectors ?? ['input[type="password"]']
  const submitSel = profile?.login?.submitSelectors ?? ['button:has-text("Entrar")', 'input[type="submit"]', 'button[type="submit"]']

  let browser: Browser | null = null
  try {
    // headed + slowMo = você vê o Chrome agindo passo a passo.
    browser = await chromium.launch({ headless: !opts.headed, slowMo: opts.headed ? 500 : 0 })
    const page = await (await browser.newContext({ locale: 'pt-BR' })).newPage()

    console.log(`\n[1/5] Logando em ${url} ...`)
    await gotoSmart(page, url, { timeout: 60_000 })
    await waitForAnyFrameSelector(page, [...userSel, ...passSel], 45_000)
    const loggedIn = await login(page, userSel, passSel, submitSel)
    console.log(`      ${loggedIn ? '✓ logado' : '✗ login não confirmado'}`)

    if (!loggedIn) {
      await page.screenshot({ path: path.join(shotDir, 'falha-login.png'), fullPage: true }).catch(() => {})
      console.log(`\n⚠️  Não autenticou — provável VPN/conexão caiu ou credenciais. Abortei para não testar a tela errada.`)
      console.log(`   Verifique a VPN e rode de novo. Print: ${path.join(outDir, 'falha-login.png')}`)
      return { loggedIn: false, opened: false, fields: [], buttons: [], tabs: [], scenarios: [], outDir }
    }

    await page.waitForTimeout(6000)

    console.log(`[2/5] Abrindo a tela "${screenName}" ...`)
    const opened = await openScreen(page, screenName)
    console.log(`      ${opened ? '✓ tela aberta' : '✗ não consegui abrir a tela pelo menu'}`)
    await page.waitForTimeout(4000)

    const screenshotPath = path.join(shotDir, 'screen.png')
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {})

    console.log(`[3/5] Lendo campos e abas (dentro dos iframes) ...`)
    const { fields, buttons, tabs, frameUrl } = await mapScreen(page)
    console.log(`      ${fields.length} campos | ${buttons.length} botões | ${tabs.length} abas`)
    for (const t of tabs) console.log(`        aba: ${t.text}`)

    if (opts.fill) {
      console.log(`[3.5] Preenchendo a tela com dados de teste (sem salvar) ...`)
      await fillScreen(page, frameUrl, tabs, shotDir)
    }

    console.log(`[4/5] Gerando cenários BDD com IA ...`)
    const scenarios = await generate(screenName, url, fields, buttons, tabs)
    console.log(`      ${scenarios.length} cenário(s) gerado(s)`)

    console.log(`[5/5] Salvando em ${outDir} ...`)
    fs.writeFileSync(path.join(outDir, 'context.md'), toContextMd(screenName, url, fields, buttons, tabs), 'utf-8')
    fs.writeFileSync(path.join(outDir, 'test_scenarios.md'), toScenariosMd(screenName, scenarios), 'utf-8')
    fs.writeFileSync(path.join(outDir, 'testes.feature'), toFeature(screenName, scenarios), 'utf-8')
    fs.writeFileSync(path.join(outDir, 'cenarios.json'), JSON.stringify(scenarios, null, 2), 'utf-8')
    fs.writeFileSync(path.join(outDir, 'tela.json'), JSON.stringify({ screenName, url, frameUrl, fields, buttons, tabs }, null, 2), 'utf-8')
    console.log(`      ✓ context.md + test_scenarios.md + testes.feature`)
    console.log(`      ✓ ${screenshotPath}`)

    if (opts.headed) {
      console.log(`      (mantendo o Chrome aberto 12s para você ver a tela preenchida...)`)
      await page.waitForTimeout(12_000)
    }

    return { loggedIn, opened, fields, buttons, tabs, scenarios, outDir }
  } finally {
    await browser?.close().catch(() => {})
  }
}

async function login(page: Page, userSel: string[], passSel: string[], submitSel: string[]): Promise<boolean> {
  const user = process.env.APP_USERNAME
  const pass = process.env.APP_PASSWORD
  if (!user || !pass) throw new Error('APP_USERNAME / APP_PASSWORD ausentes no .env')
  const u = await findInFrames(page, userSel)
  if (!u) return false
  await u.locator.fill(user)
  const p = await findInFrames(page, passSel, u.frame)
  if (p) await p.locator.fill(pass)
  const s = await findInFrames(page, submitSel, u.frame)
  if (s) await s.locator.click().catch(() => {})
  else if (p) await p.locator.press('Enter').catch(() => {})

  // Poll até 15s: login OK quando o campo de senha some (CLE/VPN é lento).
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000)
    if (!(await findInFrames(page, passSel, undefined, 400))) return true
  }
  return false
}

/** Abre a tela pelo nome: expande grupos do menu e clica no item-folha. */
async function openScreen(page: Page, screenName: string): Promise<boolean> {
  const want = norm(screenName)

  // 1ª tentativa: clicar direto se já estiver visível.
  if (await clickByText(page, want)) return true

  // Expande todos os grupos colapsados (padrão Maker: a[href^="#Menu-submenu"]).
  for (const frame of page.frames()) {
    const toggles = await frame.locator('a[href^="#Menu-submenu"], [onclick*="submenu" i], [class*="menu" i] > a').all().catch(() => [])
    for (const t of toggles) {
      if (await t.isVisible().catch(() => false)) await t.click().catch(() => {})
    }
  }
  await page.waitForTimeout(1500)

  // 2ª tentativa após expandir.
  return clickByText(page, want)
}

async function clickByText(page: Page, want: string): Promise<boolean> {
  for (const frame of page.frames()) {
    const candidates = await frame.locator('a, li, span, [onclick], [role="menuitem"]').all().catch(() => [])
    for (const c of candidates) {
      const text = norm(((await c.innerText().catch(() => '')) || '').trim())
      if (!text) continue
      if (text === want || (text.includes(want) && text.length < want.length + 15)) {
        if (await c.isVisible().catch(() => false)) {
          await c.click().catch(() => {})
          await page.waitForTimeout(2500)
          return true
        }
      }
    }
  }
  return false
}

/** Mapeia campos/botões/abas no frame que de fato tem o formulário. */
async function mapScreen(page: Page): Promise<{ fields: FieldInfo[]; buttons: string[]; tabs: TabInfo[]; frameUrl: string }> {
  let best: { frame: Frame; count: number } | null = null
  for (const frame of page.frames()) {
    if (!frame.url() || frame.url() === 'about:blank') continue
    const count = await frame.locator('input, select, textarea').count().catch(() => 0)
    if (!best || count > best.count) best = { frame, count }
  }
  if (!best || best.count === 0) return { fields: [], buttons: [], tabs: [], frameUrl: '' }

  const frame = best.frame
  const fields: FieldInfo[] = []
  const inputs = await frame.locator('input, select, textarea').all().catch(() => [])
  for (const h of inputs) {
    if (!(await h.isVisible().catch(() => false))) continue
    const type = (await h.getAttribute('type').catch(() => '')) ?? ''
    if (type === 'hidden') continue
    fields.push({
      tag: (await h.evaluate(el => el.tagName.toLowerCase()).catch(() => 'input')) ?? 'input',
      type: type || 'text',
      name: (await h.getAttribute('name').catch(() => '')) ?? '',
      id: (await h.getAttribute('id').catch(() => '')) ?? '',
      label: ((await h.getAttribute('title').catch(() => '')) || (await h.getAttribute('placeholder').catch(() => '')) || '').trim(),
    })
  }

  const buttons: string[] = []
  const btns = await frame.locator('button, input[type="submit"], input[type="button"], [role="button"], a[onclick]').all().catch(() => [])
  for (const b of btns) {
    if (!(await b.isVisible().catch(() => false))) continue
    const t = ((await b.innerText().catch(() => '')) || (await b.getAttribute('value').catch(() => '')) || '').trim().replace(/\s+/g, ' ')
    if (t && t.length < 40 && !buttons.includes(t)) buttons.push(t)
  }

  const tabs: TabInfo[] = []
  const seenTab = new Set<string>()
  for (const sel of TAB_SELECTORS) {
    const els = await frame.locator(sel).all().catch(() => [])
    for (const e of els) {
      if (!(await e.isVisible().catch(() => false))) continue
      const t = ((await e.innerText().catch(() => '')) || '').trim().replace(/\s+/g, ' ')
      if (t && t.length < 30 && !seenTab.has(norm(t))) { seenTab.add(norm(t)); tabs.push({ text: t }) }
    }
  }

  return { fields, buttons, tabs, frameUrl: frame.url() }
}

/** Preenche os campos visíveis com dados de teste e navega pelas abas (NÃO salva). */
async function fillScreen(page: Page, frameUrl: string, tabs: TabInfo[], outDir: string): Promise<void> {
  const frame = page.frames().find(f => f.url() === frameUrl) ?? page.mainFrame()

  const inputs = await frame.locator('input, select, textarea').all().catch(() => [])
  let filled = 0
  for (const h of inputs) {
    if (!(await h.isVisible().catch(() => false))) continue
    const tag = (await h.evaluate(el => el.tagName.toLowerCase()).catch(() => 'input')) ?? 'input'
    const type = ((await h.getAttribute('type').catch(() => '')) ?? '').toLowerCase()
    if (type === 'hidden' || type === 'submit' || type === 'button') continue
    const label = ((await h.getAttribute('title').catch(() => '')) || (await h.getAttribute('placeholder').catch(() => '')) || (await h.getAttribute('name').catch(() => '')) || '').toLowerCase()

    try {
      if (tag === 'select') {
        await h.selectOption({ index: 1 }).catch(() => {})
      } else if (type === 'checkbox' || type === 'radio') {
        await h.check().catch(() => {})
      } else {
        await h.fill(sampleValue(type, label)).catch(() => {})
      }
      filled++
    } catch {
      // campo não preenchível — ignora
    }
  }
  console.log(`      ✓ ${filled} campo(s) preenchido(s)`)
  await frame.page().screenshot({ path: path.join(outDir, 'preenchido.png'), fullPage: true }).catch(() => {})

  // Navega pelas abas (Cadastro/Questionário/Localizar...) e fotografa cada uma.
  for (const t of tabs) {
    const aba = frame.locator(`text=${t.text}`).first()
    if (await aba.isVisible().catch(() => false)) {
      await aba.click().catch(() => {})
      await page.waitForTimeout(1200)
      await frame.page().screenshot({ path: path.join(outDir, `aba-${slug(t.text)}.png`), fullPage: true }).catch(() => {})
      console.log(`      ✓ aba "${t.text}" aberta e fotografada`)
    }
  }
}

function sampleValue(type: string, label: string): string {
  if (type === 'email' || /email|e-mail/.test(label)) return 'teste.qa@exemplo.com'
  if (type === 'number' || /valor|qtd|quantidade|numero|cod/.test(label)) return '10'
  if (type === 'date' || /data|nascimento/.test(label)) return '2026-12-31'
  if (type === 'tel' || /telefone|celular|fone/.test(label)) return '71999990000'
  if (/nome|descri|titulo|evento/.test(label)) return 'Tipo de Evento Teste QA'
  return 'TESTE_QA'
}

interface GenScenario { tipo: string; titulo: string; prioridade: string; dado: string[]; quando: string[]; entao: string[]; dadosTeste?: Record<string, string> }

const SYSTEM_PROMPT = `Você é um QA Sênior que gera cenários de teste BDD (português) para uma tela de sistema.
Recebe os campos, botões e abas de uma tela e gera cenários CONCRETOS.
Regras: para cada campo gere positivo, negativo e borda; inclua SEGURANÇA (SQLi/XSS) nos campos texto;
se houver abas, gere ao menos um cenário navegando entre elas.
Fases BDD: "dado" (pré-condições), "quando" (ações), "entao" (resultados). Forneça "dadosTeste".
tipo ∈ POSITIVO,NEGATIVO,BORDA,SEGURANCA,NAVEGACAO. prioridade ∈ ALTA,MEDIA,BAIXA.
Responda APENAS um array JSON: [{"tipo":"","titulo":"","prioridade":"","dado":[],"quando":[],"entao":[],"dadosTeste":{}}]`

async function generate(screenName: string, url: string, fields: FieldInfo[], buttons: string[], tabs: TabInfo[]): Promise<GenScenario[]> {
  const fieldLines = fields.map(f => `- ${f.tag} type=${f.type} name="${f.name}" id="${f.id}" label="${f.label}"`).join('\n')
  const prompt = `TELA: ${screenName}
URL: ${url}

CAMPOS:
${fieldLines || '(nenhum campo de formulário detectado)'}

BOTÕES: ${buttons.join(', ') || '(nenhum)'}
ABAS: ${tabs.map(t => t.text).join(', ') || '(nenhuma)'}

Gere entre 8 e 14 cenários cobrindo positivo, negativo, borda, segurança e navegação entre abas.`

  try {
    const raw = await getProvider().discover({ systemPrompt: SYSTEM_PROMPT, userPrompt: prompt, maxTokens: 8192 })
    return parseScenariosRobust(raw.text)
  } catch (err) {
    console.log(`      ✗ IA: ${(err as Error).message}`)
    return []
  }
}

/** Parser tolerante: tenta o array inteiro; se truncou, salva os objetos completos. */
function parseScenariosRobust(text: string): GenScenario[] {
  const cleaned = text.replace(/```json\s*|\s*```/g, '').trim()
  const start = cleaned.indexOf('[')
  const body = start >= 0 ? cleaned.slice(start) : cleaned
  try {
    const end = body.lastIndexOf(']')
    if (end > 0) return (JSON.parse(body.slice(0, end + 1)) as GenScenario[]).filter(s => s.titulo)
  } catch {
    // cai pro salvamento por objeto
  }
  const out: GenScenario[] = []
  for (const obj of extractTopLevelObjects(body)) {
    try {
      const s = JSON.parse(obj) as GenScenario
      if (s.titulo) out.push(s)
    } catch {
      // objeto incompleto — ignora
    }
  }
  return out
}

/** Extrai objetos {...} de nível superior, respeitando strings e aninhamento. */
function extractTopLevelObjects(s: string): string[] {
  const objs: string[] = []
  let depth = 0
  let start = -1
  let inStr = false
  let esc = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') { if (depth === 0) start = i; depth++ }
    else if (c === '}') { depth--; if (depth === 0 && start >= 0) { objs.push(s.slice(start, i + 1)); start = -1 } }
  }
  return objs
}

function toFeature(title: string, scenarios: GenScenario[]): string {
  const lines = ['# language: pt', `Funcionalidade: ${title}`, '']
  for (const s of scenarios) {
    lines.push(`  @${slug(s.tipo)} @${slug(s.prioridade)}`)
    lines.push(`  Cenário: ${s.titulo}`)
    for (const d of s.dado ?? []) lines.push(`    Dado ${d}`)
    ;(s.quando ?? []).forEach((q, i) => lines.push(`    ${i === 0 ? 'Quando' : 'E'} ${q}`))
    ;(s.entao ?? []).forEach((e, i) => lines.push(`    ${i === 0 ? 'Então' : 'E'} ${e}`))
    if (s.dadosTeste && Object.keys(s.dadosTeste).length) lines.push(`    # dados: ${Object.entries(s.dadosTeste).map(([k, v]) => `${k}=${v}`).join(', ')}`)
    lines.push('')
  }
  return lines.join('\n')
}

function toContextMd(name: string, url: string, fields: FieldInfo[], buttons: string[], tabs: TabInfo[]): string {
  const l = [`# Tela: ${name}`, '', `**URL:** ${url}`, '']
  l.push('## Campos', ...(fields.length ? fields.map(f => `- ${f.label || f.name || f.id} (${f.tag}/${f.type})`) : ['- (nenhum detectado)']), '')
  l.push('## Abas', ...(tabs.length ? tabs.map(t => `- ${t.text}`) : ['- (nenhuma)']), '')
  l.push('## Botões', ...(buttons.length ? buttons.map(b => `- ${b}`) : ['- (nenhum)']), '')
  l.push('## Dependências', '- (a preencher)', '')
  return l.join('\n')
}

function toScenariosMd(name: string, scenarios: GenScenario[]): string {
  const l = [`# Cenários — ${name}`, '']
  const byTipo = new Map<string, GenScenario[]>()
  for (const s of scenarios) {
    const k = (s.tipo || 'GERAL').toUpperCase()
    if (!byTipo.has(k)) byTipo.set(k, [])
    byTipo.get(k)!.push(s)
  }
  for (const [tipo, list] of byTipo) {
    l.push(`## ${tipo}`, '')
    for (const s of list) {
      l.push(`### ${s.titulo}  _(prioridade: ${s.prioridade || 'n/d'})_`)
      for (const d of s.dado ?? []) l.push(`- **Dado** ${d}`)
      for (const q of s.quando ?? []) l.push(`- **Quando** ${q}`)
      for (const e of s.entao ?? []) l.push(`- **Então** ${e}`)
      if (s.dadosTeste && Object.keys(s.dadosTeste).length) l.push(`- _dados:_ ${Object.entries(s.dadosTeste).map(([k, v]) => `${k}=${v}`).join(', ')}`)
      l.push('')
    }
  }
  return l.join('\n')
}

function norm(s: string): string { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase() }
function slug(s: string): string { return norm(s || 'geral').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') }

if (require.main === module) {
  const args = process.argv.slice(2)
  const headed = args.includes('--headed')
  const fill = args.includes('--fill')
  const pos = args.filter(a => !a.startsWith('--'))
  const url = pos[0]
  const screenName = pos.slice(1).join(' ')
  if (!url || !screenName) {
    console.error('Uso: ts-node src/discovery/screenTest.ts <url> "<Nome da Tela>" [--headed] [--fill]')
    process.exit(1)
  }
  testScreen(url, screenName, { headed, fill })
    .then(r => console.log(`\n✓ Tela "${screenName}": ${r.fields.length} campos, ${r.scenarios.length} cenários → ${r.outDir}`))
    .catch(err => { console.error('Falha:', err.message); process.exit(1) })
}
