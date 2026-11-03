import type { AxiomStore } from '../db/axiom-store'
import { quote } from './previous-attempt-text'

export function answeredQuestions(store: AxiomStore, missionId: string, taskId: string) {
  const omitted = 'Earlier answered questions omitted (4 KiB limit); see the message audits.'
  // Include the rendered heading, final newline and omission marker in the byte ceiling.
  let remaining = 4 * 1024 - Buffer.byteLength(`## Answered questions\n\n${omitted}\n`) - 1
  const lines: string[] = []
  for (const { question, answer, seq } of store.listAnsweredQuestionsForTask(missionId, taskId)) {
    const line = `Q (Attempt ${seq}): ${quote(question)} — A: ${quote(answer)}`
    const bytes = Buffer.byteLength(line) + 1
    if (bytes > remaining) {
      lines.push(omitted)
      break
    }
    lines.push(line)
    remaining -= bytes
  }
  return { source: `questions:${taskId}`, content: lines.join('\n') || 'none' }
}
