import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { AxiomStore } from '../db/axiom-store'
import type { ArtifactStore } from '../artifacts/artifact-store'
import type { MissionController } from '../mission-controller/mission-controller'
import { claimVerification } from './verification-claim'
import { prepareVerification } from './verification-prepare'
import { recoverVerifications } from './verification-recovery'
import { getMainE2EConfig } from '../../e2e-config'
import { runVerificationChecks } from './verification-checks'
import { randomUUID } from 'node:crypto'

export type VerificationDependencies = {
  store: AxiomStore
  missions: MissionController
  artifacts: ArtifactStore
  runtime: Pick<
    OrcaRuntimeService,
    'createManagedWorktree' | 'removeManagedWorktree' | 'listManagedWorktrees' | 'showRepo'
  >
  runtimeEpoch: string
}

export function shouldHoldVerification(): boolean {
  return getMainE2EConfig().enabled && process.env.AXIOM_E2E_HOLD_VERIFICATION === '1'
}

export class VerificationService {
  private flight?: Promise<void>
  private recovery?: Promise<void>
  private pending = false
  private abort = new AbortController()
  // Only audit suppression is process-local; pending cleanup and ownership remain durable.
  private readonly reportedRecoveryFailures = new Set<string>()

  constructor(private readonly deps: VerificationDependencies) {}

  claimNext(missionId?: string) {
    return claimVerification(this.deps, missionId)
  }

  kick(_missionId?: string): Promise<void> {
    if (this.abort.signal.aborted) {
      return Promise.resolve()
    }
    // ponytail: one global drain per plane; mission hints never strand another Mission's queue.
    this.pending = true
    if (this.flight) {
      return this.flight
    }
    const signal = this.abort.signal
    const recovery = this.recovery
    this.flight = Promise.resolve().then(async () => {
      try {
        await recovery
        do {
          this.pending = false
          await this.recover(false)
          for (
            let run = signal.aborted ? undefined : this.claimNext();
            run;
            run = signal.aborted ? undefined : this.claimNext()
          ) {
            const prepared = await prepareVerification(this.deps, run)
            if (prepared && !signal.aborted && !shouldHoldVerification()) {
              await runVerificationChecks(this.deps, prepared, signal)
            }
          }
        } while (this.pending && !signal.aborted)
      } finally {
        // Clear in this turn: a separate Promise.finally can swallow a kick after the drain ends.
        this.flight = undefined
      }
    })
    return this.flight
  }

  recoverAtBoot(): Promise<void> {
    if (this.recovery) {
      if (this.abort.signal.aborted) {
        // A new boot must reset shutdown even when the prior boot is still doing IO.
        const restart = () => this.recoverAtBoot()
        return this.recovery.then(restart, restart)
      }
      return this.recovery
    }
    this.reportedRecoveryFailures.clear()
    const priorFlight = this.flight
    this.recovery = (async () => {
      if (this.abort.signal.aborted) {
        await priorFlight
        this.deps.runtimeEpoch = `epoch_${randomUUID()}`
        this.abort = new AbortController()
      }
      await this.recover(true)
    })().finally(() => {
      this.recovery = undefined
    })
    return this.recovery
  }

  stop(): Promise<void> {
    this.pending = false
    this.abort.abort()
    return this.flight ?? Promise.resolve()
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
