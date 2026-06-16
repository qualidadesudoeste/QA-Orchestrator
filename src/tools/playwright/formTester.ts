import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { logger } from '@utils/logger'
import { testData } from '@utils/testData'
import { findInFrames } from './frameUtils'
import type { FieldElement, ScreenMap } from './screenMapper'

export interface FormTestResult {
  field: string
  scenario: string
  passed: boolean
  detail: string
}

// Payloads for security testing
const SECURITY_PAYLOADS = {
  sqlInjection: ["' OR '1'='1", "'; DROP TABLE users;--", '" OR ""="', "1' ORDER BY 1--"],
  xss: ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '"><svg onload=alert(1)>'],
  pathTraversal: ['../../../etc/passwd', '..\\..\\windows\\system32'],
}

export class FormTester {
  private results: FormTestResult[] = []

  constructor(private page: Page) {}

  async testAll(map: ScreenMap): Promise<FormTestResult[]> {
    this.results = []

    if (map.fields.length === 0) {
      logger.info('Nenhum campo encontrado na tela para testar')
      return []
    }

    logger.info(`Iniciando testes de formulário — ${map.fields.length} campo(s)`)

    for (const field of map.fields) {
      await this.testRequired(field)
      await this.testMaxLength(field)
      await this.testSpecialChars(field)
      await this.testSQLInjection(field)
      await this.testXSS(field)
    }

    await this.testDuplicateSubmit(map)

    const passed = this.results.filter(r => r.passed).length
    const failed = this.results.filter(r => !r.passed).length
    logger.info(`Formulário — ${passed} passou(aram) | ${failed} falhou(aram)`)

    return this.results
  }

  private async testRequired(field: FieldElement): Promise<void> {
    if (!field.required) return

    try {
      const fieldLocator = this.fieldLocator(field)
      await fieldLocator.clear()

      const submitBtn = await findInFrames(this.page, ['button[type="submit"], [type="submit"]'], this.frameFor(field))
      if (submitBtn) await submitBtn.locator.click()

      // Check for validation message (native or custom)
      const hasError = await this.hasValidationError(field)

      this.results.push({
        field: field.label,
        scenario: 'Obrigatoriedade — campo vazio',
        passed: hasError,
        detail: hasError ? 'Validação exibida corretamente' : 'FALHA: campo obrigatório aceito vazio',
      })
    } catch (err) {
      this.results.push({ field: field.label, scenario: 'Obrigatoriedade', passed: false, detail: String(err) })
    }
  }

  private async testMaxLength(field: FieldElement): Promise<void> {
    if (!field.maxLength || field.type === 'select') return

    try {
      const overLimit = 'A'.repeat(field.maxLength + 10)
      const fieldLocator = this.fieldLocator(field)
      await fieldLocator.fill(overLimit)
      const actualValue = await fieldLocator.inputValue()

      const truncated = actualValue.length <= field.maxLength
      this.results.push({
        field: field.label,
        scenario: `Limite máximo (${field.maxLength} chars)`,
        passed: truncated,
        detail: truncated
          ? `Valor truncado em ${actualValue.length} caracteres`
          : `FALHA: aceitou ${actualValue.length} chars (limite: ${field.maxLength})`,
      })
    } catch (err) {
      this.results.push({ field: field.label, scenario: 'Limite máximo', passed: false, detail: String(err) })
    }
  }

  private async testSpecialChars(field: FieldElement): Promise<void> {
    if (field.type === 'select' || field.type === 'checkbox' || field.type === 'radio') return

    const special = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`'
    try {
      const fieldLocator = this.fieldLocator(field)
      await fieldLocator.fill(special)
      const value = await fieldLocator.inputValue()

      this.results.push({
        field: field.label,
        scenario: 'Caracteres especiais',
        passed: true,
        detail: `Campo aceitou: "${value.slice(0, 30)}"`,
      })
    } catch (err) {
      this.results.push({ field: field.label, scenario: 'Caracteres especiais', passed: false, detail: String(err) })
    }
  }

  private async testSQLInjection(field: FieldElement): Promise<void> {
    if (field.type === 'select' || field.type === 'checkbox' || field.type === 'radio') return

    for (const payload of SECURITY_PAYLOADS.sqlInjection) {
      try {
        await this.fieldLocator(field).fill(payload)
        const submitBtn = await findInFrames(this.page, ['button[type="submit"], [type="submit"]'], this.frameFor(field))
        if (submitBtn) await submitBtn.locator.click()

        // Check for DB errors, stack traces, or SQL keywords in response
        const bodyText = await this.page.locator('body').textContent()
        const leaked = /sql|syntax error|ora-|mysql|pg_|exception|stacktrace/i.test(bodyText ?? '')

        this.results.push({
          field: field.label,
          scenario: `SQL Injection: ${payload.slice(0, 20)}`,
          passed: !leaked,
          detail: leaked
            ? 'VULNERABILIDADE: possível SQL Injection detectado na resposta'
            : 'Payload não refletido na resposta',
        })
      } catch (err) {
        this.results.push({ field: field.label, scenario: 'SQL Injection', passed: false, detail: String(err) })
      }
    }
  }

  private async testXSS(field: FieldElement): Promise<void> {
    if (field.type === 'select' || field.type === 'checkbox' || field.type === 'radio') return

    for (const payload of SECURITY_PAYLOADS.xss) {
      try {
        await this.fieldLocator(field).fill(payload)
        const submitBtn = await findInFrames(this.page, ['button[type="submit"], [type="submit"]'], this.frameFor(field))
        if (submitBtn) await submitBtn.locator.click()

        // Check if script executed (dialog would appear)
        let dialogFired = false
        this.page.once('dialog', async dialog => {
          dialogFired = true
          await dialog.dismiss()
        })

        await this.page.waitForTimeout(500)

        this.results.push({
          field: field.label,
          scenario: `XSS: ${payload.slice(0, 30)}`,
          passed: !dialogFired,
          detail: dialogFired
            ? 'VULNERABILIDADE: XSS executado (dialog disparado)'
            : 'Payload não executado',
        })
      } catch (err) {
        this.results.push({ field: field.label, scenario: 'XSS', passed: false, detail: String(err) })
      }
    }
  }

  private async testDuplicateSubmit(map: ScreenMap): Promise<void> {
    const submitBtn = await findInFrames(this.page, ['button[type="submit"], [type="submit"]'])
    if (!submitBtn) return

    try {
      // Fill a valid record first
      for (const field of map.fields) {
        if (field.type === 'select' || field.type === 'checkbox') continue
        const value = testData.text.short()
        await this.fieldLocator(field).fill(value).catch(() => {})
      }

      await submitBtn.locator.click()
      await this.page.waitForTimeout(300)
      // Try submitting again immediately (double-click simulation)
      await submitBtn.locator.click().catch(() => {})

      const hasError = await this.page.locator('[class*="error"], [class*="alerta"], [role="alert"]').count() > 0

      this.results.push({
        field: 'Formulário',
        scenario: 'Duplo envio',
        passed: true,
        detail: hasError ? 'Validação de duplicidade exibida' : 'Segundo envio processado (validar duplicidade no backend)',
      })
    } catch (err) {
      this.results.push({ field: 'Formulário', scenario: 'Duplo envio', passed: false, detail: String(err) })
    }
  }

  private async hasValidationError(field: FieldElement): Promise<boolean> {
    // Native HTML5 validation
    const nativeInvalid = await this.fieldLocator(field).locator(':scope:invalid').count().catch(() => 0) > 0
    if (nativeInvalid) return true

    // Custom validation messages nearby
    const errorSelectors = [
      `[class*="error"]`,
      `[class*="invalid"]`,
      `[role="alert"]`,
      `[aria-invalid="true"]`,
      `.help-block`,
      `.field-error`,
    ]
    for (const sel of errorSelectors) {
      const frame = this.frameFor(field)
      const count = frame
        ? await frame.locator(sel).count().catch(() => 0)
        : await this.page.locator(sel).count().catch(() => 0)
      if (count > 0) return true
    }

    return false
  }

  private fieldLocator(field: FieldElement): Locator {
    const frame = this.frameFor(field)
    return frame ? frame.locator(field.selector).first() : this.page.locator(field.selector).first()
  }

  private frameFor(field: FieldElement) {
    if (!field.frameUrl) return undefined
    return this.page.frames().find(frame => frame.url() === field.frameUrl)
  }
}
