import { addMonths, daysBetween, weekdayOf } from '@dingen/core'
import type { ImportRecord } from '../sync.js'
import { Book, type DemoContext } from './book.js'

const WEEKLY_STEPS = [
  'mindSweep',
  'weekLookBack',
  'dueSoon',
  'projects',
  'areas',
  'looseTasks',
  'somedayScan',
  'triggers',
]
const MONTHLY_STEPS = ['monthLookBack', 'areasDeep', 'somedayDeep']

/**
 * Sam Rivera, a freelance web designer: the main demo account. Every list is
 * filled, dates are relative to today, and the weekly review is due.
 */
function sam(ctx: DemoContext): ImportRecord[] {
  const b = new Book(ctx)

  for (const title of ['calls', 'errands', 'computer', 'waiting', '15 min']) b.tag(title)

  const clients = b.area('Clients', 'briefcase', 'blue', 8)
  const business = b.area('Business', 'wallet', 'green', 8)
  const home = b.area('Home', 'home', 'orange', 8)
  const health = b.area('Health', 'heart-pulse', 'red', 22)
  const family = b.area('Friends & Family', 'users', 'purple', 8)

  // --- Inbox: loose captures, not yet processed ---
  b.task('Look into a standing desk', { created: 2 })
  b.task('Podcast tip from Jo: "Design Details"', { created: 1 })
  b.task('Renew the portfolio domain before it lapses', {
    created: 1,
    notes: 'Registrar sent a reminder. Check whether auto-renew is on.',
  })
  b.task('Idea: short newsletter for past clients', { created: 0 })
  b.task('Return the library books', { created: 0 })
  b.task('Ask Priya about the font licence for Crumb & Co.', { created: 0 })

  // --- Clients ---
  const bakery = b.project('Crumb & Co. website', {
    area: clients,
    created: 21,
    reviewed: 8,
    deadline: 33,
    notes:
      'New website for Crumb & Co., the bakery on Mill Street: menu, opening hours and online cake orders.\n\nContact: Hannah Brooks, hannah@example.com',
  })
  const discovery = b.heading(bakery, 'Discovery')
  b.task('Kick-off call with Hannah', { heading: discovery, done: 18, tags: ['calls'] })
  b.task('Collect photos and brand assets', { heading: discovery, done: 12 })
  b.task('Sitemap and page list', { heading: discovery, done: 9 })
  const design = b.heading(bakery, 'Design')
  b.task('Moodboard and type pairing', { heading: design, done: 4 })
  b.task('Send Hannah the logo files', { heading: design, done: 1, doneAt: '11:15' })
  b.task('Homepage design', {
    heading: design,
    when: 0,
    tags: ['computer'],
    created: 4,
    checklist: [
      'x Hero with the seasonal cake',
      'x Menu preview',
      'Opening hours and map',
      'Cake order call-to-action',
    ],
  })
  b.task('Mobile layouts', { heading: design, when: 'anytime', tags: ['computer'], created: 4 })
  b.task('Send designs to Hannah for feedback', {
    heading: design,
    when: 2,
    time: '10:00',
    reminder: [0, '09:30'],
    created: 4,
  })
  b.task("Hannah's feedback on the colour palette", {
    heading: design,
    when: 'anytime',
    tags: ['waiting'],
    created: 3,
    notes: 'Sent two options on Monday. Follow up if nothing by Friday.',
  })
  const build = b.heading(bakery, 'Build')
  b.task('Set up hosting and a staging site', { heading: build, when: 'anytime', created: 9 })
  b.task('Menu page with editable prices', { heading: build, when: 'anytime', created: 9 })
  b.task('Cake order form', {
    heading: build,
    when: 'anytime',
    created: 9,
    notes: 'Pick-up date, size, flavour, message on the cake. Orders go to the shop inbox.',
  })
  b.task('Launch checklist', {
    heading: build,
    when: 'anytime',
    created: 9,
    checklist: [
      'Redirect old pages',
      'Favicon and social image',
      'Analytics',
      'Test the order form',
    ],
  })

  const onboarding = b.project('Fieldnote app onboarding', {
    area: clients,
    created: 16,
    reviewed: 20,
    deadline: 12,
    notes:
      'Redesign the first-run flow of the Fieldnote app: four screens and the empty states.\n\nContact: Luis Ortega, luis@example.com',
  })
  b.task('Audit the current onboarding screens', { project: onboarding, done: 6 })
  b.task('Sketch three flow options', { project: onboarding, done: 2 })
  b.task('Onboarding flow v2', {
    project: onboarding,
    when: 0,
    tags: ['computer'],
    created: 2,
  })
  b.task('Write microcopy for the empty states', {
    project: onboarding,
    when: 'anytime',
    tags: ['computer'],
    created: 6,
  })
  b.task('Usability test with five people', {
    project: onboarding,
    when: 6,
    time: '14:00',
    reminder: [1, '17:00'],
    created: 5,
    checklist: ['x Recruit testers', 'Write the test script', 'Book the meeting room'],
  })
  b.task('Present the new flow to Luis and the team', {
    project: onboarding,
    when: 11,
    time: '11:00',
    reminder: [0, '10:00'],
    created: 5,
  })
  b.task('Quote for Riverside Dental', {
    area: clients,
    canceled: 11,
    notes: 'They went with an agency in the end.',
  })

  // --- Business ---
  const vat = b.project('Q4 VAT return', {
    area: business,
    created: 10,
    reviewed: 8,
    deadline: 9,
  })
  b.task('Export bank transactions', { project: vat, done: 3, tags: ['computer'] })
  b.task('Match receipts to expenses', {
    project: vat,
    when: 0,
    tags: ['computer'],
    created: 3,
    checklist: ['x October', 'November', 'December'],
  })
  b.task('Check the mileage log', { project: vat, when: 'anytime', tags: ['15 min'], created: 3 })
  b.task('Submit the return online', { project: vat, when: 7, tags: ['computer'], created: 3 })

  const portfolio = b.project('Portfolio refresh', {
    area: business,
    created: 45,
    notes: 'Fewer projects, better told. Six case studies at most.',
  })
  b.task('Pick the six best projects', { project: portfolio, when: 'anytime', created: 45 })
  b.task('Case study: Northwind rebrand', { project: portfolio, when: 'anytime', created: 45 })
  b.task('New headshot', { project: portfolio, when: 'anytime', created: 45, tags: ['errands'] })

  const cards = b.project('New business cards', { area: business, done: 16, reviewed: 22 })
  b.task('Design the front and back', { project: cards, done: 24 })
  b.task('Order a proof', { project: cards, done: 21 })
  b.task('Approve the proof and print 250', { project: cards, done: 16 })

  b.task('Update the rate card for next year', { area: business, when: 'anytime', created: 12 })
  b.task('Call the accountant about pension contributions', {
    area: business,
    when: 'anytime',
    tags: ['calls'],
    created: 5,
  })
  b.task('Blog post on accessible colour palettes', {
    area: business,
    when: 'someday',
    created: 30,
  })
  b.task('Cancel the unused stock photo subscription', { area: business, done: 13 })
  const invoiceDay = b.day(3)
  b.repeating(
    'Send invoices',
    { unit: 'month', every: 1, basis: 'schedule', start: addMonths(invoiceDay, -2) },
    3,
    {
      area: business,
      time: '09:00',
      reminder: [0, '09:00'],
      tags: ['computer'],
      notes: 'Hours from the time sheet; reminders for anything older than 30 days.',
    },
    [daysBetween(addMonths(invoiceDay, -1), ctx.today)],
  )

  // --- Home ---
  const garden = b.project('Garden makeover', {
    area: home,
    created: 12,
    reviewed: 8,
    notes: 'Raised beds along the fence, a small herb corner, and a bench for the evening sun.',
  })
  b.task('Measure the beds and sketch a plan', { project: garden, done: 8 })
  b.task('Order the raised bed kit', { project: garden, when: 5, created: 8 })
  b.task('Build the raised beds', { project: garden, when: 10, created: 8 })
  b.task('Buy plants', {
    project: garden,
    when: 12,
    tags: ['errands'],
    created: 8,
    checklist: ['Lavender', 'Rosemary', 'Thyme', 'Strawberries', 'Compost (4 bags)'],
  })

  b.project('Reading nook in the attic', { area: home, when: 'someday', created: 40, reviewed: 25 })
  b.task('Call the plumber about the dripping kitchen tap', {
    area: home,
    when: 0,
    tags: ['calls'],
    created: 2,
  })
  b.task('Book the boiler service', {
    area: home,
    when: 4,
    reminder: [0, '09:00'],
    tags: ['calls'],
    created: 6,
  })
  b.task('Buy light bulbs for the hallway', { area: home, when: 'anytime', tags: ['errands'] })
  b.task('Take out the recycling', { area: home, when: 0, evening: true, tags: ['15 min'] })
  b.task('Learn to bake sourdough', { area: home, when: 'someday', created: 35 })
  b.task('Renew the car insurance', { area: home, done: 20 })
  b.task('Pay the window cleaner', { area: home, done: 0, doneAt: '08:30' })
  b.repeating(
    'Water the plants',
    {
      unit: 'week',
      every: 1,
      basis: 'schedule',
      start: b.day(-21),
      weekdays: [weekdayOf(b.day(0))],
    },
    0,
    { area: home, tags: ['15 min'] },
    [14, 7],
  )

  // --- Health ---
  b.task('Book a dentist check-up', { area: health, when: 'anytime', tags: ['calls'], created: 9 })
  b.task('Yoga class', { area: health, when: 1, time: '07:30', reminder: [0, '07:00'] })
  b.task('Stretch for fifteen minutes', {
    area: health,
    when: 0,
    evening: true,
    tags: ['15 min'],
  })
  b.task('Try bouldering', { area: health, when: 'someday', created: 26 })
  for (const days of [2, 6, 10, 17, 24]) {
    b.task('Run 5 km', { area: health, done: days, doneAt: '07:40' })
  }

  // --- Friends & Family ---
  const party = b.project("Surprise party for Morgan's 40th", {
    area: family,
    created: 14,
    reviewed: 8,
    deadline: 17,
    notes: 'Keep it a secret! An evening party, around 30 people, budget about 600.',
  })
  const guests = b.heading(party, 'Guests')
  b.task('Make the guest list', {
    heading: guests,
    done: 10,
    checklist: ['x Family', 'x School colleagues', 'x Book club', 'x Old friends from uni'],
  })
  b.task('Send the invitations (secretly)', {
    heading: guests,
    when: 0,
    tags: ['computer'],
    created: 9,
  })
  b.task('Chase RSVPs', { heading: guests, when: 8, tags: ['waiting'], created: 9 })
  const venue = b.heading(party, 'Venue')
  b.task('Visit The Lantern Room', { heading: venue, done: 5 })
  b.task('Pay the venue deposit', { heading: venue, when: 1, deadline: 3, created: 5 })
  const cake = b.heading(party, 'Cake')
  b.task('Order the cake from Crumb & Co.', {
    heading: cake,
    when: 3,
    tags: ['calls'],
    created: 5,
    notes: 'Lemon and elderflower, serves 30. Pick up on the day before noon.',
  })
  const gift = b.heading(party, 'Gift')
  b.task('Collect messages for the memory book', {
    heading: gift,
    when: 'anytime',
    created: 9,
    checklist: ['x Alex', 'x Dee', 'Jordan', 'Grandma Rose', 'The book club'],
  })
  b.task('Pick up the framed print', { heading: gift, when: 15, tags: ['errands'], created: 9 })

  const lisbon = b.project('Weekend in Lisbon', {
    area: family,
    created: 11,
    reviewed: 8,
    notes: 'Friday to Monday, just the two of us. Apartment in Alfama.',
  })
  b.task('Book the flights', { project: lisbon, done: 7 })
  b.task('Book the apartment', { project: lisbon, done: 7 })
  b.task('Dinner reservation for Saturday', { project: lisbon, when: 20, created: 7 })
  b.task('Packing list', {
    project: lisbon,
    when: 25,
    created: 7,
    checklist: ['Passports', 'Chargers', 'Walking shoes', 'Camera', 'Euros for the tram'],
  })
  b.task('Call Mum', { area: family, when: 0, evening: true, tags: ['calls'] })
  b.task("Birthday present for Alex's little one", { area: family, done: 4 })

  // --- No area ---
  b.task('Check the passport expiry dates', { when: 'anytime', tags: ['15 min'], created: 3 })
  b.project('Learn basic Portuguese', { when: 'someday', created: 30, reviewed: 25 })

  // --- Reviews: the weekly one is due again, the monthly one is not ---
  b.repeating(
    'Weekly review',
    { unit: 'week', every: 1, basis: 'completion', start: b.day(-22) },
    0,
    { time: '16:00', reminder: [0, '15:45'], doneAt: '16:40' },
    [15, 8],
  )
  b.review('weekly', 15, WEEKLY_STEPS)
  b.review('weekly', 8, WEEKLY_STEPS)
  b.review('monthly', 12, MONTHLY_STEPS)
  b.review('daily', 1, [])

  return b.records
}

/** Morgan Rivera, a teacher: a smaller set, with a few household tasks Sam also has. */
function morgan(ctx: DemoContext): ImportRecord[] {
  const b = new Book(ctx)

  b.tag('calls')
  b.tag('errands')

  const home = b.area('Home', 'home', 'orange', 5)
  const health = b.area('Health', 'heart-pulse', 'red', 5)
  const school = b.area('School', 'graduation-cap', 'indigo', 5)

  b.task('Ask Sam what we are doing that Saturday', { created: 1 })
  b.task("Lentil soup recipe from Dee's", { created: 0 })

  const trip = b.project('Year 9 trip to the science museum', {
    area: school,
    created: 12,
    reviewed: 5,
    deadline: 14,
    notes: '58 pupils, 5 staff. Leave 8:30, back by 15:30.',
  })
  b.task('Send consent forms home', { project: trip, done: 4 })
  b.task('Book the coach', { project: trip, when: 0, tags: ['calls'], created: 4 })
  b.task('Collect consent forms', {
    project: trip,
    when: 5,
    created: 4,
    checklist: ['x 9A', '9B', '9C'],
  })
  b.task('Risk assessment', { project: trip, when: 'anytime', created: 4 })

  const parents = b.project("Parents' evening", { area: school, created: 6, reviewed: 5 })
  b.task('Print the progress reports', { project: parents, when: 8, created: 6 })
  b.task('Book the time slots', { project: parents, when: 'anytime', created: 6 })

  b.task('Mark Year 10 essays', {
    area: school,
    when: 0,
    created: 3,
    checklist: ['x Set 1', 'Set 2', 'Set 3'],
  })
  b.task("Plan tomorrow's lessons", { area: school, when: 0, evening: true })
  b.task('Mark the Year 8 quizzes', { area: school, done: 3 })

  b.task('Call the plumber about the dripping kitchen tap', {
    area: home,
    when: 0,
    tags: ['calls'],
    created: 2,
  })
  b.task('Book the boiler service', { area: home, when: 4, tags: ['calls'], created: 6 })
  b.task('Buy bin bags', { area: home, when: 'anytime', tags: ['errands'] })
  b.task('Order new reading glasses', { area: health, done: 6 })

  b.task('Swim', { area: health, when: 2, time: '07:00', reminder: [0, '06:30'] })
  b.repeating(
    'Physio exercises',
    { unit: 'day', every: 1, basis: 'schedule', start: b.day(-10) },
    0,
    { area: health },
    [3, 2, 1],
  )
  b.task('Swim', { area: health, done: 5, doneAt: '07:50' })

  b.review('weekly', 5, WEEKLY_STEPS)

  return b.records
}

/** The demo data per account email; accounts without an entry start empty. */
export function buildDemoSet(ctx: DemoContext): Record<string, ImportRecord[]> {
  return {
    'sam@example.com': sam(ctx),
    'morgan@example.com': morgan(ctx),
  }
}
