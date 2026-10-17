import {
  goal,
  makeProposal,
  policy,
  provenance
} from '../shared/axiom-contract/contract-fixtures.test-support'

export const cases: {
  command: string
  flags: Record<string, string>
  method: string
  params: unknown
}[] = [
  {
    command: 'mission create',
    flags: { repo: 'fixture', 'target-branch': 'main', 'goal-file': 'goal.json' },
    method: 'axiom.mission.create',
    params: {
      repo: 'fixture',
      targetBranch: 'main',
      goal,
      policy: { ...policy, budget: {}, unverifiableToleranceMinutes: 30 }
    }
  },
  {
    command: 'mission show',
    flags: { mission: 'm1' },
    method: 'axiom.mission.show',
    params: { missionId: 'm1' }
  },
  {
    command: 'mission list',
    flags: { repo: 'fixture', status: 'EXECUTING', cursor: 'm0' },
    method: 'axiom.mission.list',
    params: { repo: 'fixture', status: 'EXECUTING', cursor: 'm0' }
  },
  {
    command: 'mission start',
    flags: { mission: 'm1' },
    method: 'axiom.mission.start',
    params: { missionId: 'm1' }
  },
  ...['pause', 'resume', 'cancel'].map((verb) => ({
    command: `mission ${verb}`,
    flags: { mission: 'm1', reason: 'user request' },
    method: `axiom.mission.${verb}`,
    params: { missionId: 'm1', reason: 'user request' }
  })),
  {
    command: 'mission goal propose',
    flags: { mission: 'm1', 'goal-file': 'goal.json' },
    method: 'axiom.goal.propose',
    params: { missionId: 'm1', goal }
  },
  ...['activate', 'show'].map((verb) => ({
    command: `mission goal ${verb}`,
    flags: { mission: 'm1', goal: 'g1' },
    method: `axiom.goal.${verb}`,
    params: { missionId: 'm1', goalRevisionId: 'g1' }
  })),
  {
    command: 'plan propose',
    flags: { mission: 'm1', file: 'plan.json' },
    method: 'axiom.plan.propose',
    params: {
      missionId: 'm1',
      planRevision: { ...makeProposal(), provenance: undefined },
      provenance
    }
  },
  {
    command: 'plan approve',
    flags: { plan: 'p1', resolver: 'henry' },
    method: 'axiom.plan.approve',
    params: { planRevisionId: 'p1', resolver: 'henry' }
  },
  {
    command: 'plan reject',
    flags: { plan: 'p1', resolver: 'henry', reason: 'revise' },
    method: 'axiom.plan.reject',
    params: { planRevisionId: 'p1', resolver: 'henry', reason: 'revise' }
  },
  {
    command: 'plan list',
    flags: { mission: 'm1' },
    method: 'axiom.plan.list',
    params: { missionId: 'm1' }
  },
  {
    command: 'plan show',
    flags: { plan: 'p1' },
    method: 'axiom.plan.show',
    params: { planRevisionId: 'p1' }
  },
  {
    command: 'task list',
    flags: { mission: 'm1', stage: 'READY' },
    method: 'axiom.task.list',
    params: { missionId: 'm1', stage: 'READY' }
  },
  {
    command: 'task show',
    flags: { task: 't1' },
    method: 'axiom.task.show',
    params: { taskId: 't1' }
  },
  {
    command: 'task cancel',
    flags: { task: 't1', rationale: 'obsolete' },
    method: 'axiom.task.cancel',
    params: { taskId: 't1', rationale: 'obsolete' }
  }
]
