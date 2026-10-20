import { useId, useState } from 'react'
import type { z } from 'zod'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import type { MessageSummaryResponseSchema } from '../../../../shared/axiom-contract/message-params'
import type { AttemptSummary } from '../../../../shared/axiom-contract/attempt-params'

type Message = z.infer<typeof MessageSummaryResponseSchema>
type Actions = {
  busy: boolean
  onAnswer: (questionId: string, body: string) => void
  onResolve: (messageId: string, decision: 'accept' | 'reject', rationale: string) => void
}

function PendingMessage({ message, busy, onAnswer, onResolve }: Actions & { message: Message }) {
  const [body, setBody] = useState('')
  const id = useId()
  const question = message.type === 'QUESTION'
  const disabled = busy || !body.trim()
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (question && !disabled) {
          onAnswer(message.id, body.trim())
        }
      }}
    >
      {message.options && (
        <p className="text-xs text-muted-foreground">{message.options.join(' · ')}</p>
      )}
      <Label htmlFor={id}>
        {question
          ? translate('missions.answer', 'Answer')
          : translate('missions.rationale', 'Rationale')}
      </Label>
      <Textarea
        id={id}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        disabled={busy}
        required
        maxLength={question ? undefined : 2000}
      />
      {question ? (
        <Button size="sm" type="submit" disabled={disabled}>
          {translate('missions.sendAnswer', 'Send answer')}
        </Button>
      ) : (
        <div className="flex gap-2">
          <Button
            size="sm"
            type="button"
            disabled={disabled}
            onClick={() => onResolve(message.id, 'accept', body.trim())}
          >
            {translate('missions.acceptSubtask', 'Accept')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            type="button"
            disabled={disabled}
            onClick={() => onResolve(message.id, 'reject', body.trim())}
          >
            {translate('missions.rejectSubtask', 'Reject')}
          </Button>
        </div>
      )}
    </form>
  )
}

export function MessageTimeline({
  messages,
  attempts,
  ...actions
}: Actions & { messages: readonly Message[]; attempts: readonly AttemptSummary[] }) {
  const sequences = new Map(attempts.map((attempt) => [attempt.attemptId, attempt.seq]))
  return (
    <section className="space-y-3" aria-labelledby="task-messages-heading">
      <h3 id="task-messages-heading" className="text-sm font-semibold">
        {translate('missions.taskMessages', 'Task messages')}
      </h3>
      {messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate('missions.noMessages', 'No messages yet.')}
        </p>
      ) : (
        <ol className="space-y-4" aria-label={translate('missions.taskMessages', 'Task messages')}>
          {[...messages]
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .map((message) => (
              <li key={message.id} className="space-y-2 border-b border-border pb-4">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline">{message.type}</Badge>
                  <span>
                    {translate('missions.attemptNumber', 'Attempt {{seq}}', {
                      seq: sequences.get(message.attemptId) ?? message.attemptId
                    })}
                  </span>
                  <time className="tabular-nums text-muted-foreground" dateTime={message.createdAt}>
                    {message.createdAt}
                  </time>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm">{message.summary}</p>
                {message.answer && <p className="whitespace-pre-wrap text-sm">{message.answer}</p>}
                {message.pending &&
                  (message.type === 'QUESTION' || message.type === 'REQUEST_SUBTASK') && (
                    <PendingMessage message={message} {...actions} />
                  )}
              </li>
            ))}
        </ol>
      )}
    </section>
  )
}
