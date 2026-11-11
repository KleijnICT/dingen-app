import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FeedError } from './ics.js'
import { httpFetchFeed } from './service.js'

const FEED = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'
let server: Server
let base = ''
const seenAuth: (string | undefined)[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    seenAuth.push(req.headers.authorization)
    if (req.url === '/ok.ics') {
      res.writeHead(200, { 'content-type': 'text/calendar' })
      res.end(FEED)
    } else if (req.url === '/groot.ics') {
      // Zonder content-length, zodat de teller tijdens het lezen moet ingrijpen.
      res.writeHead(200, { 'content-type': 'text/calendar' })
      const chunk = 'X'.repeat(1024 * 1024)
      for (let i = 0; i < 11; i++) res.write(chunk)
      res.end()
    } else if (req.url === '/omweg.ics') {
      res.writeHead(302, { location: '/ok.ics' })
      res.end()
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

async function codeOf(url: string): Promise<string> {
  try {
    await httpFetchFeed(url)
    return 'ok'
  } catch (err) {
    return err instanceof FeedError ? err.code : 'other'
  }
}

describe('httpFetchFeed', () => {
  it('haalt een feed op en volgt een omleiding', async () => {
    expect(await httpFetchFeed(`${base}/ok.ics`)).toBe(FEED)
    expect(await httpFetchFeed(`${base}/omweg.ics`)).toBe(FEED)
  })

  it('maakt van fouten codes', async () => {
    expect(await codeOf(`${base}/bestaat-niet.ics`)).toBe('feed_unreachable')
    expect(await codeOf(`${base}/groot.ics`)).toBe('feed_too_large')
    expect(await codeOf('http://127.0.0.1:1/dicht.ics')).toBe('feed_unreachable')
  })

  it('stuurt inloggegevens uit de URL mee als Basic-auth', async () => {
    seenAuth.length = 0
    const withCreds = base.replace('http://', 'http://ik:app%20wachtwoord@')
    expect(await httpFetchFeed(`${withCreds}/ok.ics`)).toBe(FEED)
    expect(seenAuth).toEqual([`Basic ${Buffer.from('ik:app wachtwoord').toString('base64')}`])
  })
})
