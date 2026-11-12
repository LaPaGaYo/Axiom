import { readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { CodexThreadId } from './in-place-session'
import { PRESERVATION_GIT_TIMEOUT_MS } from './preservation-policy'

function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file)
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

/** Names and file metadata only; the limit reader separately opens its selected plain rollout. */
export async function findCodexSessionRecord(input: {
  accountHome: string
  threadId: string
  startedAt: number
  now: number
  includeArchived?: boolean
}): Promise<string | undefined> {
  if (
    !path.isAbsolute(input.accountHome) ||
    !CodexThreadId.safeParse(input.threadId).success ||
    !Number.isFinite(input.startedAt) ||
    !Number.isFinite(input.now) ||
    input.startedAt > input.now
  ) {
    return undefined
  }
  const deadline = Date.now() + PRESERVATION_GIT_TIMEOUT_MS
  try {
    const root = path.join(await realpath(input.accountHome), 'sessions')
    if ((await realpath(root)) !== root) {
      return undefined
    }
    const day = new Date(input.startedAt)
    day.setHours(0, 0, 0, 0)
    let latest: { file: string; mtimeMs: number } | undefined
    // Only the origin dispatch local calendar days, never a recursive home scan.
    while (day.getTime() <= input.now) {
      if (Date.now() > deadline) {
        throw new Error('continuation_evidence_timeout')
      }
      const directory = path.join(
        root,
        String(day.getFullYear()),
        String(day.getMonth() + 1).padStart(2, '0'),
        String(day.getDate()).padStart(2, '0')
      )
      day.setDate(day.getDate() + 1)
      let resolved: string
      try {
        resolved = await realpath(directory)
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          continue
        }
        throw error
      }
      if (!inside(root, resolved)) {
        return undefined
      }
      for (const name of await readdir(resolved)) {
        if (Date.now() > deadline) {
          throw new Error('continuation_evidence_timeout')
        }
        if (
          !name.startsWith('rollout-') ||
          !(
            name.endsWith(`-${input.threadId}.jsonl`) ||
            (input.includeArchived && name.endsWith(`-${input.threadId}.jsonl.zst`))
          )
        ) {
          continue
        }
        const file = await realpath(path.join(resolved, name))
        if (!inside(root, file)) {
          return undefined
        }
        const info = await stat(file)
        if (info.isFile() && (!latest || info.mtimeMs > latest.mtimeMs)) {
          latest = { file, mtimeMs: info.mtimeMs }
        }
      }
    }
    return latest?.file
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}
