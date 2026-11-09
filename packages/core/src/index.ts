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
