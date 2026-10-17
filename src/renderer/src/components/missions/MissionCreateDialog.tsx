import { useRef, useState } from 'react'
import type { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import { DEFAULT_MISSION_POLICY } from '../../../../shared/axiom-contract/mission-objects'
import type { MissionCreateParams } from '../../../../shared/axiom-contract/mission-params'

export type CreateMissionInput = z.input<typeof MissionCreateParams>

export function MissionCreateDialog({
  busy,
  error,
  onClose,
  onCreate
}: {
  busy: boolean
  error: string | null
  onClose: () => void
  onCreate: (params: CreateMissionInput) => Promise<void>
}) {
  const [repo, setRepo] = useState('')
  const [targetBranch, setTargetBranch] = useState('main')
  const [objective, setObjective] = useState('')
  const [criteria, setCriteria] = useState('')
  const retry = useRef<{ key: string; params: CreateMissionInput } | null>(null)
  const canCreate = repo.trim() && targetBranch.trim() && objective.trim() && criteria.trim()
  const submit = () => {
    if (busy || !canCreate) {
      return
    }
    const key = JSON.stringify([
      repo.trim(),
      targetBranch.trim(),
      objective.trim(),
      criteria.trim()
    ])
    // Receipt replay requires identical provenance as well as the same request id.
    if (retry.current?.key !== key) {
      retry.current = {
        key,
        params: {
          repo: repo.trim(),
          targetBranch: targetBranch.trim(),
          policy: DEFAULT_MISSION_POLICY,
          goal: {
            objective: objective.trim(),
            constraints: [],
            acceptanceCriteria: criteria
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean),
            provenance: { kind: 'user', actor: 'desktop-user', at: new Date().toISOString() }
          }
        }
      }
    }
    void onCreate(retry.current.params)
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) {
          onClose()
        }
      }}
    >
      <DialogContent className="sm:max-w-xl" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{translate('missions.create', 'Create Mission')}</DialogTitle>
          <DialogDescription>
            {translate(
              'missions.createDescription',
              'Define the repository, target branch, Goal and acceptance criteria. Review a plan before starting.'
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="mission-repo">
              {translate('missions.repository', 'Repository path')}
            </Label>
            <Input
              id="mission-repo"
              value={repo}
              onChange={(event) => setRepo(event.target.value)}
              required
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">
              {translate(
                'missions.repositoryHint',
                'Use a repository already added to this runtime.'
              )}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mission-branch">
              {translate('missions.targetBranch', 'Target branch')}
            </Label>
            <Input
              id="mission-branch"
              value={targetBranch}
              onChange={(event) => setTargetBranch(event.target.value)}
              required
              disabled={busy}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mission-objective">
              {translate('missions.goalObjective', 'Goal objective')}
            </Label>
            <Textarea
              id="mission-objective"
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              required
              disabled={busy}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mission-criteria">
              {translate('missions.acceptanceCriteria', 'Acceptance criteria')}
            </Label>
            <Textarea
              id="mission-criteria"
              value={criteria}
              onChange={(event) => setCriteria(event.target.value)}
              required
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">
              {translate('missions.criteriaHint', 'One criterion per line.')}
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              {translate('missions.dismiss', 'Dismiss')}
            </Button>
            <Button type="submit" disabled={busy || !canCreate}>
              {translate('missions.create', 'Create Mission')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
