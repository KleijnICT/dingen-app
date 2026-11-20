import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

/**
 * Time-based one-time passwords (RFC 6238, the kind every authenticator app
 * reads): HMAC-SHA1, 30-second steps, 6 digits. Small enough not to need a
 * library.
 */

export const TOTP_STEP_SECONDS = 30
export const TOTP_DIGITS = 6
/** Steps either side of now that still count, for clocks that drift a little. */
export const TOTP_WINDOW = 1

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of clean) {
    const index = BASE32.indexOf(char)
    if (index === -1) throw new Error('invalid base32')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** A new secret: 20 random bytes (160 bits, as RFC 4226 recommends), in base32. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

/** The time step a moment falls in. */
export function totpStep(at: Date | number = Date.now()): number {
  const ms = typeof at === 'number' ? at : at.getTime()
  return Math.floor(ms / 1000 / TOTP_STEP_SECONDS)
}

/** The code for one time step. */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest()
  const offset = (hmac[hmac.length - 1] as number) & 0xf
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0')
}

/** Only the digits of what someone typed ("123 456" → "123456"). */
export function normalizeTotp(input: string): string {
  return input.replace(/[\s-]/g, '')
}

/**
 * The step whose code matches `input` within ±TOTP_WINDOW steps of `at`, or
 * null. Steps at or before `lastStep` do not count: a code works only once.
 */
export function matchTotp(
  secret: string,
  input: string,
  at: Date | number = Date.now(),
  lastStep: number | null = null,
): number | null {
  const code = normalizeTotp(input)
  if (!/^\d{6}$/.test(code)) return null
  const now = totpStep(at)
  let found: number | null = null
  // Check every step in the window (no early exit), so timing does not tell which matched.
  for (let step = now - TOTP_WINDOW; step <= now + TOTP_WINDOW; step++) {
    const expected = Buffer.from(totpCode(secret, step))
    if (timingSafeEqual(expected, Buffer.from(code)) && (lastStep === null || step > lastStep)) {
      found ??= step
    }
  }
  return found
}

/** The `otpauth://` URI an authenticator app reads from the QR code. */
export function otpauthUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

// --- recovery codes ---

export const RECOVERY_CODE_COUNT = 10
/** Without 0/o, 1/l/i: easy to read back from paper. */
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

/** Ten codes like `k7m2-qx9p`, each 8 characters (about 40 bits). */
export function newRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>()
  while (codes.size < count) {
    let code = ''
    for (let i = 0; i < 8; i++) code += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]
    codes.add(`${code.slice(0, 4)}-${code.slice(4)}`)
  }
  return [...codes]
}

/** Lowercase, without spaces and dashes, so `K7M2 QX9P` matches `k7m2-qx9p`. */
export function normalizeRecoveryCode(input: string): string {
  return input.toLowerCase().replace(/[\s-]/g, '')
}

export function hashRecoveryCode(input: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(input)).digest('hex')
}
