import type { AcceptanceCriterion } from '../../../shared/axiom-contract/mission-objects'
import type { VerificationAcceptance } from '../../../shared/axiom-contract/verification-acceptance'
import { redactContext } from '../context-builder/redaction'
import type { VerificationCheck } from './verification-plan-runner'
import type { WorkerArtifactChecks } from './worker-artifacts'

export function evaluateAcceptance(
  criteria: AcceptanceCriterion[],
  checks: Pick<VerificationCheck, 'index' | 'criteria' | 'result'>[],
  artifacts: WorkerArtifactChecks
): VerificationAcceptance[] {
  return criteria.map(({ text, check }, index) => {
    const entry: VerificationAcceptance = {
      index,
      text: redactContext(text).content,
      check:
        check.kind === 'command'
          ? { ...check, command: redactContext(check.command).content }
          : check,
      result: 'inconclusive',
      checkIndexes: [],
      artifactIds: []
    }
    if (check.kind === 'human') {
      entry.result = 'human'
    } else if (check.kind === 'artifact') {
      const proof = artifacts.checked.find(
        (artifact) =>
          (!check.artifactKind || artifact.kind === check.artifactKind) &&
          !artifact.problem &&
          artifact.bytes !== null &&
          artifact.bytes > 0
      )
      entry.result = proof ? 'pass' : 'fail'
      entry.artifactIds = proof ? [proof.id] : []
    } else {
      const step = checks.find((step) => step.criteria.includes(index))
      if (step) {
        entry.checkIndexes = [step.index]
        entry.result = step.result === 'environmental' ? 'inconclusive' : step.result
      }
    }
    return entry
  })
}
