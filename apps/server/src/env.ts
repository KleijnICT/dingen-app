import type { SyncService } from './sync.js'

/** Variabelen die middleware in de Hono-context zet. */
export interface AppEnv {
  Variables: {
    userId: string
    sync: SyncService
  }
}
