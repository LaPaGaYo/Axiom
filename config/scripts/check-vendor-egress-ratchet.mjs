import { isUtf8 } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

// M0 freezes upstream identity and endpoint references until fork isolation removes them.
// Counts grandfather matching lines without coupling the baseline to unrelated line shifts.
// After initialization the baseline may only shrink, including in --write-baseline mode.
const BASELINE_PATH = 'config/vendor-egress-baseline.txt'
const SCAN_ROOTS = [
  'src/',
  'config/',
  'Casks/',
  'mobile/',
  'cloud/',
  'resources/',
  'skills/',
  'skill-guides/',
  'skill-stubs/',
  'electron.vite.config.ts',
  'package.json',
  'orca.yaml',
  'README.md'
]
const NEEDLES = [
  'onorca.dev',
  'orca.dev',
  'stablyai',
  'com.stablyai',
  'com.stably.orca',
  'posthog',
  'orca-plugins',
  'SignPath Foundation',
  'signpath.io'
]
// These files necessarily contain the needles as scanner data and regression fixtures.
const SELF_FILES = new Set([
  'config/scripts/check-vendor-egress-ratchet.mjs',
  'config/scripts/check-vendor-egress-ratchet.test.mjs',
  BASELINE_PATH
])
// Exact, case-sensitive escape hatch for legitimate mentions such as attribution.
// A line containing `vendor-egress-ratchet: allow` is exempt for every needle.
const ALLOW_MARKER = 'vendor-egress-ratchet: allow'

/** @typedef {{ number: number, text: string }} MatchingLine */
/** @typedef {{ file: string, needle: string, count: number, lines: MatchingLine[] }} Finding */

/** @param {string} file */
function isScannedPath(file) {
  if (SELF_FILES.has(file)) {
    return false
  }
  if (file.startsWith('mobile/node_modules/') || /^cloud\/(?:.*\/)?node_modules\//.test(file)) {
    return false
  }
  // The positive root list also excludes docs/**, LICENSE and pnpm-lock.yaml.
  return SCAN_ROOTS.some((root) => (root.endsWith('/') ? file.startsWith(root) : file === root))
}

/** @param {string} root */
function listTrackedFiles(root) {
  return execFileSync('git', ['ls-files', '-z', '--', ...SCAN_ROOTS], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  })
    .split('\0')
    .filter(Boolean)
}

/** @param {string} root @param {string} file @returns {Finding[]} */
function scanFile(root, file) {
  let bytes
  try {
    bytes = fs.readFileSync(path.join(root, file))
  } catch (error) {
    // Deletions remain in the index until staged; other read failures must not hide findings.
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return []
    }
    throw error
  }
  // NUL and invalid UTF-8 identify binary content without extension-based exclusions.
  if (bytes.includes(0) || !isUtf8(bytes)) {
    return []
  }
  const lines = bytes
    .toString('utf8')
    .split(/\r\n|\n|\r/)
    .map((text, index) => ({ number: index + 1, text, lower: text.toLowerCase() }))
    .filter(({ text }) => !text.includes(ALLOW_MARKER))
  const findings = []
  for (const needle of NEEDLES) {
    const lowerNeedle = needle.toLowerCase()
    const matching = lines
      .filter(({ lower }) => lower.includes(lowerNeedle))
      .map(({ number, text }) => ({ number, text }))
    if (matching.length > 0) {
      findings.push({ file, needle, count: matching.length, lines: matching })
    }
  }
  return findings
}

/**
 * An injected tracked-file list permits git-less fixtures; production always uses git ls-files.
 * @param {string} root
 * @param {string[]} files
 * @returns {Finding[]}
 */
export function collectCurrentVendorEgress(root = process.cwd(), files = listTrackedFiles(root)) {
  const findings = new Map()
  for (const file of new Set(files.filter(isScannedPath))) {
    for (const finding of scanFile(root, file)) {
      findings.set(`${file}:${finding.needle}`, finding)
    }
  }
  return [...findings.keys()].sort().map((key) => findings.get(key))
}

/** @param {string} text @returns {Map<string, number>} */
export function parseBaseline(text) {
  const baseline = new Map()
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) {
      continue
    }
    const match = /^(.+):([^:]+):([1-9]\d*)$/.exec(line)
    if (!match || !NEEDLES.includes(match[2]) || !Number.isSafeInteger(Number(match[3]))) {
      throw new Error(`Invalid vendor-egress baseline entry: ${line}`)
    }
    const key = `${match[1]}:${match[2]}`
    if (baseline.has(key)) {
      throw new Error(`Duplicate vendor-egress baseline entry: ${key}`)
    }
    baseline.set(key, Number(match[3]))
  }
  return baseline
}

/** @param {Finding[]} current @param {Map<string, number>} baseline */
export function diffBaseline(current, baseline) {
  const counts = new Map(current.map((entry) => [`${entry.file}:${entry.needle}`, entry.count]))
  const added = current
    .map((entry) => ({
      ...entry,
      baselineCount: baseline.get(`${entry.file}:${entry.needle}`) ?? 0
    }))
    .filter((entry) => entry.count > entry.baselineCount)
  const stale = [...baseline.keys()]
    .sort()
    .map((key) => ({ key, count: counts.get(key) ?? 0, baselineCount: baseline.get(key) ?? 0 }))
    .filter((entry) => entry.count < entry.baselineCount)
  return { added, stale }
}

/** @param {ReturnType<typeof diffBaseline>} diff @param {boolean} json */
function printDiff({ added, stale }, json) {
  for (const entry of added) {
    const kind = entry.baselineCount === 0 ? 'NEW pair' : 'Count grew'
    console.error(
      `${kind}: ${entry.file}:${entry.needle} (baseline ${entry.baselineCount} -> current ${entry.count})`
    )
    // Counts cannot identify which historical line changed, so show all matching lines.
    for (const line of entry.lines) {
      console.error(`  ${entry.file}:${line.number}: ${line.text}`)
    }
  }
  const inform = json ? console.error : console.log
  for (const entry of stale) {
    inform(
      `Stale baseline: ${entry.key} (baseline ${entry.baselineCount} -> current ${entry.count})`
    )
  }
  if (stale.length > 0) {
    inform('Run pnpm run check:vendor-egress-ratchet --write-baseline to shrink the baseline.')
  }
  if (added.length > 0) {
    console.error(
      'Vendor-egress ratchet failed. Remove new references; the baseline may only shrink.'
    )
  }
}

/** @param {string} root @param {string[]} args @param {string[] | undefined} files */
export function main(root = process.cwd(), args = [], files = undefined) {
  try {
    const write = args.includes('--write-baseline')
    const json = args.includes('--json')
    const baselineFile = path.join(root, BASELINE_PATH)
    const exists = fs.existsSync(baselineFile)
    if (!exists && !write) {
      throw new Error(
        `Missing ${BASELINE_PATH}. Initialize with: pnpm run check:vendor-egress-ratchet --write-baseline`
      )
    }
    const baseline = exists ? parseBaseline(fs.readFileSync(baselineFile, 'utf8')) : new Map()
    const current = collectCurrentVendorEgress(root, files)
    if (json) {
      console.log(JSON.stringify(current, null, 2))
    }
    const diff = diffBaseline(current, baseline)
    if (write && (!exists || diff.added.length === 0)) {
      const entries = current.map(({ file, needle, count }) => `${file}:${needle}:${count}`).sort()
      fs.mkdirSync(path.dirname(baselineFile), { recursive: true })
      fs.writeFileSync(baselineFile, entries.length > 0 ? `${entries.join('\n')}\n` : '')
      if (!json) {
        console.log(`Wrote ${BASELINE_PATH} with ${entries.length} pair(s).`)
      }
      return 0
    }
    printDiff(diff, json)
    if (diff.added.length > 0) {
      return 1
    }
    if (!json) {
      console.log(`Vendor-egress ratchet OK — ${current.length} grandfathered pair(s).`)
    }
    return 0
  } catch (error) {
    console.error(
      `Vendor-egress ratchet failed: ${error instanceof Error ? error.message : String(error)}`
    )
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.cwd(), process.argv.slice(2))
}
