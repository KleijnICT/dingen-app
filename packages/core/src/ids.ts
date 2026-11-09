/**
 * ULID: 26 tekens Crockford base32, tijd-gesorteerd, botsingsvrij genoeg voor
 * client-gegenereerde id's. Werkt in Node en in de browser (globalThis.crypto).
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

// Web Crypto bestaat in Node 20+ en in elke browser; dit pakket heeft geen DOM-types.
declare const crypto: { getRandomValues<T extends ArrayBufferView>(array: T): T }

function encodeTime(time: number): string {
  let out = ''
  let t = time
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[t % 32] + out
    t = Math.floor(t / 32)
  }
  return out
}

function encodeRandom(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < 16; i++) {
    out += ALPHABET[(bytes[i] as number) % 32]
  }
  return out
}

export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom()
}

export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/

/** Korte willekeurige id voor clients (apparaten); hoeft niet sorteerbaar te zijn. */
export function clientId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % 32]
  return out
}
