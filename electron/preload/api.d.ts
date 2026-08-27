import type { LawPilotAPI } from '../../shared/types'

declare global {
  interface Window {
    api: LawPilotAPI
  }
}
