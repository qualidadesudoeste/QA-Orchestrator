/**
 * makerSession — blocos reutilizáveis para operar QUALQUER sistema (Maker ou
 * web comum) de forma autônoma e SEM IA externa nas decisões mecânicas.
 *
 * É a base compartilhada do CRUD: `register` (Create) e `crud` (Read/Update/
 * Delete) usam estas funções, para não duplicar lógica de login, navegação,
 * formulário e confirmação. Toda heurística aqui é genérica (vale p/ vários
 * sistemas); quando um sistema novo não casar, melhora-se AQUI, não com remendo.
 */

import type { Browser, Frame, Page } from '@playwright/test'
import { findInFrames, waitForAnyFrameSelector, gotoSmart } from '../tools/playwright/frameUtils'
import type { SystemProfile } from './systemProfile'

export const INCLUDE_HINTS = /inclui|incluir|novo|nova|adicionar|cadastrar|inserir|\+/i
export const SAVE_HINTS = /salvar|gravar|confirmar|concluir|finalizar|^ok$/i
export const SUCCESS_HINTS = /sucesso|salvo|gravad|inclu[íi]d|cadastrad|registrad|exclu[íi]d|removid|atualizad|realizada com/i
export const EDIT_HINTS = /editar|alterar|atualizar|modificar|edit/i
export const DELETE_HINTS = /excluir|remover|apagar|deletar|delete/i
export const CONFIRM_HINTS = /^sim$|confirmar|^confirma$|^ok$|excluir|remover|^apagar$/i

export function norm(s: string): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

export function selectorsFromProfile(profile: SystemProfile | null) {
  return {
    user: profile?.login?.usernameSelectors ?? ['input[type="text"]', 'input[type="email"]'],
    pass: profile?.login?.passwordSelectors ?? ['input[type="password"]'],
    submit: profile?.login?.submitSelectors ?? [],
  }
}

/** Loga (frame-aware) usando o perfil + Enter como fallback quando não há botão. */
export async function loginToSystem(
  page: Page,
  url: string,
  sel: { user: string[]; pass: string[]; submit: string[] }
): Promise<boolean> {
  const user = process.env.APP_USERNAME
  const pass = process.env.APP_PASSWORD
  if (!user || !pass) throw new Error('APP_USERNAME / APP_PASSWORD ausentes no .env')

  await gotoSmart(page, url, { timeout: 60_000 })
  await waitForAnyFrameSelector(page, [...sel.user, ...sel.pass], 45_000)

  const u = await findInFrames(page, sel.user)
  if (!u) return false
  await u.locator.fill(user)
  const p = await findInFrames(page, sel.pass, u.frame)
  if (p) await p.locator.fill(pass)
  const s = sel.submit.length ? await findInFrames(page, sel.submit, u.frame) : null
  if (s) await s.locator.click().catch(() => {})
  else if (p) await p.locator.press('Enter').catch(() => {})

  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000)
    if (!(await findInFrames(page, sel.pass, undefined, 400))) return true
  }
  return false
}

/** Abre a tela pelo nome do menu: expande grupos colapsados e clica no item-folha. */
export async function openScreen(page: Page, screenName: string): Promise<boolean> {
  const want = norm(screenName)
  if (await clickByText(page, want)) return true
  for (const frame of page.frames()) {
    const toggles = await frame.locator('a[href^="#Menu-submenu"], [onclick*="submenu" i], [aria-expanded="false"]').all().catch(() => [])
    for (const t of toggles) if (await t.isVisible().catch(() => false)) await t.click().catch(() => {})
  }
  await page.waitForTimeout(1500)
  return clickByText(page, want)
}

export async function clickByText(page: Page, want: string): Promise<boolean> {
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

/** Aciona Incluir/Novo (texto, title/aria, ícone +). */
export async function clickInclude(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    const els = await frame.locator('button, a, input[type="button"], input[type="submit"], [role="button"], [onclick]').all().catch(() => [])
    for (const e of els) {
      if (!(await e.isVisible().catch(() => false))) continue
      const text = ((await e.innerText().catch(() => '')) || '').trim()
      const value = (await e.getAttribute('value').catch(() => '')) || ''
      const title = (await e.getAttribute('title').catch(() => '')) || ''
      const aria = (await e.getAttribute('aria-label').catch(() => '')) || ''
      if (INCLUDE_HINTS.test(`${text} ${value} ${title} ${aria}`)) {
        await e.click().catch(() => {})
        return true
      }
    }
  }
  for (const frame of page.frames()) {
    const e = frame.locator('[class*="add" i], [class*="incluir" i], [class*="novo" i], i[class*="plus" i]').first()
    if (await e.isVisible().catch(() => false)) {
      await e.click().catch(() => {})
      return true
    }
  }
  return false
}

/** Escolhe o frame com o formulário (mais inputs visíveis). */
export async function pickFormFrame(page: Page): Promise<Frame> {
  let best: { frame: Frame; count: number } | null = null
  for (const frame of page.frames()) {
    if (!frame.url() || frame.url() === 'about:blank') continue
    const count = await frame.locator('input:visible, select:visible, textarea:visible').count().catch(() => 0)
    if (!best || count > best.count) best = { frame, count }
  }
  return best?.frame ?? page.mainFrame()
}

export function sampleValue(type: string, label: string, token: string): string {
  if (type === 'email' || /email|e-mail/.test(label)) return `qa.${Date.now()}@exemplo.com`
  if (type === 'number' || /valor|qtd|quantidade|numero|preco|preço/.test(label)) return '10'
  if (type === 'date' || /data|nascimento|venc/.test(label)) return '2026-12-31'
  if (type === 'tel' || /telefone|celular|fone/.test(label)) return '71999990000'
  return token
}

/** Preenche os campos editáveis com dados de teste; retorna quantos. */
export async function fillForm(frame: Frame, token: string): Promise<number> {
  const inputs = await frame.locator('input, select, textarea').all().catch(() => [])
  let filled = 0
  for (const h of inputs) {
    if (!(await h.isVisible().catch(() => false))) continue
    if (!(await h.isEnabled().catch(() => false))) continue
    const tag = (await h.evaluate(el => el.tagName.toLowerCase()).catch(() => 'input')) ?? 'input'
    const type = ((await h.getAttribute('type').catch(() => '')) ?? '').toLowerCase()
    if (['hidden', 'submit', 'button', 'image', 'reset'].includes(type)) continue
    const label = ((await h.getAttribute('title').catch(() => '')) || (await h.getAttribute('placeholder').catch(() => '')) || (await h.getAttribute('name').catch(() => '')) || '').toLowerCase()
    try {
      if (tag === 'select') await h.selectOption({ index: 1 }).catch(() => {})
      else if (type === 'checkbox' || type === 'radio') await h.check().catch(() => {})
      else await h.fill(sampleValue(type, label, token)).catch(() => {})
      filled++
    } catch {
      // campo não preenchível — segue em frente (autonomia, sem travar)
    }
  }
  return filled
}

/** Aciona Salvar/Gravar — inclusive quando é só um ícone (disquete). */
export async function clickSave(page: Page): Promise<boolean> {
  const iconSel = [
    '[title*="salvar" i]', '[aria-label*="salvar" i]', '[title*="gravar" i]',
    '[onclick*="salvar" i]', '[onclick*="gravar" i]', '[onclick*="save" i]',
    '[class*="salvar" i]', '[class*="fa-save"]', '[class*="fa-floppy"]',
    '[class*="floppy" i]', '[class*="disk" i]', 'button[type="submit"]',
  ]
  for (const frame of page.frames()) {
    for (const sel of iconSel) {
      const e = frame.locator(sel).first()
      if (await e.isVisible().catch(() => false)) { await e.click().catch(() => {}); return true }
    }
  }
  for (const frame of page.frames()) {
    const els = await frame.locator('button, a, input[type="button"], input[type="submit"], [role="button"], [onclick]').all().catch(() => [])
    for (const e of els) {
      if (!(await e.isVisible().catch(() => false))) continue
      const text = ((await e.innerText().catch(() => '')) || '').trim()
      const value = (await e.getAttribute('value').catch(() => '')) || ''
      const title = (await e.getAttribute('title').catch(() => '')) || ''
      const aria = (await e.getAttribute('aria-label').catch(() => '')) || ''
      if (SAVE_HINTS.test(`${text} ${value} ${title} ${aria}`)) { await e.click().catch(() => {}); return true }
    }
  }
  return false
}

/**
 * Confirma sucesso de forma robusta ao retorno FRACO do Maker (busca de várias
 * formas — o aviso pode ser só um mínimo no canto, varia por versão):
 *   (a) toast/alerta com texto de sucesso
 *   (a2) varredura do texto visível (pega aviso de canto sem classe previsível)
 *   (b) token numa célula de grade
 *   (c) o form limpou (o token que digitamos sumiu dos inputs)
 */
export async function detectSuccess(page: Page, token: string): Promise<boolean> {
  for (const frame of page.frames()) {
    const alerts = await frame
      .locator('[class*="toast" i], [class*="alert" i], [class*="notif" i], [class*="mensagem" i], [class*="message" i], [class*="growl" i], [class*="snackbar" i], [role="alert"], [role="status"]')
      .allInnerTexts().catch(() => [] as string[])
    if (alerts.some(t => SUCCESS_HINTS.test(t))) return true

    const bodyText = await frame.locator('body').innerText({ timeout: 1000 }).catch(() => '')
    if (SUCCESS_HINTS.test(bodyText)) return true

    if (token) {
      const cells = await frame.locator('td, [role="gridcell"], [class*="cell" i]').allInnerTexts().catch(() => [] as string[])
      if (cells.some(c => c.includes(token))) return true
    }
  }
  if (token) {
    let tokenStillInForm = false
    for (const frame of page.frames()) {
      const values = await frame.locator('input:visible, textarea:visible').evaluateAll((els: any[]) => els.map(el => el.value || '')).catch(() => [] as string[])
      if (values.some(v => v.includes(token))) { tokenStillInForm = true; break }
    }
    if (!tokenStillInForm) return true
  }
  return false
}

// ── Operações de GRADE (Localizar) para Read/Update/Delete ──────────────────

/** Digita um termo na busca da Localizar e dispara (Enter + ícone de busca). */
export async function searchInGrid(page: Page, term: string): Promise<boolean> {
  const searchSel = [
    'input[placeholder*="buscar" i]', 'input[placeholder*="pesquis" i]', 'input[placeholder*="search" i]',
    'input[aria-label*="buscar" i]', 'input[type="search"]',
  ]
  const m = await findInFrames(page, searchSel, undefined, 800)
  if (!m) return false
  await m.locator.fill(term).catch(() => {})
  await m.locator.press('Enter').catch(() => {})
  await page.waitForTimeout(2000)
  return true
}

/**
 * Reverificação DEFINITIVA pós-Create/Update: reabre a tela (volta à Localizar),
 * filtra pelo token e conta as linhas que o contêm. É a prova independente de
 * que o registro está mesmo persistido na grade — não confia só no retorno
 * fraco do Maker (toast/form-limpo). Retorna quantas linhas casaram (>0 = ok).
 */
export async function reopenAndCount(page: Page, screenName: string, token: string): Promise<number> {
  await openScreen(page, screenName).catch(() => false)
  await page.waitForTimeout(2500)
  await searchInGrid(page, token).catch(() => false)
  await page.waitForTimeout(1500)
  return countRowsWithToken(page, token)
}

/** Conta linhas da grade cujo texto contém o token (registros do agente). */
export async function countRowsWithToken(page: Page, token: string): Promise<number> {
  let total = 0
  for (const frame of page.frames()) {
    const rows = await frame.locator('tr, [role="row"], [class*="row" i]').all().catch(() => [])
    for (const r of rows) {
      const t = (await r.innerText().catch(() => '')) || ''
      if (t.includes(token)) total++
    }
  }
  return total
}

/**
 * Acha a 1ª linha da grade que contém o token e clica a ação pedida (editar/
 * excluir) DENTRO dessa linha. Só atua em linhas com o token => seguro.
 */
export async function clickRowAction(page: Page, token: string, kind: 'edit' | 'delete'): Promise<boolean> {
  const hints = kind === 'edit' ? EDIT_HINTS : DELETE_HINTS
  const iconSel = kind === 'edit'
    ? '[title*="edit" i], [title*="alter" i], [class*="edit" i], [class*="pencil" i], [class*="fa-pencil"], [class*="fa-edit"], a, button'
    : '[title*="exclu" i], [title*="remov" i], [title*="delet" i], [class*="delet" i], [class*="remov" i], [class*="trash" i], [class*="lixeira" i], [class*="fa-trash"], a, button'

  for (const frame of page.frames()) {
    const rows = await frame.locator('tr, [role="row"]').all().catch(() => [])
    for (const r of rows) {
      const t = (await r.innerText().catch(() => '')) || ''
      if (!t.includes(token)) continue
      // dentro da linha do token, procura o controle de ação
      const controls = await r.locator(iconSel).all().catch(() => [])
      for (const c of controls) {
        if (!(await c.isVisible().catch(() => false))) continue
        const title = (await c.getAttribute('title').catch(() => '')) || ''
        const aria = (await c.getAttribute('aria-label').catch(() => '')) || ''
        const cls = (await c.getAttribute('class').catch(() => '')) || ''
        const text = ((await c.innerText().catch(() => '')) || '').trim()
        const hay = `${title} ${aria} ${cls} ${text}`
        if (hints.test(hay) || (kind === 'delete' && /trash|lixeira|remov|delet|exclu/i.test(cls)) || (kind === 'edit' && /pencil|edit|alter/i.test(cls))) {
          await c.click().catch(() => {})
          await page.waitForTimeout(1500)
          return true
        }
      }
    }
  }
  return false
}

/**
 * Confirma um diálogo de exclusão (modal "Confirma a exclusão?" com Ok/Sim/
 * Confirmar). Espera o modal renderizar (poll) e NUNCA clica em Cancelar/Não.
 * Prioriza o botão de confirmação por ordem de rótulo.
 */
export async function confirmDialog(page: Page, timeoutMs = 7000): Promise<boolean> {
  // Botões de confirmação aceitos, em ordem de prioridade. "Cancelar"/"Não"
  // não aparecem aqui de propósito (segurança).
  const labels = [/^ok$/i, /^sim$/i, /^confirmar$/i, /^confirmo$/i, /^prosseguir$/i, /^continuar$/i, /^excluir$/i, /^remover$/i]
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const re of labels) {
      for (const frame of page.frames()) {
        const els = await frame.locator('button, a, input[type="button"], input[type="submit"], [role="button"], [class*="confirm" i], [class*="swal" i] button, span, div').all().catch(() => [])
        for (const e of els) {
          if (!(await e.isVisible().catch(() => false))) continue
          const text = ((await e.innerText().catch(() => '')) || '').trim()
          const value = (await e.getAttribute('value').catch(() => '')) || ''
          const label = (text || value).trim()
          if (label.length > 0 && label.length <= 15 && re.test(label)) {
            await e.click().catch(() => {})
            return true
          }
        }
      }
    }
    await page.waitForTimeout(400)
  }
  return false
}
