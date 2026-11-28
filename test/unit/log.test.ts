import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { LogFile, logError, logProblem, setLogContext, startLog } from '../../src/main/core/log.ts'

const noon = () => new Date('2026-11-20T12:00:00.000Z')
const freshFile = () => join(mkdtempSync(join(tmpdir(), 'yarc-log-')), 'logs', 'main.log')

describe('the log file', () => {
  test('each entry is one line: time, level, text', () => {
    const file = freshFile()
    const log = new LogFile(file, noon)
    log.write('info', 'window 1 opened')
    log.write('error', 'activate failed')
    assert.equal(readFileSync(file, 'utf8'), '2026-11-20T12:00:00.000Z INFO window 1 opened\n2026-11-20T12:00:00.000Z ERROR activate failed\n')
  })

  test('only this user can read it: it can name the pages that failed', { skip: process.platform === 'win32' }, () => {
    const file = freshFile()
    new LogFile(file).write('info', 'started')
    assert.equal(statSync(file).mode & 0o777, 0o600)
  })

  test('past 1 MB it moves to main.log.old, replacing the older one, and a new log starts', () => {
    const file = freshFile()
    const log = new LogFile(file, noon)
    log.write('info', 'first')
    writeFileSync(file, 'x'.repeat(1_000_001))
    writeFileSync(`${file}.old`, 'the log before')

    log.write('info', 'after the move')
    assert.equal(statSync(`${file}.old`).size, 1_000_001)
    assert.equal(readFileSync(file, 'utf8'), '2026-11-20T12:00:00.000Z INFO after the move\n')
  })

  test('a log that cannot be written is skipped without throwing', () => {
    const blocked = join(mkdtempSync(join(tmpdir(), 'yarc-log-')), 'a-file')
    writeFileSync(blocked, '')
    assert.doesNotThrow(() => new LogFile(join(blocked, 'main.log')).write('error', 'lost'))
  })
})

describe('what an error entry says', () => {
  // One started log for this file: startLog changes console and process listeners for good.
  const file = freshFile()
  startLog(file)

  test('an error carries its stack and which windows were open', () => {
    setLogContext(() => 'main: current 6c1a9717, open [6c1a9717, f2ac39f5]')
    logError('arc:action activate', new TypeError('view is undefined'))
    const text = readFileSync(file, 'utf8')
    assert.match(text, /ERROR arc:action activate: TypeError: view is undefined\n {4}at /)
    assert.match(text, /context: main: current 6c1a9717, open \[6c1a9717, f2ac39f5\]/)
  })

  test('a problem that did not throw says where it was noticed', () => {
    logProblem('window 6c1a9717 made current after it closed')
    assert.match(readFileSync(file, 'utf8'), /WARN window 6c1a9717 made current after it closed\n {2}context: .*\n {4}at /)
  })

  test('the error is still logged when describing the windows fails', () => {
    setLogContext(() => {
      throw new Error('window destroyed')
    })
    logError('arc:action close', new Error('boom'))
    const text = readFileSync(file, 'utf8')
    assert.match(text, /arc:action close: Error: boom/)
    assert.match(text, /context unavailable: Error: window destroyed/)
  })

  test('console.error and console.warn in main also go to the log', (t) => {
    t.mock.method(process.stderr, 'write', () => true)
    console.error('[store] could not read state')
    console.warn('[share] no screens or windows to offer')
    const text = readFileSync(file, 'utf8')
    assert.match(text, /ERROR \[store\] could not read state/)
    assert.match(text, /WARN \[share\] no screens or windows to offer/)
  })

  test("Electron's own copy of a failed UI call is left out: the UI call's entry already has it", (t) => {
    t.mock.method(process.stderr, 'write', () => true)
    console.error("Error occurred in handler for 'arc:action':", new Error('boom'))
    assert.doesNotMatch(readFileSync(file, 'utf8'), /Error occurred in handler/)
  })

  test('the log starts with a line saying the app started', () => {
    assert.ok(existsSync(file))
    assert.match(readFileSync(file, 'utf8').split('\n')[0], /INFO started, pid \d+$/)
  })
})
