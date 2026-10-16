import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { allowedFiles, seedPackagedAppAsar } from './test-support/packaged-app-asar-fixture.mjs'

const require = createRequire(import.meta.url)
const { verifyPackagedAppAsarContents } = require('./verify-packaged-app-asar-contents.cjs')

async function withArchive(files, run) {
  const scratch = await mkdtemp(join(tmpdir(), 'axiom-packaged-asar-'))
  const resourcesDir = join(scratch, 'resources')
  try {
    await seedPackagedAppAsar(resourcesDir, files)
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
