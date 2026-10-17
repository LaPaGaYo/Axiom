import { MissionsPageSurface } from './MissionsPageSurface'
import { useMissionsPageController } from './use-missions-page-controller'

export default function MissionsPage() {
  return <MissionsPageSurface controller={useMissionsPageController()} />
}
