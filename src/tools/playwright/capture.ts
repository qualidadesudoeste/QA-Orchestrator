/**
 * capture — utilidades de captura de evidência durante um teste, sem alterar o
 * comportamento da página. Todas as funções aqui são ADITIVAS e isoladas: não
 * dependem de IA e podem ser plugadas em qualquer fluxo (register/crud/runner).
 *
 * Capacidades (adicionadas do mais leve para o mais crítico):
 *   1. attachConsoleCapture — ouvintes passivos de console/erros JS (zero interação).
 *   2. captureFullScreen   — screenshot da tela inteira do Windows (read-only de SO).
 *   3. clickAtCoordinates / clickByBoundingBox — clique por coordenada (age na página;
 *      fallback p/ iframes que não expõem o elemento clicável, ex.: SIGP/Maker).
 *
 * Nenhuma função aqui embute dado de cliente (URL, usuário, tabela, chave): tudo
 * é genérico e recebe os alvos por parâmetro. Evidência sempre por sistema:
 * usar evidencesDir(code, sub) do layout.
 */

import type { Locator, Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import * as path from 'node:path'

// ── 1. Captura de console / erros JavaScript (passiva) ──────────────────────

export type ConsoleSeverity = 'error' | 'warning' | 'info' | 'log'

export interface ConsoleEntry {
  /** error | warning | info | log — mapeado do tipo do console / origem */
  severity: ConsoleSeverity
  /** texto da mensagem (ou do erro não tratado) */
  text: string
  /** origem: 'console' (page.on('console')) ou 'pageerror' (exceção JS) */
  source: 'console' | 'pageerror'
  /** URL onde ocorreu, quando disponível */
  location?: string
  /** ISO timestamp do momento da captura */
  at: string
}

export interface ConsoleCapture {
  /** todas as entradas coletadas, em ordem cronológica */
  readonly entries: ConsoleEntry[]
  /** só erros (severity 'error') — atalho para detectar BUG_FUNCIONAL/VISUAL */
  errors(): ConsoleEntry[]
  /** só warnings */
  warnings(): ConsoleEntry[]
  /** remove os ouvintes (chamar ao fim do fluxo para não vazar handlers) */
  detach(): void
}

/**
 * Liga ouvintes passivos no `page` para coletar mensagens de console e exceções
 * JavaScript não tratadas. NÃO interage com a página — apenas escuta.
 *
 * Uso:
 *   const cap = attachConsoleCapture(page)
 *   ... (fluxo de teste) ...
 *   const errosJs = cap.errors()   // vira evidência de bug
 *   cap.detach()
 */
export function attachConsoleCapture(page: Page): ConsoleCapture {
  const entries: ConsoleEntry[] = []

  const onConsole = (msg: import('@playwright/test').ConsoleMessage) => {
    const type = msg.type()
    const severity: ConsoleSeverity =
      type === 'error' ? 'error'
        : type === 'warning' ? 'warning'
          : type === 'info' ? 'info'
            : 'log'
    const loc = msg.location()
    entries.push({
      severity,
      text: msg.text(),
      source: 'console',
      location: loc?.url ? `${loc.url}:${loc.lineNumber ?? 0}` : undefined,
      at: new Date().toISOString(),
    })
  }

  const onPageError = (err: Error) => {
    entries.push({
      severity: 'error',
      text: err.message || String(err),
      source: 'pageerror',
      location: err.stack?.split('\n')[1]?.trim(),
      at: new Date().toISOString(),
    })
  }

  page.on('console', onConsole)
  page.on('pageerror', onPageError)

  return {
    entries,
    errors: () => entries.filter((e) => e.severity === 'error'),
    warnings: () => entries.filter((e) => e.severity === 'warning'),
    detach: () => {
      page.off('console', onConsole)
      page.off('pageerror', onPageError)
    },
  }
}

// ── 2. Screenshot de tela cheia do Windows (PowerShell + .NET) ──────────────

export interface FullScreenResult {
  ok: boolean
  /** caminho absoluto do PNG salvo (quando ok) */
  path?: string
  /** motivo da falha (quando !ok) */
  error?: string
}

/**
 * Captura a TELA INTEIRA do Windows (todos os monitores — VirtualScreen) via
 * PowerShell + System.Drawing, salvando um PNG em `outPath`.
 *
 * Complementa o `page.screenshot` do Playwright: pega o que está FORA do
 * viewport do browser — diálogos nativos do Windows, popups do SO, o modal de
 * confirmação do Maker quando ele não é capturável pelo DOM, etc.
 *
 * Só roda no Windows (`process.platform === 'win32'`); em outros SOs retorna
 * `{ ok:false }` sem quebrar o fluxo. O caminho vai por env var (SHOT_PATH)
 * para não concatenar caminho dentro do script (evita injeção/escape).
 */
export function captureFullScreen(outPath: string): Promise<FullScreenResult> {
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: false, error: `captureFullScreen só roda no Windows (platform=${process.platform})` })
  }

  const abs = path.resolve(outPath)
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms,System.Drawing;",
    "$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen;",
    "$bmp = New-Object System.Drawing.Bitmap $vs.Width, $vs.Height;",
    "$g = [System.Drawing.Graphics]::FromImage($bmp);",
    "$g.CopyFromScreen($vs.X, $vs.Y, 0, 0, $bmp.Size);",
    "$bmp.Save($env:SHOT_PATH, [System.Drawing.Imaging.ImageFormat]::Png);",
    "$g.Dispose(); $bmp.Dispose();",
  ].join(' ')

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { env: { ...process.env, SHOT_PATH: abs }, windowsHide: true },
      (err) => {
        if (err) resolve({ ok: false, error: err.message })
        else resolve({ ok: true, path: abs })
      },
    )
  })
}

// ── 3. Clique por coordenada (fallback p/ iframe que não expõe o elemento) ──

export interface CoordClickResult {
  ok: boolean
  /** coordenadas (viewport) onde o clique foi disparado, quando ok */
  x?: number
  y?: number
  error?: string
}

/**
 * Clica numa coordenada (x, y) relativa ao VIEWPORT da página. Use quando o
 * Maker/SIGP renderiza dentro de iframe e o elemento não é clicável pelo seletor
 * normal. É a forma mais "bruta": não valida o que há embaixo do ponto — por
 * isso é a capacidade mais crítica deste módulo. Prefira `clickByBoundingBox`
 * quando o elemento existir no DOM (calcula o centro sozinho).
 */
export async function clickAtCoordinates(
  page: Page,
  x: number,
  y: number,
  opts: { button?: 'left' | 'right' | 'middle'; clickCount?: number } = {},
): Promise<CoordClickResult> {
  try {
    await page.mouse.move(x, y)
    await page.mouse.click(x, y, { button: opts.button ?? 'left', clickCount: opts.clickCount ?? 1 })
    return { ok: true, x, y }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Clica no CENTRO do bounding box de um elemento, via coordenadas do mouse.
 * Caso de uso real: o elemento existe no DOM (locator resolve) mas o
 * `.click()` normal é interceptado por overlay/iframe do Maker. Aqui a gente
 * pega a caixa do elemento e clica no meio dela por coordenada.
 *
 * Retorna `ok:false` (sem lançar) se o elemento não tiver caixa visível.
 */
export async function clickByBoundingBox(
  locator: Locator,
  opts: { button?: 'left' | 'right' | 'middle' } = {},
): Promise<CoordClickResult> {
  try {
    const box = await locator.boundingBox()
    if (!box) return { ok: false, error: 'elemento sem boundingBox (invisível ou fora do layout)' }
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await locator.page().mouse.move(x, y)
    await locator.page().mouse.click(x, y, { button: opts.button ?? 'left' })
    return { ok: true, x, y }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
