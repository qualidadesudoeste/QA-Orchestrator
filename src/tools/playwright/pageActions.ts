import type { Page } from '@playwright/test'
import { logger } from '@utils/logger'
import { testData } from '@utils/testData'
import { maskObject } from '@utils/dataMasking'
import { env, isProduction } from '@config/environments'
import { ScreenMapper } from './screenMapper'
import { FormTester } from './formTester'
import { GridHandler } from './gridHandler'
import { findInFrames } from './frameUtils'
import type { ScreenMap } from './screenMapper'
import type { FormTestResult } from './formTester'
import type { GridTestResult } from './gridHandler'

export interface PageTestSummary {
  url: string
  title: string
  screenMap: ScreenMap
  formResults: FormTestResult[]
  gridResults: GridTestResult[]
  crudResults: CrudResult[]
  filterResults: FilterResult[]
  screenshotPath?: string
}

export interface CrudResult {
  operation: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE'
  passed: boolean
  detail: string
}

export interface FilterResult {
  filter: string
  passed: boolean
  detail: string
}

export class PageActions {
  private mapper: ScreenMapper
  private formTester: FormTester
  private gridHandler: GridHandler

  constructor(private page: Page) {
    this.mapper = new ScreenMapper(page)
    this.formTester = new FormTester(page)
    this.gridHandler = new GridHandler(page)
  }

  async runFullPageTest(): Promise<PageTestSummary> {
    const url = this.page.url()
    logger.info(`Executando teste completo da página: ${url}`)

    await this.page.waitForLoadState('domcontentloaded')

    const screenMap = await this.mapper.map()

    const [formResults, gridResults] = await Promise.all([
      this.formTester.testAll(screenMap),
      this.gridHandler.testAll(screenMap.grids),
    ])

    const crudResults = await this.runCrud(screenMap)
    const filterResults = await this.runFilters(screenMap)

    const screenshotPath = await this.captureEvidence()

    const summary: PageTestSummary = {
      url,
      title: screenMap.title,
      screenMap,
      formResults,
      gridResults,
      crudResults,
      filterResults,
      screenshotPath,
    }

    this.logSummary(summary)
    return summary
  }

  private async runCrud(map: ScreenMap): Promise<CrudResult[]> {
    const results: CrudResult[] = []

    if (isProduction) {
      logger.warn('Produção — operações de escrita ignoradas (somente leitura)')
      results.push({ operation: 'CREATE', passed: true, detail: 'Ignorado em produção' })
      results.push({ operation: 'UPDATE', passed: true, detail: 'Ignorado em produção' })
      results.push({ operation: 'DELETE', passed: true, detail: 'Ignorado em produção' })
      return results
    }

    // READ — always safe
    results.push(await this.testRead(map))

    // CREATE
    const createBtn = this.findButton(map, 'submit')
    if (createBtn) results.push(await this.testCreate(map, createBtn.selector, createBtn.frameUrl))

    // UPDATE — needs existing record in grid
    if (map.grids.some(g => g.rowCount > 0)) {
      results.push(await this.testUpdate(map))
    }

    return results
  }

  private async testRead(map: ScreenMap): Promise<CrudResult> {
    try {
      await this.page.waitForLoadState('domcontentloaded')
      const hasContent =
        map.grids.length > 0 ||
        map.fields.length > 0 ||
        (await this.page.locator('main, [role="main"], #content, .content').count()) > 0

      return {
        operation: 'READ',
        passed: hasContent,
        detail: hasContent ? 'Página carregada com conteúdo identificado' : 'Página sem estrutura reconhecível',
      }
    } catch (err) {
      return { operation: 'READ', passed: false, detail: String(err) }
    }
  }

  private async testCreate(map: ScreenMap, submitSelector: string, frameUrl?: string): Promise<CrudResult> {
    try {
      // Find and click a "New/Add" button first if exists
      const newBtn = await findInFrames(this.page, [
        'button:has-text("Novo")',
        'button:has-text("Adicionar")',
        'button:has-text("Cadastrar")',
        'button:has-text("New")',
        '[aria-label*="novo" i]',
      ])

      if (newBtn) {
        await newBtn.locator.click()
        await this.page.waitForTimeout(600)
      }

      // Fill fields with synthetic data
      const person = testData.person()
      for (const field of map.fields) {
        if (field.type === 'submit' || field.type === 'button') continue
        if (field.type === 'email') {
          await this.locatorFor(field.selector, field.frameUrl).fill(person.email).catch(() => {})
        } else if (field.type === 'tel') {
          await this.locatorFor(field.selector, field.frameUrl).fill(person.phone).catch(() => {})
        } else if (field.type === 'select') {
          await this.locatorFor(field.selector, field.frameUrl).selectOption({ index: 1 }).catch(() => {})
        } else if (field.type === 'checkbox') {
          await this.locatorFor(field.selector, field.frameUrl).check().catch(() => {})
        } else {
          const value = testData.text.short()
          await this.locatorFor(field.selector, field.frameUrl).fill(value).catch(() => {})
        }
      }

      const urlBefore = this.page.url()
      await this.locatorFor(submitSelector, frameUrl).click()
      await this.page.waitForTimeout(1000)

      const urlAfter = this.page.url()
      const hasSuccess =
        urlBefore !== urlAfter ||
        (await this.page.locator('[class*="success"], [class*="sucesso"], [role="alert"]').count()) > 0

      return {
        operation: 'CREATE',
        passed: hasSuccess,
        detail: hasSuccess ? 'Registro criado (redirecionamento ou mensagem de sucesso)' : 'ATENÇÃO: sem feedback de sucesso após submit',
      }
    } catch (err) {
      return { operation: 'CREATE', passed: false, detail: String(err) }
    }
  }

  private async testUpdate(map: ScreenMap): Promise<CrudResult> {
    try {
      const editBtn = this.page.locator(
        'button[aria-label*="editar"], button[title*="editar"], button:has-text("Editar"), [aria-label*="edit"]'
      ).first()

      if ((await editBtn.count()) === 0) {
        return { operation: 'UPDATE', passed: true, detail: 'Botão de edição não encontrado nesta tela' }
      }

      await editBtn.click()
      await this.page.waitForTimeout(600)

      // Modify first text field
      const textField = map.fields.find(f => f.type === 'text' || f.type === 'textarea')
      if (textField) {
        const newValue = testData.text.short()
        await this.locatorFor(textField.selector, textField.frameUrl).fill(newValue)
      }

      const saveBtn = this.page.locator('button[type="submit"], button:has-text("Salvar"), button:has-text("Confirmar")').first()
      await saveBtn.click()
      await this.page.waitForTimeout(800)

      const hasSuccess = (await this.page.locator('[class*="success"], [class*="sucesso"]').count()) > 0
      return {
        operation: 'UPDATE',
        passed: hasSuccess,
        detail: hasSuccess ? 'Edição salva com feedback de sucesso' : 'ATENÇÃO: sem feedback após salvar edição',
      }
    } catch (err) {
      return { operation: 'UPDATE', passed: false, detail: String(err) }
    }
  }

  private async runFilters(map: ScreenMap): Promise<FilterResult[]> {
    const results: FilterResult[] = []

    if (map.filters.length === 0) return results

    for (const filter of map.filters.slice(0, 3)) {
      try {
        await this.locatorFor(filter.selector, filter.frameUrl).fill(testData.text.short())
        await this.page.keyboard.press('Enter')
        await this.page.waitForTimeout(600)

        results.push({
          filter: filter.label,
          passed: true,
          detail: 'Filtro aplicado sem erros',
        })

        // Clear filter
        await this.locatorFor(filter.selector, filter.frameUrl).clear()
        await this.page.keyboard.press('Enter')
        await this.page.waitForTimeout(400)
      } catch (err) {
        results.push({ filter: filter.label, passed: false, detail: String(err) })
      }
    }

    return results
  }

  private async captureEvidence(): Promise<string | undefined> {
    try {
      const filename = `screenshot-${Date.now()}.png`
      const filePath = `${env.EVIDENCE_DIR}/screenshots/${filename}`
      await this.page.screenshot({ path: filePath, fullPage: true })
      logger.info(`Evidência capturada: ${filePath}`)
      return filePath
    } catch {
      return undefined
    }
  }

  private findButton(map: ScreenMap, action: string): { selector: string; frameUrl?: string } | undefined {
    const button = map.buttons.find(b => b.action === action)
    return button ? { selector: button.selector, frameUrl: button.frameUrl } : undefined
  }

  private locatorFor(selector: string, frameUrl?: string) {
    const frame = frameUrl ? this.page.frames().find(f => f.url() === frameUrl) : undefined
    return frame ? frame.locator(selector).first() : this.page.locator(selector).first()
  }

  private logSummary(summary: PageTestSummary): void {
    const formPass = summary.formResults.filter(r => r.passed).length
    const formFail = summary.formResults.filter(r => !r.passed).length
    const gridPass = summary.gridResults.filter(r => r.passed).length
    const gridFail = summary.gridResults.filter(r => !r.passed).length
    const crudPass = summary.crudResults.filter(r => r.passed).length
    const crudFail = summary.crudResults.filter(r => !r.passed).length

    logger.info('─── Resumo da Página ───────────────────────────')
    logger.info(`Formulário : ${formPass} ok | ${formFail} falha(s)`)
    logger.info(`Grid       : ${gridPass} ok | ${gridFail} falha(s)`)
    logger.info(`CRUD       : ${crudPass} ok | ${crudFail} falha(s)`)
    logger.info(`Filtros    : ${summary.filterResults.filter(r => r.passed).length} ok`)
    logger.info('────────────────────────────────────────────────')
  }
}
