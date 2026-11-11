import { describe, expect, it } from 'vitest'
import { expandEvents, FeedError, parseFeed, wallToInstant } from './ics.js'

const TZ = 'Europe/Amsterdam'

function feed(...events: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Dingen//Test//NL',
    ...events,
    'END:VCALENDAR',
  ]
    .join('\r\n')
    .replace(/\n\s+/g, '\n')
}

function expand(text: string, from: string, to: string, timezone = TZ) {
  return expandEvents(parseFeed(text), { calendarId: 'cal', from, to, timezone })
}

describe('parseFeed', () => {
  it('weigert iets dat geen agenda is', () => {
    expect(() => parseFeed('<html>niet gevonden</html>')).toThrow(FeedError)
    expect(() => parseFeed('BEGIN:VCARD\r\nEND:VCARD')).toThrow(FeedError)
  })

  it('leest een lege agenda', () => {
    expect(expand(feed(), '2026-11-01', '2026-11-30')).toEqual([])
  })
})

describe('expandEvents', () => {
  it('rekent een afspraak met TZID om, ook zonder VTIMEZONE', () => {
    const text = feed(
      'BEGIN:VEVENT',
      'UID:tandarts',
      'DTSTART;TZID=Europe/Amsterdam:20261112T093000',
      'DTEND;TZID=Europe/Amsterdam:20261112T101500',
      'SUMMARY:Tandarts',
      'LOCATION:Dorpsstraat 1',
      'END:VEVENT',
    )
    const [event] = expand(text, '2026-11-12', '2026-11-12')
    expect(event).toMatchObject({
      calendarId: 'cal',
      title: 'Tandarts',
      location: 'Dorpsstraat 1',
      allDay: false,
      startDate: '2026-11-12',
      endDate: '2026-11-12',
      startTime: '09:30',
      endTime: '10:15',
      start: '2026-11-12T08:30:00.000Z',
      end: '2026-11-12T09:15:00.000Z',
    })
    expect(expand(text, '2026-11-13', '2026-11-20')).toEqual([])
  })

  it('toont een UTC-tijd in DINGEN_TIMEZONE', () => {
    const text = feed(
      'BEGIN:VEVENT',
      'UID:call',
      'DTSTART:20260701T120000Z',
      'DTEND:20260701T130000Z',
      'SUMMARY:Overleg',
      'END:VEVENT',
    )
    expect(expand(text, '2026-07-01', '2026-07-01')[0]).toMatchObject({
      startTime: '14:00',
      endTime: '15:00',
    })
    expect(expand(text, '2026-07-01', '2026-07-01', 'America/New_York')[0]).toMatchObject({
      startTime: '08:00',
      endTime: '09:00',
    })
  })

  it('leest een zwevende tijd in DINGEN_TIMEZONE', () => {
    const text = feed(
      'BEGIN:VEVENT',
      'UID:zwevend',
      'DTSTART:20261112T200000',
      'DTEND:20261112T210000',
      'SUMMARY:Koor',
      'END:VEVENT',
    )
    expect(expand(text, '2026-11-12', '2026-11-12')[0]).toMatchObject({
      startTime: '20:00',
      start: '2026-11-12T19:00:00.000Z',
    })
  })

  it('herhaalt wekelijks, slaat EXDATE over en houdt de kloktijd vast over de zomertijd heen', () => {
    const text = feed(
      'BEGIN:VEVENT',
      'UID:sport',
      'DTSTART;TZID=Europe/Amsterdam:20261015T190000',
      'DTEND;TZID=Europe/Amsterdam:20261015T200000',
      'RRULE:FREQ=WEEKLY;BYDAY=TH',
      'EXDATE;TZID=Europe/Amsterdam:20261029T190000',
      'SUMMARY:Sport',
      'END:VEVENT',
    )
    const events = expand(text, '2026-10-15', '2026-11-12')
    expect(events.map((e) => e.startDate)).toEqual([
      '2026-10-15',
      '2026-10-22',
      '2026-11-05',
      '2026-11-12',
    ])
    expect(new Set(events.map((e) => e.startTime))).toEqual(new Set(['19:00']))
    // Zomertijd: UTC+2; daarna UTC+1.
    expect(events[0]?.start).toBe('2026-10-15T17:00:00.000Z')
    expect(events[2]?.start).toBe('2026-11-05T18:00:00.000Z')
    expect(new Set(events.map((e) => e.id)).size).toBe(4)
  })

  it('stopt bij COUNT en UNTIL en begint niet voor het venster', () => {
    const text = feed(
      'BEGIN:VEVENT',
      'UID:cursus',
      'DTSTART;TZID=Europe/Amsterdam:20261102T100000',
      'DTEND;TZID=Europe/Amsterdam:20261102T110000',
      'RRULE:FREQ=DAILY;COUNT=5',
      'SUMMARY:Cursus',
      'END:VEVENT',
    )
    expect(expand(text, '2026-11-04', '2026-11-30').map((e) => e.startDate)).toEqual([
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
    ])
  })

  it('verwerkt uitzonderingen: verplaatst (ook het venster in) en afgezegd', () => {
    const text = feed(
      'BEGIN:VEVENT',
      'UID:overleg',
      'DTSTART;TZID=Europe/Amsterdam:20261102T090000',
      'DTEND;TZID=Europe/Amsterdam:20261102T093000',
      'RRULE:FREQ=WEEKLY;BYDAY=MO',
      'SUMMARY:Weekoverleg',
      'END:VEVENT',
      // 9 november schuift naar 11 november, 14:00.
      'BEGIN:VEVENT',
      'UID:overleg',
      'RECURRENCE-ID;TZID=Europe/Amsterdam:20261109T090000',
      'DTSTART;TZID=Europe/Amsterdam:20261111T140000',
      'DTEND;TZID=Europe/Amsterdam:20261111T150000',
      'SUMMARY:Weekoverleg (verzet)',
      'END:VEVENT',
      // 16 november vervalt.
      'BEGIN:VEVENT',
      'UID:overleg',
      'RECURRENCE-ID;TZID=Europe/Amsterdam:20261116T090000',
      'DTSTART;TZID=Europe/Amsterdam:20261116T090000',
      'DTEND;TZID=Europe/Amsterdam:20261116T093000',
      'STATUS:CANCELLED',
      'SUMMARY:Weekoverleg',
      'END:VEVENT',
    )
    const all = expand(text, '2026-11-02', '2026-11-23')
    expect(all.map((e) => [e.startDate, e.startTime, e.title])).toEqual([
      ['2026-11-02', '09:00', 'Weekoverleg'],
      ['2026-11-23', '09:00', 'Weekoverleg'],
      ['2026-11-11', '14:00', 'Weekoverleg (verzet)'],
    ])
    // Het venster bevat alleen de nieuwe datum van de verplaatste afspraak.
    expect(expand(text, '2026-11-10', '2026-11-12').map((e) => e.title)).toEqual([
      'Weekoverleg (verzet)',
    ])
    expect(expand(text, '2026-11-09', '2026-11-09')).toEqual([])
  })

  it('leest hele dagen en meerdaagse afspraken met exclusieve einddatum', () => {
    const text = feed(
      'BEGIN:VEVENT',
      'UID:verjaardag',
      'DTSTART;VALUE=DATE:20200314',
      'RRULE:FREQ=YEARLY',
      'SUMMARY:Verjaardag Sam',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:vakantie',
      'DTSTART;VALUE=DATE:20261228',
      'DTEND;VALUE=DATE:20270104',
      'SUMMARY:Vakantie',
      'END:VEVENT',
    )
    expect(expand(text, '2027-03-14', '2027-03-14')).toEqual([
      expect.objectContaining({
        title: 'Verjaardag Sam',
        allDay: true,
        startDate: '2027-03-14',
        endDate: '2027-03-14',
        startTime: null,
        endTime: null,
      }),
    ])
    const holiday = expand(text, '2027-01-01', '2027-01-10')
    expect(holiday).toEqual([
      expect.objectContaining({
        title: 'Vakantie',
        startDate: '2026-12-28',
        endDate: '2027-01-03',
      }),
    ])
    expect(expand(text, '2027-01-04', '2027-01-10')).toEqual([])
  })

  it('laat een afspraak tot middernacht niet doorlopen naar de volgende dag', () => {
    const text = feed(
      'BEGIN:VEVENT',
      'UID:feest',
      'DTSTART;TZID=Europe/Amsterdam:20261114T200000',
      'DTEND;TZID=Europe/Amsterdam:20261115T000000',
      'SUMMARY:Feest',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:nacht',
      'DTSTART;TZID=Europe/Amsterdam:20261114T220000',
      'DTEND;TZID=Europe/Amsterdam:20261115T020000',
      'SUMMARY:Nachtdienst',
      'END:VEVENT',
    )
    const [party, night] = expand(text, '2026-11-14', '2026-11-15')
    expect(party).toMatchObject({
      startDate: '2026-11-14',
      endDate: '2026-11-14',
      endTime: '00:00',
    })
    expect(night).toMatchObject({
      startDate: '2026-11-14',
      endDate: '2026-11-15',
      endTime: '02:00',
    })
    expect(expand(text, '2026-11-15', '2026-11-15').map((e) => e.title)).toEqual(['Nachtdienst'])
  })

  it('gebruikt de VTIMEZONE uit de feed voor een zone zonder IANA-naam', () => {
    const text = feed(
      'BEGIN:VTIMEZONE',
      'TZID:W. Europe Standard Time',
      'BEGIN:STANDARD',
      'DTSTART:16010101T030000',
      'TZOFFSETFROM:+0200',
      'TZOFFSETTO:+0100',
      'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
      'END:STANDARD',
      'BEGIN:DAYLIGHT',
      'DTSTART:16010101T020000',
      'TZOFFSETFROM:+0100',
      'TZOFFSETTO:+0200',
      'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3',
      'END:DAYLIGHT',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
      'UID:outlook',
      'DTSTART;TZID=W. Europe Standard Time:20260710T090000',
      'DTEND;TZID=W. Europe Standard Time:20260710T100000',
      'SUMMARY:Zomeroverleg',
      'END:VEVENT',
    )
    expect(expand(text, '2026-07-10', '2026-07-10')[0]).toMatchObject({
      start: '2026-07-10T07:00:00.000Z',
      startTime: '09:00',
    })
  })

  it('leest een onbekende zone zonder definitie als DINGEN_TIMEZONE', () => {
    const text = feed(
      'BEGIN:VEVENT',
      'UID:raar',
      'DTSTART;TZID=Ergens/Onbekend:20261112T090000',
      'DTEND;TZID=Ergens/Onbekend:20261112T100000',
      'SUMMARY:Raar',
      'END:VEVENT',
    )
    expect(expand(text, '2026-11-12', '2026-11-12')[0]).toMatchObject({ startTime: '09:00' })
  })

  it('slaat een afgezegde losse afspraak over en geeft een lege titel door', () => {
    const text = feed(
      'BEGIN:VEVENT',
      'UID:weg',
      'DTSTART:20261112T090000Z',
      'DTEND:20261112T100000Z',
      'STATUS:CANCELLED',
      'SUMMARY:Gaat niet door',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:leeg',
      'DTSTART:20261112T110000Z',
      'END:VEVENT',
    )
    expect(expand(text, '2026-11-12', '2026-11-12')).toEqual([
      expect.objectContaining({ title: '', startTime: '12:00', endTime: '12:00' }),
    ])
  })
})

describe('wallToInstant', () => {
  const f = (hour: number, day: number, month: number) => ({
    year: 2026,
    month,
    day,
    hour,
    minute: 30,
    second: 0,
  })

  it('schuift een tijd in het zomertijdgat een uur op', () => {
    // 29 maart 2026, 02:30 bestaat niet in Amsterdam.
    expect(new Date(wallToInstant(f(2, 29, 3), TZ)).toISOString()).toBe('2026-03-29T01:30:00.000Z')
  })

  it('kiest bij een dubbele tijd de eerste', () => {
    // 25 oktober 2026, 02:30 bestaat twee keer.
    expect(new Date(wallToInstant(f(2, 25, 10), TZ)).toISOString()).toBe('2026-10-25T00:30:00.000Z')
  })
})
