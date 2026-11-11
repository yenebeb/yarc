import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { PermissionQueue } from '../../src/main/permission-queue.ts'
import { SiteDecisions } from '../../src/main/site-permissions.ts'
import { promptText, siteName } from '../../src/shared/permissions.ts'

const MEET = 'https://meet.google.com'
const SLACK = 'https://app.slack.com'
const meetTab = 1
const secondMeetTab = 2
const slackTab = 3
const WORK = 'work'
const PERSONAL = 'personal'

/** A queue plus what each site was told, in order. */
function setup() {
  const profiles = new Map<string, SiteDecisions>()
  const decisionsFor = (id: string) => profiles.get(id) ?? profiles.set(id, new SiteDecisions()).get(id)!
  const queue = new PermissionQueue(decisionsFor)
  const told: string[] = []
  const ask = (wcId: number, origin: string, permission: string, mediaTypes?: ('video' | 'audio')[], profileId = WORK) =>
    queue.request({ profileId, wcId, origin, permission, mediaTypes }, (allowed) => told.push(`${origin} ${permission}${mediaTypes ? ` ${mediaTypes.join('+')}` : ''}: ${allowed ? 'allowed' : 'refused'}`))
  return { queue, told, ask }
}

describe('a site asking for a permission waits for the user', () => {
  test('the request waits until the user answers', () => {
    const { queue, told, ask } = setup()
    ask(meetTab, MEET, 'notifications')
    assert.deepEqual(told, [])
    queue.answer(queue.next([meetTab])!.id, 'allow')
    assert.deepEqual(told, [`${MEET} notifications: allowed`])
  })

  test('Not Now refuses it', () => {
    const { queue, told, ask } = setup()
    ask(meetTab, MEET, 'notifications')
    queue.answer(queue.next([meetTab])!.id, 'deny')
    assert.deepEqual(told, [`${MEET} notifications: refused`])
  })

  test('the prompt only shows for a page on screen; a background tab waits its turn', () => {
    const { queue, ask } = setup()
    ask(slackTab, SLACK, 'notifications')
    assert.equal(queue.next([meetTab]), undefined)
    assert.equal(queue.next([meetTab, slackTab])?.origin, SLACK)
  })

  test('the page listed first (the active tab) is asked about first, then each page in order of asking', () => {
    const { queue, ask } = setup()
    ask(slackTab, SLACK, 'notifications')
    ask(meetTab, MEET, 'media', ['video'])
    ask(meetTab, MEET, 'notifications')
    assert.equal(queue.next([meetTab, slackTab])?.permission, 'media')
    queue.answer(queue.next([meetTab, slackTab])!.id, 'allow')
    assert.equal(queue.next([meetTab, slackTab])?.permission, 'notifications')
    assert.equal(queue.next([meetTab, slackTab])?.origin, MEET)
  })

  test('a page asking again before answering gets the same prompt, and both requests get the answer', () => {
    const { queue, told, ask } = setup()
    ask(meetTab, MEET, 'media', ['video', 'audio'])
    ask(meetTab, MEET, 'media', ['audio', 'video'])
    assert.deepEqual(queue.waitingPages(), [meetTab])
    queue.answer(queue.next([meetTab])!.id, 'allow')
    assert.equal(queue.next([meetTab]), undefined)
    assert.equal(told.length, 2)
  })

  test('the queue reports each change so the prompt can be redrawn', () => {
    let changes = 0
    const queue = new PermissionQueue(() => new SiteDecisions(), () => changes++)
    queue.request({ profileId: WORK, wcId: meetTab, origin: MEET, permission: 'notifications' }, () => {})
    queue.answer(queue.next([meetTab])!.id, 'allow')
    assert.equal(changes, 2)
  })
})

describe('answers are remembered for the site', () => {
  test('Allow is remembered: the next request is allowed without asking', () => {
    const { queue, told, ask } = setup()
    ask(meetTab, MEET, 'notifications')
    queue.answer(queue.next([meetTab])!.id, 'allow')
    ask(meetTab, MEET, 'notifications')
    assert.equal(queue.next([meetTab]), undefined)
    assert.deepEqual(told, [`${MEET} notifications: allowed`, `${MEET} notifications: allowed`])
    assert.equal(queue.decided(WORK, MEET, 'notifications'), true)
  })

  test('Not Now refuses the site for the rest of the run, so it can not keep asking', () => {
    const { queue, told, ask } = setup()
    ask(meetTab, MEET, 'geolocation')
    queue.answer(queue.next([meetTab])!.id, 'deny')
    ask(meetTab, MEET, 'geolocation')
    assert.deepEqual(told, [`${MEET} geolocation: refused`, `${MEET} geolocation: refused`])
  })

  test('a request with nowhere to ask (dismissed) is refused without remembering anything', () => {
    const { queue, told, ask } = setup()
    ask(meetTab, MEET, 'notifications')
    queue.answer(queue.next([meetTab])!.id, 'dismiss')
    assert.equal(queue.decided(WORK, MEET, 'notifications'), undefined)
    ask(meetTab, MEET, 'notifications')
    assert.equal(queue.next([meetTab])?.permission, 'notifications')
    assert.deepEqual(told, [`${MEET} notifications: refused`])
  })

  test('answers belong to a profile: the same site asks again in another profile', () => {
    const { queue, ask } = setup()
    ask(meetTab, MEET, 'notifications')
    queue.answer(queue.next([meetTab])!.id, 'allow')
    ask(secondMeetTab, MEET, 'notifications', undefined, PERSONAL)
    assert.equal(queue.next([secondMeetTab])?.origin, MEET)
  })

  test('an answer is per site: another site still gets asked', () => {
    const { queue, ask } = setup()
    ask(meetTab, MEET, 'notifications')
    queue.answer(queue.next([meetTab])!.id, 'allow')
    ask(slackTab, SLACK, 'notifications')
    assert.equal(queue.next([slackTab])?.origin, SLACK)
  })

  test("an answer also settles the same question waiting in the site's other tabs", () => {
    const { queue, told, ask } = setup()
    ask(meetTab, MEET, 'notifications')
    ask(secondMeetTab, MEET, 'notifications')
    queue.answer(queue.next([meetTab])!.id, 'allow')
    assert.equal(queue.next([secondMeetTab]), undefined)
    assert.deepEqual(told, [`${MEET} notifications: allowed`, `${MEET} notifications: allowed`])
  })
})

describe('camera and microphone are separate permissions', () => {
  test('allowing the microphone does not give away the camera', () => {
    const { queue, ask } = setup()
    ask(meetTab, MEET, 'media', ['audio'])
    queue.answer(queue.next([meetTab])!.id, 'allow')
    assert.equal(queue.decided(WORK, MEET, 'media', ['audio']), true)
    assert.equal(queue.decided(WORK, MEET, 'media', ['video']), undefined)
    ask(meetTab, MEET, 'media', ['video', 'audio'])
    assert.deepEqual(queue.next([meetTab])?.mediaTypes, ['video', 'audio'])
  })

  test('allowing both answers later requests for either one', () => {
    const { queue, told, ask } = setup()
    ask(meetTab, MEET, 'media', ['video', 'audio'])
    queue.answer(queue.next([meetTab])!.id, 'allow')
    ask(meetTab, MEET, 'media', ['video'])
    assert.equal(told.at(-1), `${MEET} media video: allowed`)
  })

  test('refusing either one refuses a request for both', () => {
    const { queue, ask } = setup()
    ask(meetTab, MEET, 'media', ['video'])
    queue.answer(queue.next([meetTab])!.id, 'deny')
    assert.equal(queue.decided(WORK, MEET, 'media', ['video', 'audio']), false)
    // A permission check that doesn't say which device covers both.
    assert.equal(queue.decided(WORK, MEET, 'media'), false)
  })
})

describe('a page that goes away takes its questions with it', () => {
  test('navigating or closing the page refuses what it asked and removes the prompt', () => {
    const { queue, told, ask } = setup()
    ask(meetTab, MEET, 'notifications')
    ask(slackTab, SLACK, 'notifications')
    queue.cancel(meetTab)
    assert.deepEqual(told, [`${MEET} notifications: refused`])
    assert.deepEqual(queue.waitingPages(), [slackTab])
    assert.equal(queue.decided(WORK, MEET, 'notifications'), undefined)
  })

  test('answering a prompt that is already gone does nothing', () => {
    const { queue, told, ask } = setup()
    ask(meetTab, MEET, 'notifications')
    const id = queue.next([meetTab])!.id
    queue.cancel(meetTab)
    queue.answer(id, 'allow')
    assert.deepEqual(told, [`${MEET} notifications: refused`])
    assert.equal(queue.decided(WORK, MEET, 'notifications'), undefined)
  })
})

describe('the prompt names the site and asks in plain words', () => {
  test('the site is its host, without https://', () => {
    assert.equal(siteName(MEET), 'meet.google.com')
    assert.equal(siteName('http://localhost:8765'), 'localhost:8765')
    assert.equal(siteName('file://'), 'file://')
  })

  test("notifications, camera, microphone and location, in Arc's words", () => {
    assert.deepEqual(promptText('notifications'), { icon: 'bell', wants: 'send you notifications' })
    assert.deepEqual(promptText('media', ['video', 'audio']), { icon: 'camera', wants: 'access your camera, microphone' })
    assert.deepEqual(promptText('media', ['video']), { icon: 'camera', wants: 'access your camera' })
    assert.deepEqual(promptText('media', ['audio']), { icon: 'mic', wants: 'access your microphone' })
    assert.deepEqual(promptText('geolocation'), { icon: 'location', wants: 'access your location' })
  })
})
