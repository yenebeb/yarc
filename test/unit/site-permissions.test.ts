import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { NOT_NOWS_BEFORE_QUIET, QUIET_FOR, SiteDecisions, type SitePermissionsFile } from '../../src/main/site-permissions.ts'

const MEET = 'https://meet.google.com'
const SLACK = 'https://app.slack.com'
const DAY = 24 * 60 * 60 * 1000
const monday = Date.UTC(2026, 10, 9)

/** One profile's permissions.json on "disk", and a clock; `launch()` reads it back like a restart. */
function profile() {
  let file: SitePermissionsFile | undefined
  let now = monday
  const launch = () =>
    new SiteDecisions(
      file && JSON.parse(JSON.stringify(file)),
      (data) => (file = JSON.parse(JSON.stringify(data))),
      () => now
    )
  return { launch, later: (ms: number) => (now += ms), file: () => file }
}

describe('Allow and Block are kept across restarts', () => {
  test('a site allowed once is still allowed after relaunching', () => {
    const p = profile()
    p.launch().set(MEET, 'notifications', 'allow')
    assert.equal(p.launch().answer(MEET, 'notifications'), true)
  })

  test('a site blocked in Settings stays blocked after relaunching', () => {
    const p = profile()
    p.launch().set(MEET, 'media:video', 'block')
    assert.equal(p.launch().answer(MEET, 'media:video'), false)
  })

  test('a site nobody answered still gets asked', () => {
    assert.equal(profile().launch().answer(SLACK, 'notifications'), undefined)
  })

  test('each permission of a site is its own answer', () => {
    const p = profile()
    p.launch().set(MEET, 'media:audio', 'allow')
    assert.equal(p.launch().answer(MEET, 'media:video'), undefined)
  })

  test('Forget removes the answer, so the site asks again', () => {
    const p = profile()
    const run = p.launch()
    run.set(MEET, 'notifications', 'allow')
    run.reset(MEET, 'notifications')
    assert.equal(run.answer(MEET, 'notifications'), undefined)
    assert.equal(p.launch().answer(MEET, 'notifications'), undefined)
    assert.deepEqual(p.file(), { version: 1, settings: {}, notNow: {} })
  })

  test('an unreadable permissions file starts empty instead of failing', () => {
    assert.equal(new SiteDecisions('not json').answer(MEET, 'notifications'), undefined)
    assert.equal(new SiteDecisions({ settings: { [MEET]: { notifications: 'maybe' } } }).answer(MEET, 'notifications'), undefined)
  })
})

describe('Not Now stops a site from nagging', () => {
  test('after Not Now the site is refused for the rest of the run, without asking', () => {
    const run = profile().launch()
    run.notNow(MEET, 'notifications')
    assert.equal(run.answer(MEET, 'notifications'), false)
  })

  test('the next launch asks again', () => {
    const p = profile()
    p.launch().notNow(MEET, 'notifications')
    assert.equal(p.launch().answer(MEET, 'notifications'), undefined)
  })

  test(`after ${NOT_NOWS_BEFORE_QUIET} Not Nows across launches the site is refused for a week without asking`, () => {
    const p = profile()
    for (let i = 0; i < NOT_NOWS_BEFORE_QUIET; i++) p.launch().notNow(MEET, 'notifications')
    p.later(QUIET_FOR - DAY)
    assert.equal(p.launch().answer(MEET, 'notifications'), false)
  })

  test('once the quiet week is over the site may ask again, and the count starts over', () => {
    const p = profile()
    for (let i = 0; i < NOT_NOWS_BEFORE_QUIET; i++) p.launch().notNow(MEET, 'notifications')
    p.later(QUIET_FOR + DAY)
    assert.equal(p.launch().answer(MEET, 'notifications'), undefined)
    p.launch().notNow(MEET, 'notifications')
    assert.equal(p.launch().answer(MEET, 'notifications'), undefined)
  })

  test('Allow wipes the Not Now count', () => {
    const p = profile()
    p.launch().notNow(MEET, 'notifications')
    p.launch().notNow(MEET, 'notifications')
    p.launch().set(MEET, 'notifications', 'allow')
    p.launch().reset(MEET, 'notifications')
    p.launch().notNow(MEET, 'notifications')
    assert.equal(p.launch().answer(MEET, 'notifications'), undefined)
  })

  test('Not Now on one site does not quiet another', () => {
    const p = profile()
    for (let i = 0; i < NOT_NOWS_BEFORE_QUIET; i++) p.launch().notNow(MEET, 'notifications')
    assert.equal(p.launch().answer(SLACK, 'notifications'), undefined)
  })
})

describe('Settings lists what each site was told', () => {
  test('allowed and blocked sites, and quiet ones with the day asking resumes, sorted by site name', () => {
    const p = profile()
    const run = p.launch()
    run.set(SLACK, 'notifications', 'block')
    run.set(MEET, 'media:video', 'allow')
    for (let i = 0; i < NOT_NOWS_BEFORE_QUIET; i++) run.notNow(MEET, 'notifications')
    assert.deepEqual(p.launch().list(), [
      { origin: SLACK, key: 'notifications', setting: 'block' },
      { origin: MEET, key: 'media:video', setting: 'allow' },
      { origin: MEET, key: 'notifications', setting: 'quiet', until: monday + QUIET_FOR }
    ])
  })

  test('a single Not Now is not listed: the site will simply ask again next launch', () => {
    const run = profile().launch()
    run.notNow(MEET, 'notifications')
    assert.deepEqual(run.list(), [])
  })
})
