import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import {
  type BackupKind,
  listBackups,
  parseBackupName,
  pruneBackups,
  schemaState,
  writeBackup,
} from '../backup.js'
import { checkDingenDatabase, RestoreError } from '../restore.js'

/**
 * Back-ups in Administration (plan 24 part B, plan 32 decision 6): the same
 * files as `dingen backups` and `dingen backup`, in `DATA_DIR/backups`.
 */

export interface BackupInfo {
  name: string
  kind: BackupKind
  /** When it was made (ISO). */
  at: string
  /** Schema version of the database in it (`0011`). */
  schema: string
  size: number
}

export interface BackupHost {
  /** The live database, copied with the SQLite backup API. */
  sqlite: Database.Database
  backupDir: string
  migrationsFolder: string
  /**
   * Puts the back-up at `file` in place of the database and restarts the
   * server's database and services (see runtime.ts). Called after the
   * response; the pre-restore back-up is already made and is `fallback`, put
   * back when the restore fails. `keepSession` is the hashed session of the
   * administrator who asked, kept when their account is in the back-up so
   * they stay signed in. Absent: restoring is not offered.
   */
  restore?: (
    file: string,
    keepSession: { id: string; userId: string } | null,
    fallback: string | null,
  ) => void
}

export class BackupAdmin {
  constructor(private readonly host: BackupHost) {}

  get canRestore(): boolean {
    return this.host.restore !== undefined
  }

  list(): BackupInfo[] {
    return listBackups(this.host.backupDir).map((b) => ({
      name: b.name,
      kind: b.kind,
      at: b.at.toISOString(),
      schema: b.schema,
      size: b.size,
    }))
  }

  /**
   * Makes a back-up of the live database now. `prune` applies the retention
   * afterwards; not before a restore, so the back-up being restored stays.
   */
  async create(kind: BackupKind = 'manual', prune = true): Promise<BackupInfo> {
    const file = await writeBackup(this.host.sqlite, {
      backupDir: this.host.backupDir,
      kind,
      schema: schemaState(this.host.sqlite, this.host.migrationsFolder).version,
    })
    if (prune) pruneBackups(this.host.backupDir)
    const name = path.basename(file)
    const info = this.list().find((b) => b.name === name)
    if (!info) throw new Error(`back-up ${name} not found after writing it`)
    return info
  }

  /** The path of a back-up by its name, or null (also for anything that is not a back-up name). */
  file(name: string): string | null {
    if (name !== path.basename(name) || !parseBackupName(name)) return null
    const file = path.join(this.host.backupDir, name)
    try {
      return fs.statSync(file).isFile() ? file : null
    } catch {
      return null
    }
  }

  /** Throws a `RestoreError` when the file is not a Dingen database this version can run. */
  check(file: string): void {
    let sqlite: Database.Database
    try {
      sqlite = new Database(file, { readonly: true, fileMustExist: true })
    } catch (err) {
      throw new RestoreError(
        `cannot open the back-up (${err instanceof Error ? err.message : String(err)})`,
      )
    }
    try {
      checkDingenDatabase(sqlite, this.host.migrationsFolder)
    } finally {
      sqlite.close()
    }
  }

  /**
   * Checks the back-up, makes a `pre-restore` back-up of the live database and
   * returns a function that does the restore (to run after the response).
   */
  async prepareRestore(
    name: string,
    keepSession: { id: string; userId: string } | null,
  ): Promise<{ saved: BackupInfo; run: () => void }> {
    const restore = this.host.restore
    if (!restore) throw new RestoreError('restoring is not available on this server')
    const file = this.file(name)
    if (!file) throw new RestoreError('back-up not found')
    this.check(file)
    const saved = await this.create('pre-restore', false)
    const fallback = path.join(this.host.backupDir, saved.name)
    return { saved, run: () => restore(file, keepSession, fallback) }
  }
}
