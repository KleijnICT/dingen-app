import { api } from './api.js'

/**
 * Web push on this device (browser). Push needs a service worker, and both
 * only work in a secure context: HTTPS, or localhost. Without that the app
 * works as before; the settings explain why reminders are unavailable.
 */

export type PushSupport = 'ok' | 'insecure' | 'unsupported'

export function pushSupport(
  w: {
    isSecureContext?: boolean
    navigator?: object
    PushManager?: unknown
    Notification?: unknown
  } = typeof window === 'undefined' ? {} : window,
  production = import.meta.env.PROD,
): PushSupport {
  if (!w.isSecureContext) return 'insecure'
  // The service worker is only registered in a production build (see pwa.ts).
  if (!production || !w.navigator || !('serviceWorker' in w.navigator)) return 'unsupported'
  if (!w.PushManager || !w.Notification) return 'unsupported'
  return 'ok'
}

/** The VAPID public key (base64url) as the bytes `pushManager.subscribe` wants. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const base64 = padded + '='.repeat((4 - (padded.length % 4)) % 4)
  const raw = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.length) return false
  const view = new Uint8Array(a)
  return view.every((v, i) => v === b[i])
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (pushSupport() !== 'ok') return null
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000))
  return Promise.race([navigator.serviceWorker.ready, timeout])
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration()
  return reg ? reg.pushManager.getSubscription() : null
}

async function register(sub: PushSubscription): Promise<void> {
  await api.post('/api/push/subscriptions', sub.toJSON())
}

/** Re-sends an existing subscription, so the server knows it under the signed-in account. */
export async function refreshSubscription(): Promise<boolean> {
  const sub = await currentSubscription()
  if (!sub) return false
  await register(sub)
  return true
}

export class PushDeniedError extends Error {
  constructor() {
    super('push_denied')
  }
}

/** Asks for permission and subscribes this device. */
export async function enablePush(): Promise<void> {
  const reg = await registration()
  if (!reg) throw new Error('push_unsupported')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new PushDeniedError()
  const { publicKey } = await api.get<{ publicKey: string }>('/api/push/key')
  const key = keyBytes(publicKey)
  let sub = await reg.pushManager.getSubscription()
  // A subscription made with another server key cannot receive our messages.
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe()
    sub = null
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  await register(sub)
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  const { endpoint } = sub
  await sub.unsubscribe()
  await api.delete('/api/push/subscriptions', { endpoint })
}

export async function sendTestPush(title: string, body: string): Promise<number> {
  const { sent } = await api.post<{ sent: number }>('/api/push/test', { title, body })
  return sent
}
