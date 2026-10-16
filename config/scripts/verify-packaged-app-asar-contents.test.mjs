import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createPackageWithOptions } = require('@electron/asar')
const { verifyPackagedAppAsarContents } = require('./verify-packaged-app-asar-contents.cjs')

const allowedFiles = [
  'out/main/index.js',
  'out/mobile-web/index.html',
  'resources/icon.png',
  'package.json',
  'LICENSE',
  'NOTICE.md'
]

async function withArchive(files, run) {
  const scratch = await mkdtemp(join(tmpdir(), 'axiom-packaged-asar-'))
  const sourceDir = join(scratch, 'source')
  const resourcesDir = join(scratch, 'resources')
  try {
    await mkdir(resourcesDir)
    for (const file of files) {
      const filePath = join(sourceDir, file)
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, 'fixture\n')
    }
    await createPackageWithOptions(sourceDir, join(resourcesDir, 'app.asar'), {
      unpack: 'resources/**'
    })
    await run(resourcesDir)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

describe('verify packaged app.asar contents', () => {
  it('accepts the runtime layout, including unpacked resources and the mobile web bundle', async () => {
    await withArchive(allowedFiles, (resourcesDir) => {
      expect(() => verifyPackagedAppAsarContents(resourcesDir)).not.toThrow()
    })
  })

  it.each([
    '.axiom-work/logs/x.log',
    'unknown-root/file.txt',
    'unknown-root.txt',
    'out/deep/x.log',
    'resources/deep/x.log',
    'out/deep/.axiom-work/brief.md',
    'resources/deep/launchers/start.sh',
    'out/deep/test-results/result.json',
    'resources/deep/.git/config'
  ])('rejects %s and names the offending path', async (offendingPath) => {
    await withArchive([...allowedFiles, offendingPath], (resourcesDir) => {
      expect(() => verifyPackagedAppAsarContents(resourcesDir)).toThrow(
        offendingPath.startsWith('unknown-root/') ? 'unknown-root' : offendingPath
      )
    })
  })

  it('requires the complete root layout', async () => {
    await withArchive(
      allowedFiles.filter((file) => file !== 'LICENSE'),
      (resourcesDir) => {
        expect(() => verifyPackagedAppAsarContents(resourcesDir)).toThrow(/missing.*LICENSE/)
      }
    )
  })
})
