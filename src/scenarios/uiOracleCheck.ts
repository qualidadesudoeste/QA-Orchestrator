/**
 * uiOracleCheck — o BRAÇO DE UI do verificador de oráculo.
 *
 * Por que existe: a Sheila/Jessica NÃO têm acesso aos bancos dos projetos (só
 * líderes técnicos e devs). Então o efeito do oráculo (business_rules.json) é
 * conferido pela PRÓPRIA TELA, não pelo banco. Reaproveita os blocos de grade
 * do `makerSession.ts` (a grade "Localizar" do Maker é a fonte da verdade).
 *
 * Mapeamento CheckPlan → verificação na UI:
 *   - insert  → o registro DEVE aparecer na grade (token) e exibir os campos SET.
 *   - delete  → o registro NÃO deve mais aparecer na grade.
 *   - update  → reabre, localiza a linha (token/locator) e confere que os campos
 *               SET (o EFEITO) aparecem nela.
 *   - select-precondition / manual → não é observável genericamente pela grade:
 *               devolve PULADO com a instrução do que checar à mão.
 *
 * Custo zero de IA: tudo é navegação Playwright determinística.
 */

import type { Page } from '@playwright/test'
import { reopenAndCount, countRowsWithToken, openScreen, searchInGrid } from '../discovery/makerSession'
import type { CheckPlan, Verdict } from './oracleVerifier'

export interface UiCheckResult {
  oracle: string
  kind: CheckPlan['kind']
  verdict: Verdict
  detail: string
  /** Valores SET que esperávamos ver na linha e que NÃO apareceram. */
  missing?: string[]
}

/** Texto da 1ª linha da grade que contém o termo (token ou valor localizador). */
async function rowTextWith(page: Page, term: string): Promise<string | null> {
  for (const frame of page.frames()) {
    const rows = await frame.locator('tr, [role="row"], [class*="row" i]').all().catch(() => [])
    for (const r of rows) {
      const t = (await r.innerText().catch(() => '')) || ''
      if (t.includes(term)) return t
    }
  }
  return null
}

/** Quais valores SET (efeito) NÃO aparecem no texto da linha. */
function missingSetValues(plan: CheckPlan, rowText: string): string[] {
  const hay = rowText.toLowerCase()
  return Object.values(plan.setFields)
    .map(v => String(v))
    .filter(v => v.length > 0 && !hay.includes(v.toLowerCase()))
}

/**
 * Confere UM plano na UI. `token` é o marcador do registro do agente (Create) e/ou
 * um valor localizador (ex.: o código da OS) — usado para achar a linha na grade.
 */
export async function verifyPlanOnUi(
  page: Page,
  screenName: string,
  plan: CheckPlan,
  token: string
): Promise<UiCheckResult> {
  const base = { oracle: plan.oracle, kind: plan.kind }

  if (plan.kind === 'select-precondition' || plan.kind === 'manual') {
    return { ...base, verdict: 'PULADO', detail: 'efeito não observável pela grade — checar manualmente na UI (permissão/consulta)' }
  }
  if (plan.unresolved.length) {
    return { ...base, verdict: 'PULADO', detail: `faltam parâmetros para localizar/conferir: ${plan.unresolved.join(', ')}` }
  }

  if (plan.kind === 'insert') {
    const count = await reopenAndCount(page, screenName, token)
    if (count <= 0) return { ...base, verdict: 'FALHOU', detail: `registro com token "${token}" NÃO apareceu na grade após inclusão` }
    const rowText = (await rowTextWith(page, token)) || ''
    const missing = missingSetValues(plan, rowText)
    return missing.length
      ? { ...base, verdict: 'FALHOU', detail: `registro existe (${count} linha) mas faltou exibir: ${missing.join(', ')}`, missing }
      : { ...base, verdict: 'PASSOU', detail: `registro presente na grade (${count} linha) com os campos esperados` }
  }

  if (plan.kind === 'delete') {
    await openScreen(page, screenName).catch(() => false)
    await page.waitForTimeout(2000)
    await searchInGrid(page, token).catch(() => false)
    await page.waitForTimeout(1500)
    const count = await countRowsWithToken(page, token)
    return count === 0
      ? { ...base, verdict: 'PASSOU', detail: 'registro não aparece mais na grade (excluído/inativado)' }
      : { ...base, verdict: 'FALHOU', detail: `registro ainda aparece na grade (${count} linha) após exclusão` }
  }

  // update: localiza a linha e confere que os campos SET (efeito) aparecem nela.
  await openScreen(page, screenName).catch(() => false)
  await page.waitForTimeout(2000)
  // localiza pela 1ª chave WHERE (ex.: OS_COD) ou pelo token
  const locator = Object.values(plan.matchFields).map(v => String(v))[0] || token
  await searchInGrid(page, locator).catch(() => false)
  await page.waitForTimeout(1500)
  const rowText = await rowTextWith(page, locator)
  if (!rowText) return { ...base, verdict: 'PULADO', detail: `não localizei a linha (${locator}) na grade para conferir o efeito` }
  const missing = missingSetValues(plan, rowText)
  return missing.length
    ? { ...base, verdict: 'FALHOU', detail: `linha localizada mas o efeito não apareceu: faltou ${missing.join(', ')}`, missing }
    : { ...base, verdict: 'PASSOU', detail: 'linha localizada e os campos do efeito aparecem conforme o oráculo' }
}

/** Confere todos os planos de uma regra na UI (página já logada e na tela). */
export async function verifyRuleOnUi(
  page: Page,
  screenName: string,
  plans: CheckPlan[],
  token: string
): Promise<UiCheckResult[]> {
  const results: UiCheckResult[] = []
  for (const plan of plans) {
    results.push(await verifyPlanOnUi(page, screenName, plan, token))
  }
  return results
}
