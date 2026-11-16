import { mkdtemp, rmdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { GitObjectIdSchema } from '../../../shared/axiom-contract/submission-params'
import { splitWorktreeIdForFilesystem } from '../../../shared/worktree/id'
import { gitExecFileAsync } from '../../git/runner'
import { gitOptionsForWorktree } from '../../git/git-runtime-options'
import type { AxiomStore } from '../db/axiom-store'

export type CommitPin =
  | { pinned: true; ref: string }
  | { pinned: false; ref: string; reason: 'ref_conflict' | 'unavailable' }

export async function pinCommit(input: {
  cwd: string
  ref: string
  commitSha: string
}): Promise<CommitPin> {
  const { cwd, ref } = input
  const unavailable = { pinned: false, ref, reason: 'unavailable' } as const
  try {
    if (
      !ref.startsWith('refs/axiom/') ||
      !path.isAbsolute(cwd) ||
      !(await stat(cwd)).isDirectory()
    ) {
      return unavailable
    }
    const commitSha = GitObjectIdSchema.parse(input.commitSha)
    const options = { ...gitOptionsForWorktree(cwd), timeout: 30_000 }
    const hooksPath = await mkdtemp(path.join(tmpdir(), 'axiom-pin-hooks-'))
    try {
      await gitExecFileAsync(
        [
          '-c',
          `core.hooksPath=${hooksPath}`,
          'update-ref',
          ref,
          commitSha,
          '0'.repeat(commitSha.length)
        ],
        options
      )
      return { pinned: true, ref }
    } catch {
      const { stdout } = await gitExecFileAsync(
        ['for-each-ref', '--format=%(refname) %(objectname)', ref],
        options
      )
      // A literal pattern also lists descendants; only the exact ref can be this pin.
      const entry = stdout.split('\n').find((line) => line.startsWith(`${ref} `))
      if (!entry) {
        return unavailable
      }
      const existing = GitObjectIdSchema.parse(entry.slice(ref.length + 1))
      return existing === commitSha
        ? { pinned: true, ref }
        : { pinned: false, ref, reason: 'ref_conflict' }
    } finally {
      await rmdir(hooksPath)
    }
  } catch {
    return unavailable
  }
}

export async function pinCandidateRef(
  worktreeId: string,
  candidateId: string,
  commitSha: string
): Promise<CommitPin> {
  const ref = `refs/axiom/candidates/${candidateId}`
  const worktree = splitWorktreeIdForFilesystem(worktreeId)
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(candidateId) || !worktree?.worktreePath) {
    return { pinned: false, ref, reason: 'unavailable' }
  }
  return pinCommit({ cwd: worktree.worktreePath, ref, commitSha })
}

export function recordCandidatePin(
  store: AxiomStore,
  candidate: { missionId: string; id: string },
  pin: CommitPin
): void {
  if (!pin.pinned) {
    store.appendAuditEvent({
      missionId: candidate.missionId,
      actor: 'AttemptSettlement',
      objectKind: 'candidate',
      objectId: candidate.id,
      event: 'candidate.pin_failed',
      before: null,
      after: { ref: pin.ref, reason: pin.reason }
    })
  }
}
