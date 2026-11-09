/**
 * Hybride logische klok (HLC).
 *
 * Een tijdstempel is een string `wall:counter:clientId`, zo opgebouwd dat
 * gewone stringvergelijking dezelfde volgorde geeft als de klok zelf.
 * Zo kan elke client, in elke taal, met één `<` beslissen welke wijziging wint.
 */

export type Timestamp = string

const WALL_WIDTH = 15
const COUNTER_WIDTH = 5

export function formatTimestamp(wall: number, counter: number, clientId: string): Timestamp {
  return `${String(wall).padStart(WALL_WIDTH, '0')}:${String(counter).padStart(COUNTER_WIDTH, '0')}:${clientId}`
}

export function parseTimestamp(ts: Timestamp): { wall: number; counter: number; clientId: string } {
  const [wall, counter, clientId] = ts.split(':')
  if (wall === undefined || counter === undefined || clientId === undefined) {
    throw new Error(`Ongeldige tijdstempel: ${ts}`)
  }
  return { wall: Number(wall), counter: Number(counter), clientId }
}

export const TIMESTAMP_PATTERN = /^\d{15}:\d{5}:[0-9A-Z]+$/

export interface Clock {
  readonly clientId: string
  /** Geeft een nieuwe, strikt oplopende tijdstempel voor een lokale wijziging. */
  now(): Timestamp
  /** Verwerkt een tijdstempel van elders zodat latere lokale stempels erna komen. */
  receive(remote: Timestamp): void
}

export function createClock(clientId: string, wallClock: () => number = Date.now): Clock {
  let lastWall = 0
  let counter = 0

  return {
    clientId,
    now() {
      const wall = wallClock()
      if (wall > lastWall) {
        lastWall = wall
        counter = 0
      } else {
        counter += 1
      }
      return formatTimestamp(lastWall, counter, clientId)
    },
    receive(remote) {
      const { wall: remoteWall, counter: remoteCounter } = parseTimestamp(remote)
      const wall = wallClock()
      const maxWall = Math.max(wall, lastWall, remoteWall)
      if (maxWall === lastWall && maxWall === remoteWall) {
        counter = Math.max(counter, remoteCounter) + 1
      } else if (maxWall === lastWall) {
        counter += 1
      } else if (maxWall === remoteWall) {
        counter = remoteCounter + 1
      } else {
        counter = 0
      }
      lastWall = maxWall
    },
  }
}
