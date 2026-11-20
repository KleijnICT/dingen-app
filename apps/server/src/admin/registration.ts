import { eq } from 'drizzle-orm'
import { parseRegistration, type RegistrationMode } from '../config.js'
import type { Db } from '../db.js'
import { meta } from '../schema.js'

/**
 * Who may create an account (plan 32, decision 5) is chosen in Administration
 * and kept in `meta`. DINGEN_REGISTRATION (or the Home Assistant option) is
 * only the starting value: it is stored the first time a server without a
 * stored value starts, also on an installation that already has users, so
 * an update keeps behaving as before.
 */
export const REGISTRATION_KEY = 'registration.mode'

/** The stored mode, or null when none is stored yet. */
export function storedRegistration(db: Pick<Db, 'select'>): RegistrationMode | null {
  const row = db
    .select({ value: meta.value })
    .from(meta)
    .where(eq(meta.key, REGISTRATION_KEY))
    .get()
  return row ? parseRegistration(row.value) : null
}

/** The mode in force: the stored one, else `fallback`. */
export function readRegistration(
  db: Pick<Db, 'select'>,
  fallback: RegistrationMode = 'closed',
): RegistrationMode {
  return storedRegistration(db) ?? fallback
}

export function writeRegistration(db: Pick<Db, 'insert'>, mode: RegistrationMode): void {
  db.insert(meta)
    .values({ key: REGISTRATION_KEY, value: mode })
    .onConflictDoUpdate({ target: meta.key, set: { value: mode } })
    .run()
}

/**
 * Stores `initial` when nothing is stored yet. Returns the mode in force and
 * whether `initial` was ignored because another mode is stored.
 */
export function seedRegistration(
  db: Pick<Db, 'select' | 'insert'>,
  initial: RegistrationMode,
): { mode: RegistrationMode; ignored: boolean } {
  const stored = storedRegistration(db)
  if (stored) return { mode: stored, ignored: stored !== initial }
  writeRegistration(db, initial)
  return { mode: initial, ignored: false }
}
