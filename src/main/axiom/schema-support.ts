import type { OrchestrationDb } from '../runtime/orchestration/db'
import {
  AXIOM_SCHEMA_VERSION,
  readAxiomSchemaVersion
} from '../runtime/orchestration/db/schema/axiom-schema-steps'
import { MissionControllerError } from './mission-controller/controller-context'

export function assertAxiomSchemaSupported(db: OrchestrationDb): void {
  const stored = readAxiomSchemaVersion(db.db)
  if (stored > AXIOM_SCHEMA_VERSION) {
    throw new MissionControllerError('axiom_schema_newer', {
      reason: `This database was written by a newer Axiom (schema ${stored}; this build supports ${AXIOM_SCHEMA_VERSION}), so Missions and orchestration commands are unavailable here until Axiom is updated.`,
      stored,
      supported: AXIOM_SCHEMA_VERSION,
      nextSteps: [
        `Update Axiom to the version that last opened this profile or a newer one (database schema ${stored}; this build supports ${AXIOM_SCHEMA_VERSION}).`
      ]
    })
  }
}

export function isAxiomSchemaNewer(error: unknown): error is MissionControllerError {
  return error instanceof MissionControllerError && error.code === 'axiom_schema_newer'
}
