import { TaskCreateParams } from '../../../shared/axiom-contract/task-params'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { z } from 'zod'
import { GoalBodySchema, RoutingPolicySchema } from '../../../shared/axiom-contract/mission-objects'
import { PlanProposalSchema } from '../../../shared/axiom-contract/plan-proposal'
import { RuntimeClientError } from '../../runtime/types'

async function readInput<T>(
  cwd: string,
  file: string,
  parse: (text: string, path: string) => Promise<T> | T
): Promise<T> {
  const path = resolve(cwd, file)
  try {
    return await parse(await readFile(path, 'utf8'), path)
  } catch (error) {
    if (error instanceof RuntimeClientError) {
      throw error
    }
    throw new RuntimeClientError(
      'invalid_argument',
      `Cannot read valid input from ${file}`,
      error instanceof z.ZodError ? { issues: error.issues } : undefined
    )
  }
}

export function readGoalFile(cwd: string, file: string) {
  return readInput(cwd, file, async (text, path) => {
    const extension = extname(path).toLowerCase()
    if (extension === '.json') {
      return GoalBodySchema.parse(JSON.parse(text))
    }
    if (extension !== '.md') {
      throw new RuntimeClientError('invalid_argument', '--goal-file must be a .md or .json file')
    }
    // File time keeps an unchanged Markdown goal byte-for-byte stable on --retry-request.
    return GoalBodySchema.parse({
      objective: text,
      constraints: [],
      acceptanceCriteria: [],
      provenance: { kind: 'user', actor: 'user', at: (await stat(path)).mtime.toISOString() }
    })
  })
}

export function readPlanFile(cwd: string, file: string) {
  return readInput(cwd, file, (text) => PlanProposalSchema.parse(JSON.parse(text)))
}

export function readRoutingFile(cwd: string, file: string) {
  return readInput(cwd, file, (text) => RoutingPolicySchema.parse(JSON.parse(text)))
}

export function readTaskFile(cwd: string, file: string) {
  return readInput(cwd, file, async (text, path) => ({
    task: TaskCreateParams.shape.task.parse(JSON.parse(text)),
    provenance: { kind: 'user' as const, actor: 'user', at: (await stat(path)).mtime.toISOString() }
  }))
}
