import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { changesSince, recentChanges, startupScreen, type Changelog } from '../../src/main/features/changelog.ts'

// 0.1.11 only had Dependabot bumps, so it has no entry; 0.1.12 has an empty one.
const changelog: Changelog = {
  changes: {
    '0.1.13': ['Add incognito windows'],
    '0.1.12': [],
    '0.1.10': ['Add split view by dragging', 'Import from Zen'],
    '0.1.9': ['Restyle Little Arc'],
    '0.1.8': ['Add Tab to Search']
  },
  thanks: { '0.1.10': ['ada'] }
}

const versions = (notes: { version: string }[]) => notes.map((n) => n.version)

describe("What's New lists the changes since the version the user last ran", () => {
  test('one release later: that release', () => {
    assert.deepEqual(changesSince(changelog, '0.1.9', '0.1.10'), [{ version: '0.1.10', changes: ['Add split view by dragging', 'Import from Zen'], thanks: ['ada'] }])
  })

  test('several releases skipped in one update: all of them, newest first', () => {
    assert.deepEqual(versions(changesSince(changelog, '0.1.8', '0.1.13')), ['0.1.13', '0.1.10', '0.1.9'])
  })

  test('versions are compared as numbers, not text', () => {
    assert.deepEqual(versions(changesSince(changelog, '0.1.9', '0.1.10')), ['0.1.10'])
  })

  test('versions without changes are left out', () => {
    assert.deepEqual(versions(changesSince(changelog, '0.1.10', '0.1.13')), ['0.1.13'])
  })

  test('nothing newer than the running version, even if the changelog has it', () => {
    assert.deepEqual(versions(changesSince(changelog, '0.1.8', '0.1.9')), ['0.1.9'])
  })

  test('a last-seen version the changelog never heard of still bounds the list', () => {
    assert.deepEqual(versions(changesSince(changelog, '0.1.9-beta.1', '0.1.10')), ['0.1.10', '0.1.9'])
    assert.deepEqual(versions(changesSince(changelog, '0.0.0-dev', '0.1.9')), ['0.1.9', '0.1.8'])
  })

  test('a running version the changelog never heard of (a local build) shows what came before it', () => {
    assert.deepEqual(versions(changesSince(changelog, '0.1.9', '0.1.11')), ['0.1.10'])
  })

  test('no last-seen version (state from before YARC remembered it): only the running version', () => {
    assert.deepEqual(versions(changesSince(changelog, undefined, '0.1.10')), ['0.1.10'])
    assert.deepEqual(changesSince(changelog, undefined, '0.1.11'), [])
  })

  test('an empty changelog has nothing to show', () => {
    assert.deepEqual(changesSince({ changes: {}, thanks: {} }, '0.1.8', '0.1.13'), [])
  })
})

describe('Opening What\'s New by hand shows the latest versions up to the running one', () => {
  test('newest first, without empty versions', () => {
    assert.deepEqual(versions(recentChanges(changelog, '0.1.13')), ['0.1.13', '0.1.10', '0.1.9', '0.1.8'])
  })

  test('limited to a few versions', () => {
    assert.deepEqual(versions(recentChanges(changelog, '0.1.13', 2)), ['0.1.13', '0.1.10'])
  })

  test('not versions newer than the running one', () => {
    assert.deepEqual(versions(recentChanges(changelog, '0.1.9')), ['0.1.9', '0.1.8'])
  })
})

describe('A launch shows the welcome screen, What\'s New or nothing', () => {
  test('first run: the welcome screen, never What\'s New', () => {
    assert.deepEqual(startupScreen(true, undefined, '0.1.13', changelog), { kind: 'welcome' })
  })

  test('first launch after an update: What\'s New with the changes since the last version', () => {
    const screen = startupScreen(false, '0.1.9', '0.1.13', changelog)
    assert.equal(screen.kind, 'whats-new')
    assert.deepEqual(screen.kind === 'whats-new' && versions(screen.releases), ['0.1.13', '0.1.10'])
  })

  test('an existing profile updating to the first version that remembers: What\'s New for that version', () => {
    const screen = startupScreen(false, undefined, '0.1.13', changelog)
    assert.deepEqual(screen, { kind: 'whats-new', releases: [{ version: '0.1.13', changes: ['Add incognito windows'], thanks: [] }], spotlights: [] })
  })

  test('same version as last time: nothing', () => {
    assert.deepEqual(startupScreen(false, '0.1.13', '0.1.13', changelog), { kind: 'none' })
  })

  test('an older version than last time (downgrade): nothing', () => {
    assert.deepEqual(startupScreen(false, '0.1.13', '0.1.10', changelog), { kind: 'none' })
  })

  test('an update with no listed changes (only Dependabot bumps): nothing', () => {
    assert.deepEqual(startupScreen(false, '0.1.10', '0.1.12', changelog), { kind: 'none' })
  })
})

describe("Spotlights the user hasn't seen open What's New", () => {
  test('first run: the welcome screen, even with spotlights', () => {
    assert.deepEqual(startupScreen(true, undefined, '0.1.13', changelog, ['floating-player']), { kind: 'welcome' })
  })

  test('after an update: the spotlights, then that update\'s changes', () => {
    const screen = startupScreen(false, '0.1.10', '0.1.13', changelog, ['floating-player'])
    assert.deepEqual(screen, { kind: 'whats-new', spotlights: ['floating-player'], releases: [{ version: '0.1.13', changes: ['Add incognito windows'], thanks: [] }] })
  })

  test('an update whose changes are all "none" still shows its spotlights', () => {
    assert.deepEqual(startupScreen(false, '0.1.10', '0.1.12', changelog, ['floating-player']), { kind: 'whats-new', spotlights: ['floating-player'], releases: [] })
  })

  test('the same version as last time (a local build): only the spotlights', () => {
    assert.deepEqual(startupScreen(false, '0.1.13', '0.1.13', changelog, ['floating-player']), { kind: 'whats-new', spotlights: ['floating-player'], releases: [] })
  })
})
