import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { fixture, createInput } from '../mission-controller/controller-fixture.test-support'
import { ArtifactStore } from '../artifacts/artifact-store'
import { ContextBuilder } from './context-builder'
import * as repositoryRules from './repository-rules'
import { z } from 'zod'
import { PlanProposalSchema } from '../../../shared/axiom-contract/plan-proposal'

it.each([[], ['Checks pass']].map((acceptanceCriteria) => ({ acceptanceCriteria })))(
  'explains proposal rules with conditional Goal coverage (%j)',
  async ({ acceptanceCriteria }) => {
    const root = await mkdtemp(path.join(tmpdir(), 'axiom-planner-contract-'))
    const f = fixture()
    vi.spyOn(repositoryRules, 'readRepositoryRules').mockResolvedValue('Repository rules')
    try {
      const { mission, goalRevision } = f.controller.createMission({
        ...createInput,
        goal: { ...createInput.goal, acceptanceCriteria }
      })
      f.store.upsertPolicy(mission.id, {
        ...f.store.getPolicy(mission.id)!,
        verificationRules: {
          evidenceCommands: { allowedPrograms: ['pnpm'] },
          repositoryGates: { high: ['node gate.js'] },
          setupCommands: ['toolchain prepare']
        }
      })
      const result = await new ContextBuilder(f.store, new ArtifactStore(f.store, root)).build({
        missionId: mission.id,
        role: 'planner',
        goalRevisionId: goalRevision.id
      })
      expect(result.renderTemplate).toContain('Every acceptanceCriteria entry is { text, check }.')
      expect(result.renderTemplate).toContain(
        'check.kind = "command" carries one exact shell command'
      )
      expect(result.renderTemplate).toContain(
        '"artifact" means the submission must reference a readable, non-empty Artifact'
      )
      expect(result.renderTemplate).toContain('"human" means no command or Artifact can prove it')
      expect(result.renderTemplate).toContain('requiredEvidence is retired and rejected')
      expect(result.renderTemplate).toContain('acceptance_uncheckable')
      expect(result.renderTemplate).toContain('scope_overlap')
      expect(result.renderTemplate).toContain('Declare coversGoalCriteria on every Task')
      expect(result.renderTemplate).toContain('the program must be one of: pnpm, toolchain, node')
      expect(result.renderTemplate).toContain('pnpm exec vitest run tests/example.test.ts')
      expect(result.renderTemplate).not.toContain('Test results')
      expect(result.renderTemplate).not.toContain(
        'requiredEvidence entries are exact shell commands'
      )
      const example = result.renderTemplate
        .split('## Minimal example')[1]
        .split('## Planner proposal recipe')[0]
      expect(example).not.toContain('requiredEvidence')
      const parsedExample = PlanProposalSchema.omit({ provenance: true }).parse(
        JSON.parse(example.trim())
      )
      expect(parsedExample.tasks.map((task) => task.coversGoalCriteria)).toEqual(
        acceptanceCriteria.length ? [[0], [0]] : [undefined, undefined]
      )
      for (const kind of ['command', 'artifact', 'human']) {
        expect(example).toContain(`"kind": "${kind}"`)
      }
      const jsonSchema = z.toJSONSchema(PlanProposalSchema)
      expect(jsonSchema).toMatchObject({
        properties: {
          tasks: {
            items: {
              properties: {
                requiredEvidence: {
                  description: expect.stringContaining(
                    'retired by D85 rule 2: put the command on the criterion'
                  )
                },
                acceptanceCriteria: {
                  items: {
                    anyOf: expect.arrayContaining([
                      expect.objectContaining({
                        type: 'object',
                        properties: expect.objectContaining({
                          text: expect.any(Object),
                          check: expect.objectContaining({ oneOf: expect.any(Array) })
                        })
                      })
                    ])
                  }
                }
              }
            }
          }
        }
      })
    } finally {
      vi.restoreAllMocks()
      f.db.close()
      await rm(root, { recursive: true, force: true })
    }
  }
)

// Opt-in evidence render: the frozen repository is external to this checkout.
it.runIf(process.env.AXIOM_FIXTURE_REPO && process.env.AXIOM_PLANNER_EXAMPLE)(
  'renders the frozen fixture goal with its repository rules for the Worker report',
  async () => {
    const repoPath = process.env.AXIOM_FIXTURE_REPO!
    const root = await mkdtemp(path.join(tmpdir(), 'axiom-planner-render-'))
    const f = fixture()
    try {
      const { mission, goalRevision } = f.controller.createMission({
        ...createInput,
        repoPath,
        targetBranch: 'fixture-v1',
        goal: {
          ...createInput.goal,
          objective: await readFile(path.join(repoPath, 'GOAL.md'), 'utf8'),
          constraints: [],
          acceptanceCriteria: []
        }
      })
      const builder = new ContextBuilder(f.store, new ArtifactStore(f.store, root))
      const result = await builder.build({
        missionId: mission.id,
        role: 'planner',
        goalRevisionId: goalRevision.id
      })
      expect(result.renderTemplate).toContain(JSON.stringify(goalRevision.objective))
      expect(result.renderTemplate).toContain('axiom plan propose')
      expect(f.store.getContextPackage(result.packageId)).toBeUndefined()
      await writeFile(
        process.env.AXIOM_PLANNER_EXAMPLE!,
        JSON.stringify(
          {
            ...result,
            bytes: Buffer.byteLength(result.renderTemplate)
          },
          null,
          2
        )
      )
    } finally {
      f.db.close()
      await rm(root, { recursive: true, force: true })
    }
  }
)
