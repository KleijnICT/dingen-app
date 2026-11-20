import { APP_NAME } from '@dingen/core'

/**
 * The mails the server sends, in English and Dutch (plan 32). The language
 * is the app's language when the web app tells it, else the browser's
 * Accept-Language; anything else gets English.
 */

export const MAIL_LOCALES = ['en', 'nl'] as const
export type MailLocale = (typeof MAIL_LOCALES)[number]

/** `nl` for a Dutch app language or Accept-Language (`nl`, `nl-BE`, `nl;q=0.9, en`), else `en`. */
export function mailLocale(language: string | null | undefined): MailLocale {
  const first = (language ?? '').split(',')[0]?.trim().toLowerCase() ?? ''
  return first === 'nl' || first.startsWith('nl-') || first.startsWith('nl;') ? 'nl' : 'en'
}

interface Mail {
  subject: string
  text: string
}

export function resetMail(locale: MailLocale, email: string, link: string): Mail {
  if (locale === 'nl') {
    return {
      subject: `Kies een nieuw wachtwoord voor ${APP_NAME}`,
      text: [
        `Iemand heeft gevraagd om het wachtwoord van je ${APP_NAME}-account (${email}) opnieuw in te stellen.`,
        '',
        'Kies een nieuw wachtwoord met deze link. Hij werkt één keer, een uur lang:',
        link,
        '',
        'Heb je dit niet gevraagd? Dan kun je deze mail negeren; je wachtwoord blijft hetzelfde.',
      ].join('\n'),
    }
  }
  return {
    subject: `Choose a new password for ${APP_NAME}`,
    text: [
      `Someone asked to reset the password of your ${APP_NAME} account (${email}).`,
      '',
      'Choose a new password with this link. It works once, for one hour:',
      link,
      '',
      "Didn't ask for this? Then you can ignore this mail; your password stays the same.",
    ].join('\n'),
  }
}

export function testMail(locale: MailLocale): Mail {
  if (locale === 'nl') {
    return {
      subject: `Testmail van ${APP_NAME}`,
      text: `Dit is een testmail van ${APP_NAME}. Mail versturen werkt.`,
    }
  }
  return {
    subject: `Test mail from ${APP_NAME}`,
    text: `This is a test mail from ${APP_NAME}. Sending mail works.`,
  }
}
