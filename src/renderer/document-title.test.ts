import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('renderer document titles', () => {
  it('titles the desktop window Axiom', () => {
    const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8')
    expect(html.match(/<title>(.*?)<\/title>/)?.[1]).toBe('Axiom')
  })

  it('titles the web client Axiom Web', () => {
    const html = readFileSync(new URL('./web-index.html', import.meta.url), 'utf8')
    expect(html.match(/<title>(.*?)<\/title>/)?.[1]).toBe('Axiom Web')
  })
})
