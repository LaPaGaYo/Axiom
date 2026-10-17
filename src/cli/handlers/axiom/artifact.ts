import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { CommandHandler } from '../../dispatch'
import { getRequiredStringFlag as required, getOptionalStringFlag as optional } from '../../flags'
import {
  ArtifactKind,
  ArtifactPutResponseSchema,
  ArtifactReadResponseSchema,
  ArtifactListResponseSchema,
  MAX_ARTIFACT_BYTES
} from '../../../shared/axiom-contract/artifact-params'
import { RuntimeClientError } from '../../runtime/types'
import { callAxiom } from './rpc-command'

async function contentBase64(cwd: string, file: string) {
  try {
    const filename = path.resolve(cwd, file)
    if ((await stat(filename)).size > MAX_ARTIFACT_BYTES) {
      throw new RuntimeClientError('invalid_argument', 'Artifact exceeds 8 MiB')
    }
    const bytes = await readFile(filename)
    if (bytes.length > MAX_ARTIFACT_BYTES) {
      throw new RuntimeClientError('invalid_argument', 'Artifact exceeds 8 MiB')
    }
    return bytes.toString('base64')
  } catch (error) {
    if (error instanceof RuntimeClientError) {
      throw error
    }
    throw new RuntimeClientError('invalid_argument', 'Cannot read artifact file')
  }
}

export const AXIOM_ARTIFACT_HANDLERS: Record<string, CommandHandler> = {
  'mission artifact put': async (ctx) => {
    const kind = ArtifactKind.safeParse(required(ctx.flags, 'kind'))
    if (!kind.success) {
      throw new RuntimeClientError('invalid_argument', 'Unknown artifact kind')
    }
    const related = optional(ctx.flags, 'related')
    await callAxiom(
      ctx,
      'axiom.artifact.put',
      {
        missionId: required(ctx.flags, 'mission'),
        kind: kind.data,
        contentBase64: await contentBase64(ctx.cwd, required(ctx.flags, 'file')),
        mediaType: optional(ctx.flags, 'media-type') ?? 'application/octet-stream',
        related: related ? related.split(',') : [],
        createdBy: optional(ctx.flags, 'created-by') ?? 'user'
      },
      (value) => ArtifactPutResponseSchema.parse(value).artifact.id
    )
  },
  'mission artifact read': async (ctx) => {
    await callAxiom(ctx, 'axiom.artifact.read', { id: required(ctx.flags, 'artifact') }, (value) =>
      Buffer.from(ArtifactReadResponseSchema.parse(value).contentBase64, 'base64').toString('utf8')
    )
  },
  'mission artifact list': async (ctx) => {
    await callAxiom(
      ctx,
      'axiom.artifact.list',
      {
        missionId: required(ctx.flags, 'mission'),
        kind: optional(ctx.flags, 'kind'),
        relatedTo: optional(ctx.flags, 'related')
      },
      (value) =>
        ArtifactListResponseSchema.parse(value)
          .artifacts.map((item) => `${item.id}\t${item.kind}\t${item.sizeBytes}`)
          .join('\n')
    )
  }
}
