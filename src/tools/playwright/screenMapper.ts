import type { Page, Locator } from '@playwright/test'
import { logger } from '@utils/logger'
import { activeFrames, countVisibleInFrames } from './frameUtils'

export interface FieldElement {
  label: string
  selector: string
  type: string
  required: boolean
  frameUrl?: string
  placeholder?: string
  maxLength?: number
}

export interface ButtonElement {
  text: string
  selector: string
  action: 'submit' | 'cancel' | 'delete' | 'edit' | 'export' | 'import' | 'filter' | 'other'
  frameUrl?: string
}

export interface GridColumn {
  header: string
  index: number
  sortable: boolean
}

export interface GridElement {
  selector: string
  columns: GridColumn[]
  rowCount: number
  hasPagination: boolean
  frameUrl?: string
}

export interface TabElement {
  label: string
  selector: string
  active: boolean
  frameUrl?: string
}

export interface FilterElement {
  label: string
  selector: string
  type: string
  frameUrl?: string
}

export interface ScreenMap {
  url: string
  title: string
  fields: FieldElement[]
  buttons: ButtonElement[]
  grids: GridElement[]
  tabs: TabElement[]
  filters: FilterElement[]
  hasModal: boolean
  hasExport: boolean
  hasImport: boolean
  hasPagination: boolean
  timestamp: string
}

export class ScreenMapper {
  constructor(private page: Page) {}

  async map(): Promise<ScreenMap> {
    const url = this.page.url()
    const title = await this.page.title()

    logger.info(`Mapeando tela: ${title} (${url})`)

    const [fields, buttons, grids, tabs, filters] = await Promise.all([
      this.mapFields(),
      this.mapButtons(),
      this.mapGrids(),
      this.mapTabs(),
      this.mapFilters(),
    ])

    const hasExport = buttons.some(b => b.action === 'export')
    const hasImport = buttons.some(b => b.action === 'import')
    const hasPagination = grids.some(g => g.hasPagination)
    const hasModal = (await countVisibleInFrames(this.page, ['[role="dialog"], .modal, [class*="modal"]'])) > 0

    const map: ScreenMap = {
      url,
      title,
      fields,
      buttons,
      grids,
      tabs,
      filters,
      hasModal,
      hasExport,
      hasImport,
      hasPagination,
      timestamp: new Date().toISOString(),
    }

    logger.info(
      `Mapa concluído — ${fields.length} campo(s), ${buttons.length} botão(ões), ${grids.length} grid(s), ${tabs.length} aba(s)`
    )

    return map
  }

  private async mapFields(): Promise<FieldElement[]> {
    const fields: FieldElement[] = []

    for (const { frame, frameUrl } of await activeFrames(this.page)) {
      const inputs = frame.locator(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select'
      )
      const count = await inputs.count()

      for (let i = 0; i < count; i++) {
        const el = inputs.nth(i)
        if (!(await el.isVisible().catch(() => false))) continue

        const id = await el.getAttribute('id')
        const name = await el.getAttribute('name')
        const tag = await el.evaluate(node => node.tagName.toLowerCase()).catch(() => 'input')
        const type = tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : (await el.getAttribute('type')) ?? 'text'
        const placeholder = (await el.getAttribute('placeholder')) ?? undefined
        const required = (await el.getAttribute('required')) !== null
        const maxLength = await el.getAttribute('maxlength')
        const ariaLabel = await el.getAttribute('aria-label')

        let label = ariaLabel ?? placeholder ?? name ?? id ?? `campo_${fields.length}`
        if (id) {
          const labelEl = frame.locator(`label[for="${id}"]`)
          if ((await labelEl.count()) > 0) {
            label = (await labelEl.first().textContent())?.trim() ?? label
          }
        }

        const selector = id ? `#${id}` : name ? `[name="${name}"]` : `${tag}:nth-of-type(${i + 1})`

        fields.push({
          label,
          selector,
          type,
          required,
          frameUrl,
          placeholder,
          maxLength: maxLength ? parseInt(maxLength) : undefined,
        })
      }
    }

    return fields
  }

  private async mapButtons(): Promise<ButtonElement[]> {
    const buttons: ButtonElement[] = []

    for (const { frame, frameUrl } of await activeFrames(this.page)) {
      const locator = frame.locator(
        'button, [type="submit"], input[type="button"], a[href][class*="btn"], [role="button"]'
      )
      const count = await locator.count()

      for (let i = 0; i < count; i++) {
        const el = locator.nth(i)
        if (!(await el.isVisible().catch(() => false))) continue

        const text = (
          (await el.textContent()) ??
          (await el.getAttribute('value')) ??
          (await el.getAttribute('aria-label')) ??
          ''
        ).trim()
        if (!text) continue

        const selector = await this.buildSelector(el, i)
        const action = this.classifyButtonAction(text)

        buttons.push({ text, selector, action, frameUrl })
      }
    }

    return buttons
  }

  private async mapGrids(): Promise<GridElement[]> {
    const grids: GridElement[] = []

    for (const { frame, frameUrl } of await activeFrames(this.page)) {
      const tableLocator = frame.locator('table, [role="grid"], [class*="grid"], [class*="table"]')
      const count = await tableLocator.count()

      for (let i = 0; i < count; i++) {
        const table = tableLocator.nth(i)
        if (!(await table.isVisible().catch(() => false))) continue

        const headers = table.locator('th, [role="columnheader"]')
        const headerCount = await headers.count()

        const columns: GridColumn[] = []
        for (let h = 0; h < headerCount; h++) {
          const header = headers.nth(h)
          const text = ((await header.textContent()) ?? '').trim()
          const sortable =
            (await header.getAttribute('aria-sort')) !== null ||
            (await header.locator('[class*="sort"]').count()) > 0

          columns.push({ header: text, index: h, sortable })
        }

        const rows = table.locator('tbody tr, [role="row"]:not([class*="header"])')
        const rowCount = await rows.count()
        const pagination = frame.locator('[class*="pagination"], [aria-label*="page"], nav[role="navigation"]')

        grids.push({
          selector: `table:nth-of-type(${i + 1})`,
          columns,
          rowCount,
          hasPagination: (await pagination.count()) > 0,
          frameUrl,
        })
      }
    }

    return grids
  }

  private async mapTabs(): Promise<TabElement[]> {
    const tabs: TabElement[] = []

    for (const { frame, frameUrl } of await activeFrames(this.page)) {
      const tabLocator = frame.locator('[role="tab"], .tab, [class*="tab-item"]')
      const count = await tabLocator.count()

      for (let i = 0; i < count; i++) {
        const el = tabLocator.nth(i)
        if (!(await el.isVisible().catch(() => false))) continue
        const label = ((await el.textContent()) ?? '').trim()
        const active = (await el.getAttribute('aria-selected')) === 'true'
        const selector = await this.buildSelector(el, i)

        tabs.push({ label, selector, active, frameUrl })
      }
    }

    return tabs
  }

  private async mapFilters(): Promise<FilterElement[]> {
    const filters: FilterElement[] = []

    for (const { frame, frameUrl } of await activeFrames(this.page)) {
      const filterArea = frame.locator(
        '[class*="filter"], [class*="search"], [aria-label*="filtro"], [aria-label*="filter"], input[type="search"]'
      )
      const count = await filterArea.count()

      for (let i = 0; i < count; i++) {
        const el = filterArea.nth(i)
        if (!(await el.isVisible().catch(() => false))) continue
        const label = ((await el.getAttribute('aria-label')) ?? (await el.getAttribute('placeholder')) ?? `filtro_${i}`).trim()
        const type = (await el.getAttribute('type')) ?? 'text'
        const selector = await this.buildSelector(el, i)

        filters.push({ label, selector, type, frameUrl })
      }
    }

    return filters
  }

  private classifyButtonAction(text: string): ButtonElement['action'] {
    const t = text.toLowerCase()
    if (/salvar|save|confirm|submit|cadastr|criar|add|novo/.test(t)) return 'submit'
    if (/cancel|voltar|fechar|close|back/.test(t)) return 'cancel'
    if (/excluir|deletar|remover|delete|remove/.test(t)) return 'delete'
    if (/editar|alterar|edit|update|modif/.test(t)) return 'edit'
    if (/export|baixar|download|excel|csv|pdf/.test(t)) return 'export'
    if (/import|upload|carregar/.test(t)) return 'import'
    if (/filtrar|buscar|pesquisar|search|filter|aplicar/.test(t)) return 'filter'
    return 'other'
  }

  private async buildSelector(el: Locator, index: number): Promise<string> {
    const id = await el.getAttribute('id')
    if (id) return `#${id}`
    const dataTestId = await el.getAttribute('data-testid')
    if (dataTestId) return `[data-testid="${dataTestId}"]`
    const ariaLabel = await el.getAttribute('aria-label')
    if (ariaLabel) return `[aria-label="${ariaLabel}"]`
    const tag = await el.evaluate(node => node.tagName.toLowerCase()).catch(() => '*')
    return `${tag}:nth-of-type(${index + 1})`
  }
}
