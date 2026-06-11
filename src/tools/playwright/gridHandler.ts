import type { Page } from '@playwright/test'
import { logger } from '@utils/logger'
import { testData } from '@utils/testData'
import type { GridElement } from './screenMapper'

export interface GridTestResult {
  scenario: string
  passed: boolean
  detail: string
  rowsFound?: number
}

export class GridHandler {
  private results: GridTestResult[] = []

  constructor(private page: Page) {}

  async testAll(grids: GridElement[]): Promise<GridTestResult[]> {
    this.results = []

    if (grids.length === 0) {
      logger.info('Nenhuma grid encontrada na tela')
      return []
    }

    for (let i = 0; i < grids.length; i++) {
      const grid = grids[i]
      logger.info(`Testando grid ${i + 1}/${grids.length} — ${grid.rowCount} linha(s)`)

      if (grid.rowCount === 0) {
        await this.handleEmptyGrid(grid)
      } else {
        await this.handlePopulatedGrid(grid)
      }

      if (grid.hasPagination) await this.testPagination()
      await this.testSorting(grid)
    }

    return this.results
  }

  private async handleEmptyGrid(grid: GridElement): Promise<void> {
    logger.info('Grid vazia — verificando mensagem de empty state')

    const emptyMsg = await this.page
      .locator('[class*="empty"], [class*="no-data"], [class*="sem-registro"], td[colspan]')
      .first()
      .textContent()
      .catch(() => null)

    this.results.push({
      scenario: 'Grid vazia — empty state',
      passed: emptyMsg !== null,
      detail: emptyMsg
        ? `Mensagem exibida: "${emptyMsg.trim().slice(0, 80)}"`
        : 'ATENÇÃO: sem mensagem de empty state — usuário pode não entender que está vazio',
      rowsFound: 0,
    })
  }

  private async handlePopulatedGrid(grid: GridElement): Promise<void> {
    const rows = this.page.locator('tbody tr, [role="row"]:not([class*="header"])')
    const rowCount = await rows.count()

    // Pick a random row to interact with
    const randomIndex = Math.floor(Math.random() * Math.min(rowCount, 5))
    const targetRow = rows.nth(randomIndex)

    this.results.push({
      scenario: 'Grid populada — registros visíveis',
      passed: rowCount > 0,
      detail: `${rowCount} linha(s) encontrada(s)`,
      rowsFound: rowCount,
    })

    // Try opening row detail
    await this.testRowDetail(targetRow, randomIndex)

    // Test column data presence
    await this.testColumnData(grid, targetRow)

    // Test row selection (checkbox)
    await this.testRowSelection(rows)
  }

  private async testRowDetail(row: import('@playwright/test').Locator, index: number): Promise<void> {
    try {
      // Try clicking the row or a detail/edit link inside it
      const detailLink = row.locator('a, button[title*="detalhe"], button[title*="ver"], button[aria-label*="detalhe"]').first()

      if ((await detailLink.count()) > 0) {
        await detailLink.click()
        await this.page.waitForTimeout(800)

        const opened =
          (await this.page.locator('[role="dialog"], .modal, [class*="detail"]').count()) > 0 ||
          this.page.url().includes('/detalhe') ||
          this.page.url().includes('/detail') ||
          this.page.url().includes('/view')

        this.results.push({
          scenario: `Linha ${index + 1} — abrir detalhe`,
          passed: opened,
          detail: opened ? 'Detalhe aberto com sucesso' : 'Detalhe não identificado após clique',
        })

        // Close modal if opened
        const closeBtn = this.page.locator('[aria-label*="fechar"], [aria-label*="close"], button:has-text("Fechar"), button:has-text("×")').first()
        if ((await closeBtn.count()) > 0) await closeBtn.click()
        await this.page.waitForTimeout(400)
      } else {
        await row.click()
        await this.page.waitForTimeout(600)
        this.results.push({
          scenario: `Linha ${index + 1} — clique na linha`,
          passed: true,
          detail: 'Linha clicável (sem link de detalhe explícito)',
        })
      }
    } catch (err) {
      this.results.push({
        scenario: `Linha ${index + 1} — abrir detalhe`,
        passed: false,
        detail: String(err),
      })
    }
  }

  private async testColumnData(grid: GridElement, row: import('@playwright/test').Locator): Promise<void> {
    try {
      const cells = row.locator('td, [role="cell"]')
      const cellCount = await cells.count()

      const emptyCells: number[] = []
      for (let i = 0; i < Math.min(cellCount, grid.columns.length); i++) {
        const text = ((await cells.nth(i).textContent()) ?? '').trim()
        if (!text) emptyCells.push(i)
      }

      this.results.push({
        scenario: 'Dados das colunas',
        passed: emptyCells.length < cellCount / 2,
        detail: emptyCells.length === 0
          ? 'Todas as colunas com dados'
          : `${emptyCells.length} coluna(s) vazia(s): índices [${emptyCells.join(', ')}]`,
      })
    } catch (err) {
      this.results.push({ scenario: 'Dados das colunas', passed: false, detail: String(err) })
    }
  }

  private async testRowSelection(rows: import('@playwright/test').Locator): Promise<void> {
    try {
      const checkbox = rows.first().locator('input[type="checkbox"]')
      if ((await checkbox.count()) === 0) return

      await checkbox.check()
      const checked = await checkbox.isChecked()

      this.results.push({
        scenario: 'Seleção de linha (checkbox)',
        passed: checked,
        detail: checked ? 'Seleção funcionando' : 'FALHA: checkbox não marcado após clique',
      })

      await checkbox.uncheck()
    } catch (err) {
      this.results.push({ scenario: 'Seleção de linha', passed: false, detail: String(err) })
    }
  }

  private async testPagination(): Promise<void> {
    try {
      const nextBtn = this.page.locator(
        '[aria-label*="próxima"], [aria-label*="next"], button:has-text("›"), button:has-text(">")'
      ).first()

      if ((await nextBtn.count()) === 0) {
        this.results.push({ scenario: 'Paginação', passed: true, detail: 'Botão próxima página não encontrado (página única ou sem paginação visível)' })
        return
      }

      const enabled = await nextBtn.isEnabled()
      if (enabled) {
        await nextBtn.click()
        await this.page.waitForTimeout(800)
        this.results.push({ scenario: 'Paginação — próxima página', passed: true, detail: 'Navegação para próxima página funcionando' })
      } else {
        this.results.push({ scenario: 'Paginação — próxima página', passed: true, detail: 'Botão desabilitado (última página)' })
      }
    } catch (err) {
      this.results.push({ scenario: 'Paginação', passed: false, detail: String(err) })
    }
  }

  private async testSorting(grid: GridElement): Promise<void> {
    const sortableColumns = grid.columns.filter(c => c.sortable)
    if (sortableColumns.length === 0) return

    try {
      const col = sortableColumns[0]
      const header = this.page.locator(`th:nth-child(${col.index + 1}), [role="columnheader"]:nth-child(${col.index + 1})`).first()

      await header.click()
      await this.page.waitForTimeout(500)

      const ariaSort = await header.getAttribute('aria-sort')
      const hasSortIndicator = await header.locator('[class*="sort"], [class*="asc"], [class*="desc"]').count() > 0

      this.results.push({
        scenario: `Ordenação — coluna "${col.header}"`,
        passed: ariaSort !== null || hasSortIndicator,
        detail: ariaSort ? `aria-sort="${ariaSort}"` : hasSortIndicator ? 'Indicador visual de ordenação encontrado' : 'ATENÇÃO: sem indicador de ordenação após clique',
      })
    } catch (err) {
      this.results.push({ scenario: 'Ordenação', passed: false, detail: String(err) })
    }
  }
}
