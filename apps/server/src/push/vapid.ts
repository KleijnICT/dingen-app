import { eq } from 'drizzle-orm'
import webpush from 'web-push'
import type { Db } from '../db.js'
import { meta } from '../schema.js'

export interface VapidKeys {
  publicKey: string
  privateKey: string
  subject: string
}

const PUBLIC = 'vapid_public_key'
const PRIVATE = 'vapid_private_key'
export const DEFAULT_VAPID_SUBJECT = 'mailto:dingen@example.com'

/**
 * De VAPID-sleutels van deze server. Uit de omgeving als beide gezet zijn,
 * anders uit de tabel `meta`; ontbreken ze daar, dan worden ze eenmalig
 * gemaakt en bewaard. Nieuwe sleutels maken bestaande abonnementen ongeldig,
 * dus ze veranderen nooit vanzelf.
 */
export function loadVapidKeys(db: Db, env: NodeJS.ProcessEnv = process.env): VapidKeys {
  const subject = env.DINGEN_VAPID_SUBJECT || DEFAULT_VAPID_SUBJECT
  if (env.DINGEN_VAPID_PUBLIC_KEY && env.DINGEN_VAPID_PRIVATE_KEY) {
    return {
      publicKey: env.DINGEN_VAPID_PUBLIC_KEY,
      privateKey: env.DINGEN_VAPID_PRIVATE_KEY,
      subject,
    }
  }
  const read = (key: string) => db.select().from(meta).where(eq(meta.key, key)).get()?.value
  const publicKey = read(PUBLIC)
  const privateKey = read(PRIVATE)
  if (publicKey && privateKey) return { publicKey, privateKey, subject }
  const fresh = webpush.generateVAPIDKeys()
  db.transaction((tx) => {
    for (const [key, value] of [
      [PUBLIC, fresh.publicKey],
      [PRIVATE, fresh.privateKey],
    ] as const) {
      tx.insert(meta)
        .values({ key, value })
        .onConflictDoUpdate({ target: meta.key, set: { value } })
        .run()
    }
  })
  return { ...fresh, subject }
}
