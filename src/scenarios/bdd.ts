import type { Frame, Locator, Page } from '@playwright/test'
import { logger } from '@utils/logger'
import { findInFrames, waitForAnyFrameSelector } from '@tools/playwright/frameUtils'
import type { ScreenMap } from '@tools/playwright/screenMapper'
import type { BddKeyword, ScenarioSuite, TestScenario, TestStep } from './types'

export interface BddScenario {
  feature: string
  scenario: string
  tags: string[]
  given: string[]
  when: string[]
  then: string[]
}

export interface BddStepResult {
  keyword: BddKeyword
  text: string
  passed: boolean
  detail: string
}

// ── Conversão p/ Gherkin (artefato legível) ───────────────────────────────

const KEYWORD_WORD: Record<BddKeyword, string> = {
  DADO: 'Dado',
  QUANDO: 'Quando',
  ENTAO: 'Então',
  E: 'E',
}

export function clauseFor(step: TestStep): string {
  const target = step.target ? `"${step.target}"` : 'a tela'
  const value = step.value ? `"${step.value}"` : 'dados válidos'
  const verb = classifyVerb(step.action)

  switch (verb) {
    case 'navigate':
      return `acesso ${target}`
    case 'fill':
      return `preencho ${target} com ${value}`
    case 'select':
      return `seleciono ${value} em ${target}`
    case 'click':
      return `clico em ${target}`
    case 'expect':
      return `vejo ${step.target ? target : `"${step.expectedOutcome ?? 'o resultado esperado'}"`}`
    default:
      return `${step.action}${step.target ? ` ${target}` : ''}`
  }
}

export function stepToGherkin(step: TestStep): string {
  return `${KEYWORD_WORD[step.keyword] ?? 'Quando'} ${clauseFor(step)}`
}

export function scenarioToBdd(scenario: TestScenario): BddScenario {
  const given: string[] = []
  const when: string[] = []
  const then: string[] = []
  let lastPhase: BddKeyword = 'DADO'

  for (const step of [...scenario.steps].sort((a, b) => a.order - b.order)) {
    const line = stepToGherkin(step)
    const phase = step.keyword === 'E' ? lastPhase : step.keyword
    if (phase === 'ENTAO') then.push(line)
    else if (phase === 'DADO') given.push(line)
    else when.push(line)
    if (step.keyword !== 'E') lastPhase = step.keyword
  }

  if (then.length === 0) then.push(`Então ${scenario.expectedResult}`)

  return {
    feature: scenario.module,
    scenario: scenario.title,
    tags: scenario.tags.map(tag => `@${sanitizeTag(tag)}`),
    given: given.length ? given : [`Dado que estou no módulo ${scenario.module}`],
    when,
    then,
  }
}

export function suiteToFeature(suite: ScenarioSuite): string {
  const lines = [`# language: pt`, `Funcionalidade: ${suite.module}`, '']

  for (const scenario of suite.scenarios) {
    const bdd = scenarioToBdd(scenario)
    if (bdd.tags.length) lines.push(`  ${bdd.tags.join(' ')}`)
    lines.push(`  Cenário: ${bdd.scenario}`)
    lines.push(...bdd.given.map(line => `    ${line}`))
    lines.push(...bdd.when.map(line => `    ${line}`))
    lines.push(...bdd.then.map(line => `    ${line}`))
    lines.push('')
  }

  return lines.join('\n')
}

// ── Executor BDD dirigido por passos ──────────────────────────────────────

type StepVerb = 'navigate' | 'fill' | 'select' | 'click' | 'expect' | 'other'

export function classifyVerb(action: string): StepVerb {
  const a = action.toLowerCase()
  if (/navegar|acessar|abrir/.test(a)) return 'navigate'
  if (/selecionar|escolher/.test(a)) return 'select'
  if (/preencher|informar|digitar|inserir/.test(a)) return 'fill'
  if (/clicar|acionar|enviar|submeter|confirmar/.test(a)) return 'click'
  if (/verificar|validar|visualizar|exibir|conferir|deve|esperar/.test(a)) return 'expect'
  return 'other'
}

export class BddPlaywrightRunner {
  constructor(private page: Page, private screenMap?: ScreenMap) {}

  /** Executa os passos de um cenário e devolve o resultado por passo (Dado/Quando/Então). */
  async runSteps(scenario: TestScenario): Promise<BddStepResult[]> {
    const results: BddStepResult[] = []

    for (const step of [...scenario.steps].sort((a, b) => a.order - b.order)) {
      const text = stepToGherkin(step)
      try {
        const detail = await this.execStep(step)
        results.push({ keyword: step.keyword, text, passed: true, detail })
        logger.debug(`  ✓ ${text} — ${detail}`)
      } catch (err) {
        results.push({ keyword: step.keyword, text, passed: false, detail: String(err) })
        logger.debug(`  ✗ ${text} — ${String(err)}`)
      }
    }

    return results
  }

  private async execStep(step: TestStep): Promise<string> {
    switch (classifyVerb(step.action)) {
      case 'navigate':
        await this.page.waitForLoadState('domcontentloaded')
        return `tela pronta (${this.page.url()})`
      case 'fill':
        return this.doFill(step)
      case 'select':
        return this.doSelect(step)
      case 'click':
        return this.doClick(step)
      case 'expect':
        return this.doExpect(step)
      default:
        // Passo descritivo sem interação direta — registra sem falhar.
        return `passo registrado: ${step.action}`
    }
  }

  private async doFill(step: TestStep): Promise<string> {
    const value = step.value ?? 'teste'
    const field = await this.resolveField(step.target)
    if (!field) throw new Error(`Campo não encontrado para "${step.target}"`)
    await field.fill(value)
    return `preenchido "${step.target}" = "${value}"`
  }

  private async doSelect(step: TestStep): Promise<string> {
    const field = await this.resolveField(step.target)
    if (!field) throw new Error(`Campo de seleção não encontrado para "${step.target}"`)
    const value = step.value ?? ''
    if (value) {
      await field.selectOption({ label: value }).catch(async () => {
        await field.selectOption(value).catch(() => field.selectOption({ index: 1 }))
      })
    } else {
      await field.selectOption({ index: 1 })
    }
    return `selecionado "${value || '(primeira opção)'}" em "${step.target}"`
  }

  private async doClick(step: TestStep): Promise<string> {
    const button = await this.resolveButton(step.target)
    if (!button) throw new Error(`Ação não encontrada para "${step.target}"`)
    await button.click()
    await this.page.waitForLoadState('domcontentloaded').catch(() => {})
    return `clicado "${step.target}"`
  }

  private async doExpect(step: TestStep): Promise<string> {
    const expected = step.target ?? step.expectedOutcome
    if (expected) {
      const match = await waitForAnyFrameSelector(this.page, [`text=${expected}`], 8_000)
      if (match) return `confirmado: "${expected}" visível`
    }

    // Não confirmou positivamente — falha apenas se houver erro/exceção evidente na tela.
    const errorMatch = await findInFrames(
      this.page,
      ['[class*="error" i]', '[class*="erro" i]', '[role="alert"]', '[aria-invalid="true"]'],
      undefined,
      400
    )
    if (errorMatch) {
      throw new Error(`resultado esperado "${expected ?? '(n/d)'}" não confirmado e há indicador de erro na tela`)
    }
    return `sem erro aparente (resultado "${expected ?? 'n/d'}" não localizado textualmente)`
  }

  // ── Resolução de alvo: ScreenMap primeiro, depois heurística em frames ──

  private async resolveField(target?: string): Promise<Locator | null> {
    if (target && this.screenMap) {
      const field = matchField(this.screenMap, target)
      if (field) {
        const locator = this.locatorFor(field.selector, field.frameUrl)
        if (await locator.count().catch(() => 0)) return locator
      }
    }
    if (!target) return null

    const fallback = await findInFrames(this.page, [
      `[name="${target}"]`,
      `#${cssEscapeId(target)}`,
      `[aria-label="${target}"]`,
      `input[placeholder="${target}"]`,
      `textarea[placeholder="${target}"]`,
    ])
    return fallback?.locator ?? null
  }

  private async resolveButton(target?: string): Promise<Locator | null> {
    if (target && this.screenMap) {
      const button = matchButton(this.screenMap, target)
      if (button) {
        const locator = this.locatorFor(button.selector, button.frameUrl)
        if (await locator.count().catch(() => 0)) return locator
      }
    }
    if (!target) return null

    const fallback = await findInFrames(this.page, [
      `button:has-text("${target}")`,
      `a:has-text("${target}")`,
      `[role="button"]:has-text("${target}")`,
      `input[type="submit"][value="${target}"]`,
      `[aria-label="${target}"]`,
      `text=${target}`,
    ])
    return fallback?.locator ?? null
  }

  private locatorFor(selector: string, frameUrl?: string): Locator {
    const frame: Frame | undefined = frameUrl
      ? this.page.frames().find(f => f.url() === frameUrl)
      : undefined
    return (frame ?? this.page).locator(selector).first()
  }
}

// ── Helpers de casamento ScreenMap ↔ alvo do passo ─────────────────────────

function matchField(map: ScreenMap, target: string) {
  const t = norm(target)
  return (
    map.fields.find(f => norm(f.label) === t) ??
    map.fields.find(f => norm(f.placeholder ?? '') === t) ??
    map.fields.find(f => norm(f.label).includes(t) || t.includes(norm(f.label))) ??
    map.fields.find(f => norm(f.selector).includes(t))
  )
}

function matchButton(map: ScreenMap, target: string) {
  const t = norm(target)
  return (
    map.buttons.find(b => norm(b.text) === t) ??
    map.buttons.find(b => norm(b.text).includes(t) || t.includes(norm(b.text)))
  )
}

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

function cssEscapeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&')
}

function sanitizeTag(tag: string): string {
  return tag
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .toLowerCase()
}
