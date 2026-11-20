import { ulid } from '@dingen/core'
import { and, eq, isNull } from 'drizzle-orm'
import webpush from 'web-push'
import type { Db } from '../db.js'
import { pushSubscriptions, users } from '../schema.js'
import { DEFAULT_PUSH_LOCALE, type PushLocale, parsePushLocale } from './messages.js'
import type { VapidKeys } from './vapid.js'

export interface PushTarget {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** Wat er in een melding staat; de service worker toont het. */
export interface PushPayload {
  title: string
  body: string
  /** Meldingen met dezelfde tag vervangen elkaar (de taak-id). */
  tag: string
  /** Pad dat een klik op de melding opent. */
  url: string
}

/**
 * A payload, or a function that renders it in a subscription's language
 * (English when the device did not tell its language).
 */
export type PushMessage = PushPayload | ((locale: PushLocale) => PushPayload)

/** `gone`: het abonnement bestaat niet meer (404/410) en kan weg. */
export type SendResult = 'sent' | 'gone' | 'failed'

/** Verstuurt één melding; tests geven een nep-versie mee. */
export type PushSender = (target: PushTarget, payload: PushPayload) => Promise<SendResult>

export function webPushSender(keys: VapidKeys): PushSender {
  return async (target, payload) => {
    try {
      await webpush.sendNotification(target, JSON.stringify(payload), {
        vapidDetails: keys,
        TTL: 60 * 60,
        urgency: 'high',
        timeout: 15_000,
      })
      return 'sent'
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) return 'gone'
      console.warn(`Push failed${status ? ` (${status})` : ''}`)
      return 'failed'
    }
  }
}

/** Abonnementen per gebruiker en het versturen naar al hun apparaten. */
export class PushService {
  constructor(
    private readonly db: Db,
    readonly publicKey: string,
    private readonly sender: PushSender,
  ) {}

  /** `language`: the app language on the device; an unknown one is stored as null. */
  subscribe(
    userId: string,
    target: PushTarget,
    userAgent: string | null,
    language: string | null = null,
  ): void {
    const values = {
      userId,
      p256dh: target.keys.p256dh,
      auth: target.keys.auth,
      userAgent,
      language: parsePushLocale(language),
      createdAt: new Date().toISOString(),
    }
    this.db
      .insert(pushSubscriptions)
      .values({ id: ulid(), endpoint: target.endpoint, ...values })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values })
      .run()
  }

  unsubscribe(userId: string, endpoint: string): boolean {
    const result = this.db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
      .run()
    return result.changes > 0
  }

  count(userId: string): number {
    return this.db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .all().length
  }

  /**
   * Stuurt naar alle apparaten van de gebruiker, elk in de taal van dat
   * apparaat; verdwenen abonnementen gaan weg.
   */
  async send(userId: string, message: PushMessage): Promise<number> {
    // Nothing goes to a blocked account; its subscriptions stay for when it is unblocked.
    const subs = this.db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
        language: pushSubscriptions.language,
      })
      .from(pushSubscriptions)
      .innerJoin(users, eq(users.id, pushSubscriptions.userId))
      .where(and(eq(pushSubscriptions.userId, userId), isNull(users.blockedAt)))
      .all()
    let sent = 0
    await Promise.all(
      subs.map(async (s) => {
        const payload =
          typeof message === 'function'
            ? message(parsePushLocale(s.language) ?? DEFAULT_PUSH_LOCALE)
            : message
        const result = await this.sender(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        )
        if (result === 'sent') sent += 1
        if (result === 'gone') {
          this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id)).run()
        }
      }),
    )
    return sent
  }
}
