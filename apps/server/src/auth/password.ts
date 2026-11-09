import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

interface ScryptParams {
  N: number
  r: number
  p: number
  maxmem: number
}

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  params: ScryptParams,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, params, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

const N = 32768
const R = 8
const P = 1
const KEY_LENGTH = 64
const MAX_MEM = 128 * 1024 * 1024

/** Hash in de vorm `scrypt:N:r:p:salt:hash`, zodat parameters later kunnen opschuiven. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAX_MEM })
  return `scrypt:${N}:${R}:${P}:${salt.toString('base64url')}:${hash.toString('base64url')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split(':')
  if (algo !== 'scrypt' || !n || !r || !p || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAX_MEM,
  })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
