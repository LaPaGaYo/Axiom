import { lstatSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Only temp fixture homes: lstat never walks through a resource link. */
export function snapshotAccountTestHome(
  root: string
): { path: string; size: number; mtimeMs: number }[] {
  return readdirSync(root)
    .sort()
    .flatMap((name) => {
      const path = join(root, name)
      const stat = lstatSync(path)
      return [
        { path, size: stat.size, mtimeMs: stat.mtimeMs },
        ...(stat.isDirectory() ? snapshotAccountTestHome(path) : [])
      ]
    })
}
