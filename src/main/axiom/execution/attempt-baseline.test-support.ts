import type { AxiomStore } from '../db/axiom-store'

export function previousSubmission(
  store: AxiomStore,
  { missionId = 'm', taskId = 't', seq = 1, dispatchId = 'd1', reason = 'checks_failed' } = {}
) {
  if (!store.getAttemptBinding(taskId, seq)) {
    store.insertAttemptBinding({
      missionId,
      taskId,
      seq,
      dispatchId,
      branch: `axiom/attempt/${taskId}/${seq}`,
      agentSpecId: 'agent',
      contextPackageId: 'context'
    })
  }
  const candidate = store.insertCandidate({
    id: `candidate-${seq}`,
    missionId,
    taskId,
    attemptId: dispatchId,
    commitSha: String(seq).repeat(40),
    treeSha: 'a'.repeat(40),
    status: 'ACTIVE',
    supersededBy: null
  })
  const submission = store.insertSubmission({
    id: `submission-${seq}`,
    missionId,
    taskId,
    attemptId: dispatchId,
    candidateId: candidate.id,
    report: {
      summary: 'Candidate submitted',
      filesChanged: ['src/task.ts'],
      checksRun: [],
      artifacts: [],
      limitations: [],
      risks: [],
      questions: [],
      followUps: []
    }
  })
  const verificationRun = store.insertVerificationRun({
    id: `verification-${seq}`,
    missionId,
    taskId,
    candidateId: candidate.id,
    status: 'FAIL',
    verdictDetail: { verdict: 'FAIL', reason },
    commands: [],
    toolVersions: {},
    verifier: 'VerificationService'
  })
  return { candidate, submission, verificationRun }
}
