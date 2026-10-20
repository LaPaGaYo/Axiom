import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { fixture, createInput } from '../mission-controller/controller-fixture.test-support'
import { ArtifactStore } from '../artifacts/artifact-store'
import { ContextBuilder } from './context-builder'

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
