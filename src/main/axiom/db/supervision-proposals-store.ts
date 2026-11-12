import { z } from 'zod'
import { AxiomIdSchema } from '../../../shared/axiom-contract/mission-objects'
import { SupervisionProposalSchema } from '../../../shared/axiom-contract/supervision'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import { readJson, readRow, readRows } from './row-codec'

const columns = `id, rule, from_mode, to_mode, status, evidence, since_sequence,
  through_sequence, resolver, created_at, resolved_at`
const Row = z
  .object({
    id: z.string(),
    rule: z.string(),
    from_mode: z.string(),
    to_mode: z.string(),
    status: z.string(),
    evidence: z.string(),
    since_sequence: z.number(),
    through_sequence: z.number(),
    resolver: z.string().nullable(),
    created_at: z.string(),
    resolved_at: z.string().nullable()
  })
  .transform((row) =>
    SupervisionProposalSchema.parse({
      id: row.id,
      rule: row.rule,
      fromMode: row.from_mode,
      toMode: row.to_mode,
      status: row.status,
      evidence: readJson(
        SupervisionProposalSchema.shape.evidence,
        row.evidence,
        'supervision_proposals',
        row.id,
        'evidence'
      ),
      sinceSequence: row.since_sequence,
      throughSequence: row.through_sequence,
      resolver: row.resolver,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at
    })
  )
const Insert = SupervisionProposalSchema.omit({
  status: true,
  resolver: true,
  createdAt: true,
  resolvedAt: true
})
const Resolve = z.strictObject({
  id: AxiomIdSchema,
  status: SupervisionProposalSchema.shape.status.exclude(['OPEN']),
  resolver: z.literal('user')
})

export function supervisionProposalsStore(db: OrchestrationDb) {
  return {
    getSupervisionProposal(id: string) {
      return readRow(
        Row,
        db.db
          .prepare(`SELECT ${columns} FROM supervision_proposals WHERE id = ?`)
          .get(AxiomIdSchema.parse(id))
      )
    },
    getOpenSupervisionProposal() {
      return readRow(
        Row,
        db.db
          .prepare(`SELECT ${columns} FROM supervision_proposals
        WHERE rule = 'stalled' AND status = 'OPEN'`)
          .get()
      )
    },
    latestResolvedSupervisionSequence() {
      return (
        z
          .object({ through_sequence: z.number().int().nonnegative() })
          .optional()
          .parse(
            db.db
              .prepare(`SELECT through_sequence FROM supervision_proposals
          WHERE rule = 'stalled' AND status != 'OPEN' ORDER BY resolved_at DESC, rowid DESC LIMIT 1`)
              .get()
          )?.through_sequence ?? 0
      )
    },
    listSupervisionProposals() {
      // Include the open row independently of the five-row resolved history limit.
      const open = readRows(
        Row,
        db.db
          .prepare(`SELECT ${columns} FROM supervision_proposals
        WHERE rule = 'stalled' AND status = 'OPEN'`)
          .all()
      )
      const resolved = readRows(
        Row,
        db.db
          .prepare(`SELECT ${columns} FROM supervision_proposals
        WHERE rule = 'stalled' AND status != 'OPEN' ORDER BY resolved_at DESC, rowid DESC LIMIT 5`)
          .all()
      )
      return [...open, ...resolved]
    },
    insertSupervisionProposal(input: z.input<typeof Insert>) {
      const p = Insert.parse(input)
      return Row.parse(
        db.db
          .prepare(`INSERT INTO supervision_proposals
        (id, rule, from_mode, to_mode, status, evidence, since_sequence, through_sequence)
        VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?) RETURNING ${columns}`)
          .get(
            p.id,
            p.rule,
            p.fromMode,
            p.toMode,
            JSON.stringify(p.evidence),
            p.sinceSequence,
            p.throughSequence
          )
      )
    },
    resolveSupervisionProposal(input: z.input<typeof Resolve>) {
      const p = Resolve.parse(input)
      return (
        db.db
          .prepare(`UPDATE supervision_proposals SET status = ?, resolver = ?,
        resolved_at = datetime('now') WHERE id = ? AND status = 'OPEN'`)
          .run(p.status, p.resolver, p.id).changes === 1
      )
    }
  }
}
