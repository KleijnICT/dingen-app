/**
 * Gedeeld domeinmodel en sync-protocol van Dingen.
 * Dit pakket doet geen IO: geen database, geen netwerk, geen DOM.
 */

export const APP_NAME = 'Dingen'

export interface HealthStatus {
  status: 'ok'
  app: typeof APP_NAME
  version: string
  database: 'ok'
  sqliteVersion: string
}

export * from './entities.js'
export * from './factories.js'
export * from './hlc.js'
export * from './ids.js'
export * from './order.js'
export * from './sync.js'
export * as views from './views.js'
export { toCalendarDate } from './views.js'
