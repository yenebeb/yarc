import assert from 'node:assert/strict'
import { test } from 'node:test'
import { browserUserAgent, userAgentFor } from '../../src/main/useragent.ts'

const electron = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) YARC/0.1.17 Chrome/156.0.8078.75 Electron/45.2.1 Safari/537.36'
const browser = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.75 Electron/45.2.1 Safari/537.36'
const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.75 Safari/537.36'

test('the browser UA drops the app name but keeps Electron, for Google sign-in', () => {
  assert.equal(browserUserAgent(electron), browser)
})

test('Teams gets the UA without Electron, so meeting links open its web app', () => {
  assert.equal(userAgentFor('https://teams.microsoft.com/meet/283207184529638?p=abc', browser), chrome)
  assert.equal(userAgentFor('https://teams.live.com/meet/9876', browser), chrome)
  assert.equal(userAgentFor('https://teams.cloud.microsoft/v2/', browser), chrome)
})

test('every other site keeps the browser UA', () => {
  assert.equal(userAgentFor('https://accounts.google.com/signin', browser), browser)
  assert.equal(userAgentFor('https://login.microsoftonline.com/common/oauth2', browser), browser)
  assert.equal(userAgentFor('https://teams.microsoft.com.evil.example/', browser), browser)
  assert.equal(userAgentFor('not a url', browser), browser)
})
