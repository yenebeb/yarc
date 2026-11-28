import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { closeFloating, closed, dismiss, emptyMedia, float, left, minimize, shown } from '../../src/main/features/media-state.ts'

const FLOAT_ON = true

describe('leaving a tab', () => {
  test('a playing video floats', () => {
    assert.deepEqual(left(emptyMedia(), 'video-tab', 'video', FLOAT_ON), { cards: [], floating: 'video-tab' })
  })

  test('playing audio gets a card', () => {
    assert.deepEqual(left(emptyMedia(), 'radio', 'audio', FLOAT_ON), { cards: ['radio'] })
  })

  test('a tab that was paused gets nothing', () => {
    assert.deepEqual(left(emptyMedia(), 'paused-video', 'nothing', FLOAT_ON), emptyMedia())
  })

  test('with floating turned off, a playing video gets a card instead', () => {
    assert.deepEqual(left(emptyMedia(), 'video-tab', 'video', !FLOAT_ON), { cards: ['video-tab'] })
  })

  test('a second video takes the player, and the first keeps playing as a card', () => {
    const one = left(emptyMedia(), 'first', 'video', FLOAT_ON)
    assert.deepEqual(left(one, 'second', 'video', FLOAT_ON), { cards: ['first'], floating: 'second' })
  })

  test('the newest card goes in front (last)', () => {
    const radio = left(emptyMedia(), 'radio', 'audio', FLOAT_ON)
    const both = left(radio, 'podcast', 'audio', FLOAT_ON)
    assert.deepEqual(left(both, 'radio', 'audio', FLOAT_ON).cards, ['podcast', 'radio'])
  })
})

describe('coming back to a tab', () => {
  test('its video leaves the player and goes back into the page', () => {
    assert.deepEqual(shown({ cards: [], floating: 'video-tab' }, 'video-tab'), { cards: [], floating: undefined })
  })

  test('its card goes; other cards and the player stay', () => {
    assert.deepEqual(shown({ cards: ['radio', 'podcast'], floating: 'video-tab' }, 'radio'), { cards: ['podcast'], floating: 'video-tab' })
  })

  test('closing a tab removes its card or its player the same way', () => {
    assert.deepEqual(closed({ cards: ['radio'], floating: 'video-tab' }, 'video-tab'), { cards: ['radio'], floating: undefined })
  })
})

describe("the player's buttons", () => {
  test('– keeps the video playing as the newest card', () => {
    assert.deepEqual(minimize({ cards: ['radio'], floating: 'video-tab' }), { cards: ['radio', 'video-tab'], floating: undefined })
  })

  test('✕ leaves a card too, so the paused video can be resumed', () => {
    assert.deepEqual(closeFloating({ cards: [], floating: 'video-tab' }), { cards: ['video-tab'], floating: undefined })
  })
})

describe("a card's buttons", () => {
  test('Float takes the video out of the cards and into the player', () => {
    assert.deepEqual(float({ cards: ['radio', 'video-tab'] }, 'video-tab'), { cards: ['radio'], floating: 'video-tab' })
  })

  test('Float swaps with a video already floating, which becomes a card', () => {
    assert.deepEqual(float({ cards: ['second'], floating: 'first' }, 'second'), { cards: ['first'], floating: 'second' })
  })

  test('✕ removes only that card', () => {
    assert.deepEqual(dismiss({ cards: ['radio', 'podcast'], floating: 'video-tab' }, 'radio'), { cards: ['podcast'], floating: 'video-tab' })
  })
})
