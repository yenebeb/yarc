import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { urlArg } from '../../src/main/launch-args.ts'

const dir = mkdtempSync(join(tmpdir(), 'yarc-launch-'))
const page = (name: string) => {
  const path = join(dir, name)
  writeFileSync(path, '<p>hi</p>')
  return path
}
const exe = 'C:\\Programs\\YARC\\YARC.exe'

test('a web address after the switches and "--" is the one opened', () => {
  assert.equal(urlArg([exe, '--allow-file-access-from-files', '--', 'https://example.com/a?b=1#c'], dir), 'https://example.com/a?b=1#c')
  assert.equal(urlArg([exe, 'HTTP://EXAMPLE.COM'], dir), 'HTTP://EXAMPLE.COM')
  assert.equal(urlArg([exe, 'file:///tmp/x.html'], dir), 'file:///tmp/x.html')
})

test('a double-clicked page with spaces, accents or # in its name becomes its file URL', () => {
  for (const name of ['My Page.html', 'Résumé 履歴書.htm', 'notes #1 100%.HTML']) {
    const path = page(name)
    assert.equal(urlArg([exe, '--', path], dir), pathToFileURL(path).href)
  }
})

test('a relative page is found from the folder it was opened in, not where YARC runs', () => {
  mkdirSync(join(dir, 'site'), { recursive: true })
  const path = page(join('site', 'index.html'))
  assert.equal(urlArg([exe, join('site', 'index.html')], dir), pathToFileURL(path).href)
})

test('nothing to open: no argument, a missing page, other schemes or the app path itself', () => {
  assert.equal(urlArg([exe], dir), undefined)
  assert.equal(urlArg([exe, '--', join(dir, 'gone.html')], dir), undefined)
  assert.equal(urlArg([exe, 'javascript:alert(1)', 'mailto:a@b.c', '--new-tab'], dir), undefined)
  assert.equal(urlArg([page('YARC.html')], dir), undefined)
})
