import { createHash } from 'node:crypto'
import type { SkillCloudPublishRequest } from '../../shared/skill-cloud-contract'

export function publishUploadIdempotencyKey(request: SkillCloudPublishRequest): string {
  return (
    request.idempotencyKey ??
    createHash('sha256').update(`${request.packageId}\0${request.archiveSha256}`).digest('hex')
  )
}
