import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { isSecurityUpdate, shouldAsk, startWaiting } from '../../src/main/update/update-escalation.ts'

const HOUR = 60 * 60_000
const DAY = 24 * HOUR
// The update was downloaded on a Monday morning; times below count from then.
const monday = Date.UTC(2026, 10, 9, 9)
const after = (ms: number) => monday + ms

describe('A downloaded update stays quiet until it has waited a week', () => {
  const waiting = { from: '0.1.30', since: monday }

  test('the day it is downloaded: no dialog, only the sidebar pill', () => {
    assert.equal(shouldAsk(waiting, false, after(HOUR)), false)
  })

  test('six days later: still no dialog', () => {
    assert.equal(shouldAsk(waiting, false, after(6 * DAY)), false)
  })

  test('seven days later: the dialog asks', () => {
    assert.equal(shouldAsk(waiting, false, after(7 * DAY)), true)
  })
})

describe('After "Later", the dialog stays away for a day', () => {
  const askedOnDay7 = { from: '0.1.30', since: monday, askedAt: after(7 * DAY) }

  test('the same day: no second dialog', () => {
    assert.equal(shouldAsk(askedOnDay7, false, after(7 * DAY + 23 * HOUR)), false)
  })

  test('a day later: it asks again', () => {
    assert.equal(shouldAsk(askedOnDay7, false, after(8 * DAY)), true)
  })
})

describe('An update with Chromium security fixes asks after a day', () => {
  const waiting = { from: '0.1.30', since: monday }

  test('the day it is downloaded: no dialog yet, so a normal restart can install it', () => {
    assert.equal(shouldAsk(waiting, true, after(23 * HOUR)), false)
  })

  test('a day later: the dialog asks', () => {
    assert.equal(shouldAsk(waiting, true, after(DAY)), true)
  })
})

describe('The wait is counted from the first update that was ready for this version', () => {
  test('nothing waited before: the wait starts now', () => {
    assert.deepEqual(startWaiting(undefined, '0.1.30', monday), { from: '0.1.30', since: monday })
  })

  test('YARC restarted without installing (a crash): the wait goes on from Monday', () => {
    const saved = { from: '0.1.30', since: monday }
    assert.equal(startWaiting(saved, '0.1.30', after(3 * DAY)), saved)
  })

  test('a newer release replaced the waiting one: the wait goes on from Monday, and so does the last "Later"', () => {
    const saved = { from: '0.1.30', since: monday, askedAt: after(7 * DAY) }
    assert.equal(startWaiting(saved, '0.1.30', after(7 * DAY + HOUR)), saved)
  })

  test('the user restarted into the update: the next one starts a new wait', () => {
    const saved = { from: '0.1.30', since: monday, askedAt: after(7 * DAY) }
    assert.deepEqual(startWaiting(saved, '0.1.31', after(8 * DAY)), { from: '0.1.31', since: after(8 * DAY) })
  })
})

describe('An update is a security update when it changes Electron', () => {
  test('a newer Electron than the one running: security fixes', () => {
    assert.equal(isSecurityUpdate('45.2.3', { electron: '45.2.4' }), true)
  })

  test('the same Electron: a normal update', () => {
    assert.equal(isSecurityUpdate('45.2.3', { electron: '45.2.3' }), false)
  })

  test('an older release without release.json, or one we could not read: a normal update', () => {
    assert.equal(isSecurityUpdate('45.2.3', undefined), false)
    assert.equal(isSecurityUpdate('45.2.3', 'Not Found'), false)
    assert.equal(isSecurityUpdate('45.2.3', {}), false)
    assert.equal(isSecurityUpdate('45.2.3', { electron: 45 }), false)
    assert.equal(isSecurityUpdate('45.2.3', { electron: '' }), false)
  })
})
