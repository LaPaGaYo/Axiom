import { afterEach, beforeEach, expect, it } from 'vitest'
import { plannerFixture } from '../execution/planner-fixture.test-support'
import { plannerProposalCommandPrefix } from './planner-render'

let f: Awaited<ReturnType<typeof plannerFixture>>
beforeEach(async () => {
  f = await plannerFixture()
})
afterEach(async () => {
  await f.close()
})

async function context(provider?: string) {
  return await f.contextBuilder.build({
    missionId: f.mission.id,
    role: 'planner',
    goalRevisionId: f.goalRevision.id,
    provider
  })
}

it('renders the MCP-only Claude proposal contract without a shell or file recipe', async () => {
  const { renderTemplate } = await context('claude')
  expect(renderTemplate).toContain('plan_propose')
  expect(renderTemplate).toContain('{ "proposal": <complete PlanProposal> }')
  expect(renderTemplate).toContain('Do not create, edit or commit any file')
  expect(renderTemplate).not.toContain('axiom plan propose')
  expect(renderTemplate).not.toContain('/dev/stdin')
  expect(renderTemplate).not.toContain('```bash')
})

it('preserves the existing Codex recipe when the provider is omitted or Codex', async () => {
  const implicit = await context()
  expect(await context('codex')).toEqual(implicit)
  expect(implicit.renderTemplate).toContain(
    `${plannerProposalCommandPrefix(f.mission.id, '{{attemptId}}')} <proposal.json> --json`
  )
  expect(implicit.renderTemplate).toContain('Write the proposal JSON outside the worktree')
  expect(implicit.renderTemplate).not.toContain('/dev/stdin')
})
