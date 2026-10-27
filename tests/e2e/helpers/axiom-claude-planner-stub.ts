import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { quotePosixShell } from '../../../src/shared/shell-argument-quoting'

/** Absolute executables avoid a login-shell PATH selecting a real provider. */
export function createAxiomClaudePlannerStub(directory: string) {
  const executable = path.join(directory, 'claude')
  const script = path.join(
    process.cwd(),
    'tests',
    'e2e',
    'fixtures',
    'axiom-claude-planner-stub.cjs'
  )
  writeFileSync(
    executable,
    `#!/bin/sh\nexport PATH=${quotePosixShell(directory)}:"$PATH"\nexec ${quotePosixShell(process.execPath)} ${quotePosixShell(script)} "$@"\n`,
    { mode: 0o755 }
  )
  // Execute the preamble's exact axiom command using the same compiled CLI as the Codex fixture.
  writeFileSync(
    path.join(directory, 'axiom'),
    `#!/bin/sh\nexec ${quotePosixShell(process.execPath)} "$ORCA_E2E_CLI_ENTRY" "$@"\n`,
    { mode: 0o755 }
  )
  return executable
}
