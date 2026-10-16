import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const { createPackageWithOptions } = require('@electron/asar')

export const allowedFiles = [
  'out/main/index.js',
  // Why: afterPack's runtime dependency check also requires this emitted entry.
  'out/main/agent-hooks/managed-agent-hook-controls.js',
  'out/mobile-web/index.html',
  'resources/icon.png',
  'package.json',
  'LICENSE',
  'NOTICE.md'
]

export async function seedPackagedAppAsar(resourcesDir, files = allowedFiles) {
  const scratch = await mkdtemp(join(tmpdir(), 'axiom-packaged-asar-source-'))
  const sourceDir = join(scratch, 'source')
  try {
    await mkdir(resourcesDir, { recursive: true })
    for (const file of files) {
      const filePath = join(sourceDir, file)
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, 'fixture\n')
    }
    await createPackageWithOptions(sourceDir, join(resourcesDir, 'app.asar'), {
      unpack: 'resources/**'
    })
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}
