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

