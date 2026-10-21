import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { AxiomStore } from '../db/axiom-store'
import type { ArtifactStore } from '../artifacts/artifact-store'
import type { MissionController } from '../mission-controller/mission-controller'
import { claimVerification } from './verification-claim'
import { prepareVerification } from './verification-prepare'
import { recoverVerifications } from './verification-recovery'

export type VerificationDependencies = {
  store: AxiomStore
  missions: MissionController
  artifacts: ArtifactStore
  runtime: Pick<
    OrcaRuntimeService,
    'createManagedWorktree' | 'removeManagedWorktree' | 'listManagedWorktrees'
  >
  runtimeEpoch: string
}

export class VerificationService {
  private flight?: Promise<void>
  private recovery?: Promise<void>
  private pending = false
  // Only audit suppression is process-local; pending cleanup and ownership remain durable.
  private readonly reportedRecoveryFailures = new Set<string>()

  constructor(private readonly deps: VerificationDependencies) {}

  claimNext(missionId?: string) {
    return claimVerification(this.deps, missionId)
  }

  kick(_missionId?: string): Promise<void> {
    // ponytail: one global drain per plane; mission hints never strand another Mission's queue.
    this.pending = true
    if (this.flight) {
      return this.flight
    }
    this.flight = Promise.resolve().then(async () => {
      try {
        await this.recovery
        do {
          this.pending = false
          await this.recover(false)
          for (let run = this.claimNext(); run; run = this.claimNext()) {
            await prepareVerification(this.deps, run)
          }
        } while (this.pending)
      } finally {
        // Clear in this turn: a separate Promise.finally can swallow a kick after the drain ends.
        this.flight = undefined
      }
    })
    return this.flight
  }

  recoverAtBoot(): Promise<void> {
    if (this.recovery) {
      return this.recovery
    }
    this.reportedRecoveryFailures.clear()
    this.recovery = this.recover(true).finally(() => {
      this.recovery = undefined
    })
    return this.recovery
  }

  private async recover(sweepOrphans: boolean): Promise<void> {
    const report = await recoverVerifications(this.deps, {
      sweepOrphans,
      reportedFailures: this.reportedRecoveryFailures
    })
    if (report.failed) {
      console.warn('[axiom] Verification recovery incomplete', report)
    }
  }
}
