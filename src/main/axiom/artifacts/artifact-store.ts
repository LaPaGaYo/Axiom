import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import {
  ArtifactMetaSchema,
  MAX_ARTIFACT_BYTES,
  Sha256Schema
} from '../../../shared/axiom-contract/artifact-params'
import type { AxiomStore } from '../db/axiom-store'

const PutSchema = ArtifactMetaSchema.pick({
  missionId: true,
  kind: true,
  mediaType: true,
  related: true,
  createdBy: true
}).extend({ content: z.instanceof(Buffer) })

export function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

export class ArtifactStoreError extends Error {
  constructor(
    readonly code:
      | 'artifact_corrupt'
      | 'artifact_not_found'
      | 'invalid_argument'
      | 'mission_not_found'
  ) {
    super(code)
  }
}

export class ArtifactStore {
  constructor(
    private readonly store: AxiomStore,
    private readonly root: string
  ) {}

  pathFor(hash: string): string {
    return path.join(this.root, Sha256Schema.parse(hash))
  }

  async put(input: z.input<typeof PutSchema>) {
    const p = PutSchema.parse(input)
    if (p.content.length > MAX_ARTIFACT_BYTES) {
      throw new ArtifactStoreError('invalid_argument')
    }
    if (!this.store.getMission(p.missionId)) {
      throw new ArtifactStoreError('mission_not_found')
    }
    // Own the bytes across awaits; a caller must not change content after its hash is fixed.
    const content = Buffer.from(p.content)
    const hash = sha256(content)
    const id = `art_${sha256(JSON.stringify({ missionId: p.missionId, kind: p.kind, sha256: hash }))}`
    const existing = this.store.getArtifact(id)
    if (existing) {
      return existing
    }
    const destination = this.pathFor(hash)
    await mkdir(this.root, { recursive: true })
    try {
      await access(destination)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw error
      }
      const temporary = path.join(this.root, `.tmp-${randomUUID()}`)
      try {
        await writeFile(temporary, content, { flag: 'wx', mode: 0o600 })
        await rename(temporary, destination)
      } finally {
        await rm(temporary, { force: true })
      }
    }
    return this.store.insertArtifact({ ...p, id, sha256: hash, sizeBytes: content.length })
  }

  async read(id: string) {
    const meta = this.store.getArtifact(id)
    if (!meta) {
      throw new ArtifactStoreError('artifact_not_found')
    }
    let content: Buffer
    try {
      content = await readFile(this.pathFor(meta.sha256))
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw error
      }
      throw new ArtifactStoreError('artifact_corrupt')
    }
    if (sha256(content) !== meta.sha256 || content.length !== meta.sizeBytes) {
      throw new ArtifactStoreError('artifact_corrupt')
    }
    return { meta, content }
  }

  list(input: Parameters<AxiomStore['listArtifacts']>[0]) {
    return this.store.listArtifacts(input)
  }
}
