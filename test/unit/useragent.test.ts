import assert from 'node:assert/strict'
import { test } from 'node:test'
import { browserUserAgent, chromeBrands, clientHintsFor, userAgentFor } from '../../src/main/useragent.ts'

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

test('eBay gets the UA without Electron on its own domains, and lookalikes do not', () => {
  assert.equal(userAgentFor('https://www.ebay.com/sch/i.html?_nkw=lenovo+laptop', browser), chrome)
  assert.equal(userAgentFor('https://ebay.com/', browser), chrome)
  assert.equal(userAgentFor('https://www.ebay.co.uk/', browser), chrome)
  assert.equal(userAgentFor('https://www.ebay.com.evil.example/', browser), browser)
  assert.equal(userAgentFor('https://notebay.com/', browser), browser)
})

test('the brand list matches what Chrome 156, 157 and 158 send', () => {
  assert.equal(chromeBrands(156), '"Not:A-Brand";v="8", "Chromium";v="156"')
  assert.equal(chromeBrands(157), '"Chromium";v="157", "Not-A.Brand";v="99"')
  assert.equal(chromeBrands(158), '"Not.A/Brand";v="24", "Chromium";v="158"')
})

test('sites that want Chrome identity get its client hints, every other site none', () => {
  assert.deepEqual(clientHintsFor('https://www.ebay.com/', '156.0.8078.109', 'darwin'), {
    'sec-ch-ua': '"Not:A-Brand";v="8", "Chromium";v="156"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"'
  })
  assert.equal(clientHintsFor('https://teams.microsoft.com/', '156.0.8078.109', 'win32')['sec-ch-ua-platform'], '"Windows"')
  assert.deepEqual(clientHintsFor('https://accounts.google.com/signin', '156.0.8078.109', 'darwin'), {})
})
