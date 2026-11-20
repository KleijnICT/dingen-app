import nodemailer from 'nodemailer'
import type { MailConfig } from '../config.js'

export interface MailMessage {
  to: string
  subject: string
  text: string
}

/** Hands one message to the mail server; rejects when that fails. */
export type MailTransport = (message: MailMessage & { from: string }) => Promise<void>

export class MailError extends Error {
  constructor(
    public readonly code: 'mail_not_configured' | 'mail_failed',
    message: string = code,
  ) {
    super(message)
  }
}

/** SMTP through nodemailer. The password goes to the transport only, never to a log. */
export function smtpTransport(config: MailConfig): MailTransport {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.user ? { auth: { user: config.user, pass: config.password ?? '' } } : {}),
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  })
  return async (message) => {
    await transporter.sendMail(message)
  }
}

/**
 * Outgoing mail (plan 32): configured through SMTP_* or the Home Assistant
 * app's options, never stored in the database. Without SMTP settings nothing
 * is sent and `isConfigured()` is false.
 */
export class MailService {
  private readonly transport: MailTransport | null

  constructor(
    private readonly config: MailConfig | null,
    transport?: MailTransport,
  ) {
    this.transport = config ? (transport ?? smtpTransport(config)) : null
  }

  isConfigured(): boolean {
    return this.transport !== null
  }

  /** The sender address, or null without mail. Safe to show to an administrator. */
  from(): string | null {
    return this.config?.from ?? null
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.config || !this.transport) throw new MailError('mail_not_configured')
    try {
      await this.transport({ ...message, from: this.config.from })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.error(`Sending mail failed: ${reason}`)
      throw new MailError('mail_failed', reason)
    }
  }
}
