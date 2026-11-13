import type { AgentGrant, MemberId } from '@dingen/core'
import type { AgentService } from './agents/service.js'
import type { AuthService, AuthSource, User } from './auth/service.js'
import type { SyncService } from './sync.js'

/**
 * Set by the HTTP listener, never by the client. The ingress listener (Home
 * Assistant mode) passes `ingress: true`; `incoming` is @hono/node-server's request.
 */
export interface AppBindings {
  ingress?: boolean
  incoming?: { socket?: { remoteAddress?: string } }
}

/** Variabelen die middleware in de Hono-context zet. */
export interface AppEnv {
  Bindings: AppBindings
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
    /** The Home Assistant user's account on the ingress listener; undefined elsewhere. */
    ingressUser?: User
    /**
     * Validated `X-Ingress-Path` (e.g. `/api/hassio_ingress/<token>`, no trailing slash),
     * only on the ingress listener; index.html takes its base path from it (static.ts).
     */
    ingressPath?: string
  }
}
