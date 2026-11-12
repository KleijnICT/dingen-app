import type { AgentGrant, MemberId } from '@dingen/core'
import type { AgentService } from './agents/service.js'
import type { AuthService, AuthSource, User } from './auth/service.js'
import type { SyncService } from './sync.js'

/** Variabelen die middleware in de Hono-context zet. */
export interface AppEnv {
  Variables: {
    sync: SyncService
    auth: AuthService
    agents: AgentService
    /** Alleen gezet na succesvolle authenticatie. */
    user: User | undefined
    userId: string
    authSource: AuthSource | undefined
    /** Who acts: `user:<id>` for a session, `agent:<id>` for an agent token. */
    actor: MemberId
    /** The agent's grants; null for the owner (a session). */
    grants: AgentGrant[] | null
    /** The agent behind the token; null for a session. */
    agentId: string | null
  }
}
