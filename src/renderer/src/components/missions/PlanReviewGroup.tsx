import { useId, type ReactNode } from 'react'

export function PlanReviewGroup({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId()
  return (
    <div role="group" aria-labelledby={headingId} className="space-y-2">
      <h3 id={headingId} className="text-xs font-medium">
        {title}
      </h3>
      {children}
    </div>
  )
}
