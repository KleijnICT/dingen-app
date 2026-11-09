import type { AuthService, AuthSource, User } from './auth/service.js'
import type { SyncService } from './sync.js'

/** Variabelen die middleware in de Hono-context zet. */
export interface AppEnv {
  Variables: {
    sync: SyncService
    auth: AuthService
    /** Alleen gezet na succesvolle authenticatie. */
    user: User | undefined
    userId: string
    authSource: AuthSource | undefined
  }
}
