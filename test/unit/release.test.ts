import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  compareVersions,
  isNewer,
  pickDownload,
  pickMacUpdate,
  releaseAssetUrl,
  windowsInstallerName,
  type GithubRelease
} from '../../src/main/update/release.ts'

test('compareVersions orders release versions numerically', () => {
  assert.equal(compareVersions('0.1.10', '0.1.9'), 1)
  assert.equal(compareVersions('0.2.0', '0.10.0'), -1)
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('1.0', '1.0.0'), 0)
  assert.equal(compareVersions('1.0.0+build.5', '1.0.0'), 0)
})

test('compareVersions puts pre-releases before their release', () => {
  assert.equal(compareVersions('1.0.0-beta.1', '1.0.0'), -1)
  assert.equal(compareVersions('1.0.0', '1.0.0-rc.1'), 1)
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.10'), -1)
  assert.equal(compareVersions('1.0.1-beta.1', '1.0.0'), 1)
})

test('isNewer only reports a strictly newer version', () => {
  assert.equal(isNewer('v0.1.3', '0.1.2'), true)
  assert.equal(isNewer('0.1.2', '0.1.2'), false)
  assert.equal(isNewer('0.1.1', '0.1.2'), false)
})

const release: GithubRelease = {
  tag_name: 'v0.1.3',
  html_url: 'https://github.com/yenebeb/yarc/releases/tag/v0.1.3',
  assets: [
    'YARC-0.1.3-arm64.dmg',
    'YARC-0.1.3-arm64.dmg.blockmap',
    'YARC-0.1.3-x64.dmg',
    'YARC-0.1.3-x64.dmg.blockmap',
    'YARC-0.1.3-arm64-mac.zip',
    'YARC-0.1.3-arm64-mac.zip.sig',
    'YARC-0.1.3-x64-mac.zip',
    'YARC-0.1.3-x86_64.AppImage',
    'YARC-0.1.3-x64.AppImage',
    'YARC-Setup-0.1.3-x64.exe',
    'latest-mac.yml'
  ].map((name) => ({ name, browser_download_url: `https://github.com/yenebeb/yarc/releases/download/v0.1.3/${name}` }))
}
const url = (name: string) => `https://github.com/yenebeb/yarc/releases/download/v0.1.3/${name}`

test('pickDownload picks the DMG for this Mac’s CPU', () => {
  assert.equal(pickDownload(release, 'darwin', 'arm64'), url('YARC-0.1.3-arm64.dmg'))
  assert.equal(pickDownload(release, 'darwin', 'x64'), url('YARC-0.1.3-x64.dmg'))
})

test('pickDownload picks the AppImage on Linux', () => {
  assert.equal(pickDownload(release, 'linux', 'x64'), url('YARC-0.1.3-x64.AppImage'))
})

test('pickDownload falls back to the release page', () => {
  assert.equal(pickDownload(release, 'linux', 'arm64'), release.html_url)
  assert.equal(pickDownload({ ...release, assets: [] }, 'darwin', 'arm64'), release.html_url)
  assert.equal(pickDownload(release, 'freebsd', 'x64'), release.html_url)
})

test('pickMacUpdate picks the signed zip for this Mac’s CPU', () => {
  assert.deepEqual(pickMacUpdate(release, 'arm64'), {
    name: 'YARC-0.1.3-arm64-mac.zip',
    url: url('YARC-0.1.3-arm64-mac.zip'),
    signatureUrl: url('YARC-0.1.3-arm64-mac.zip.sig')
  })
})

test('pickMacUpdate needs a signature', () => {
  assert.equal(pickMacUpdate(release, 'x64'), undefined)
  assert.equal(pickMacUpdate({ ...release, assets: [] }, 'arm64'), undefined)
})

test('windowsInstallerName and releaseAssetUrl find the installer’s signature', () => {
  const name = windowsInstallerName('0.1.3', 'x64')
  assert.equal(name, 'YARC-Setup-0.1.3-x64.exe')
  assert.equal(releaseAssetUrl('0.1.3', `${name}.sig`), url('YARC-Setup-0.1.3-x64.exe.sig'))
})

test('links outside YARC\'s releases are never offered', () => {
  const elsewhere = {
    ...release,
    html_url: 'file:///Applications/Calculator.app',
    assets: release.assets.map((a) => ({ ...a, browser_download_url: `https://evil.example/${a.name}` }))
  }
  assert.equal(pickDownload(elsewhere, 'darwin', 'arm64'), 'https://github.com/yenebeb/yarc/releases')
  assert.equal(pickMacUpdate(elsewhere, 'arm64'), undefined)
})
