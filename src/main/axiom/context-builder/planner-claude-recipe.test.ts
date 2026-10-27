import { createRequire } from 'node:module'
import path from 'node:path'
import { runProcess } from '@orca/process-host'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
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

it('renders a Claude stdin recipe with the same narrowly bound permission prefix', async () => {
  const { renderTemplate } = await context('claude')
  expect(renderTemplate).toContain(
    `${plannerProposalCommandPrefix(f.mission.id, '{{attemptId}}')} /dev/stdin --json <<'AXIOM_PLAN_JSON'`
  )
  expect(renderTemplate).toMatch(/<<'AXIOM_PLAN_JSON'\n\{[\s\S]+\n\}\nAXIOM_PLAN_JSON\n```/)
  expect(renderTemplate).not.toContain('Write the proposal JSON outside the worktree')
  expect(renderTemplate).not.toContain('except the proposal JSON')
  expect(renderTemplate).toContain('Do not create, edit or commit any file')
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

it.skipIf(process.platform === 'win32')(
  'submits the rendered heredoc through the existing CLI input reader without a proposal file',
  async () => {
    const { renderTemplate } = await context('claude')
    const recipe = renderTemplate.match(/```bash\n([\s\S]*?)\n```/)?.[1]
    expect(recipe).toBeDefined()
    const require = createRequire(import.meta.url)
    const reader = path.resolve('src/cli/handlers/axiom/input-files.ts')
    const script = [
      `const { readPlannerPlanFile } = require(${JSON.stringify(reader)});`,
      "const file = process.argv[process.argv.indexOf('--file') + 1];",
      'readPlannerPlanFile(process.cwd(), file).then(value => process.stdout.write(JSON.stringify(value)));'
    ].join('\n')
    const command = [
      // Replace only the RPC front end with its real input reader; execute the printed shell recipe.
      `axiom() { ${quotePosixShell(process.execPath)} --require ${quotePosixShell(require.resolve('tsx/cjs'))} --eval ${quotePosixShell(script)} -- "$@"; }`,
      recipe!.replace('{{attemptId}}', 'ctx_stdin')
    ].join('\n')
    const result = await runProcess({
      program: '/bin/bash',
      args: ['--noprofile', '--norc', '-c', command],
      cwd: f.root,
      env: { PATH: '/usr/bin:/bin', TSX_DISABLE_CACHE: '1' },
      timeoutMs: 5_000,
      maxOutputBytes: 32_768
    })
    expect(result.code, result.stderr).toBe(0)
    expect(result.timedOut).toBe(false)
    expect(result.outputTruncated).not.toBe(true)
    expect(JSON.parse(result.stdout)).toMatchObject({
      goalRevisionId: f.goalRevision.id,
      milestones: [{ id: 'M1' }],
      tasks: [{ id: 'T1' }, { id: 'T2' }],
      edges: [{ fromTaskId: 'T1', toTaskId: 'T2' }]
    })
  }
)
