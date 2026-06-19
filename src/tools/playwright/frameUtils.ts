import type { Frame, Locator, Page } from '@playwright/test'

export interface FrameMatch {
  locator: Locator
  frame: Frame
  frameUrl: string
  selector: string
}

export interface FrameContext {
  frame: Frame
  frameUrl: string
  index: number
}

export async function activeFrames(page: Page): Promise<FrameContext[]> {
  const frames = page.frames()
  const contexts: FrameContext[] = []

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    const frameUrl = frame.url()
    if (!frameUrl || frameUrl === 'about:blank') continue
    contexts.push({ frame, frameUrl, index: i })
  }

  return contexts
}

export async function findInFrames(
  page: Page,
  selectors: string[],
  preferredFrame?: Frame,
  timeout = 700
): Promise<FrameMatch | null> {
  const allFrames = page.frames().filter(frame => frame.url() && frame.url() !== 'about:blank')
  const ordered = preferredFrame
    ? [preferredFrame, ...allFrames.filter(frame => frame !== preferredFrame)]
    : allFrames

  for (const frame of ordered) {
    for (const selector of selectors) {
      try {
        const locator = frame.locator(selector).first()
        if (await locator.isVisible({ timeout }).catch(() => false)) {
          return { locator, frame, frameUrl: frame.url(), selector }
        }
      } catch {
        // Frames in no-code/ERP systems can be replaced while we inspect them.
      }
    }
  }

  return null
}

export async function countVisibleInFrames(page: Page, selectors: string[]): Promise<number> {
  let total = 0

  for (const { frame } of await activeFrames(page)) {
    for (const selector of selectors) {
      try {
        const locators = frame.locator(selector)
        const count = await locators.count()
        for (let i = 0; i < count; i++) {
          if (await locators.nth(i).isVisible().catch(() => false)) total++
        }
      } catch {
        // Ignore transient frame access errors.
      }
    }
  }

  return total
}

export async function waitForAnyFrameSelector(
  page: Page,
  selectors: string[],
  timeoutMs = 30_000
): Promise<FrameMatch | null> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const match = await findInFrames(page, selectors, undefined, 250)
    if (match) return match
    await page.waitForTimeout(300)
  }

  return null
}

export async function hasLoginFields(page: Page): Promise<boolean> {
  const password = await findInFrames(page, ['input[type="password"]'], undefined, 250)
  return !!password
}

export interface GotoResult {
  /** true se navegou sem erro E não ficou em about:blank */
  ok: boolean
  /** a URL efetivamente usada (com protocolo normalizado) */
  url: string
  /** mensagem do erro de navegação, quando houve */
  error?: string
  /** true se a página ficou em about:blank após o goto */
  blank: boolean
}

/**
 * Navega de forma robusta e diagnosticável. Resolve dois problemas que antes
 * deixavam o browser em about:blank silenciosamente:
 *   1. URL sem protocolo → assume https:// (page.goto rejeita sem ele).
 *   2. erro de goto engolido → aqui é logado, e devolvido em GotoResult.
 *
 * Não lança: devolve o resultado para o chamador decidir. Usado por todos os
 * fluxos que abrem um alvo (register/crud, screen, navigate, explore, maker).
 */
export async function gotoSmart(
  page: Page,
  url: string,
  opts: { timeout?: number; waitUntil?: 'domcontentloaded' | 'load' | 'networkidle' } = {}
): Promise<GotoResult> {
  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`
  const err = await page
    .goto(target, { waitUntil: opts.waitUntil ?? 'domcontentloaded', timeout: opts.timeout ?? 60_000 })
    .then(() => null)
    .catch((e: Error) => e)
  if (err) console.warn(`      ⚠️ navegação falhou para ${target}: ${err.message}`)
  const blank = page.url() === 'about:blank'
  if (blank) {
    console.warn(`      ⚠️ página em about:blank após goto — URL inacessível? (VPN ligada? URL correta?) Alvo: ${target}`)
  }
  return { ok: !err && !blank, url: target, error: err?.message, blank }
}

