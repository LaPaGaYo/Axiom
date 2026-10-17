import { z } from 'zod'

export function readRow<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  return value === undefined ? undefined : schema.parse(value)
}

export function readRows<T>(schema: z.ZodType<T>, values: unknown): T[] {
  return z.array(schema).parse(values)
}

export function readJson<T>(
  schema: z.ZodType<T>,
  value: string,
  table: string,
  row: string | number,
  column: string
): T {
  try {
    return schema.parse(JSON.parse(value))
  } catch {
    // Do not put potentially sensitive cell contents in the error.
    throw new Error(`Invalid stored JSON in ${table} row ${row} column ${column}`)
  }
}
