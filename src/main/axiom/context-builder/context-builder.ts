import { z } from 'zod'
import { AxiomIdSchema } from '../../../shared/axiom-contract/mission-objects'
import {
  canonicalContextManifest,
  ContextManifestSchema,
  type ContextManifest
} from '../../../shared/axiom-contract/context-package'
import type { AxiomStore } from '../db/axiom-store'
import type { ArtifactStore } from '../artifacts/artifact-store'
import { sha256 } from '../artifacts/artifact-store'
import { mandatorySections, markdownSection } from './render'
import { redactContext } from './redaction'
import { buildPlannerContext } from './planner-render'
import { resolveAttemptBaseline } from '../execution/attempt-baseline'
import { previousAttemptSection } from './previous-attempt'

const BuildParams = z.object({
  missionId: AxiomIdSchema,
  taskId: AxiomIdSchema,
  tokenBudget: z.number().int().nonnegative().optional()
})
const PlannerBuildParams = z.object({
  missionId: AxiomIdSchema,
  role: z.literal('planner'),
  goalRevisionId: AxiomIdSchema,
  repositoryRef: z.string().min(1).optional(),
  tokenBudget: z.number().int().nonnegative().optional()
})

export function estimateContextTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 4)
}

export class ContextBuilder {
  constructor(
    private readonly store: AxiomStore,
    private readonly artifacts: ArtifactStore
  ) {}

  build(input: z.input<typeof PlannerBuildParams>): ReturnType<typeof buildPlannerContext>
  build(input: z.input<typeof BuildParams>): ReturnType<ContextBuilder['buildWorker']>
  build(input: z.input<typeof BuildParams> | z.input<typeof PlannerBuildParams>) {
    return 'role' in input
      ? buildPlannerContext(this.store, this.artifacts, PlannerBuildParams.parse(input))
      : this.buildWorker(input)
  }

  private async buildWorker(input: z.input<typeof BuildParams>) {
    const p = BuildParams.parse(input)
    const tokenBudget = p.tokenBudget ?? this.store.getContextTokenBudget(p.missionId) ?? 24_000
    const baseline = resolveAttemptBaseline(this.store, {
      taskId: p.taskId,
      seq: this.store.nextAttemptSeq(p.taskId)
    })
    const previousAttempt = await previousAttemptSection(this.store, this.artifacts, baseline)
    const { task, incoming, sections, protocol } = await mandatorySections(
      this.store,
      p.missionId,
      p.taskId,
      previousAttempt
    )
    const mandatory = sections.map(({ section, source, text }, index) => {
      // The protocol is rendered last but belongs to the mandatory submission contract.
      // Include it in both the content hash and token charge so template changes change identity.
      const content = index === 3 ? `${text}\n${protocol}` : text
      return { section, source, sha256: sha256(content), tokens: estimateContextTokens(content) }
    })
    let used = mandatory.reduce((sum, entry) => sum + entry.tokens, 0)
    const budgetExceededByMandatory = used > tokenBudget
    const ranked: ContextManifest['ranked'] = []
    const omitted: ContextManifest['omitted'] = []
    const rendered: string[] = []
    const seen = new Set<string>()
    let exhausted = budgetExceededByMandatory
    for (const edge of incoming) {
      for (const meta of this.artifacts.list({
        missionId: p.missionId,
        relatedTo: edge.fromTaskId
      })) {
        if (!['handoff', 'worker_report'].includes(meta.kind) || seen.has(meta.id)) {
          continue
        }
        seen.add(meta.id)
        if (exhausted) {
          omitted.push({ artifactId: meta.id, reason: 'budget' })
          continue
        }
        const { content } = await this.artifacts.read(meta.id)
        const safe = redactContext(content.toString('utf8'))
        if (safe.redacted) {
          omitted.push({ artifactId: meta.id, reason: 'redacted' })
        }
        const section = `Upstream ${meta.kind}: ${meta.id}`
        const text = markdownSection(
          section,
          `${safe.redacted ? '[redacted]\n' : ''}${safe.content}`
        )
        const tokens = estimateContextTokens(text)
        if (used + tokens > tokenBudget) {
          exhausted = true
          omitted.push({ artifactId: meta.id, reason: 'budget' })
          continue
        }
        used += tokens
        ranked.push({ section, artifactId: meta.id, sha256: sha256(safe.content), tokens })
        rendered.push(text)
      }
    }
    const manifest = ContextManifestSchema.parse({
      version: 1,
      missionId: p.missionId,
      taskId: p.taskId,
      planRevisionId: task.planRevisionId,
      tokenBudget,
      mandatory,
      ranked,
      omitted,
      ...(budgetExceededByMandatory ? { budgetExceededByMandatory: true } : {})
    })
    const canonical = canonicalContextManifest(manifest)
    const packageId = `ctx_${sha256(canonical)}`
    const renderTemplate = [...sections.map((s) => s.text), ...rendered, protocol].join('\n')
    if (!this.store.getContextPackage(packageId)) {
      const common = { missionId: p.missionId, related: [p.taskId], createdBy: 'ContextBuilder' }
      const manifestArtifact = await this.artifacts.put({
        ...common,
        kind: 'context_package_manifest',
        mediaType: 'application/json',
        content: Buffer.from(canonical)
      })
      const renderArtifact = await this.artifacts.put({
        ...common,
        kind: 'context_package_render',
        mediaType: 'text/markdown',
        content: Buffer.from(renderTemplate)
      })
      this.store.insertContextPackage({
        id: packageId,
        missionId: p.missionId,
        taskId: p.taskId,
        planRevisionId: task.planRevisionId,
        manifest,
        tokenBudget,
        mandatoryRefs: [manifestArtifact.id, renderArtifact.id],
        rankedRefs: ranked.map((entry) => entry.artifactId)
      })
    }
    return { packageId, manifest, renderTemplate }
  }
}
