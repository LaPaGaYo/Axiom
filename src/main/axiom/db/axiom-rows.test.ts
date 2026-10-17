import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { AXIOM_COLUMNS } from './axiom-rows'
import { readRow, readRows } from './row-codec'

let db: OrchestrationDb
beforeEach(() => {
  db = new OrchestrationDb(':memory:')
})
afterEach(() => db.close())

describe('Axiom column lists', () => {
  it.each(Object.entries(AXIOM_COLUMNS))(
    'pins all %s row-schema columns to migrated DDL',
    (table, columns) => {
      const migrated = z
        .array(z.object({ name: z.string() }))
        .parse(db.db.pragma(`table_info(${table})`))
      expect(columns.split(', ').sort()).toEqual(migrated.map((column) => column.name).sort())
      expect(() => db.db.prepare(`SELECT ${columns} FROM ${table}`).all()).not.toThrow()
    }
  )
  it('parses single and multiple rows and rejects invalid cells without casts', () => {
    const schema = z.object({ count: z.number() }).transform((row) => ({ total: row.count }))
    expect(readRow(schema, undefined)).toBeUndefined()
    expect(readRow(schema, { count: 2 })).toEqual({ total: 2 })
    expect(readRows(schema, [{ count: 2 }, { count: 3 }])).toEqual([{ total: 2 }, { total: 3 }])
    expect(() => readRow(schema, { count: '2' })).toThrow()
    expect(() => readRows(schema, [{ count: 2 }, { count: '3' }])).toThrow()
  })
})
