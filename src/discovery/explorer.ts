/**
 * Explorer — a metade SEM IA da descoberta (Fase B1).
 *
 * Abre QUALQUER URL com o Playwright, varre todos os frames e coleta os
 * candidatos brutos: inputs (nome, id, tipo, placeholder, label) e botões.
 * Também detecta páginas de bloqueio (Cloudflare/erro de origem) para não
 * confundir uma tela quebrada com "não tem login".
 *
 * Esse material é o que, na Fase B2, será enviado ao Claude para ele decidir
 * "o campo de usuário é X, a senha é Y". Aqui não há nenhuma inteligência:
 * é coleta pura. Por isso roda sem ANTHROPIC_API_KEY e sem créditos.
 *
 * Self-contained: não importa @config/environments nem @utils/logger.
 */

import { chromium } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { computeFingerprint, idFromUrl } from './systemProfile'
import { evidencesDir, resolveCode } from '../knowledge/layout'

export interface InputCandidate {
  frameUrl: string
  name: string
  id: string
  type: string
  placeholder: string
  ariaLabel: string
  visible: boolean
}

export interface ButtonCandidate {
  frameUrl: string
  text: string
  type: string
  id: string
  name: string
  visible: boolean
}

export interface BlockedInfo {
  reason: string
  evidence: string
}

export interface ExplorationResult {
  url: string
  finalUrl: string
  title: string
  frameCount: number
  inputs: InputCandidate[]
  buttons: ButtonCandidate[]
  screenshotPath: string
  /** Assinatura estrutural da tela — alimenta a detecção de mudança (Fase E). */
  fingerprint: string
  /** Preenchido quando a página é um bloqueio/erro em vez do app real. */
  blocked?: BlockedInfo
}

export interface ExploreOptions {
  headless?: boolean
  /** Tempo máximo esperando a tela estabilizar (ms). */
  settleMs?: number
  screenshotDir?: string
}

const BLOCK_SIGNATURES: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /connection timed out|error code\s*5\d\d/i, reason: 'Origem fora do ar (erro 5xx)' },
  { pattern: /just a moment|checking your browser|cf-browser-verification/i, reason: 'Desafio anti-bot Cloudflare' },
  { pattern: /access denied|forbidden|403 forbidden/i, reason: 'Acesso negado (403)' },
  { pattern: /attention required.*cloudflare/i, reason: 'Bloqueio Cloudflare' },
]

/** Abre uma URL e coleta tudo que parece campo/botão em todos os frames. */
export async function explore(url: string, opts: ExploreOptions = {}): Promise<ExplorationResult> {
  const settleMs = opts.settleMs ?? 4000
  const screenshotDir = opts.screenshotDir ?? evidencesDir(resolveCode(url), 'discovery')
  fs.mkdirSync(screenshotDir, { recursive: true })

  let browser: Browser | null = null
  try {
    browser = await chromium.launch({ headless: opts.headless ?? true })
    const context = await browser.newContext({ locale: 'pt-BR' })
    const page = await context.newPage()

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null)
    await page.waitForTimeout(settleMs)

    const title = await page.title().catch(() => '')
    const screenshotPath = path.join(screenshotDir, `${idFromUrl(url)}.png`)
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {})

    const blocked = await detectBlock(page, title)

    const inputs: InputCandidate[] = []
    const buttons: ButtonCandidate[] = []

    for (const frame of page.frames()) {
      const frameUrl = frame.url()
      if (!frameUrl || frameUrl === 'about:blank') continue

      // Inputs candidatos
      try {
        const handles = await frame.locator('input, textarea, select').all()
        for (const h of handles) {
          inputs.push({
            frameUrl,
            name: (await h.getAttribute('name').catch(() => '')) ?? '',
            id: (await h.getAttribute('id').catch(() => '')) ?? '',
            type: (await h.getAttribute('type').catch(() => '')) ?? 'text',
            placeholder: (await h.getAttribute('placeholder').catch(() => '')) ?? '',
            ariaLabel: (await h.getAttribute('aria-label').catch(() => '')) ?? '',
            visible: await h.isVisible().catch(() => false),
          })
        }
      } catch {
        // Frame pode ser substituído enquanto inspecionamos (comum em ERPs).
      }

      // Botões candidatos
      try {
        const handles = await frame
          .locator('button, input[type="submit"], input[type="button"], [role="button"]')
          .all()
        for (const h of handles) {
          buttons.push({
            frameUrl,
            text: ((await h.innerText().catch(() => '')) || (await h.getAttribute('value').catch(() => '')) || '').trim().slice(0, 60),
            type: (await h.getAttribute('type').catch(() => '')) ?? '',
            id: (await h.getAttribute('id').catch(() => '')) ?? '',
            name: (await h.getAttribute('name').catch(() => '')) ?? '',
            visible: await h.isVisible().catch(() => false),
          })
        }
      } catch {
        // idem
      }
    }

    const fingerprint = computeFingerprint([
      ...inputs.map(i => `in:${i.name}:${i.id}:${i.type}`),
      ...buttons.map(b => `bt:${b.text}:${b.type}`),
    ])

    return {
      url,
      finalUrl: page.url(),
      title,
      frameCount: page.frames().length,
      inputs,
      buttons,
      screenshotPath,
      fingerprint,
      ...(blocked ? { blocked } : {}),
    }
  } finally {
    await browser?.close().catch(() => {})
  }
}

async function detectBlock(page: Page, title: string): Promise<BlockedInfo | undefined> {
  let bodyText = ''
  try {
    bodyText = await page.locator('body').innerText({ timeout: 1500 })
  } catch {
    // sem body acessível
  }
  const haystack = `${title}\n${bodyText}`
  for (const { pattern, reason } of BLOCK_SIGNATURES) {
    const match = haystack.match(pattern)
    if (match) return { reason, evidence: match[0] }
  }
  return undefined
}

// CLI: `ts-node src/discovery/explorer.ts <url> [--headed]`
if (require.main === module) {
  const url = process.argv[2]
  const headed = process.argv.includes('--headed')
  if (!url) {
    console.error('Uso: ts-node src/discovery/explorer.ts <url> [--headed]')
    process.exit(1)
  }
  explore(url, { headless: !headed })
    .then(r => {
      console.log(`\n=== Exploração: ${r.url} ===`)
      console.log(`Título: ${r.title || '(vazio)'}`)
      console.log(`URL final: ${r.finalUrl}`)
      console.log(`Frames: ${r.frameCount} | inputs: ${r.inputs.length} | botões: ${r.buttons.length}`)
      console.log(`Fingerprint: ${r.fingerprint}`)
      console.log(`Screenshot: ${r.screenshotPath}`)
      if (r.blocked) {
        console.log(`\n⚠️  BLOQUEADO: ${r.blocked.reason} — "${r.blocked.evidence}"`)
      }
      console.log('\nInputs visíveis:')
      for (const i of r.inputs.filter(x => x.visible)) {
        console.log(`  • type=${i.type} name="${i.name}" id="${i.id}" placeholder="${i.placeholder}" aria="${i.ariaLabel}"`)
      }
      console.log('\nBotões visíveis:')
      for (const b of r.buttons.filter(x => x.visible)) {
        console.log(`  • "${b.text}" type=${b.type} id="${b.id}"`)
      }
      console.log()
    })
    .catch(err => {
      console.error('Falha na exploração:', err.message)
      process.exit(1)
    })
}
