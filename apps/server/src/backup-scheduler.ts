import type Database from 'better-sqlite3'
import { listBackups, pruneBackups, schemaState, writeBackup } from './backup.js'

/** The nightly back-up is due from this hour (in DINGEN_TIMEZONE). */
export const BACKUP_HOUR = 3
/** How often the scheduler looks. */
export const BACKUP_TICK_MS = 5 * 60_000

export interface BackupSchedulerOptions {
  backupDir: string
  migrationsFolder: string
  timezone: string
  /** De klok; tests geven een nep-klok mee. */
  now?: () => number
}

/** The calendar day and hour of a moment in a time zone. */
export function localDayHour(at: number, timezone: string): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) }
}

/**
 * The nightly back-up (plan 24): once per calendar day in DINGEN_TIMEZONE,
 * from 03:00, a consistent copy of the live database (SQLite backup API, safe
 * while the server writes), then pruning by the retention rules. When the
 * server was off at 03:00 the back-up follows at the first look after it
 * starts. Same style as the reminder planner: a timer that looks every few
 * minutes, a clock that tests can replace.
 */
export class BackupScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private running: Promise<string | null> | null = null
  private readonly now: () => number

  constructor(
    private readonly sqlite: Database.Database,
    private readonly options: BackupSchedulerOptions,
  ) {
    this.now = options.now ?? Date.now
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), BACKUP_TICK_MS)
    this.timer.unref?.()
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Is today's back-up due: past 03:00 and none made yet today (both in the time zone)? */
  due(): boolean {
    const { day, hour } = localDayHour(this.now(), this.options.timezone)
    if (hour < BACKUP_HOUR) return false
    return !listBackups(this.options.backupDir).some(
      (b) => b.kind === 'daily' && localDayHour(b.at.getTime(), this.options.timezone).day === day,
    )
  }

  /** One look: makes the back-up when due. Returns its path, or null. */
  tick(): Promise<string | null> {
    if (!this.running) {
      this.running = this.run()
        .catch((err) => {
          console.error(
            `Nightly backup failed; trying again in a few minutes. ${err instanceof Error ? err.message : String(err)}`,
          )
          return null
        })
        .finally(() => {
          this.running = null
        })
    }
    return this.running
  }

  private async run(): Promise<string | null> {
    if (!this.due()) return null
    const file = await writeBackup(this.sqlite, {
      backupDir: this.options.backupDir,
      kind: 'daily',
      schema: schemaState(this.sqlite, this.options.migrationsFolder).version,
      now: new Date(this.now()),
    })
    const removed = pruneBackups(this.options.backupDir)
    console.log(
      `Nightly backup written to ${file}${removed.length > 0 ? ` (${removed.length} old backup(s) removed)` : ''}`,
    )
    return file
  }
}
