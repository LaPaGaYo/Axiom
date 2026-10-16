const { getRawHeader } = require('@electron/asar')
const { join, posix } = require('node:path')

// Keep aligned with the files exclusions in ../electron-builder.config.cjs.
const ALLOWED_ROOT_ENTRIES = ['out', 'resources', 'package.json', 'LICENSE', 'NOTICE.md']
const FORBIDDEN_PATH = /(?:\.log$|(?:^|\/)(?:\.axiom-work|launchers|test-results|\.git)(?:\/|$))/

function verifyPackagedAppAsarContents(resourcesDir) {
  const { header } = getRawHeader(join(resourcesDir, 'app.asar'))
  const rootEntries = Object.keys(header.files)
  const unexpected = rootEntries.filter((name) => !ALLOWED_ROOT_ENTRIES.includes(name))
  const missing = ALLOWED_ROOT_ENTRIES.filter((name) => !rootEntries.includes(name))
  const forbidden = []
  const visit = (files, prefix = '') => {
    for (const [name, entry] of Object.entries(files)) {
      // ASAR header paths use forward slashes even when packaging on Windows.
      const entryPath = posix.join(prefix, name)
      if (FORBIDDEN_PATH.test(entryPath)) {
        forbidden.push(entryPath)
      }
      if (entry.files) {
        visit(entry.files, entryPath)
      }
    }
  }
  // Unpacked files are still in the header and must obey the same content policy.
  visit(header.files)
  const violations = []
  if (unexpected.length > 0) {
    violations.push(`unexpected root entries: ${unexpected.join(', ')}`)
  }
  if (missing.length > 0) {
    violations.push(`missing root entries: ${missing.join(', ')}`)
  }
  if (forbidden.length > 0) {
    violations.push(`forbidden paths: ${forbidden.join(', ')}`)
  }
  if (violations.length > 0) {
    throw new Error(`[verify-packaged-app-asar-contents] app.asar ${violations.join('; ')}`)
  }
  console.log(`[verify-packaged-app-asar-contents] OK — roots: ${rootEntries.join(', ')}`)
}

module.exports = { verifyPackagedAppAsarContents }
