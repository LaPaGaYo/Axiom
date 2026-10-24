import { gitExecFileAsync, gitStreamStdout } from '../../git/runner'
import { gitOptionsForWorktree } from '../../git/git-runtime-options'

export type CandidateDiff =
  | {
      ok: true
      integrationBase: { branch: string; sha: string }
      mergeBase: string
      candidateCommitSha: string
      changes: { status: string; path: string }[]
      addedText: Map<string, string>
      binary: string[]
      patchComplete: boolean
    }
  | {
      ok: false
      reason: 'integration_base_unavailable' | 'merge_base_unavailable' | 'diff_unavailable'
      integrationBase?: { branch: string; sha?: string }
      mergeBase?: string
    }

const DIFF_FLAGS = [
  'diff',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--no-renames',
  '--ignore-submodules=none'
]
const PATCH_BYTE_LIMIT = 32 * 1024 * 1024

function parsePatch(patch: string, changes: { status: string; path: string }[]) {
  const sections: string[][] = []
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      sections.push([])
    } else {
      sections.at(-1)?.push(line)
    }
  }
  const expectedSections = changes.reduce(
    (count, change) => count + (change.status === 'T' ? 2 : 1),
    0
  )
  if (sections.length !== expectedSections) {
    return null
  }
  const addedText = new Map<string, string>()
  const binary: string[] = []
  let sectionIndex = 0
  for (const change of changes) {
    // Git emits a deletion and creation for a type change, both for the same path.
    const count = change.status === 'T' ? 2 : 1
    let hasBinarySection = false
    const added: string[] = []
    for (const lines of sections.slice(sectionIndex, sectionIndex + count)) {
      let inHunk = false
      let isBinary = false
      for (const line of lines) {
        if (line.startsWith('@@')) {
          inHunk = true
        }
        if (!inHunk && line.startsWith('Binary files ')) {
          isBinary = true
        }
        if (inHunk && line.startsWith('+')) {
          added.push(line.slice(1))
        }
      }
      hasBinarySection ||= isBinary && !inHunk
    }
    sectionIndex += count
    if (hasBinarySection) {
      binary.push(change.path)
    }
    if (added.length) {
      addedText.set(change.path, added.join('\n'))
    }
  }
  return { addedText, binary }
}

/** Read only immutable commit identities after resolving the integration ref once. */
export async function readCandidateDiff(input: {
  cwd: string
  missionId: string
  candidateCommitSha: string
  patchByteLimit?: number
}): Promise<CandidateDiff> {
  const { cwd, missionId, candidateCommitSha, patchByteLimit = PATCH_BYTE_LIMIT } = input
  const options = gitOptionsForWorktree(cwd)
  const branch = `axiom/integration/${missionId}`
  let sha: string
  try {
    sha = (
      await gitExecFileAsync(
        ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`],
        options
      )
    ).stdout.trim()
  } catch {
    return { ok: false, reason: 'integration_base_unavailable', integrationBase: { branch } }
  }
  const integrationBase = { branch, sha }
  let mergeBase: string
  try {
    mergeBase = (
      await gitExecFileAsync(['merge-base', sha, candidateCommitSha], options)
    ).stdout.trim()
  } catch (error) {
    const nonzeroExit =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'number' &&
      error.code !== 0
    return {
      ok: false,
      reason: nonzeroExit ? 'merge_base_unavailable' : 'diff_unavailable',
      integrationBase
    }
  }
  try {
    const { stdout } = await gitExecFileAsync(
      [...DIFF_FLAGS, '--name-status', '-z', mergeBase, candidateCommitSha],
      options
    )
    const tokens = stdout.split('\0')
    if (tokens.at(-1) === '') {
      tokens.pop()
    }
    if (tokens.length % 2 !== 0) {
      throw new Error('Invalid name-status pairs')
    }
    const changes: { status: string; path: string }[] = []
    for (let i = 0; i < tokens.length; i += 2) {
      changes.push({ status: tokens[i], path: tokens[i + 1] })
    }
    const chunks: string[] = []
    let bytes = 0
    const stream = await gitStreamStdout(
      [...DIFF_FLAGS, '--submodule=short', '-U0', mergeBase, candidateCommitSha],
      {
        ...options,
        // The callback owns the byte limit; the runner checks maxBuffer before invoking it.
        maxBuffer: Number.MAX_SAFE_INTEGER,
        onStdout(chunk) {
          bytes += Buffer.byteLength(chunk)
          if (bytes > patchByteLimit) {
            return true
          }
          chunks.push(chunk)
          return false
        }
      }
    )
    if (stream.stoppedEarly) {
      return {
        ok: true,
        integrationBase,
        mergeBase,
        candidateCommitSha,
        changes,
        addedText: new Map(),
        binary: [],
        patchComplete: false
      }
    }
    const parsed = parsePatch(chunks.join(''), changes)
    if (!parsed) {
      throw new Error('Mismatched diff sections')
    }
    return {
      ok: true,
      integrationBase,
      mergeBase,
      candidateCommitSha,
      changes,
      ...parsed,
      patchComplete: true
    }
  } catch {
    // Git output can contain secrets. Persist only fixed reasons and resolved identities.
    return { ok: false, reason: 'diff_unavailable', integrationBase, mergeBase }
  }
}
