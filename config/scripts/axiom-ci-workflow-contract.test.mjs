import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

const workflowsDir = fileURLToPath(new URL('../../.github/workflows', import.meta.url))
const jobIds = ['axiom-tests', 'lint', 'typecheck']
const testTargets = [
  'src/main/axiom',
  'src/shared/axiom-contract',
  'src/main/runtime/rpc/methods/axiom',
  'src/main/runtime/orchestration/db/schema',
  'src/cli/specs',
  'src/cli/handlers/axiom',
  'src/renderer/src/components/missions',
  'src/renderer/src/lib/axiom-client.test.ts',
  'src/renderer/src/lib/missions-view.test.ts',
  'tests/e2e/helpers/fixture-plan-proposal.unit.test.ts'
]

const installAction = './.github/actions/install-node-dependencies'
const retryCondition = "steps.deps.outcome == 'failure'"

// Why: one npm registry timeout in pnpm's own download failed every job of run #42, so the
// dependency install may run twice; nothing after it may be skipped or allowed to fail.
function expectRetriedInstall(job) {
  const [checkout, install, wait, retry] = job.steps
  expect(checkout.uses).toBe('actions/checkout@v6')
  expect(checkout.with['persist-credentials']).toBe(false)
  expect(install).toMatchObject({ id: 'deps', 'continue-on-error': true, uses: installAction })
  expect(install.if).toBeUndefined()
  expect(wait).toEqual({
    name: 'Wait before retrying the install',
    if: retryCondition,
    run: 'sleep 30'
  })
  expect(retry.if).toBe(retryCondition)
  expect(retry['continue-on-error']).toBeUndefined()
  expect(retry.uses).toBe(installAction)
  expect(retry.with).toEqual(install.with)
  return job.steps.slice(4)
}

function readWorkflow(file = 'axiom-ci.yml') {
  const document = parseDocument(readFileSync(join(workflowsDir, file), 'utf8'))
  expect(document.errors, file).toEqual([])
  return document.toJS()
}

describe('Axiom hosted second signal (D41 / D45)', () => {
  it('runs on every push to main and manual dispatch only', () => {
    expect(readWorkflow().on).toEqual({
      push: { branches: ['main'] },
      workflow_dispatch: {}
    })
  })

  it('cancels superseded runs per ref with read-only permissions', () => {
    const workflow = readWorkflow()
    expect(workflow.concurrency).toEqual({
      group: 'axiom-ci-${{ github.ref }}',
      'cancel-in-progress': true
    })
    expect(workflow.permissions).toEqual({ contents: 'read' })
  })

  it('runs exactly three bounded, parallel Ubuntu 24.04 jobs with shared, retried setup', () => {
    const { jobs } = readWorkflow()
    expect(Object.keys(jobs).sort()).toEqual(jobIds)
    for (const job of Object.values(jobs)) {
      expect(job['runs-on']).toBe('ubuntu-24.04')
      expect(Number.isInteger(job['timeout-minutes'])).toBe(true)
      expect(job['timeout-minutes']).toBeGreaterThan(0)
      expect(job['timeout-minutes']).toBeLessThanOrEqual(30)
      expect(job.needs).toBeUndefined()
      expect(job.if).toBeUndefined()
      expect(job['continue-on-error']).toBeUndefined()
      expect(job.permissions).toBeUndefined()
      for (const step of expectRetriedInstall(job)) {
        expect(step.if).toBeUndefined()
        expect(step['continue-on-error']).toBeUndefined()
      }
    }
    expect(jobs.typecheck.steps[1].with?.['native-runtime']).toBeUndefined()
    expect(jobs['axiom-tests'].steps[1].with['native-runtime']).toBe('node')
  })

  it('runs separate typechecks, the full lint chain and exactly the Axiom test targets', () => {
    const { jobs } = readWorkflow()
    const checkRuns = (job) =>
      expectRetriedInstall(job)
        .filter((step) => step.run)
        .map((step) => step.run)
    expect(checkRuns(jobs.typecheck)).toEqual(['pnpm tc:node', 'pnpm tc:cli', 'pnpm tc:web'])
    expect(checkRuns(jobs.lint)).toEqual(['pnpm lint'])
    const testSteps = expectRetriedInstall(jobs['axiom-tests']).filter((step) => step.run)
    expect(testSteps).toHaveLength(1)
    expect(
      testSteps[0].run
        .replace(/\\\r?\n/g, ' ')
        .trim()
        .split(/\s+/)
    ).toEqual([
      'ORCA_BACKGROUND_LAUNCH=1',
      'pnpm',
      'exec',
      'vitest',
      'run',
      '--config',
      'config/vitest.config.ts',
      ...testTargets
    ])
  })

  it('keeps the repository push-trigger census limited to D41 / D45', () => {
    const pushWorkflows = readdirSync(workflowsDir)
      .filter((file) => /\.ya?ml$/.test(file))
      .filter((file) => Object.hasOwn(readWorkflow(file).on ?? {}, 'push'))
      .sort()
    expect(pushWorkflows).toEqual([
      'axiom-ci.yml',
      'daemon-relocation-spike.yml',
      'win-update-e2e.yml',
      'win-update-survival-e2e.yml'
    ])
  })
})
