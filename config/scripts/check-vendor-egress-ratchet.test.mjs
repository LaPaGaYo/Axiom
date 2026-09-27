import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  collectCurrentVendorEgress,
  diffBaseline,
  main,
  parseBaseline
} from './check-vendor-egress-ratchet.mjs'

const BASELINE = 'config/vendor-egress-baseline.txt'
let root
let files
let output
let errors

function put(file, content) {
  const absolute = path.join(root, file)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, content)
  if (!files.includes(file)) {
    files.push(file)
  }
}

function scan() {
  return collectCurrentVendorEgress(root, files)
}

function run(args = []) {
  return main(root, args, files)
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-egress-ratchet-'))
  files = []
  output = vi.spyOn(console, 'log').mockImplementation(() => {})
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('collectCurrentVendorEgress', () => {
  it('counts case-insensitive matching lines once per needle, including overlaps', () => {
    put(
      'src/vendor.ts',
      [
        'ONORCA.DEV onorca.dev',
        'Orca.Dev',
        'STABLYAI stablyai',
        'COM.STABLYAI',
        'COM.STABLY.ORCA',
        'POSTHOG posthog',
        'ORCA-PLUGINS',
        'SIGNPATH FOUNDATION',
        'SIGNPATH.IO'
      ].join('\r\n')
    )
    expect(scan().map(({ needle, count }) => [needle, count])).toEqual([
      ['SignPath Foundation', 1],
      ['com.stably.orca', 1],
      ['com.stablyai', 1],
      ['onorca.dev', 1],
      ['orca-plugins', 1],
      ['orca.dev', 2],
      ['posthog', 1],
      ['signpath.io', 1],
      ['stablyai', 2]
    ])
    expect(scan().find(({ needle }) => needle === 'onorca.dev')?.lines).toEqual([
      { number: 1, text: 'ONORCA.DEV onorca.dev' }
    ])
  })

  it('scans every specified root and only supplied tracked files', () => {
    const allowed = [
      'src/a.ts',
      'config/a.cjs',
      'mobile/app.json',
      'mobile/nested/node_modules/reference.js',
      'cloud/apps/a.ts',
      'resources/a.txt',
      'skills/a.md',
      'skill-guides/a.md',
      'skill-stubs/a.md',
      'electron.vite.config.ts',
      'package.json',
      'orca.yaml',
      'README.md'
    ]
    for (const file of allowed) {
      put(file, 'posthog')
    }
    put('src/untracked.ts', 'posthog')
    files = allowed
    expect(scan().map(({ file }) => file)).toEqual([...allowed].sort())
  })

  it('excludes dependencies, self files, documentation and out-of-scope paths', () => {
    for (const file of [
      'mobile/node_modules/a.js',
      'cloud/node_modules/a.js',
      'cloud/apps/a/node_modules/b/index.js',
      'docs/a.md',
      'LICENSE',
      'pnpm-lock.yaml',
      'src-other/a.ts',
      'README.md.bak',
      'tests/a.ts',
      'config/scripts/check-vendor-egress-ratchet.mjs',
      'config/scripts/check-vendor-egress-ratchet.test.mjs',
      BASELINE
    ]) {
      put(file, 'posthog')
    }
    expect(scan()).toEqual([])
  })

  it('ignores binary files and tracked files deleted from the working tree', () => {
    put('resources/nul.bin', Buffer.from('posthog\0onorca.dev'))
    put('resources/invalid.bin', Buffer.from([0xff, ...Buffer.from('posthog')]))
    files.push('src/deleted.ts')
    expect(scan()).toEqual([])
  })

  it('requires the exact, case-sensitive allow marker on the matching line', () => {
    put(
      'src/a.ts',
      [
        '// vendor-egress-ratchet: allow',
        'posthog',
        'posthog // Vendor-egress-ratchet: allow',
        'posthog // vendor-egress-ratchet: allow'
      ].join('\n')
    )
    expect(scan()).toEqual([
      {
        file: 'src/a.ts',
        needle: 'posthog',
        count: 2,
        lines: [
          { number: 2, text: 'posthog' },
          { number: 3, text: 'posthog // Vendor-egress-ratchet: allow' }
        ]
      }
    ])
  })
})

describe('parseBaseline and diffBaseline', () => {
  it('parses counts, comments, CRLF and paths containing colons', () => {
    expect(parseBaseline('# header\r\n\r\nsrc/a:b.ts:posthog:2\r\n')).toEqual(
      new Map([['src/a:b.ts:posthog', 2]])
    )
  })

  it.each([
    'src/a.ts:posthog:0',
    'src/a.ts:posthog:-1',
    'src/a.ts:posthog:1.5',
    'src/a.ts:posthog:9007199254740992',
    'src/a.ts:unknown:1',
    'src/a.ts:posthog',
    'src/a.ts:posthog:1\nsrc/a.ts:posthog:2'
  ])('rejects an invalid baseline: %s', (text) => {
    expect(() => parseBaseline(text)).toThrow(/baseline/i)
  })

  it('distinguishes new pairs, growth, shrinkage and disappearance', () => {
    put('src/a.ts', 'posthog\nposthog\nstablyai')
    const baseline = parseBaseline('src/a.ts:posthog:1\nsrc/a.ts:stablyai:2\nsrc/b.ts:posthog:3')
    const { added, stale } = diffBaseline(scan(), baseline)
    expect(added).toEqual([
      expect.objectContaining({ file: 'src/a.ts', needle: 'posthog', count: 2, baselineCount: 1 })
    ])
    expect(stale).toEqual([
      { key: 'src/a.ts:stablyai', count: 1, baselineCount: 2 },
      { key: 'src/b.ts:posthog', count: 0, baselineCount: 3 }
    ])
    expect(diffBaseline(scan(), new Map()).added).toHaveLength(2)
  })
})

describe('main', () => {
  it('fails a new endpoint and names its file, needle and offending line', () => {
    put(BASELINE, '')
    put('src/endpoint.ts', "// unrelated\nconst x = 'https://onorca.dev/x'\n")
    expect(run()).toBe(1)
    const diagnostics = errors.mock.calls.flat().join('\n')
    expect(diagnostics).toContain('src/endpoint.ts:onorca.dev')
    expect(diagnostics).toContain("src/endpoint.ts:2: const x = 'https://onorca.dev/x'")
  })

  it('suppresses that endpoint with an allow marker on the same line', () => {
    put(BASELINE, '')
    put('src/endpoint.ts', "const x = 'https://onorca.dev/x' // vendor-egress-ratchet: allow\n")
    expect(run()).toBe(0)
    expect(scan()).toEqual([])
  })

  it('fails count growth for a grandfathered pair', () => {
    put(BASELINE, 'src/a.ts:posthog:1\n')
    put('src/a.ts', 'posthog\nposthog')
    expect(run()).toBe(1)
    expect(errors.mock.calls.flat().join('\n')).toContain('src/a.ts:2: posthog')
  })

  it('reports shrinking and disappeared pairs without failing or changing the baseline', () => {
    const baseline = 'src/a.ts:posthog:2\nsrc/gone.ts:stablyai:1\n'
    put(BASELINE, baseline)
    put('src/a.ts', 'posthog')
    expect(run()).toBe(0)
    const diagnostics = output.mock.calls.flat().join('\n')
    expect(diagnostics).toContain('src/a.ts:posthog')
    expect(diagnostics).toContain('src/gone.ts:stablyai')
    expect(diagnostics).toContain('--write-baseline')
    expect(fs.readFileSync(path.join(root, BASELINE), 'utf8')).toBe(baseline)
  })

  it('bootstraps a sorted count baseline that ignores unrelated line shifts', () => {
    put('src/z.ts', 'posthog\nposthog')
    put('src/a.ts', 'stablyai')
    expect(run(['--write-baseline'])).toBe(0)
    expect(fs.readFileSync(path.join(root, BASELINE), 'utf8')).toBe(
      'src/a.ts:stablyai:1\nsrc/z.ts:posthog:2\n'
    )
    put('src/z.ts', '// unrelated\n\nposthog\nposthog')
    expect(run()).toBe(0)
    expect(run(['--write-baseline'])).toBe(0)
    expect(fs.readFileSync(path.join(root, BASELINE), 'utf8')).toBe(
      'src/a.ts:stablyai:1\nsrc/z.ts:posthog:2\n'
    )
  })

  it('tightens stale counts and removed entries with --write-baseline', () => {
    put(BASELINE, 'src/a.ts:posthog:2\nsrc/gone.ts:stablyai:1\n')
    put('src/a.ts', 'posthog')
    expect(run(['--write-baseline'])).toBe(0)
    expect(fs.readFileSync(path.join(root, BASELINE), 'utf8')).toBe('src/a.ts:posthog:1\n')
    put('src/a.ts', '')
    expect(run(['--write-baseline'])).toBe(0)
    expect(fs.readFileSync(path.join(root, BASELINE), 'utf8')).toBe('')
    expect(run()).toBe(0)
  })

  it.each(['posthog\nposthog', 'posthog\nstablyai'])(
    'refuses to grow an existing baseline when writing: %s',
    (source) => {
      put(BASELINE, 'src/a.ts:posthog:1\n')
      put('src/a.ts', source)
      expect(run(['--write-baseline'])).toBe(1)
      expect(fs.readFileSync(path.join(root, BASELINE), 'utf8')).toBe('src/a.ts:posthog:1\n')
    }
  )

  it('fails closed for a missing baseline and explains how to initialize it', () => {
    expect(run()).toBe(1)
    expect(errors.mock.calls.flat().join('\n')).toContain('--write-baseline')
  })

  it('fails closed for a malformed baseline', () => {
    put(BASELINE, 'src/a.ts:posthog:NaN')
    expect(run()).toBe(1)
  })

  it.each([{ args: [] }, { args: ['--write-baseline'] }])(
    'emits only findings JSON to stdout: $args',
    ({ args }) => {
      put(BASELINE, 'src/a.ts:posthog:2\n')
      put('src/a.ts', 'posthog')
      expect(run([...args, '--json'])).toBe(0)
      expect(output).toHaveBeenCalledTimes(1)
      expect(JSON.parse(output.mock.calls[0][0])).toEqual(scan())
    }
  )

  it('preserves the failing exit status with --json', () => {
    put(BASELINE, '')
    put('src/a.ts', 'posthog')
    expect(run(['--json'])).toBe(1)
    expect(JSON.parse(output.mock.calls[0][0])).toEqual(scan())
  })
})
