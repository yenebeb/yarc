import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { DownloadBurst, isDangerous } from '../../src/main/core/downloads.ts'

describe('which downloads ask before they open', () => {
  test('programs and scripts ask, whatever the case of the extension', () => {
    for (const name of ['setup.exe', 'Invoice.pdf.HTA', 'run.command', 'install.pkg', 'tool.sh', 'shortcut.lnk']) assert.equal(isDangerous(name), true, name)
  })

  test('documents, images and archives open straight away', () => {
    for (const name of ['report.pdf', 'photo.jpg', 'notes.txt', 'archive.zip', 'no-extension']) assert.equal(isDangerous(name), false, name)
  })
})

describe('a site starting many downloads at once', () => {
  test('three downloads go through, the fourth within ten seconds is refused', () => {
    let now = 0
    const burst = new DownloadBurst(() => now)
    assert.deepEqual([1, 2, 3, 4].map(() => burst.allow('p1|evil.example')), [true, true, true, false])
  })

  test('other sites and later downloads are not affected', () => {
    let now = 0
    const burst = new DownloadBurst(() => now)
    for (let i = 0; i < 3; i++) burst.allow('p1|evil.example')
    assert.equal(burst.allow('p1|good.example'), true)
    now = 10_001
    assert.equal(burst.allow('p1|evil.example'), true)
  })
})
