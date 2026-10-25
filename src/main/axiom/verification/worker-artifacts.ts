import type { ArtifactKind } from '../../../shared/axiom-contract/artifact-params'
import type { ArtifactStore } from '../artifacts/artifact-store'
import type { AxiomStore } from '../db/axiom-store'

export type ArtifactProblem = 'unreadable' | 'empty' | 'invalid_utf8' | 'invalid_json'
export type WorkerArtifactChecks = {
  required: boolean
  checked: {
    id: string
    kind: ArtifactKind | null
    mediaType: string | null
    bytes: number | null
    problem?: ArtifactProblem
  }[]
  counts: { checked: number } & Record<ArtifactProblem, number>
}

function contentProblem(content: Buffer, mediaType: string): ArtifactProblem | undefined {
  if (!content.length) {
    return 'empty'
  }
  const type = mediaType.split(';')[0].trim().toLowerCase()
  const json = type === 'application/json' || /^application\/[^/]+\+json$/.test(type)
  if (!type.startsWith('text/') && !json) {
    return
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(content)
  } catch {
    return 'invalid_utf8'
  }
  if (json) {
    try {
      JSON.parse(text)
    } catch {
      return 'invalid_json'
    }
  }
  return undefined
}

/** Inspect every reference; only the evidence list is capped, never the verdict counts. */
export async function checkWorkerArtifacts(input: {
  store: AxiomStore
  artifacts: ArtifactStore
  attemptId: string
  required: boolean
}): Promise<WorkerArtifactChecks> {
  const { store, artifacts, attemptId, required } = input
  const ids = store.getSubmissionByDispatch(attemptId)?.report.artifacts ?? []
  const result: WorkerArtifactChecks = {
    required,
    checked: [],
    counts: { checked: ids.length, unreadable: 0, empty: 0, invalid_utf8: 0, invalid_json: 0 }
  }
  for (const id of ids) {
    const check: WorkerArtifactChecks['checked'][number] = {
      id,
      kind: null,
      mediaType: null,
      bytes: null
    }
    try {
      const stored = store.getArtifact(id)
      check.kind = stored?.kind ?? null
      check.mediaType = stored?.mediaType ?? null
      check.bytes = stored?.sizeBytes ?? null
      const { meta, content } = await artifacts.read(id)
      check.kind = meta.kind
      check.mediaType = meta.mediaType
      check.bytes = content.length
      const problem = contentProblem(content, meta.mediaType)
      if (problem) {
        check.problem = problem
      }
    } catch {
      // Store failures are environmental; never persist raw errors or Artifact content.
      check.problem = 'unreadable'
    }
    if (check.problem) {
      result.counts[check.problem]++
    }
    if (result.checked.length < 50) {
      result.checked.push(check)
    }
  }
  return result
}
