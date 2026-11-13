import type { Page, TestInfo } from '@playwright/test'
import { expect } from './orca-app'

export async function captureDetail(page: Page, testInfo: TestInfo, name: string) {
  const detail = page.getByRole('region', { name: 'Task detail', exact: true })
  // The application scrolls inside ancestors. Temporarily expand those ancestors so the
  // element screenshot contains the entire detail; restore all inline styles afterwards.
  const styles = await detail.evaluate((section) => {
    const saved: (string | null)[] = []
    for (let node = section.parentElement; node; node = node.parentElement) {
      saved.push(node.getAttribute('style'))
      node.style.setProperty('overflow', 'visible', 'important')
      node.style.setProperty('height', 'auto', 'important')
      node.style.setProperty('max-height', 'none', 'important')
      node.style.setProperty('min-height', '0', 'important')
    }
    return saved
  })
  try {
    const path = testInfo.outputPath(`${name}.png`)
    const bounds = await detail.boundingBox()
    expect(bounds).not.toBeNull()
    const png = await detail.screenshot({ path, animations: 'disabled' })
    expect(png.readUInt32BE(20)).toBeGreaterThanOrEqual(Math.floor(bounds!.height))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  } finally {
    await detail.evaluate((section, saved) => {
      let index = 0
      for (let node = section.parentElement; node; node = node.parentElement) {
        const style = saved[index++]
        if (style === null) {
          node.removeAttribute('style')
        } else {
          node.setAttribute('style', style)
        }
      }
    }, styles)
  }
}
