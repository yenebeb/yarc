import assert from 'node:assert/strict'
import { test } from 'node:test'
import { externalLinkInfo } from '../../src/main/core/external-link-info.ts'

test('names the app and the site asking', () => {
  const info = externalLinkInfo('msteams:/l/meetup-join/19%3ameeting', 'https://teams.microsoft.com/l/meetup-join/x')
  assert.equal(info.scheme, 'msteams')
  assert.equal(info.app, 'Microsoft Teams')
  assert.equal(info.site, 'teams.microsoft.com')
  assert.equal(info.origin, 'https://teams.microsoft.com')
  assert.equal(info.blocked, false)
})

test('unknown schemes are named by their scheme', () => {
  assert.equal(externalLinkInfo('obsidian://open?vault=x', 'https://example.com/').app, 'the obsidian: app')
})

test('Windows handlers that have been abused to run code are refused', () => {
  for (const url of ['ms-msdt:/id PCWDiagnostic', 'search-ms:query=x&crumb=location:\\\\evil\\share', 'SEARCH:query=x']) {
    assert.equal(externalLinkInfo(url, 'https://evil.example/').blocked, true, url)
  }
})

test('Chrome\'s refused schemes, network shares and YARC\'s own scheme are refused', () => {
  for (const url of ['shell:startup', 'vbscript:msgbox(1)', 'hcp://system/x', 'smb://evil.example/share', 'afp://evil.example/x', 'yarc://ui/index.html']) {
    assert.equal(externalLinkInfo(url, 'https://evil.example/').blocked, true, url)
  }
})

test('pages without a web origin (file:, about:) show no site and are never always-allowed', () => {
  const info = externalLinkInfo('mailto:a@b.c', 'file:///C:/page.html')
  assert.equal(info.site, '')
  assert.equal(info.origin, '')
  assert.equal(info.blocked, false)
})

test('malformed links are refused', () => {
  assert.equal(externalLinkInfo('not a url', 'https://example.com/').blocked, true)
})
